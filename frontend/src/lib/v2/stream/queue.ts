/**
 * Paced drain queue (blueprint §13).
 *
 * Ported from V1's `liveEventStream` — the hardest-won code in the codebase.
 * **Timing lives here and nowhere else.** Components stay pure functions of
 * state; no component may schedule its own reveal.
 *
 * Why it exists: backend frames arrive in bursts. History replays dozens at
 * once and a single `completed` frame stands for a whole stage's narrative.
 * Applying those straight through collapses into one React render and the
 * reveals never mount. So frames drain one per tick, accelerating while a
 * backlog exists so catching up on a finished run stays quick, settling to a
 * readable cadence once caught up.
 *
 * This is not decoration: the cadence is proportional to real backlog, and it
 * stops the instant the backlog empties (§1.3).
 */

/** Cadence a single frame plays at once the queue has caught up. */
export const FRAME_INTERVAL_MS = 460;
/** Floor for the accelerated catch-up cadence. */
export const MIN_INTERVAL_MS = 60;
/** Backlog beyond which the queue drains faster than real time. */
export const CATCH_UP_THRESHOLD = 6;

export interface PacedQueueOptions<T> {
  /** Applied once per tick, in order. */
  onDrain: (item: T) => void;
  /**
   * Bypasses pacing entirely. Used for `prefers-reduced-motion`, where the
   * cadence exists to make animation legible and there is no animation.
   */
  immediate?: boolean;
  interval?: number;
  minInterval?: number;
  catchUpThreshold?: number;
}

/** Pacing that can be changed while frames are in flight. */
export interface PacingOptions {
  interval?: number;
  minInterval?: number;
  catchUpThreshold?: number;
}

export interface PacedQueue<T> {
  push: (item: T) => void;
  pushAll: (items: T[]) => void;
  /** Drains everything synchronously — used when the tab is hidden. */
  flush: () => void;
  /**
   * Re-pace a live queue without discarding its backlog.
   *
   * Switching speed by rebuilding the queue would drop every pending frame,
   * so the presentation-mode toggle would silently skip whatever was mid-drain.
   * The new cadence applies from the next tick; the frame currently waiting
   * keeps the delay it was scheduled with.
   */
  setPacing: (pacing: PacingOptions) => void;
  /** Pending item count, for backlog-aware callers. */
  readonly size: number;
  dispose: () => void;
}

export function createPacedQueue<T>(options: PacedQueueOptions<T>): PacedQueue<T> {
  const { onDrain, immediate = false } = options;

  // Mutable so `setPacing` can retune a queue that already has frames in it.
  let interval = options.interval ?? FRAME_INTERVAL_MS;
  let minInterval = options.minInterval ?? MIN_INTERVAL_MS;
  let catchUpThreshold = options.catchUpThreshold ?? CATCH_UP_THRESHOLD;

  const queue: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  /**
   * Shrink the gap while a backlog exists, so replaying a finished run's
   * history animates without making the user wait out every frame in it.
   */
  const nextDelay = () =>
    queue.length > catchUpThreshold
      ? Math.max(minInterval, Math.round((interval * catchUpThreshold) / queue.length))
      : interval;

  const pump = () => {
    if (disposed || timer) return;
    const item = queue.shift();
    if (item === undefined) return;

    onDrain(item);
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, nextDelay());
  };

  const flush = () => {
    if (disposed) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    while (queue.length > 0) {
      onDrain(queue.shift() as T);
    }
  };

  return {
    push(item) {
      if (disposed) return;
      if (immediate) {
        onDrain(item);
        return;
      }
      queue.push(item);
      pump();
    },
    pushAll(items) {
      if (disposed) return;
      if (immediate) {
        for (const item of items) onDrain(item);
        return;
      }
      queue.push(...items);
      pump();
    },
    flush,
    setPacing(pacing) {
      if (disposed) return;
      if (pacing.interval !== undefined) interval = pacing.interval;
      if (pacing.minInterval !== undefined) minInterval = pacing.minInterval;
      if (pacing.catchUpThreshold !== undefined) catchUpThreshold = pacing.catchUpThreshold;
      // Idle queue: nothing is scheduled, so the next push picks the new
      // cadence up on its own. A queue mid-drain re-paces at its next tick.
      pump();
    },
    get size() {
      return queue.length;
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      queue.length = 0;
    },
  };
}
