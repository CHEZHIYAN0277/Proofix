/**
 * `<RunElapsed>` — the live elapsed counter (blueprint §1.3).
 *
 * There are no indeterminate progress bars in Workspace V2. An in-flight run
 * shows an elapsed counter, **which is a fact**; a percentage nobody measured
 * is a lie.
 *
 * Both endpoints of the span come from the backend: the start is the
 * `run.started` lifecycle frame (or the earliest frame the backend timestamped,
 * for runs that predate lifecycle events), and the end is the terminal frame.
 * The counter never counts from page load, and it stops the instant the run
 * settles — the termination test in §1.3.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import type { RunStoreSnapshot } from "@/lib/v2/stream/store";
import { orNull } from "@/lib/v2/absence";
import { runQuery } from "@/lib/v2/queries";
import { useRunId, useRunSelector, useTerminal } from "../RunProvider";

const selectStartedAt = (s: RunStoreSnapshot) => s.startedAt;

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function RunElapsed({ className }: { className?: string }) {
  const runId = useRunId();
  const startedAt = useRunSelector(selectStartedAt);
  const terminal = useTerminal();
  const { data } = useQuery(runQuery(runId));
  const [now, setNow] = useState<number | null>(null);

  const settled = terminal !== null;

  useEffect(() => {
    // Nothing to tick: the run has not started, or it is over and the span is
    // fixed. Either way no timer runs — the animation stops when the work does.
    if (startedAt === null || settled) return;

    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt, settled]);

  /**
   * Once the run is over the backend has already measured and formatted the
   * span, and its number is the better one: `executionTime` is the run's own
   * duration, whereas the client can only bracket the frames it received — and
   * for a run whose terminal state was recovered from `status` rather than a
   * lifecycle frame, that bracket is wrong by however long the tab has been
   * open. Deriving a second answer here would disagree with the report.
   */
  const backendElapsed = settled ? orNull(data?.executionTime) : null;

  const elapsed =
    startedAt === null
      ? null
      : settled
        ? (terminal as { at: number }).at - startedAt
        : now === null
          ? null
          : now - startedAt;

  return (
    <DataBoundary
      value={backendElapsed ?? (elapsed === null ? null : formatElapsed(elapsed))}
      whenMissing="waiting"
      reason="The run has not emitted a frame yet"
      inline
    >
      {(text) => (
        <span
          className={className ?? "type-mono-sm tabular text-ink-soft"}
          aria-label={`Elapsed ${text}`}
        >
          {text}
        </span>
      )}
    </DataBoundary>
  );
}
