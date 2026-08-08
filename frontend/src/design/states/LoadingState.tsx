/**
 * `<LoadingState>` (blueprint §3.6).
 *
 * A genuine in-flight fetch. There are no indeterminate progress bars in this
 * product (§1.3): a spinner says "a request is open", which is true, whereas a
 * percentage nobody measured is a lie.
 *
 * Where a real elapsed time exists, pass `startedAt` and the state shows the
 * counter instead — a fact rather than a mood.
 */

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export interface LoadingStateProps {
  /** What is being fetched. Shown to the user and to screen readers. */
  label?: string;
  /** Epoch ms. When supplied, an elapsed counter replaces the bare spinner. */
  startedAt?: number | null;
  size?: "sm" | "md";
  className?: string;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Ticks once a second while `startedAt` is set. Stops the moment it clears. */
export function useElapsed(startedAt: number | null | undefined): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (startedAt === null || startedAt === undefined) {
      setNow(null);
      return;
    }
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (startedAt === null || startedAt === undefined || now === null) return null;
  return now - startedAt;
}

export function LoadingState({
  label = "Loading",
  startedAt = null,
  size = "md",
  className,
}: LoadingStateProps) {
  const elapsed = useElapsed(startedAt);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 text-ink-soft",
        size === "sm" ? "py-4" : "py-8",
        className,
      )}
    >
      <Loader2
        aria-hidden
        className={cn("animate-spin", size === "sm" ? "size-3.5" : "size-4")}
        strokeWidth={2}
      />
      <span className={size === "sm" ? "type-caption" : "type-body-sm"}>{label}</span>
      {elapsed !== null && (
        <span className="type-mono-sm text-ink-soft/80">{formatElapsed(elapsed)}</span>
      )}
    </div>
  );
}
