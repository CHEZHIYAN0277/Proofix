/**
 * Layout atoms (blueprint §3.7): `<Eyebrow>`, `<SectionHeader>`, `<KeyValue>`,
 * `<Timestamp>`.
 *
 * Small on purpose. They exist so that section kickers, label/value pairs and
 * times are typographically identical on every surface in the product without
 * each one re-deciding a size.
 */

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { DataState } from "../states/DataState";
import type { DataStateKind } from "../types";

/* -------------------------------------------------------------------------
   Eyebrow — the section kicker
   ---------------------------------------------------------------------- */

export interface EyebrowProps {
  children: ReactNode;
  /** Tints the eyebrow. Accent is reserved for the active stage (rule A1). */
  tone?: "soft" | "accent";
  className?: string;
}

export function Eyebrow({ children, tone = "soft", className }: EyebrowProps) {
  return (
    <div
      className={cn(
        "type-eyebrow",
        tone === "accent" ? "text-primary" : "text-ink-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
   SectionHeader — eyebrow + title + optional description and actions
   ---------------------------------------------------------------------- */

export interface SectionHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls — an `<ExplainAffordance>` belongs here. */
  actions?: ReactNode;
  /**
   * Peripheral headers cap at `body-sm`/`title-3` per rule A2; the active
   * stage owns everything above.
   */
  level?: "stage" | "panel" | "card";
  className?: string;
}

const TITLE_CLASS = {
  stage: "type-title-1",
  panel: "type-title-2",
  card: "type-title-3",
} as const;

export function SectionHeader({
  title,
  eyebrow,
  description,
  actions,
  level = "card",
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow>}
        <h2 className={cn(TITLE_CLASS[level], "text-ink")}>{title}</h2>
        {description && <p className="type-body-sm mt-1 text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------
   KeyValue — the label/value pair
   ---------------------------------------------------------------------- */

export interface KeyValueProps {
  label: ReactNode;
  /** `null`/`undefined` renders the data state instead of an invented value. */
  value?: ReactNode;
  /** Which state to show when `value` is absent. */
  whenMissing?: DataStateKind;
  /** Why it is absent. Required when `whenMissing` is `unavailable`. */
  reason?: string;
  /** Identifiers, paths, SHAs and numbers are always mono (§3.1). */
  mono?: boolean;
  /** `row` puts label and value on one line; `stack` puts the label above. */
  layout?: "row" | "stack";
  className?: string;
}

export function KeyValue({
  label,
  value,
  whenMissing = "waiting",
  reason,
  mono = false,
  layout = "row",
  className,
}: KeyValueProps) {
  const missing = value === null || value === undefined || value === "";
  const rendered = missing ? (
    <DataState kind={whenMissing} reason={reason} variant="inline" />
  ) : (
    <span className={cn(mono ? "type-mono" : "type-body-sm", "text-ink")}>{value}</span>
  );

  if (layout === "stack") {
    return (
      <div className={cn("min-w-0", className)}>
        <div className="type-label text-ink-soft">{label}</div>
        <div className="mt-0.5 min-w-0 truncate">{rendered}</div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-4", className)}>
      <span className="type-label shrink-0 text-ink-soft">{label}</span>
      <span className="min-w-0 truncate text-right">{rendered}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Timestamp

   Renders the absolute time on the server and on first paint, then upgrades
   to the requested format after mount. Formatting a relative time during SSR
   guarantees a hydration mismatch, and the absolute value is the honest one
   anyway.
   ---------------------------------------------------------------------- */

export type TimestampFormat = "time" | "datetime" | "relative";

export interface TimestampProps {
  /** Epoch ms, ISO string, or `Date`. `null` renders the data state. */
  value: number | string | Date | null | undefined;
  format?: TimestampFormat;
  whenMissing?: DataStateKind;
  reason?: string;
  className?: string;
}

function toDate(value: number | string | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function absolute(d: Date, format: TimestampFormat): string {
  if (format === "datetime") {
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Coarse relative time. No library, no locale gymnastics, no fake precision. */
export function relativeTime(d: Date, now: number = Date.now()): string {
  const seconds = Math.round((now - d.getTime()) / 1000);
  const ago = seconds >= 0;
  const s = Math.abs(seconds);
  const suffix = ago ? "ago" : "from now";

  if (s < 5) return "just now";
  if (s < 60) return `${s}s ${suffix}`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${suffix}`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${suffix}`;
  return `${Math.floor(s / 86400)}d ${suffix}`;
}

export function Timestamp({
  value,
  format = "time",
  whenMissing = "waiting",
  reason,
  className,
}: TimestampProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (value === null || value === undefined) {
    return <DataState kind={whenMissing} reason={reason} variant="inline" />;
  }

  const d = toDate(value);
  if (!d) {
    return <DataState kind="unavailable" reason="Unparseable timestamp" variant="inline" />;
  }

  const text = mounted && format === "relative" ? relativeTime(d) : absolute(d, format);

  return (
    <time
      dateTime={d.toISOString()}
      title={d.toISOString()}
      className={cn("type-mono-sm text-ink-soft", className)}
    >
      {text}
    </time>
  );
}
