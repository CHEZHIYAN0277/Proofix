/**
 * Playback pacing — how fast the *frontend* reveals frames.
 *
 * ## What this is not
 *
 * It is not progress, and it is not work. The backend runs at whatever speed it
 * runs at; this only decides how quickly frames already received are handed to
 * React. Slowing playback does not slow the pipeline, and it must never be
 * presented as if it did — a run that finished in 8 seconds still finished in 8
 * seconds, however long the narrative takes to read out.
 *
 * That distinction is the whole reason this module is separate from the queue:
 * the queue knows *how* to pace, this knows *why*, and the UI that exposes it
 * is obliged to say which one the user is looking at.
 *
 * ## Why presentation mode exists
 *
 * The drain accelerates when a backlog builds (see `queue.ts`), so a run that
 * emits 40 frames in 8 seconds drains at the 60ms floor and is genuinely
 * unreadable — the frames go by faster than a reveal can animate. For a demo,
 * an onboarding walkthrough or a recorded screencast, the honest fix is to slow
 * the *reveal* and say so, not to slow the backend or invent intermediate work.
 *
 * Presentation mode therefore does two things:
 *   - raises the settled cadence, so each frame is legible
 *   - raises the catch-up threshold a long way, so a burst does not immediately
 *     collapse back to the floor
 *
 * It deliberately keeps *some* acceleration. A 300-frame history at 1.1s per
 * frame is five minutes of waiting, which is not a demo either.
 */

import {
  CATCH_UP_THRESHOLD,
  FRAME_INTERVAL_MS,
  MIN_INTERVAL_MS,
  type PacingOptions,
} from "./queue";

export type PlaybackMode = "normal" | "presentation";

export interface PlaybackSpec extends PacingOptions {
  mode: PlaybackMode;
  label: string;
  /** Shown next to the control so the guarantee is on screen, not in docs. */
  description: string;
}

export const PLAYBACK_MODES: Record<PlaybackMode, PlaybackSpec> = {
  normal: {
    mode: "normal",
    label: "Normal",
    description: "Frames reveal as they arrive, catching up quickly after a burst.",
    interval: FRAME_INTERVAL_MS,
    minInterval: MIN_INTERVAL_MS,
    catchUpThreshold: CATCH_UP_THRESHOLD,
  },
  presentation: {
    mode: "presentation",
    label: "Presentation",
    description:
      "Slows the on-screen reveal so each step is readable. Backend execution is unchanged.",
    // ~2.4x the settled cadence: slow enough to read a line and look at the
    // panel it changed, short of feeling stalled.
    interval: 1100,
    // The floor matters more than the ceiling here. In normal mode a backlog
    // collapses to 60ms, which is what makes a fast run unwatchable; presenting
    // never goes below a still-readable gap.
    minInterval: 420,
    // Tolerate a much deeper backlog before accelerating at all, so an
    // 8-second/40-frame run plays out steadily instead of racing.
    catchUpThreshold: 40,
  },
};

export const DEFAULT_PLAYBACK_MODE: PlaybackMode = "normal";

/** Persisted per browser: a demo machine should stay in presentation mode. */
export const PLAYBACK_STORAGE_KEY = "proofix.v2.playback";

export function readPlaybackMode(): PlaybackMode {
  if (typeof window === "undefined") return DEFAULT_PLAYBACK_MODE;
  try {
    const stored = window.localStorage.getItem(PLAYBACK_STORAGE_KEY);
    if (stored === "normal" || stored === "presentation") return stored;
  } catch {
    // Storage blocked (private mode, embedded contexts). The default is the
    // right answer, not a crash.
  }
  return DEFAULT_PLAYBACK_MODE;
}

export function writePlaybackMode(mode: PlaybackMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLAYBACK_STORAGE_KEY, mode);
  } catch {
    /* non-fatal */
  }
}

export function pacingFor(mode: PlaybackMode): PacingOptions {
  const spec = PLAYBACK_MODES[mode];
  return {
    interval: spec.interval,
    minInterval: spec.minInterval,
    catchUpThreshold: spec.catchUpThreshold,
  };
}
