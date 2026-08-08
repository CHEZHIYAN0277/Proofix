/**
 * Live execution event source backed by the ProoFix backend.
 *
 * Mirrors the contract of `createMockEventSource`: given the agent list, emit
 * `ExecutionEvent`s and return a dispose function. `useExecutionRun` stays a
 * pure reducer — it never learns where events come from.
 *
 * Transport: replays `GET /api/runs/:id/events` for history, then attaches to
 * `WS /ws/runs/:id` for live frames. Backend `AgentStatusEvent`s are translated
 * into the UI's card-indexed events here.
 *
 * Backend frames arrive in bursts — history replays dozens at once, and a
 * single `completed` frame stands for a whole card's narrative. Emitting those
 * straight through collapses into one React render and the journal's reveal
 * animations never mount. So translated events go through a paced drain queue:
 * one event per tick, accelerating while a backlog exists so catching up on a
 * finished run stays quick, settling to a readable cadence once caught up.
 */
import { API_BASE_URL, ENDPOINTS, apiFetch } from "@/lib/api";
import type { AgentEntry, AgentStatus } from "./data";
import type { EventEmitter, EventSourceFactory, ExecutionEvent } from "./mockEventStream";

/** Backend agent_id -> frontend card id. Mirrors backend AGENT_REGISTRY. */
const CARD_BY_AGENT_ID: Record<string, string> = {
  A1: "repo-intel",
  A2: "deps",
  A3: "static",
  "A3.5": "reproduce",
  A4: "root",
  A5: "blast",
  A6: "planner",
  A7: "patch",
  A8: "mutation",
  A9: "security",
  A10: "merge",
};

/** A1/A2/A3 run concurrently and report under a combined id. */
const FAN_OUT_AGENT_IDS = new Set(["A1+A2+A3", "fan-in"]);

export interface BackendAgentEvent {
  run_id: string;
  agent_id: string;
  status: "started" | "progress" | "completed" | "failed" | "retry";
  timestamp: string;
  message: string;
  payload?: Record<string, unknown> | null;
  sequence: number;
}

function statusToAgentStatus(status: BackendAgentEvent["status"]): AgentStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "retry":
      return "retry";
    default:
      return "running";
  }
}

/** Cadence a single reveal plays at once the queue has caught up. */
const LINE_INTERVAL_MS = 460;
/** Floor for the accelerated catch-up cadence. */
const MIN_INTERVAL_MS = 60;
/** Backlog beyond which the queue starts draining faster than real time. */
const CATCH_UP_THRESHOLD = 6;

function websocketUrl(runId: string): string {
  const base = API_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");
  const url = new URL(`/ws/runs/${encodeURIComponent(runId)}`, base || "http://127.0.0.1:8000");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Build an event source bound to a specific run.
 *
 * Terminal runs (already completed before the UI attached) replay their full
 * history and finish immediately, so opening an old run renders the same
 * journal as watching it live.
 */
export function createLiveEventSource(runId: string): EventSourceFactory {
  // Reveal progress lives on the factory, not the subscription. The workspace
  // memoises one factory per run id, so when polling swaps in a longer agent
  // list and `useExecutionRun` re-subscribes, the history replay recognises
  // what the user has already watched and only queues genuinely new lines.
  //
  // Two levels of bookkeeping, because queued is not the same as delivered: a
  // subscription can be disposed with events still in its queue, and those
  // never reach the reducer. `emitted*` records what the user actually saw and
  // is the state a fresh subscription resumes from; `queued*` additionally
  // covers what is still in flight, so replaying history does not double-queue.
  // On dispose the queued level rolls back to the emitted level, letting the
  // next subscription re-queue whatever the old one dropped.
  const emittedLines = new Map<string, number>();
  const emittedFinal = new Set<string>();
  let queuedLines = new Map<string, number>();
  let queuedFinal = new Set<string>();

  return (agents: AgentEntry[], emit: EventEmitter) => {
    // No run selected yet — nothing to stream.
    if (!runId || runId === "vulnapi-live") return () => undefined;

    const indexByCard = new Map(agents.map((agent, index) => [agent.id, index]));
    const cardByIndex = new Map(agents.map((agent, index) => [index, agent.id]));
    const linesByCard = new Map(agents.map((agent) => [agent.id, agent.lines.length]));

    let disposed = false;
    let socket: WebSocket | null = null;

    // ---- paced drain queue ------------------------------------------------
    const queue: ExecutionEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Shrink the gap while a backlog exists so replaying a finished run's
    // history animates without making the user wait out every line in it.
    const nextDelay = () =>
      queue.length > CATCH_UP_THRESHOLD
        ? Math.max(
            MIN_INTERVAL_MS,
            Math.round((LINE_INTERVAL_MS * CATCH_UP_THRESHOLD) / queue.length),
          )
        : LINE_INTERVAL_MS;

    const pump = () => {
      if (disposed || timer) return;
      const event = queue.shift();
      if (!event) return;

      // Promote to the delivered level only now that the reducer has it.
      const card = event.type === "run.completed" ? undefined : cardByIndex.get(event.index);
      if (card) {
        if (event.type === "agent.line") {
          emittedLines.set(card, Math.max(emittedLines.get(card) ?? 0, event.lineIndex));
        } else if (event.type === "agent.finalized") {
          emittedFinal.add(card);
        }
      }

      emit(event);
      timer = setTimeout(() => {
        timer = null;
        pump();
      }, nextDelay());
    };

    const enqueue = (event: ExecutionEvent) => {
      if (disposed) return;
      queue.push(event);
      pump();
    };

    const applyEvent = (event: BackendAgentEvent) => {
      if (FAN_OUT_AGENT_IDS.has(event.agent_id)) return;

      const card = CARD_BY_AGENT_ID[event.agent_id];
      if (!card) return;
      const index = indexByCard.get(card);
      if (index === undefined) return;

      const total = linesByCard.get(card) ?? 0;
      const seen = queuedLines.get(card) ?? 0;
      const terminal = event.status === "completed" || event.status === "failed";

      // Nothing new to show for this card — don't re-announce it as active.
      if (seen >= total && (!terminal || queuedFinal.has(card))) return;

      enqueue({ type: "agent.started", index });

      // A terminal frame stands for the card's whole remaining narrative; any
      // other frame advances by one. Either way the lines are queued one at a
      // time so each types in instead of the card jumping to its end state.
      const target = terminal ? total : Math.min(seen + 1, total);
      for (let lineIndex = seen + 1; lineIndex <= target; lineIndex += 1) {
        enqueue({ type: "agent.line", index, lineIndex });
      }
      queuedLines.set(card, Math.max(seen, target));

      if (terminal) {
        queuedFinal.add(card);
        enqueue({
          type: "agent.finalized",
          index,
          status: statusToAgentStatus(event.status),
        });
      }
    };

    const attachSocket = () => {
      if (disposed || typeof WebSocket === "undefined") return;
      try {
        socket = new WebSocket(websocketUrl(runId));
      } catch {
        return;
      }

      socket.onmessage = (message) => {
        try {
          const parsed = JSON.parse(message.data as string);
          if (parsed?.type === "ping") return;
          // The backend says outright when the run has settled. Queued rather
          // than applied immediately so the end-of-run report reveal waits for
          // the journal to finish playing instead of firing while lines are
          // still arriving.
          if (parsed?.type === "run.completed") {
            enqueue({ type: "run.completed" });
            return;
          }
          applyEvent(parsed as BackendAgentEvent);
        } catch {
          /* ignore malformed frames */
        }
      };

      // Deliberately no `onclose` handler: a close is not evidence the run
      // finished. Dropped wifi, a backend restart and a proxy timeout all close
      // the socket mid-run, and treating that as completion showed the user a
      // final report for a run that was still going. Completion arrives only as
      // the explicit frame above, or from the history replay below.
    };

    // Replay history first so a mid-run attach still shows everything.
    void (async () => {
      try {
        const history = await apiFetch<BackendAgentEvent[]>(ENDPOINTS.runEvents(runId));
        if (disposed) return;
        history.forEach(applyEvent);

        const finished = history.some(
          (event) => event.agent_id === "A10" && event.status === "completed",
        );
        if (finished) {
          enqueue({ type: "run.completed" });
          return;
        }
      } catch {
        /* fall through to the socket — history is best-effort */
      }
      attachSocket();
    })();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      queue.length = 0;
      // Anything still queued never reached the reducer. Forget it so the next
      // subscription re-queues it instead of skipping it as already shown.
      queuedLines = new Map(emittedLines);
      queuedFinal = new Set(emittedFinal);
      socket?.close();
      socket = null;
    };
  };
}
