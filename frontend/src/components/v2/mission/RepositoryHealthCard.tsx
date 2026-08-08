/**
 * Repository Health — risk bands and hotspots.
 *
 * `GET /knowledge/{run_id}/risk` is the reference producer for the
 * explainability contract (§9): every entry already carries `Evidence[]` with
 * `signal`, `value`, `contribution`, `detail` and `provenance` — the exact
 * shape `<EvidenceList>` renders. So the "Why" behind a risk score is the
 * backend's own weighted signals, passed through untouched.
 *
 * Hotspots publish their evidence as preformatted strings instead, so they get
 * a plain list rather than contribution bars. Rendering a bar there would mean
 * inventing weights the backend never computed.
 */

import { useQuery } from "@tanstack/react-query";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import { QueryBoundary } from "@/design/states/QueryBoundary";
import { cn } from "@/lib/utils";
import { kgHotspotsQuery, kgRiskQuery } from "@/lib/v2/queries";
import type { Hotspot, RiskEntry } from "@/lib/v2/types";
import { useRunId } from "../RunProvider";

/** Bands the backend assigns; tinted, never re-derived from the score. */
const BAND_COLOR: Record<string, string> = {
  low: "var(--status-completed)",
  medium: "var(--status-retry)",
  high: "var(--status-failed)",
  critical: "var(--status-failed)",
};

const TOP_N = 5;

export function RepositoryHealthCard() {
  const runId = useRunId();
  const risk = useQuery(kgRiskQuery(runId));
  const hotspots = useQuery(kgHotspotsQuery(runId));

  return (
    <div className="flex flex-col gap-4">
      <section>
        <Eyebrow className="mb-2">Risk by module</Eyebrow>
        <QueryBoundary
          query={risk}
          label="the risk analysis"
          stage="Repository Intelligence"
          agent="A1"
          skeletonLines={4}
          notFoundReason="No knowledge graph was built for this run, so no modules were scored."
        >
          {(rows) => (
            <DataBoundary
              value={rows.length > 0 ? rows : null}
              whenMissing="waiting"
              emptyIsMissing
              fallback={<EmptyState title="No modules scored" size="sm" />}
            >
              {(entries) => (
                <ul className="flex flex-col gap-2">
                  {entries.slice(0, TOP_N).map((entry: RiskEntry) => (
                    <li key={entry.module} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className="type-mono-sm min-w-0 truncate text-ink"
                          title={entry.module}
                        >
                          {entry.module}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span
                            className="type-caption"
                            style={{ color: BAND_COLOR[entry.band] ?? "var(--ink-soft)" }}
                          >
                            {entry.band}
                          </span>
                          <span className="type-mono-sm tabular text-ink-soft">
                            {entry.risk.toFixed(2)}
                          </span>
                          <ExplainAffordance
                            id={`risk.${entry.module}`}
                            subject={entry.module}
                            spec={{
                              explain: entry.why,
                              // Already in the contract's shape — passed through.
                              why: entry.evidence,
                              // The risk score is a weighted sum, not a stated
                              // confidence. The producer publishes none.
                              confidence: null,
                              source: [
                                {
                                  label: "Risk analysis",
                                  endpoint: "GET /api/knowledge/{run_id}/risk",
                                  fieldPath: `[module=${entry.module}]`,
                                },
                              ],
                            }}
                          />
                        </span>
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, entry.risk * 100)}%`,
                            backgroundColor: BAND_COLOR[entry.band] ?? "var(--ink-soft)",
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DataBoundary>
          )}
        </QueryBoundary>
      </section>

      <section>
        <Eyebrow className="mb-2">Hotspots</Eyebrow>
        <QueryBoundary
          query={hotspots}
          label="the hotspot analysis"
          stage="Repository Intelligence"
          agent="A1"
          skeletonLines={2}
          notFoundReason="No knowledge graph was built for this run, so no hotspots were derived."
        >
          {(rows) => (
            <DataBoundary
              value={rows.length > 0 ? rows : null}
              whenMissing="waiting"
              emptyIsMissing
              fallback={<EmptyState title="No hotspots detected" size="sm" />}
            >
              {(entries) => (
                <ul className="flex flex-col gap-2">
                  {entries.slice(0, TOP_N).map((hotspot: Hotspot, index: number) => (
                    <li key={`${hotspot.target}:${index}`} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className="type-mono-sm min-w-0 truncate text-ink"
                          title={hotspot.target}
                        >
                          {hotspot.target}
                        </span>
                        <ExplainAffordance
                          id={`hotspot.${hotspot.target}`}
                          subject={hotspot.target}
                          spec={{
                            explain: hotspot.why,
                            why: hotspot.evidence.map((detail) => ({
                              signal: detail.split("=")[0] ?? "signal",
                              // The hotspot endpoint states its evidence in
                              // prose. There is no weight to render, so none is
                              // manufactured.
                              contribution: 0,
                              detail,
                              provenance: "knowledge/hotspots",
                            })),
                            confidence: null,
                            source: [
                              {
                                label: "Hotspots",
                                endpoint: "GET /api/knowledge/{run_id}/hotspots",
                                fieldPath: `[target=${hotspot.target}]`,
                              },
                            ],
                          }}
                        />
                      </div>
                      <p className={cn("type-caption text-ink-soft")}>{hotspot.kind}</p>
                    </li>
                  ))}
                </ul>
              )}
            </DataBoundary>
          )}
        </QueryBoundary>
      </section>
    </div>
  );
}
