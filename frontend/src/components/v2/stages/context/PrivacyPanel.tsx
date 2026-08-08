/**
 * Privacy — the guard's verdict and every redaction it made.
 *
 * Three states, and the difference between them is the whole point:
 *
 *   `clean`  — the guard ran and found nothing to mask.
 *   `masked` — it found secrets and masked them; each is listed by detector.
 *   `failed` — **it could not certify the context.** This renders red and
 *              blocking, because a guard that failed is not the same as a
 *              guard that found nothing, and rendering them alike would let a
 *              run whose context was never verified pass for one that was.
 *
 * Masking is structure-preserving by design — `SECRET_KEY = "abc123"` becomes
 * `SECRET_KEY = "<REDACTED:str:6>"` — so the code still parses and the model
 * still sees the shape while the value never leaves the process.
 */

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useMemo } from "react";

import { DataTable, type TableColumn } from "@/design/components/Table";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import { SkeletonText } from "@/design/states/Skeleton";
import { cn } from "@/lib/utils";
import { contextQuery } from "@/lib/v2/queries";
import type { PrivacyGuardStatus, Redaction } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

const STATUS: Record<
  PrivacyGuardStatus,
  { icon: typeof ShieldCheck; color: string; title: string; detail: string }
> = {
  clean: {
    icon: ShieldCheck,
    color: "var(--status-completed)",
    title: "Clean",
    detail: "The guard ran and found nothing to mask.",
  },
  masked: {
    icon: ShieldAlert,
    color: "var(--status-retry)",
    title: "Masked",
    detail: "Secrets were detected and replaced before the context left the process.",
  },
  failed: {
    icon: ShieldX,
    color: "var(--status-failed)",
    title: "Failed",
    detail:
      "The guard could not certify this context. Treat it as unverified — this is not the same as finding nothing.",
  },
};

interface RedactionRow {
  file: string;
  line: number | null;
  detector: string;
  placeholder: string;
}

export function PrivacyPanel() {
  const runId = useRunId();
  const { data, isLoading } = useQuery(contextQuery(runId));

  const rows = useMemo<RedactionRow[]>(
    () =>
      (data?.redactions ?? []).map((r: Redaction) => ({
        file: String(r.file ?? "—"),
        line: typeof r.line === "number" ? r.line : null,
        detector: String(r.detector ?? "—"),
        placeholder: String(r.placeholder ?? "—"),
      })),
    [data],
  );

  /** Redaction counts per detector — which rule actually caught things. */
  const byDetector = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.detector, (counts.get(row.detector) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  if (isLoading) return <SkeletonText lines={3} label="Loading the privacy report" />;

  return (
    <DataBoundary
      value={data?.privacy_guard_status}
      whenMissing="pending"
      reason="The privacy guard has not reported for this run"
    >
      {(status) => {
        const spec = STATUS[status];
        const Icon = spec.icon;
        const blocking = status === "failed";

        return (
          <div className="flex flex-col gap-4">
            <div
              className={cn("rounded-card border p-4")}
              style={{
                borderColor: blocking
                  ? "var(--status-failed)"
                  : "color-mix(in srgb, var(--border) 100%, transparent)",
                backgroundColor: blocking ? "var(--status-failed-bg)" : "var(--surface)",
              }}
              role={blocking ? "alert" : undefined}
            >
              <div className="flex items-start gap-3">
                <Icon
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0"
                  style={{ color: spec.color }}
                  strokeWidth={1.75}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="type-title-3" style={{ color: spec.color }}>
                      {spec.title}
                    </span>
                    <ExplainAffordance
                      id="privacy.guard"
                      subject="Privacy guard"
                      spec={{
                        explain: spec.detail,
                        why: byDetector.map(([detector, count]) => ({
                          signal: detector,
                          value: count,
                          contribution: count / Math.max(1, rows.length),
                          detail: `${count} value${count === 1 ? "" : "s"} masked by this detector`,
                          provenance: "A5.5 privacy guard",
                        })),
                        // The guard reports a verdict, not a probability.
                        confidence: null,
                        source: [
                          {
                            label: "Context package",
                            endpoint: "GET /api/runs/{run_id}/context",
                            fieldPath: "privacy_guard_status · redactions[]",
                            agentId: "A5.5",
                          },
                        ],
                      }}
                    />
                  </div>
                  <p className="type-body-sm mt-1 text-ink-soft">{spec.detail}</p>
                </div>
                <span className="type-mono shrink-0 tabular text-ink">
                  {rows.length}
                  <span className="type-caption ml-1 text-ink-soft">
                    redaction{rows.length === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
            </div>

            {byDetector.length > 0 && (
              <div>
                <Eyebrow className="mb-2">By detector</Eyebrow>
                <ul className="flex flex-wrap gap-2">
                  {byDetector.map(([detector, count]) => (
                    <li
                      key={detector}
                      className="type-mono-sm rounded-full border border-border bg-surface-muted px-2 py-0.5 text-ink"
                    >
                      {detector} · {count}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <Eyebrow className="mb-2">Redactions</Eyebrow>
              <DataBoundary
                value={rows.length > 0 ? rows : null}
                whenMissing="waiting"
                emptyIsMissing
                fallback={
                  <EmptyState
                    title="Nothing masked"
                    description={
                      blocking
                        ? "The guard failed before it could report redactions."
                        : "The guard inspected the context and found no secrets. This is a result, not a gap."
                    }
                    size="sm"
                  />
                }
              >
                {(redactions) => (
                  <DataTable
                    columns={COLUMNS}
                    rows={redactions}
                    rowKey={(row, index) => `${row.file}:${row.line}:${index}`}
                    caption="Values the privacy guard masked before the context left the process"
                    maxHeight={240}
                  />
                )}
              </DataBoundary>
            </div>
          </div>
        );
      }}
    </DataBoundary>
  );
}

const COLUMNS: TableColumn<RedactionRow>[] = [
  { key: "file", header: "File", cell: (row) => row.file, mono: true },
  { key: "line", header: "Line", cell: (row) => row.line ?? "—", numeric: true, width: "72px" },
  { key: "detector", header: "Detector", cell: (row) => row.detector, width: "160px" },
  { key: "placeholder", header: "Placeholder", cell: (row) => row.placeholder, mono: true },
];
