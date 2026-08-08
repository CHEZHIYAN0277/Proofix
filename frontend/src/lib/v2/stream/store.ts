/**
 * `RunStore` — the live state layer (blueprint §12).
 *
 * One writer (the stream), selector-scoped readers. A context provider would
 * re-render every consumer on every frame; with seven stages of graph canvases
 * that is unaffordable, so this is a plain external store read through
 * `useSyncExternalStore`.
 *
 * The contract that makes selectors cheap: **every slice keeps its object
 * identity until its own content changes.** A frame for A7 replaces the `patch`
 * stage slice and nothing else, so a component subscribed to `repository` does
 * not re-render.
 *
 * A frame says *what changed*; REST says *what it is now*. Nothing here
 * reconstructs a stage's output from a payload — that is TanStack Query's job.
 */

import type { AgentEventStatus, StageProgress } from "../types";
import type { RunFrame } from "./frames";
import { frameKey } from "./frames";

/* -------------------------------------------------------------------------
   Shape
   ---------------------------------------------------------------------- */

/**
 * Agent status as the *stream* sees it.
 *
 * Deliberately not the backend projection's status: `build_agent_entries`
 * reports `running` for an agent with no events on a live run
 * (`ui_projection.py:427`), which would show every unstarted agent as active.
 * An agent that has emitted nothing is `waiting`, and that is a fact the frame
 * history states directly.
 */
export type AgentRuntimeStatus = "waiting" | "running" | "retrying" | "completed" | "failed";

export interface AgentRuntimeState {
  agentId: string;
  status: AgentRuntimeStatus;
  /** Latest message this agent emitted. Frozen once it settles. */
  message: string;
  startedAt: number | null;
  endedAt: number | null;
  frameCount: number;
  retries: number;
  /**
   * Only A4 and A6 publish a confidence. Every other agent leaves this `null`,
   * which renders "Not published" — synthesizing one per agent is precisely
   * the failure this product exists to prevent.
   */
  confidence: number | null;
}

export type StageRuntimeStatus =
  "waiting" | "running" | "retrying" | "completed" | "failed" | "skipped";

export interface StageRuntimeState {
  id: string;
  status: StageRuntimeStatus;
  agents: Record<string, AgentRuntimeState>;
  startedAt: number | null;
  endedAt: number | null;
}

export interface ActivityEntry {
  id: string;
  agentId: string;
  /** `null` when the frame came from an agent the topology does not place. */
  stageId: string | null;
  message: string;
  at: number;
  status: AgentEventStatus;
  /**
   * Which repair attempt this frame belongs to, or `null` outside the retry
   * loop.
   *
   * The retry loop re-runs the same agents with the same messages, so a run
   * with four attempts produced four rows reading "Generated 0 patches from 0
   * plans", all within the same second and identical in every visible respect.
   * Verified against the backend, those were four genuine executions — but the
   * feed gave the viewer no way to tell that from a rendering fault.
   *
   * The number is the store's own attempt index, not a re-derivation: it is
   * assigned when the frame is applied, from the same counter that drives the
   * attempt switcher.
   */
  attempt: number | null;
}

export interface TimelineEntry {
  id: string;
  stageId: string;
  kind: "stage-started" | "stage-ended" | "decision";
  label: string;
  at: number;
  status: StageRuntimeStatus | null;
}

export interface AttemptEntry {
  index: number;
  startedAt: number;
  /** Sequence numbers of the frames belonging to this attempt. */
  frames: number[];
}

export type ConnectionState = "idle" | "replaying" | "live" | "reconnecting" | "closed";

export interface TerminalState {
  /**
   * `blocked` = the environment precheck stopped the run before reproduction.
   * Kept distinct from `failed` so the UI can explain rather than apologise.
   */
  kind: "completed" | "failed" | "blocked";
  decision: string | null;
  decisionLabel: string;
  reason: string | null;
  at: number;
}

export interface RunStoreSnapshot {
  frames: RunFrame[];
  lastSequence: number;
  /**
   * When the run began, as the backend timestamped it: the `run.started`
   * lifecycle frame, or the earliest frame seen when a run predates lifecycle
   * events. `null` until something has been observed — the elapsed counter
   * renders `Waiting` rather than counting from page load.
   */
  startedAt: number | null;
  stages: Record<string, StageRuntimeState>;
  /** Ordered stage ids, as published by the backend. */
  stageOrder: string[];
  activeStage: string | null;
  attempts: AttemptEntry[];
  activity: ActivityEntry[];
  timeline: TimelineEntry[];
  connection: ConnectionState;
  terminal: TerminalState | null;
}

/** Blueprint §4.3 — the feed is capped and virtualized. */
export const ACTIVITY_CAP = 200;

/** A7 beginning again is what starts a new repair attempt. */
const ATTEMPT_AGENT_ID = "A7";

const EMPTY_SNAPSHOT: RunStoreSnapshot = {
  frames: [],
  lastSequence: -1,
  startedAt: null,
  stages: {},
  stageOrder: [],
  activeStage: null,
  attempts: [],
  activity: [],
  timeline: [],
  connection: "idle",
  terminal: null,
};

/* -------------------------------------------------------------------------
   Store
   ---------------------------------------------------------------------- */

export interface RunStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => RunStoreSnapshot;
  getServerSnapshot: () => RunStoreSnapshot;
  /** Apply one normalised frame. Idempotent — duplicates are dropped. */
  apply: (frame: RunFrame) => void;
  setConnection: (state: ConnectionState) => void;
  /**
   * Record a terminal state that did not arrive as a lifecycle frame.
   *
   * Runs created before `run.completed` / `run.failed` existed carry the
   * outcome only on `GET /runs/{id}` — `status` plus `decisionLabel`. That is
   * still the backend stating how the run ended, so it is honoured; a
   * lifecycle frame always wins, and this never overwrites one.
   */
  setTerminal: (terminal: TerminalState) => void;
  /**
   * Teach the store which agents belong to which stage, and in what order.
   * Sourced from `GET /runs/{id}/stages` — the backend owns this mapping and
   * the store never guesses it.
   */
  setTopology: (stages: StageProgress[]) => void;
  reset: () => void;
}

export function createRunStore(): RunStore {
  let snapshot: RunStoreSnapshot = EMPTY_SNAPSHOT;
  const listeners = new Set<() => void>();

  /** agentId → stageId, from the backend. */
  let stageOfAgent: Record<string, string> = {};
  /**
   * stageId → every agent the backend places in it.
   *
   * The roll-up needs the *full roster*, not just the agents that have
   * reported: with only the reported ones in hand, a stage whose first agent
   * finished looks unanimously complete and flips to `completed` while three
   * more agents are still to run.
   */
  let rosterOfStage: Record<string, string[]> = {};
  /** Frames applied already, by stable key. */
  const seen = new Set<string>();
  /**
   * Frames that arrived before the topology did. The socket opens as soon as
   * the run id is known, which can beat the stages query; buffering means those
   * frames land in the right stage instead of being dropped or misfiled.
   */
  let orphaned: RunFrame[] = [];

  const emit = () => {
    for (const listener of listeners) listener();
  };

  /* --- derivation ------------------------------------------------------ */

  function emptyAgent(agentId: string): AgentRuntimeState {
    return {
      agentId,
      status: "waiting",
      message: "",
      startedAt: null,
      endedAt: null,
      frameCount: 0,
      retries: 0,
      confidence: null,
    };
  }

  /** Only a numeric confidence actually present in the payload is published. */
  function readConfidence(payload: Record<string, unknown> | null): number | null {
    if (!payload) return null;
    const direct = payload.confidence;
    if (typeof direct === "number" && Number.isFinite(direct)) return direct;
    const nested = payload.root_cause;
    if (nested && typeof nested === "object") {
      const value = (nested as Record<string, unknown>).confidence;
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
  }

  function nextAgentState(
    prev: AgentRuntimeState,
    frame: Extract<RunFrame, { kind: "agent" }>,
  ): AgentRuntimeState {
    const status: AgentRuntimeStatus =
      frame.status === "completed"
        ? "completed"
        : frame.status === "failed"
          ? "failed"
          : frame.status === "retry"
            ? "retrying"
            : "running";

    const terminal = status === "completed" || status === "failed";

    return {
      agentId: prev.agentId,
      status,
      message: frame.message || prev.message,
      startedAt: prev.startedAt ?? frame.at,
      endedAt: terminal ? frame.at : null,
      frameCount: prev.frameCount + 1,
      retries: prev.retries + (frame.status === "retry" ? 1 : 0),
      confidence: readConfidence(frame.payload) ?? prev.confidence,
    };
  }

  /**
   * Roll agent statuses up to their stage.
   *
   * Order matters and mirrors the backend's own rule (`_stage_status`): a
   * failure outranks everything, work in flight outranks finished work, and a
   * stage nothing has reported is `waiting` — never `completed`. Claiming a
   * stage finished when no agent said so is the error this layer exists to
   * avoid.
   */
  function rollUp(stageId: string, agents: Record<string, AgentRuntimeState>): StageRuntimeStatus {
    const reported = Object.values(agents).map((a) => a.status);
    if (reported.length === 0) return "waiting";
    if (reported.includes("failed")) return "failed";
    if (reported.includes("running")) return "running";
    if (reported.includes("retrying")) return "retrying";

    // Every agent that has spoken is done — but the stage is only done if
    // every agent the backend placed here has spoken. An agent yet to emit is
    // work still ahead, so the stage stays in flight.
    const roster = rosterOfStage[stageId];
    const silent = roster ? roster.filter((id) => agents[id] === undefined).length : 0;
    if (silent > 0) return "running";

    return "completed";
  }

  function recomputeActiveStage(
    stages: Record<string, StageRuntimeState>,
    order: string[],
  ): string | null {
    const live = order.find((id) => {
      const s = stages[id];
      return s && (s.status === "running" || s.status === "retrying");
    });
    if (live) return live;

    const settled = [...order].reverse().find((id) => {
      const s = stages[id];
      return s && (s.status === "completed" || s.status === "failed");
    });
    return settled ?? order[0] ?? null;
  }

  /* --- apply ----------------------------------------------------------- */

  function applyAgentFrame(frame: Extract<RunFrame, { kind: "agent" }>): void {
    const stageId = stageOfAgent[frame.agentId];
    if (!stageId) {
      // Unknown agent — a fan-out id like `A1+A2+A3`, or one whose topology
      // has not arrived. Buffered rather than dropped; `setTopology` replays
      // it. The activity entry was already recorded by `apply`.
      orphaned.push(frame);
      return;
    }

    const prevStage = snapshot.stages[stageId] ?? {
      id: stageId,
      status: "waiting" as StageRuntimeStatus,
      agents: {},
      startedAt: null,
      endedAt: null,
    };
    const prevAgent = prevStage.agents[frame.agentId] ?? emptyAgent(frame.agentId);
    const agent = nextAgentState(prevAgent, frame);

    const agents = { ...prevStage.agents, [frame.agentId]: agent };
    const status = rollUp(stageId, agents);
    const settled = status === "completed" || status === "failed";

    const stage: StageRuntimeState = {
      id: stageId,
      status,
      agents,
      startedAt: prevStage.startedAt ?? frame.at,
      endedAt: settled ? frame.at : null,
    };

    const stages = { ...snapshot.stages, [stageId]: stage };
    const timeline = pushTimeline(snapshot.timeline, prevStage, stage, frame.at);
    const attempts =
      frame.agentId === ATTEMPT_AGENT_ID && frame.status === "started"
        ? [
            ...snapshot.attempts,
            {
              index: snapshot.attempts.length + 1,
              startedAt: frame.at,
              frames: [frame.sequence],
            },
          ]
        : appendAttemptFrame(snapshot.attempts, frame.sequence);

    snapshot = {
      ...snapshot,
      stages,
      activeStage: recomputeActiveStage(stages, snapshot.stageOrder),
      timeline,
      attempts,
    };
  }

  function pushActivity(
    activity: ActivityEntry[],
    frame: Extract<RunFrame, { kind: "agent" }>,
    stageId: string | null,
  ): ActivityEntry[] {
    // No client-authored entries. If the backend never said it, the feed never
    // shows it — so a frame with no message contributes nothing.
    if (!frame.message) return activity;

    // `pushActivity` runs before `applyAgentFrame`, so the attempt this frame
    // belongs to is not in `snapshot.attempts` yet when the frame is the one
    // that opens it. Mirroring that agent's own rule here — rather than reading
    // the count afterwards — keeps the two in step by construction.
    const opensAttempt = frame.agentId === ATTEMPT_AGENT_ID && frame.status === "started";
    const attempt = opensAttempt
      ? snapshot.attempts.length + 1
      : snapshot.attempts.length > 0
        ? snapshot.attempts.length
        : null;

    const entry: ActivityEntry = {
      id: frameKey(frame),
      agentId: frame.agentId,
      stageId,
      message: frame.message,
      at: frame.at,
      status: frame.status,
      attempt,
    };
    // Newest first, capped.
    return [entry, ...activity].slice(0, ACTIVITY_CAP);
  }

  function pushTimeline(
    timeline: TimelineEntry[],
    prev: StageRuntimeState,
    next: StageRuntimeState,
    at: number,
  ): TimelineEntry[] {
    const out = timeline;

    // First frame for the stage.
    if (prev.startedAt === null && next.startedAt !== null) {
      return [
        ...out,
        {
          id: `${next.id}:started`,
          stageId: next.id,
          kind: "stage-started",
          label: "Started",
          at: next.startedAt,
          status: next.status,
        },
      ];
    }

    // Stage reached a terminal state.
    const wasSettled = prev.status === "completed" || prev.status === "failed";
    const isSettled = next.status === "completed" || next.status === "failed";
    if (!wasSettled && isSettled) {
      // The timeline is a milestone view: the first `started` and the **last**
      // terminal frame per stage (§4.4). A retried stage settles more than
      // once, so a later ending replaces the earlier one rather than stacking
      // — otherwise three retries read as three separate stages finishing.
      const entry: TimelineEntry = {
        id: `${next.id}:ended`,
        stageId: next.id,
        kind: "stage-ended",
        label: next.status === "failed" ? "Failed" : "Completed",
        at,
        status: next.status,
      };
      return [...out.filter((e) => e.id !== entry.id), entry];
    }

    return out;
  }

  function appendAttemptFrame(attempts: AttemptEntry[], sequence: number): AttemptEntry[] {
    if (attempts.length === 0) return attempts;
    const last = attempts[attempts.length - 1];
    return [...attempts.slice(0, -1), { ...last, frames: [...last.frames, sequence] }];
  }

  function applyLifecycleFrame(frame: Extract<RunFrame, { kind: "lifecycle" }>): void {
    if (frame.type === "run.started") {
      // Authoritative start. Overrides the first-frame fallback below, which is
      // only ever an approximation for runs that predate lifecycle events.
      snapshot = { ...snapshot, startedAt: frame.at };
      return;
    }

    const terminal: TerminalState = {
      kind:
        frame.type === "run.completed"
          ? "completed"
          : frame.type === "run.blocked"
            ? "blocked"
            : "failed",
      decision: frame.decision,
      decisionLabel: frame.decisionLabel,
      reason: frame.reason,
      at: frame.at,
    };

    snapshot = {
      ...snapshot,
      terminal,
      timeline: [
        ...snapshot.timeline,
        {
          id: `run:${frame.type}`,
          stageId: snapshot.activeStage ?? "",
          kind: "decision",
          label:
            frame.decisionLabel || (terminal.kind === "failed" ? "Run failed" : "Run completed"),
          at: frame.at,
          status: null,
        },
      ],
    };
  }

  /* --- public ---------------------------------------------------------- */

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY_SNAPSHOT,

    apply(frame) {
      const key = frameKey(frame);
      if (seen.has(key)) return;
      seen.add(key);

      snapshot = {
        ...snapshot,
        frames: [...snapshot.frames, frame],
        lastSequence: Math.max(snapshot.lastSequence, frame.sequence),
        // Fallback for runs with no `run.started` frame: the earliest thing the
        // backend timestamped. Never the page-load time — that would count the
        // viewer's session, not the run.
        startedAt: snapshot.startedAt === null ? frame.at : Math.min(snapshot.startedAt, frame.at),
      };

      if (frame.kind === "agent") {
        // Recorded here, exactly once per unique frame. Doing it inside
        // `applyAgentFrame` would double-count every frame that arrives before
        // the topology, since `setTopology` replays those.
        snapshot = {
          ...snapshot,
          activity: pushActivity(snapshot.activity, frame, stageOfAgent[frame.agentId] ?? null),
        };
        applyAgentFrame(frame);
      } else {
        applyLifecycleFrame(frame);
      }

      emit();
    },

    setTerminal(terminal) {
      if (snapshot.terminal) return;
      snapshot = { ...snapshot, terminal };
      emit();
    },

    setConnection(state) {
      if (snapshot.connection === state) return;
      snapshot = { ...snapshot, connection: state };
      emit();
    },

    setTopology(stages) {
      const ordered = [...stages].sort((a, b) => a.order - b.order);
      const order = ordered.map((s) => s.id);

      const nextStageOfAgent: Record<string, string> = {};
      const nextRoster: Record<string, string[]> = {};
      for (const stage of ordered) {
        nextRoster[stage.id] = stage.agents.map((a) => a.agentId);
        for (const agent of stage.agents) nextStageOfAgent[agent.agentId] = stage.id;
      }

      // Nothing changed — keep every slice's identity so no consumer re-renders.
      const sameAgents =
        Object.keys(nextStageOfAgent).length === Object.keys(stageOfAgent).length &&
        Object.entries(nextStageOfAgent).every(([k, v]) => stageOfAgent[k] === v);
      const sameOrder =
        order.length === snapshot.stageOrder.length &&
        order.every((id, i) => snapshot.stageOrder[i] === id);
      if (sameAgents && sameOrder) return;

      stageOfAgent = nextStageOfAgent;
      rosterOfStage = nextRoster;

      // Seed every published stage so the rail renders the full pipeline
      // immediately, with unreported stages honestly `waiting`.
      const nextStages: Record<string, StageRuntimeState> = {};
      for (const stage of ordered) {
        nextStages[stage.id] = snapshot.stages[stage.id] ?? {
          id: stage.id,
          status: "waiting",
          agents: {},
          startedAt: null,
          endedAt: null,
        };
      }

      snapshot = {
        ...snapshot,
        stages: nextStages,
        stageOrder: order,
        activeStage: recomputeActiveStage(nextStages, order),
      };

      // Replay anything that arrived before the topology did, and backfill the
      // stage on the activity rows those frames already produced — otherwise
      // the earliest entries in the feed stay unclickable for the whole run.
      const pending = orphaned;
      orphaned = [];
      for (const frame of pending) {
        if (frame.kind === "agent" && stageOfAgent[frame.agentId]) applyAgentFrame(frame);
      }

      if (pending.length > 0) {
        snapshot = {
          ...snapshot,
          activity: snapshot.activity.map((entry) =>
            entry.stageId === null && stageOfAgent[entry.agentId]
              ? { ...entry, stageId: stageOfAgent[entry.agentId] }
              : entry,
          ),
        };
      }

      emit();
    },

    reset() {
      snapshot = EMPTY_SNAPSHOT;
      seen.clear();
      orphaned = [];
      stageOfAgent = {};
      rosterOfStage = {};
      emit();
    },
  };
}
