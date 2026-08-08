/**
 * Ranking explorer — `ranked_files[]` with per-signal contributions.
 *
 * This is the surface the whole explainability contract was built for. A5.5
 * makes **no LLM call**: every score is a weighted sum of named deterministic
 * signals, and the package publishes each signal's contribution by name. So
 * "why is this file in the context?" has an exact, checkable answer — the
 * weights are shown, and they add up to the score.
 *
 * Nothing here is re-derived. The score, the confidence and every signal weight
 * are A5.5's own numbers; this component sorts and draws them.
 */

import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { useMemo, useState } from "react";

import { DataTable, type TableColumn } from "@/design/components/Table";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { EvidenceList } from "@/design/primitives/EvidenceList";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import { SkeletonText } from "@/design/states/Skeleton";
import type { Evidence } from "@/design/types";
import { cn } from "@/lib/utils";
import { contextQuery } from "@/lib/v2/queries";
import type { RankedFile } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

/** A5.5's signal weights, mapped into the contract's `Evidence` shape. */
function toEvidence(file: RankedFile): Evidence[] {
  const total = Object.values(file.signals).reduce((sum, v) => sum + Math.abs(v), 0) || 1;

  return Object.entries(file.signals)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([signal, weight], index) => ({
      signal,
      value: weight.toFixed(4),
      // Share of this file's own score. The absolute weight is shown as the
      // value, so nothing is hidden by the normalisation.
      contribution: Math.abs(weight) / total,
      // The package's evidence strings are ordered to match the signals that
      // fired, so they pair up where both exist.
      detail: file.evidence[index],
      provenance: "A5.5 ranking",
    }));
}

export function RankingExplorer() {
  const runId = useRunId();
  const { data, isLoading } = useQuery(contextQuery(runId));
  const [selected, setSelected] = useState<string | null>(null);

  const files = useMemo(
    () => [...(data?.ranked_files ?? [])].sort((a, b) => b.score - a.score),
    [data],
  );

  const current = useMemo(
    () => files.find((f) => f.file === selected) ?? files[0] ?? null,
    [files, selected],
  );

  if (isLoading) return <SkeletonText lines={4} label="Loading the ranking" />;

  return (
    <DataBoundary
      value={files.length > 0 ? files : null}
      whenMissing="pending"
      emptyIsMissing
      reason="A5.5 has ranked no files for this run"
      fallback={
        // Two different absences. "No package" means the stage has not run or
        // resolved no target; "a package that ranked nothing" means it ran and
        // found nothing to rank. Reporting the second when the first is true
        // would claim work that never happened.
        data ? (
          <EmptyState
            title="No ranked files"
            description="A5.5 produced a package but ranked nothing — it resolved no target to rank against."
            size="sm"
          />
        ) : (
          <EmptyState
            title="No context package yet"
            description="A5.5 has not completed for this run, so there is no ranking to explore."
            size="sm"
          />
        )
      }
    >
      {(ranked) => (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <div className="min-w-0">
            <Eyebrow className="mb-2">Ranked files</Eyebrow>
            <DataTable
              columns={COLUMNS}
              rows={ranked}
              rowKey={(row) => row.file}
              caption="Files scored by the context ranker, highest first"
              maxHeight={280}
              onRowClick={(row) => setSelected(row.file)}
            />
          </div>

          {current && (
            <aside className="min-w-0 rounded-card border border-border bg-surface p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <Eyebrow>Why this file</Eyebrow>
                <ExplainAffordance
                  id={`ranking.${current.file}`}
                  subject={current.file}
                  spec={{
                    explain: current.reason,
                    why: toEvidence(current),
                    // A5.5 publishes a confidence per ranked file.
                    confidence: current.confidence,
                    source: [
                      {
                        label: "Context package",
                        endpoint: "GET /api/runs/{run_id}/context",
                        fieldPath: `ranked_files[file=${current.file}].signals`,
                        agentId: "A5.5",
                      },
                    ],
                  }}
                />
              </div>

              <p className="type-mono-sm mb-1 break-all text-ink">{current.file}</p>
              <p className="type-caption mb-3 text-ink-soft">{current.reason}</p>

              <div className="mb-3 flex items-baseline gap-4">
                <span className="flex items-baseline gap-1.5">
                  <span className="type-caption text-ink-soft">Score</span>
                  <span className="type-mono tabular text-ink">{current.score.toFixed(4)}</span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="type-caption text-ink-soft">Confidence</span>
                  <span className="type-mono tabular text-ink">
                    {Math.round(current.confidence * 100)}%
                  </span>
                </span>
              </div>

              <Eyebrow className="mb-2">Signal contributions</Eyebrow>
              <DataBoundary
                value={Object.keys(current.signals).length > 0 ? current.signals : null}
                whenMissing="pending"
                emptyIsMissing
                reason="No signal fired for this file"
              >
                {() => <EvidenceList evidence={toEvidence(current)} />}
              </DataBoundary>
            </aside>
          )}
        </div>
      )}
    </DataBoundary>
  );
}

const COLUMNS: TableColumn<RankedFile>[] = [
  {
    key: "file",
    header: "File",
    cell: (row) => (
      <span className={cn("flex items-center gap-1.5", row.is_target && "text-primary")}>
        {row.is_target && (
          <Target aria-label="Resolved patch target" className="size-3 shrink-0" strokeWidth={2} />
        )}
        <span className="truncate">{row.file}</span>
      </span>
    ),
    mono: true,
  },
  {
    key: "score",
    header: "Score",
    cell: (row) => row.score.toFixed(3),
    numeric: true,
    width: "88px",
  },
  {
    key: "confidence",
    header: "Confidence",
    cell: (row) => `${Math.round(row.confidence * 100)}%`,
    numeric: true,
    width: "104px",
  },
  {
    key: "signals",
    header: "Signals",
    cell: (row) => Object.keys(row.signals).length,
    numeric: true,
    width: "84px",
  },
];
