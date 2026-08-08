/**
 * Data-state chips (blueprint §3.5).
 *
 * The visual grammar of the primary rule: every visual element traces to a
 * backend field, or renders `Waiting` / `Pending` / `Unavailable`.
 *
 * None of the three is ever colored as an error. Absence of data is not
 * failure, and rendering it as red trains users to distrust the product.
 */

import { Clock, EyeOff, Loader } from "lucide-react";

import { cn } from "@/lib/utils";
import { DATA_STATE_COLORS } from "../tokens/color";
import type { DataStateKind } from "../types";

export interface DataStateProps {
  kind: DataStateKind;

  /**
   * Why the value is absent. Required for `unavailable` — a capability that
   * is off without saying so is indistinguishable from a bug.
   */
  reason?: string;

  /** Overrides the default label ("Waiting" / "Pending" / "Unavailable"). */
  label?: string;

  size?: "sm" | "md";

  /**
   * `inline` renders as a value substitute inside a sentence or a metric slot;
   * `chip` renders a bordered pill.
   */
  variant?: "chip" | "inline";

  className?: string;
}

const ICONS = { waiting: Clock, pending: Loader, unavailable: EyeOff } as const;

export function DataState({
  kind,
  reason,
  label,
  size = "md",
  variant = "chip",
  className,
}: DataStateProps) {
  const spec = DATA_STATE_COLORS[kind];
  const Icon = ICONS[kind];
  const text = label ?? spec.label;

  if (import.meta.env.DEV && spec.requiresReason && !reason) {
    console.warn(
      `[design/DataState] "${kind}" must carry a reason. ` +
        `Rendering an unexplained Unavailable hides a capability gap.`,
    );
  }

  // The accessible name carries the reason, so a screen reader gets the same
  // explanation the tooltip gives a sighted user.
  const ariaLabel = reason ? `${text}: ${reason}` : text;

  if (variant === "inline") {
    return (
      <span
        className={cn("type-mono inline-flex items-center gap-1.5", className)}
        style={{ color: spec.fg }}
        title={reason}
        aria-label={ariaLabel}
      >
        <span aria-hidden>—</span>
        <span className="type-caption font-normal">{text}</span>
        {spec.shimmer && (
          <span
            aria-hidden
            className="ds-shimmer h-[2px] w-6 rounded-full"
            style={{ backgroundColor: spec.bg }}
          />
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "type-caption inline-flex max-w-full items-center gap-1.5 rounded-full border",
        size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1",
        // Waiting carries a dashed hairline: the backend has not reached it yet.
        spec.dashedBorder ? "border-dashed" : "border-solid",
        // Pending carries a single quiet shimmer: it is in flight now.
        spec.shimmer && "ds-shimmer",
        className,
      )}
      style={{
        color: spec.fg,
        backgroundColor: spec.bg,
        borderColor: `color-mix(in srgb, ${spec.fg} 28%, transparent)`,
      }}
      title={reason}
      aria-label={ariaLabel}
    >
      <Icon
        aria-hidden
        className={cn(size === "sm" ? "size-2.5" : "size-3", "shrink-0")}
        strokeWidth={2}
      />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** Convenience wrappers — read better at the call site than a `kind` prop. */
export const Waiting = (props: Omit<DataStateProps, "kind">) => (
  <DataState kind="waiting" {...props} />
);

export const Pending = (props: Omit<DataStateProps, "kind">) => (
  <DataState kind="pending" {...props} />
);

export const Unavailable = (props: Omit<DataStateProps, "kind"> & { reason: string }) => (
  <DataState kind="unavailable" {...props} />
);
