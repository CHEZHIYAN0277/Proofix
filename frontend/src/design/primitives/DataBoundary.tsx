/**
 * `<DataBoundary>` — the primary-rule enforcer (blueprint §3.7).
 *
 * Every visual element traces to a backend field, or renders `Waiting` /
 * `Pending` / `Unavailable`. Every fact in the product is wrapped in one of
 * these: you cannot render an invented value without deleting the component.
 *
 * `children` is a function of the present value, which is what makes the rule
 * structural rather than advisory — there is no code path that reaches the
 * render body with a missing value.
 */

import type { ReactNode } from "react";

import { DataState } from "../states/DataState";
import type { DataStateKind } from "../types";

/**
 * Whether a value is genuinely present.
 *
 * Deliberately narrow: `0`, `false` and `""`-adjacent falsy values that carry
 * meaning are present. A metric that is genuinely zero must render `0`, not
 * "—" — conflating the two is the exact failure this component exists to
 * prevent.
 *
 *   missing: null, undefined, NaN, whitespace-only string
 *   present: 0, false, [], {}, "0"
 */
export function isPresent<T>(value: T | null | undefined): value is NonNullable<T> {
  if (value === null || value === undefined) return false;
  if (typeof value === "number" && Number.isNaN(value)) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

export interface DataBoundaryProps<T> {
  /** The backend value. `null`/`undefined` means the backend has not said. */
  value: T | null | undefined;

  /** Rendered only when the value is genuinely present. */
  children: (value: NonNullable<T>) => ReactNode;

  /**
   * Which state to show when the value is absent.
   *
   *   waiting     — the backend has not reached this stage yet
   *   pending     — in flight now
   *   unavailable — the capability is off or unsupported (requires `reason`)
   */
  whenMissing: DataStateKind;

  /**
   * Why it is absent. Required when `whenMissing` is `unavailable`, and worth
   * supplying for the other two — it becomes the tooltip and the accessible
   * name.
   */
  reason?: string;

  /**
   * Treat an empty array or empty object as missing. Off by default: a stage
   * that genuinely produced zero findings should say so through an
   * `<EmptyState>`, not pretend it never ran.
   */
  emptyIsMissing?: boolean;

  /** Overrides the chip label. */
  label?: string;

  /** Renders the absent state inline rather than as a chip. */
  inline?: boolean;

  /** Replaces the default chip entirely. */
  fallback?: ReactNode;

  className?: string;
}

function isEmptyCollection(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  if (typeof value === "object" && value !== null) {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }
  return false;
}

export function DataBoundary<T>({
  value,
  children,
  whenMissing,
  reason,
  emptyIsMissing = false,
  label,
  inline = false,
  fallback,
  className,
}: DataBoundaryProps<T>) {
  const present = isPresent(value) && !(emptyIsMissing && isEmptyCollection(value));

  if (!present) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <DataState
        kind={whenMissing}
        reason={reason}
        label={label}
        variant={inline ? "inline" : "chip"}
        className={className}
      />
    );
  }

  return <>{children(value as NonNullable<T>)}</>;
}
