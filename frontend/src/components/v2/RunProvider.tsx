/**
 * `<RunProvider>` — the run scope (blueprint §4, §12).
 *
 * Owns three things and nothing else:
 *   1. the `RunStore` instance for this run,
 *   2. the stream connection that writes to it,
 *   3. the bridge that turns frames into query invalidations.
 *
 * The store itself is passed through context, but **its contents are not** —
 * consumers read through selector hooks backed by `useSyncExternalStore`, so a
 * frame for one stage re-renders only what subscribes to that stage. Putting
 * the snapshot in context would re-render every consumer on every frame.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useReducedMotion } from "framer-motion";

import { invalidateForFrames, invalidateOnTerminal, runQuery } from "@/lib/v2/queries";
import { normalizeFrame, type RunFrame } from "@/lib/v2/stream/frames";
import { connectRun, type RunConnection } from "@/lib/v2/stream/connection";
import {
  pacingFor,
  readPlaybackMode,
  writePlaybackMode,
  type PlaybackMode,
} from "@/lib/v2/stream/playback";
import {
  createRunStore,
  type ActivityEntry,
  type AgentRuntimeState,
  type AttemptEntry,
  type ConnectionState,
  type RunStore,
  type RunStoreSnapshot,
  type StageRuntimeState,
  type TerminalState,
  type TimelineEntry,
} from "@/lib/v2/stream/store";

interface RunContextValue {
  runId: string;
  store: RunStore;
  /** Reveal cadence. Frontend-only — see `stream/playback.ts`. */
  playback: PlaybackMode;
  setPlayback: (mode: PlaybackMode) => void;
  /** Re-drain the run's stored events. Only meaningful once terminal. */
  replay: () => void;
}

const RunContext = createContext<RunContextValue | null>(null);

/**
 * Trailing debounce for query invalidation.
 *
 * **It must exceed the frame cadence or it batches nothing.** At 300ms against
 * a 460ms settled drain, every frame landed in its own window and flushed
 * alone, so the "debounce" was decorative: one page load of a finished run
 * issued ~580 requests (153 each to `/agents` and `/stages`, 112 to
 * `/attempts`, 82 to `/context`) for projections that could not change.
 *
 * Derived from the active cadence rather than fixed, so presentation mode —
 * which drains at 1100ms — does not silently regress to one flush per frame
 * again. The multiplier buys a couple of frames per round without making a live
 * run feel stale.
 */
const INVALIDATE_DEBOUNCE_FLOOR_MS = 300;
const INVALIDATE_DEBOUNCE_FACTOR = 1.6;

export function RunProvider({ runId, children }: { runId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();

  /**
   * Whether the backend already considers this run finished.
   *
   * Shares `TerminalBridge`'s cache entry, so it costs no extra request. It is
   * the signal that per-frame invalidation is pointless: a finished run's
   * projections are already final, and the frames still draining are history
   * being *told*, not state changing. Refetching per frame there re-fetched
   * identical bytes ~29 times per page load.
   */
  const runStatus = useQuery(runQuery(runId)).data?.status;
  const isHistorical = runStatus === "completed" || runStatus === "failed";
  const historicalRef = useRef(isHistorical);
  historicalRef.current = isHistorical;

  // One store per run id. Recreated when the run changes so a navigation never
  // shows the previous run's frames.
  const store = useMemo(() => createRunStore(), [runId]);

  // Read from storage once, so a demo machine left in presentation mode stays
  // there across navigations and reloads.
  const [playback, setPlaybackState] = useState<PlaybackMode>(readPlaybackMode);

  // Mirrors `playback` for the connection effect to read without depending on
  // it — a reconnect (run change, reduced-motion change) then starts at the
  // mode currently selected rather than the default.
  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  const pendingAgents = useRef(new Set<string>());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionRef = useRef<RunConnection | null>(null);

  // Stable across renders, so the bridge's effect does not re-run when the
  // connection is replaced.
  const enqueue = useCallback((frame: RunFrame) => {
    connectionRef.current?.enqueue(frame);
  }, []);

  /**
   * Changing mode re-paces the *existing* queue. It deliberately does not go
   * through the connection effect below: recreating the connection would drop
   * every frame still draining, so toggling mode mid-run would silently skip
   * part of the narrative.
   */
  const setPlayback = useCallback((mode: PlaybackMode) => {
    setPlaybackState(mode);
    writePlaybackMode(mode);
    connectionRef.current?.setPacing(pacingFor(mode));
  }, []);

  const replay = useCallback(() => {
    void connectionRef.current?.replay();
  }, []);

  useEffect(() => {
    if (!runId) return;

    const flushInvalidations = () => {
      debounceTimer.current = null;
      // One call for the whole batch. Looping here was the storm: the
      // run-scoped keys do not depend on which agent reported, so N agents
      // produced N identical invalidations of the same three keys.
      invalidateForFrames(queryClient, runId, pendingAgents.current);
      pendingAgents.current.clear();
    };

    const debounceMs = Math.max(
      INVALIDATE_DEBOUNCE_FLOOR_MS,
      Math.round((pacingFor(playbackRef.current).interval ?? 0) * INVALIDATE_DEBOUNCE_FACTOR),
    );

    const connection = connectRun({
      runId,
      store,
      // Reduced motion has no animation to make legible, so the cadence is
      // pure latency. Apply frames as they arrive.
      immediate: reducedMotion ?? false,
      // Read, not tracked: `playback` is intentionally absent from this
      // effect's deps. Mode changes go through `setPacing` so the connection
      // survives them.
      pacing: pacingFor(playbackRef.current),
      onFrame: (frame) => {
        if (frame.kind === "lifecycle") {
          invalidateOnTerminal(queryClient, runId);
          return;
        }
        // A finished run needs exactly one invalidation, and the terminal
        // frame above delivers it when the history finishes draining. Until
        // then there is nothing new to fetch.
        if (historicalRef.current) return;

        pendingAgents.current.add(frame.agentId);
        if (debounceTimer.current === null) {
          debounceTimer.current = setTimeout(flushInvalidations, debounceMs);
        }
      },
    });

    connectionRef.current = connection;

    return () => {
      connectionRef.current = null;
      connection.close();
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      pendingAgents.current.clear();
    };
  }, [runId, store, queryClient, reducedMotion]);

  const value = useMemo(
    () => ({ runId, store, playback, setPlayback, replay }),
    [runId, store, playback, setPlayback, replay],
  );

  return (
    <RunContext.Provider value={value}>
      <TerminalBridge runId={runId} store={store} enqueue={enqueue} />
      {children}
    </RunContext.Provider>
  );
}

/**
 * Reconciles how a run ended, from whichever source actually knows.
 *
 * The socket's `run.completed` / `run.failed` frames are authoritative, but
 * they only exist for runs created after G5 landed. Older runs carry the
 * outcome solely on `GET /runs/{id}` — `status` plus `decisionLabel` — and the
 * header also replays any lifecycle events it does have.
 *
 * Without this, a finished run streams its whole history, never receives a
 * terminal frame, and sits at "Running" with a counter ticking for as long as
 * the tab is open. Reading the backend's own `status` is not an inference; it
 * is the run's recorded outcome.
 */
function TerminalBridge({
  runId,
  store,
  enqueue,
}: {
  runId: string;
  store: RunStore;
  enqueue: (frame: RunFrame) => void;
}) {
  const { data } = useQuery(runQuery(runId));
  const applied = useRef(false);

  useEffect(() => {
    if (!data || applied.current) return;

    // Prefer real lifecycle events — they carry the decision and a timestamp.
    const lifecycle = data.lifecycle ?? [];
    if (lifecycle.length > 0) {
      applied.current = true;
      for (const event of lifecycle) {
        const frame = normalizeFrame(event);
        if (frame) enqueue(frame);
      }
      return;
    }

    if (data.status !== "completed" && data.status !== "failed") return;
    applied.current = true;

    // No lifecycle record. Timestamp the ending at the last frame the backend
    // sent rather than `Date.now()`, so any span derived from it is the run's
    // duration and not the viewer's session length.
    const frames = store.getSnapshot().frames;
    const lastAt = frames.length > 0 ? frames[frames.length - 1].at : Date.now();

    // Queued, not applied: it must land *after* the history still draining, or
    // the header reports the ending while the narrative is stages behind.
    // `sequence` sorts past anything the backend can emit, so the dedupe key
    // stays unique and the frame is applied exactly once.
    enqueue({
      kind: "lifecycle",
      type: data.status === "failed" ? "run.failed" : "run.completed",
      decision: null,
      decisionLabel: data.decisionLabel ?? "",
      reason: null,
      at: lastAt,
      sequence: Number.MAX_SAFE_INTEGER,
    });
  }, [data, store, enqueue]);

  return null;
}

/* -------------------------------------------------------------------------
   Selector hooks (blueprint §12)

   Each returns a slice whose identity is stable until that slice changes, so
   React bails out of the re-render for every consumer the frame did not touch.
   ---------------------------------------------------------------------- */

function useRunContext(): RunContextValue {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error("useRunContext must be used within <RunProvider>");
  return ctx;
}

export function useRunId(): string {
  return useRunContext().runId;
}

export function useRunStore(): RunStore {
  return useRunContext().store;
}

export function useRunSelector<T>(selector: (snapshot: RunStoreSnapshot) => T): T {
  const { store } = useRunContext();
  const select = useCallback(() => selector(store.getSnapshot()), [store, selector]);
  const selectServer = useCallback(() => selector(store.getServerSnapshot()), [store, selector]);
  return useSyncExternalStore(store.subscribe, select, selectServer);
}

const selectStageOrder = (s: RunStoreSnapshot) => s.stageOrder;
const selectActiveStage = (s: RunStoreSnapshot) => s.activeStage;
const selectConnection = (s: RunStoreSnapshot) => s.connection;
const selectTerminal = (s: RunStoreSnapshot) => s.terminal;
const selectActivity = (s: RunStoreSnapshot) => s.activity;
const selectTimeline = (s: RunStoreSnapshot) => s.timeline;
const selectAttempts = (s: RunStoreSnapshot) => s.attempts;
const selectFrameCount = (s: RunStoreSnapshot) => s.frames.length;

export function useStage(stageId: string): StageRuntimeState | null {
  const selector = useCallback((s: RunStoreSnapshot) => s.stages[stageId] ?? null, [stageId]);
  return useRunSelector(selector);
}

export function useStageOrder(): string[] {
  return useRunSelector(selectStageOrder);
}

export function useAgent(stageId: string, agentId: string): AgentRuntimeState | null {
  const selector = useCallback(
    (s: RunStoreSnapshot) => s.stages[stageId]?.agents[agentId] ?? null,
    [stageId, agentId],
  );
  return useRunSelector(selector);
}

export function useActiveStage(): string | null {
  return useRunSelector(selectActiveStage);
}

export function useConnection(): ConnectionState {
  return useRunSelector(selectConnection);
}

export function useTerminal(): TerminalState | null {
  return useRunSelector(selectTerminal);
}

/**
 * Playback controls: reveal cadence and replay.
 *
 * Frontend-only, and the UI that uses it is required to say so. Nothing here
 * touches the backend, the run, or how long the pipeline took.
 */
export function usePlayback(): {
  mode: PlaybackMode;
  setMode: (mode: PlaybackMode) => void;
  replay: () => void;
} {
  const { playback, setPlayback, replay } = useRunContext();
  return { mode: playback, setMode: setPlayback, replay };
}

export function useActivity(): ActivityEntry[] {
  return useRunSelector(selectActivity);
}

export function useTimeline(): TimelineEntry[] {
  return useRunSelector(selectTimeline);
}

export function useAttempts(): AttemptEntry[] {
  return useRunSelector(selectAttempts);
}

/** Frame count — the cheapest "has anything happened yet?" signal. */
export function useFrameCount(): number {
  return useRunSelector(selectFrameCount);
}
