/**
 * Gallery: the color system and its live contrast audit (blueprint §3.5).
 *
 * Ratios are measured in the browser from resolved token values, so flipping
 * the theme re-measures. An asserted number in a comment is not an audit.
 */

import { useEffect, useState } from "react";

import {
  AA_CONTRAST_MIN,
  DATA_STATE_COLORS,
  GRAPH_EDGE_STYLES,
  GRAPH_NODE_COLORS,
  GRAPH_NODE_ORDER,
  SEMANTIC_COLORS,
  STATUS_COLORS,
} from "../../tokens/color";
import { DATA_STATES, GRAPH_EDGE_TYPES, STATUS_STATES } from "../../types";
import { StatusDot, StatusPill } from "../../primitives/StatusDot";
import { DataState } from "../../states/DataState";
import { GraphLegend } from "../../components/GraphChrome";
import { Specimen, SpecimenGrid } from "../GalleryShell";
import { contrastRatio, grade, resolveVar, type ContrastGrade } from "../contrast";

/* -------------------------------------------------------------------------
   Live audit
   ---------------------------------------------------------------------- */

interface AuditRow {
  label: string;
  fg: string;
  bg: string;
  ratio: number | null;
  verdict: ContrastGrade | null;
}

const GRADE_COLOR: Record<ContrastGrade, string> = {
  AAA: "var(--status-completed)",
  AA: "var(--status-completed)",
  "AA-large": "var(--status-retry)",
  fail: "var(--status-failed)",
};

/**
 * Re-measures whenever the root class list changes, which is exactly when the
 * theme flips.
 */
function useContrastAudit(pairs: { label: string; fg: string; bg: string }[]): AuditRow[] {
  const [rows, setRows] = useState<AuditRow[]>([]);

  useEffect(() => {
    const measure = () => {
      setRows(
        pairs.map(({ label, fg, bg }) => {
          const fgValue = resolveVar(fg);
          const bgValue = resolveVar(bg);
          const ratio = contrastRatio(fgValue, bgValue);
          return {
            label,
            fg: fgValue,
            bg: bgValue,
            ratio,
            verdict: ratio === null ? null : grade(ratio),
          };
        }),
      );
    };

    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [pairs]);

  return rows;
}

const AUDIT_PAIRS = [
  ...STATUS_STATES.map((s) => ({
    label: `status-${s}`,
    fg: `--status-${s}`,
    bg: "--surface",
  })),
  ...DATA_STATES.map((d) => ({
    label: `data-${d}`,
    fg: `--data-${d}`,
    bg: "--surface",
  })),
  ...GRAPH_NODE_ORDER.map((n) => ({
    label: `node-${n}`,
    fg: `--node-${n}`,
    bg: "--surface",
  })),
  { label: "ink", fg: "--ink", bg: "--background" },
  { label: "ink-soft", fg: "--ink-soft", bg: "--background" },
  { label: "primary", fg: "--primary", bg: "--surface" },
];

function ContrastAudit() {
  const rows = useContrastAudit(AUDIT_PAIRS);
  const failures = rows.filter((r) => r.verdict === "fail" || r.verdict === "AA-large");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <span className="type-body-sm text-ink">
          Measured against <code className="type-mono">--surface</code> /{" "}
          <code className="type-mono">--background</code> in the current theme.
        </span>
        <span
          className="type-label"
          style={{
            color: failures.length === 0 ? "var(--status-completed)" : "var(--status-retry)",
          }}
        >
          {rows.length === 0
            ? "measuring…"
            : failures.length === 0
              ? `all ${rows.length} pass AA (≥${AA_CONTRAST_MIN})`
              : `${failures.length} below AA for normal text`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-xs border border-border"
              style={{ backgroundColor: row.fg }}
            />
            <span className="type-mono-sm min-w-0 flex-1 truncate text-ink-soft">{row.label}</span>
            <span className="type-mono-sm tabular text-ink">
              {row.ratio === null ? "—" : row.ratio.toFixed(2)}
            </span>
            {row.verdict && (
              <span
                className="type-caption w-16 shrink-0 text-right"
                style={{ color: GRADE_COLOR[row.verdict] }}
              >
                {row.verdict}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Section
   ---------------------------------------------------------------------- */

export function ColorSection() {
  return (
    <div className="flex flex-col gap-5">
      <Specimen label="Semantic" note="inherited from the existing token block">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SEMANTIC_COLORS.map((c) => (
            <div key={c.token} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="size-8 shrink-0 rounded-card border border-border"
                style={{ backgroundColor: `var(${c.cssVar})` }}
              />
              <div className="min-w-0">
                <p className="type-mono-sm truncate text-ink">{c.token}</p>
                <p className="type-caption truncate text-ink-soft">{c.use}</p>
              </div>
            </div>
          ))}
        </div>
      </Specimen>

      <Specimen label="Status" note="six states, one shape language">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {STATUS_STATES.map((s) => (
              <StatusPill key={s} status={s} pulse={s === "running"} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {STATUS_STATES.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <StatusDot status={s} pulse={s === "running"} />
                <span className="type-caption text-ink-soft">{STATUS_COLORS[s].label}</span>
              </div>
            ))}
          </div>
          <p className="type-caption text-ink-soft">
            Only one dot pulses — rule A4. On a peripheral surface pass{" "}
            <code className="type-mono">pulse=&#123;false&#125;</code>: the rail shows state, not
            activity.
          </p>
        </div>
      </Specimen>

      <Specimen
        label="Data-state"
        note="absence of data is not failure — never colored as an error"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <DataState kind="waiting" />
            <DataState kind="pending" />
            <DataState kind="unavailable" reason="Capability disabled for this deployment" />
          </div>
          <div className="flex flex-col gap-1.5">
            {DATA_STATES.map((k) => (
              <div key={k} className="flex items-baseline gap-3">
                <span className="type-mono-sm w-24 shrink-0 text-ink-soft">{k}</span>
                <span className="type-body-sm text-ink">{DATA_STATE_COLORS[k].meaning}</span>
              </div>
            ))}
          </div>
        </div>
      </Specimen>

      <SpecimenGrid columns={2}>
        <Specimen label="Graph — node types" note="one fixed hue each">
          <div className="flex flex-col gap-2">
            {GRAPH_NODE_ORDER.map((t, i) => {
              const spec = GRAPH_NODE_COLORS[t];
              return (
                <div key={t} className="flex items-center gap-2.5">
                  <span className="type-mono-sm w-5 shrink-0 text-ink-soft">{i + 1}</span>
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: spec.fg }}
                  />
                  <span className="type-body-sm min-w-0 flex-1 text-ink">{spec.label}</span>
                  <span className="type-mono-sm text-ink-soft">
                    {spec.contrast.light} / {spec.contrast.dark}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="type-caption mt-3 text-ink-soft">
            Assignment order follows the Okabe–Ito sequence, so the first few types in any view stay
            separable under deuteranopia and protanopia. Ratios shown are light / dark.
          </p>
        </Specimen>

        <Specimen label="Graph — edge types" note="dash and weight, never hue alone">
          <div className="flex flex-col gap-2">
            {GRAPH_EDGE_TYPES.map((t) => {
              const spec = GRAPH_EDGE_STYLES[t];
              return (
                <div key={t} className="flex items-center gap-3">
                  <svg width="72" height="10" aria-hidden className="shrink-0">
                    <line
                      x1="0"
                      y1="5"
                      x2="72"
                      y2="5"
                      stroke="var(--ink)"
                      strokeWidth={spec.width}
                      strokeDasharray={spec.dash ?? undefined}
                      strokeLinecap="round"
                      opacity={spec.opacity}
                    />
                  </svg>
                  <span className="type-body-sm min-w-0 flex-1 text-ink">{spec.label}</span>
                  <span className="type-mono-sm text-ink-soft">
                    {spec.width}px {spec.dash ?? "solid"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <GraphLegend
              nodeTypes={GRAPH_NODE_ORDER.slice(0, 4)}
              edgeTypes={["calls", "imports"]}
            />
          </div>
        </Specimen>
      </SpecimenGrid>

      <Specimen label="Contrast audit" note="measured live, both themes">
        <ContrastAudit />
      </Specimen>
    </div>
  );
}
