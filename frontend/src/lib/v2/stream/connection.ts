/**
 * Run connection: replay → WebSocket → backoff (blueprint §12, Phase 1).
 *
 * The transport, and only the transport. It normalises frames, paces them
 * through the queue, and pushes them into the store. It renders nothing and
 * derives nothing.
 *
 * Deliberately no `onclose = complete`: a close is not evidence the run
 * finished. Dropped wifi, a backend restart and a proxy timeout all close the
 * socket mid-run, and treating that as completion shows a final report for a
 * run that is still going. Completion arrives only as an explicit lifecycle
 * frame — which the backend now emits (`run.completed` / `run.failed`).
 */

import { runSocketUrl, v2Fetch, V2_ENDPOINTS } from "../endpoints";
import { isLegacyTerminalFrame, normalizeFrame, type RunFrame } from "./frames";
import { createPacedQueue, type PacedQueue, type PacingOptions } from "./queue";
import type { RunStore } from "./store";

/** Reconnect backoff, in ms. Caps rather than growing without bound. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];

export interface ConnectionOptions {
  runId: string;
  store: RunStore;
  /** Bypasses the paced queue — set under `prefers-reduced-motion`. */
  immediate?: boolean;
  /** Initial reveal cadence. Changed later with `setPacing`. */
  pacing?: PacingOptions;
  /** Invoked for every applied frame, after the store has it. */
  onFrame?: (frame: RunFrame) => void;
}

export interface RunConnection {
  /**
   * Push a frame the socket did not deliver — today, a terminal state
   * recovered from `GET /runs/{id}` for runs that predate lifecycle events.
   *
   * It goes through the same paced queue as everything else. Applying it
   * directly would let the ending overtake the history still draining behind
   * it, so the header would announce "Draft PR" while the narrative was three
   * stages back. **Timing lives in the queue and nowhere else** (§13).
   */
  enqueue: (frame: RunFrame) => void;
  /**
   * Re-pace the reveal without dropping frames in flight (playback modes).
   * Pure presentation: the transport, the backend and the store are untouched.
   */
  setPacing: (pacing: PacingOptions) => void;
  /**
   * Replay the run's stored events from the beginning.
   *
   * Reuses the existing history endpoint and the existing queue — no separate
   * animation system, and nothing is regenerated. The store is reset first
   * because it deduplicates by sequence, so without that every replayed frame
   * would be recognised as already-seen and discarded.
   *
   * Only meaningful for a terminal run. Replaying a live one would fight the
   * socket for the same store, so callers gate on `terminal`.
   */
  replay: () => Promise<void>;
  close: () => void;
}

export function connectRun({
  runId,
  store,
  immediate = false,
  pacing,
  onFrame,
}: ConnectionOptions): RunConnection {
  let disposed = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Whether the history replay has been queued yet.
   *
   * `enqueue` callers (the terminal bridge) race the history fetch: the run
   * header often resolves first, and pushing the ending ahead of the history
   * put "Draft PR" at the top of the timeline, before the run had started.
   * Externally-supplied frames therefore wait for history to be in the queue.
   */
  let historyEnqueued = false;
  let deferred: RunFrame[] = [];

  // Current pacing, tracked so a queue rebuilt by `replay` keeps the mode the
  // user selected rather than snapping back to the default.
  let activePacing: PacingOptions = { ...pacing };

  const buildQueue = (): PacedQueue<RunFrame> =>
    createPacedQueue<RunFrame>({
      immediate,
      ...activePacing,
      onDrain: (frame) => {
        store.apply(frame);
        onFrame?.(frame);
      },
    });

  // Reassignable: `replay` discards the queue mid-drain and starts a new one.
  let queue: PacedQueue<RunFrame> = buildQueue();

  /**
   * A hidden tab should not hold a backlog of frames hostage behind a 460ms
   * cadence — the pacing exists to make animation legible, and nothing is
   * being watched. On return the store is already current.
   */
  const onVisibility = () => {
    if (document.visibilityState === "hidden") queue.flush();
  };

  const ingest = (raw: unknown) => {
    if (disposed) return;

    // The legacy terminal frame carries a run status rather than a decision
    // (`ws.py:162`), so it cannot populate a decision honestly. It still tells
    // us the socket is done, which is worth acting on.
    if (isLegacyTerminalFrame(raw)) {
      queue.flush();
      store.setConnection("closed");
      return;
    }

    const frame = normalizeFrame(raw);
    if (frame) queue.push(frame);
  };

  const attach = () => {
    if (disposed || typeof WebSocket === "undefined") return;

    try {
      socket = new WebSocket(runSocketUrl(runId));
    } catch {
      scheduleRetry();
      return;
    }

    socket.onopen = () => {
      if (disposed) return;
      attempt = 0;
      store.setConnection("live");
    };

    socket.onmessage = (message) => {
      try {
        ingest(JSON.parse(message.data as string));
      } catch {
        /* a malformed frame is dropped, never allowed to kill the stream */
      }
    };

    socket.onclose = () => {
      if (disposed) return;
      socket = null;
      // Not a completion signal — only a lost transport. Retry unless the run
      // already announced a terminal frame.
      if (store.getSnapshot().terminal) {
        store.setConnection("closed");
        return;
      }
      scheduleRetry();
    };

    socket.onerror = () => {
      // `onclose` always follows; nothing to do here but avoid an unhandled
      // error surfacing as a page-level failure.
    };
  };

  const scheduleRetry = () => {
    if (disposed || retryTimer) return;
    store.setConnection("reconnecting");
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      attach();
    }, delay);
  };

  /**
   * Replay history first so a mid-run attach shows everything that already
   * happened. The socket replays too, and the store deduplicates by sequence,
   * so an overlap costs nothing.
   */
  void (async () => {
    store.setConnection("replaying");
    try {
      const history = await v2Fetch<unknown[]>(V2_ENDPOINTS.runEvents(runId));
      if (disposed) return;
      const frames = history.map(normalizeFrame).filter((f): f is RunFrame => f !== null);
      queue.pushAll(frames);
    } catch {
      // History is best-effort — the socket replays it too. Falling through
      // keeps a transient REST failure from blocking the live view.
    }
    if (disposed) return;

    historyEnqueued = true;
    if (deferred.length > 0) {
      queue.pushAll(deferred);
      deferred = [];
    }

    attach();
  })();

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  return {
    enqueue(frame) {
      if (disposed) return;
      if (!historyEnqueued) {
        deferred.push(frame);
        return;
      }
      queue.push(frame);
    },

    setPacing(next) {
      if (disposed) return;
      activePacing = { ...activePacing, ...next };
      queue.setPacing(next);
    },

    async replay() {
      if (disposed) return;

      // Drop anything still draining from the previous pass, then clear the
      // dedupe set. Order matters: resetting first would let an in-flight
      // frame land in the fresh store and re-mark its sequence as seen, so
      // that frame would be missing from the replay.
      queue.dispose();
      store.reset();
      store.setConnection("replaying");

      try {
        const history = await v2Fetch<unknown[]>(V2_ENDPOINTS.runEvents(runId));
        if (disposed) return;
        const frames = history.map(normalizeFrame).filter((f): f is RunFrame => f !== null);
        queue = buildQueue();
        queue.pushAll(frames);
        // The socket is not reattached: a replayed run is terminal, and its
        // stored events are the whole story.
        store.setConnection("closed");
      } catch {
        // A replay that cannot fetch its own history has nothing to show.
        // Rebuild the queue anyway so the connection stays usable.
        queue = buildQueue();
        store.setConnection("closed");
      }
    },

    close() {
      disposed = true;
      queue.dispose();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      store.setConnection("closed");
    },
  };
}
