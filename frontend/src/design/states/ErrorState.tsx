/**
 * `<ErrorState>` (blueprint §3.6).
 *
 * Error states name what failed and offer retry. **They never silently fall
 * back to fixture data** — a product that invents a plausible value when a
 * request fails is worse than one that shows nothing, because the user cannot
 * tell the two apart.
 */

import { AlertTriangle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  /** What failed, in the user's terms. */
  title: string;
  /** The failure detail — an endpoint, a status code, a message. */
  detail?: ReactNode;
  /** Source of truth for the failure, e.g. `GET /api/runs/{id}/report`. */
  source?: string;
  onRetry?: () => void;
  retryLabel?: string;
  size?: "sm" | "md";
  className?: string;
}

export function ErrorState({
  title,
  detail,
  source,
  onRetry,
  retryLabel = "Retry",
  size = "md",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("rounded-card border", size === "sm" ? "p-3" : "p-5", className)}
      style={{
        borderColor: "color-mix(in srgb, var(--status-failed) 30%, transparent)",
        backgroundColor: "var(--status-failed-bg)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          aria-hidden
          className="mt-0.5 size-4 shrink-0"
          style={{ color: "var(--status-failed)" }}
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1">
          <p className={cn(size === "sm" ? "type-label" : "type-title-3", "text-ink")}>{title}</p>
          {detail && <div className="type-body-sm mt-1 text-ink-soft">{detail}</div>}
          {source && <p className="type-mono-sm mt-1.5 break-all text-ink-soft/80">{source}</p>}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="type-label inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-ink transition-colors hover:bg-surface-muted"
          >
            <RotateCw aria-hidden className="size-3" strokeWidth={2} />
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
