/**
 * `<EvidenceList>` (blueprint §3.7, §9).
 *
 * Renders `Evidence[]` as weighted contribution bars — the "Why" half of the
 * explainability contract.
 *
 * Never chain-of-thought. Every row is a deterministic signal with a weight
 * and a provenance, which is what makes an autonomous decision checkable
 * rather than merely impressive.
 */

import { cn } from "@/lib/utils";
import { EmptyState } from "../states/EmptyState";
import type { Evidence } from "../types";

export interface EvidenceListProps {
  evidence: Evidence[];

  /**
   * Sort by contribution, descending. On by default — the reader wants the
   * dominant signal first.
   */
  sorted?: boolean;

  /** Cap the visible rows; the remainder is summarised. */
  max?: number;

  /** Shown when the array is empty. */
  emptyMessage?: string;

  /** Hides the provenance line, for dense surfaces. */
  compact?: boolean;

  className?: string;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function EvidenceList({
  evidence,
  sorted = true,
  max,
  emptyMessage = "This surface published no evidence.",
  compact = false,
  className,
}: EvidenceListProps) {
  if (evidence.length === 0) {
    return <EmptyState title="No evidence" description={emptyMessage} size="sm" />;
  }

  const rows = sorted ? [...evidence].sort((a, b) => b.contribution - a.contribution) : evidence;
  const visible = max ? rows.slice(0, max) : rows;
  const hidden = rows.length - visible.length;

  // Bars are scaled against the strongest signal so a set of small weights is
  // still readable, while the printed percentage stays the true contribution.
  const peak = Math.max(...rows.map((r) => clamp01(r.contribution)), 0.01);

  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {visible.map((item, i) => {
        const contribution = clamp01(item.contribution);
        return (
          <li key={`${item.signal}-${i}`} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-mono-sm min-w-0 truncate text-ink">{item.signal}</span>
              <span className="type-mono-sm shrink-0 text-ink-soft">
                {Math.round(contribution * 100)}%
              </span>
            </div>

            <div
              className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-muted"
              role="img"
              aria-label={`${item.signal} contributes ${Math.round(contribution * 100)} percent`}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(contribution / peak) * 100}%` }}
              />
            </div>

            {(item.value !== undefined && item.value !== null) || item.detail ? (
              <div className="type-caption mt-1 flex flex-wrap items-baseline gap-x-2 text-ink-soft">
                {item.value !== undefined && item.value !== null && (
                  <span className="type-mono-sm text-ink">{String(item.value)}</span>
                )}
                {item.detail && <span>{item.detail}</span>}
              </div>
            ) : null}

            {!compact && item.provenance && (
              <div className="type-caption mt-0.5 text-ink-soft/80">
                <span className="type-mono-sm">{item.provenance}</span>
              </div>
            )}
          </li>
        );
      })}

      {hidden > 0 && (
        <li className="type-caption text-ink-soft">
          {hidden} more signal{hidden === 1 ? "" : "s"} not shown
        </li>
      )}
    </ul>
  );
}
