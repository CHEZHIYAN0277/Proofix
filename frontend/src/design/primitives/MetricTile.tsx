/**
 * `<MetricTile>` (blueprint §3.7).
 *
 * `{ label, value: T | null, unit, delta?, threshold?, source, explain? }`.
 *
 * `null` renders "—" plus the source, **never `0`**. Substituting zero for
 * "the backend did not publish this" is the single most common way a
 * dashboard lies, and it is the reason `source` is a required prop: every
 * number on screen can answer "where did this come from?".
 */

import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ExplainSpec, SourceRef } from "../types";
import { DataBoundary, isPresent } from "./DataBoundary";
import { ExplainAffordance } from "./ExplainAffordance";
import type { DataStateKind } from "../types";

export interface MetricDelta {
  /** Signed change against the comparison point. */
  value: number;
  /** What it is compared against, e.g. "vs. baseline". */
  label?: string;
  /**
   * Whether an increase is good. Drives the tint; omit when the metric has no
   * inherent direction and the delta renders neutral.
   */
  higherIsBetter?: boolean;
}

export interface MetricThreshold {
  /** The value the metric must reach (or stay under). */
  value: number;
  /** `at-least` passes when value ≥ threshold; `at-most` when ≤. */
  direction: "at-least" | "at-most";
  label?: string;
}

export interface MetricTileProps<T extends number | string> {
  label: string;

  /** The backend value. `null`/`undefined` renders the data state. */
  value: T | null | undefined;

  /** Rendered after the value, e.g. `%`, `ms`, `files`. */
  unit?: string;

  delta?: MetricDelta | null;
  threshold?: MetricThreshold | null;

  /**
   * Where the number came from. Required — a metric without a provenance is
   * not auditable, and this product's whole claim is that it is.
   */
  source: SourceRef[];

  /** Registers the tile with the explainability contract (§9). */
  explain?: ExplainSpec;
  /** Stable id for the explain registry. Defaults to a slug of the label. */
  explainId?: string;

  /** Which data state to show when the value is absent. */
  whenMissing?: DataStateKind;
  /** Why it is absent. Required when `whenMissing` is `unavailable`. */
  reason?: string;

  /** Formats the present value. Defaults to a locale number / raw string. */
  format?: (value: T) => string;

  size?: "sm" | "md";
  className?: string;
}

function defaultFormat(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString() : value;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function thresholdPassed(value: number, threshold: MetricThreshold): boolean {
  return threshold.direction === "at-least" ? value >= threshold.value : value <= threshold.value;
}

export function MetricTile<T extends number | string>({
  label,
  value,
  unit,
  delta,
  threshold,
  source,
  explain,
  explainId,
  whenMissing = "waiting",
  reason,
  format = defaultFormat as (value: T) => string,
  size = "md",
  className,
}: MetricTileProps<T>) {
  // The source is the tooltip on the whole tile, so the answer to "where did
  // this number come from?" is always one hover away — present or absent.
  const sourceTitle = source
    .map((s) => [s.label, s.endpoint, s.fieldPath, s.agentId].filter(Boolean).join(" · "))
    .join("\n");

  const numeric = typeof value === "number" ? value : null;
  const passed = threshold && numeric !== null ? thresholdPassed(numeric, threshold) : null;

  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surface",
        size === "sm" ? "p-4" : "p-5",
        className,
      )}
      title={sourceTitle}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="type-label min-w-0 truncate text-ink-soft">{label}</p>
        {explain && (
          <ExplainAffordance
            id={explainId ?? `metric.${slug(label)}`}
            subject={label}
            spec={explain}
          />
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <DataBoundary
          value={value}
          whenMissing={whenMissing}
          reason={reason}
          inline
          // "—" is the honest rendering of an absent number. Never 0.
          fallback={
            <span className="flex items-baseline gap-2">
              <span
                className={cn(size === "sm" ? "type-title-3" : "type-title-2", "text-ink-soft")}
                aria-label={`${label}: not published`}
              >
                —
              </span>
              <span className="type-caption text-ink-soft">{reason ?? "Not published"}</span>
            </span>
          }
        >
          {(present) => (
            <>
              <span
                className={cn(
                  size === "sm" ? "type-title-3" : "type-title-2",
                  "tabular text-ink",
                  passed === false && "text-status-failed",
                )}
              >
                {format(present as T)}
              </span>
              {unit && <span className="type-label text-ink-soft">{unit}</span>}
            </>
          )}
        </DataBoundary>
      </div>

      {isPresent(value) && delta && <DeltaRow delta={delta} />}

      {threshold && (
        <p className="type-caption mt-1.5 text-ink-soft">
          {threshold.label ??
            `${threshold.direction === "at-least" ? "Threshold ≥" : "Threshold ≤"} ${threshold.value}`}
          {passed !== null && (
            <span
              className="ml-1.5"
              style={{
                color: passed ? "var(--status-completed)" : "var(--status-failed)",
              }}
            >
              {passed ? "met" : "not met"}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function DeltaRow({ delta }: { delta: MetricDelta }) {
  const { value, label, higherIsBetter } = delta;
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;

  // Neutral unless the metric declares a direction — an unlabelled green
  // arrow is an opinion the backend never expressed.
  const color =
    higherIsBetter === undefined || value === 0
      ? "var(--ink-soft)"
      : value > 0 === higherIsBetter
        ? "var(--status-completed)"
        : "var(--status-failed)";

  return (
    <div className="mt-1.5 flex items-center gap-1" style={{ color }}>
      <Icon aria-hidden className="size-3" strokeWidth={2} />
      <span className="type-caption tabular">
        {value > 0 ? "+" : ""}
        {value.toLocaleString()}
      </span>
      {label && <span className="type-caption text-ink-soft">{label}</span>}
    </div>
  );
}
