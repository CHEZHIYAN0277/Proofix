/**
 * Playback controls — reveal speed and replay.
 *
 * The one rule this component exists to honour: **it must never let the user
 * mistake playback speed for pipeline speed.** Presentation mode slows the
 * on-screen reveal and nothing else, so the control says exactly that rather
 * than leaving the user to infer that the analysis got slower or more thorough.
 *
 * Replay re-drains the run's stored events through the same queue. Nothing is
 * re-executed and no animation is regenerated — `GET /runs/{id}/events` is the
 * same history the page replays on first load, so a replay shows precisely what
 * happened, not a re-enactment of it.
 *
 * Replay is offered only for terminal runs. Replaying a live run would fight
 * the socket for the same store, and the button would be a way to corrupt the
 * view rather than review it.
 */

import { Gauge, RotateCcw } from "lucide-react";

import { PLAYBACK_MODES, type PlaybackMode } from "@/lib/v2/stream/playback";
import { cn } from "@/lib/utils";
import { usePlayback, useTerminal } from "../RunProvider";

const MODES: PlaybackMode[] = ["normal", "presentation"];

export function PlaybackControls({ className }: { className?: string }) {
  const { mode, setMode, replay } = usePlayback();
  const terminal = useTerminal();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="radiogroup"
        aria-label="Playback speed"
        className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5"
      >
        <Gauge aria-hidden className="ml-1.5 size-3 shrink-0 text-ink-soft" strokeWidth={2} />
        {MODES.map((value) => {
          const spec = PLAYBACK_MODES[value];
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              // The guarantee travels with the control, so it is legible to a
              // screen reader and on hover — not only in documentation.
              title={spec.description}
              onClick={() => setMode(value)}
              className={cn(
                "type-caption rounded-full px-2.5 py-1 transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                active ? "bg-surface-muted font-medium text-ink" : "text-ink-soft hover:text-ink",
              )}
            >
              {spec.label}
            </button>
          );
        })}
      </div>

      {terminal && (
        <button
          type="button"
          onClick={replay}
          title="Re-drain this run's stored events. Nothing is re-executed."
          className={cn(
            "type-caption inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-ink-soft transition-colors hover:text-ink",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          )}
        >
          <RotateCcw aria-hidden className="size-3" strokeWidth={2} />
          Replay
        </button>
      )}
    </div>
  );
}

/**
 * The standing disclaimer for presentation mode.
 *
 * Rendered next to the run's elapsed time, where the confusion would otherwise
 * happen: a viewer watching a slowed reveal beside a duration needs to know
 * which of the two the pipeline actually took.
 */
export function PlaybackNotice() {
  const { mode } = usePlayback();
  if (mode !== "presentation") return null;

  return (
    <span className="type-caption text-ink-soft" role="note">
      Presentation mode — reveal slowed for viewing. Execution time is unchanged.
    </span>
  );
}
