/**
 * The assembled package — token reduction, budget, and what the model is told.
 *
 * **Token reduction comes from `original_tokens` / `reduced_tokens` and nothing
 * else.** The claim "A5.5 cuts the prompt by N%" is the stage's entire
 * justification, so it is read from the two numbers A5.5 measured rather than
 * estimated from character counts, budget ratios, or anything else that would
 * make the number look better than it is. When they are equal, the reduction is
 * 0% and it says 0%.
 *
 * `degraded` is surfaced prominently: a package A5.5 could not fully build is a
 * package whose measurements describe a fallback, and reading its reduction as
 * a success would be reading the wrong run.
 */

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { MetricTile } from "@/design/primitives/MetricTile";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { Eyebrow, KeyValue } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import { SkeletonText } from "@/design/states/Skeleton";
import { contextQuery } from "@/lib/v2/queries";
import { useRunId } from "../../RunProvider";

const SOURCE = {
  label: "Context package",
  endpoint: "GET /api/runs/{run_id}/context",
  agentId: "A5.5",
};

export function PackagePanel() {
  const runId = useRunId();
  const { data, isLoading } = useQuery(contextQuery(runId));

  if (isLoading) return <SkeletonText lines={4} label="Loading the context package" />;

  return (
    <DataBoundary
      value={data}
      whenMissing="pending"
      reason="A5.5 has not produced a context package for this run"
      fallback={
        <EmptyState
          title="No context package yet"
          description="A5.5 has not completed, or resolved no target. The endpoint answers 404 until it does."
          size="sm"
        />
      }
    >
      {(pkg) => {
        const m = pkg.metrics;

        return (
          <div className="flex flex-col gap-4">
            {m.degraded && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-card border p-3"
                style={{
                  borderColor: "color-mix(in srgb, var(--status-retry) 40%, transparent)",
                  backgroundColor: "var(--status-retry-bg)",
                }}
              >
                <AlertTriangle
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0"
                  style={{ color: "var(--status-retry)" }}
                  strokeWidth={2}
                />
                <p className="type-body-sm text-ink">
                  A5.5 marked this package <span className="type-mono">degraded</span> — it fell
                  back rather than building a full context. The measurements below describe that
                  fallback.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                label="Original tokens"
                value={m.original_tokens}
                source={[{ ...SOURCE, fieldPath: "metrics.original_tokens" }]}
                size="sm"
              />
              <MetricTile
                label="Reduced tokens"
                value={m.reduced_tokens}
                source={[{ ...SOURCE, fieldPath: "metrics.reduced_tokens" }]}
                size="sm"
              />
              <MetricTile
                label="Token reduction"
                value={Math.round(m.token_reduction * 100)}
                unit="%"
                source={[{ ...SOURCE, fieldPath: "metrics.token_reduction" }]}
                size="sm"
                explain={{
                  explain:
                    "How much smaller the prompt became, as A5.5 measured it — reduced tokens against original tokens.",
                  why: [
                    {
                      signal: "original_tokens",
                      value: m.original_tokens,
                      contribution: 1,
                      detail: "Tokens the unreduced context would have cost",
                      provenance: "A5.5 metrics",
                    },
                    {
                      signal: "reduced_tokens",
                      value: m.reduced_tokens,
                      contribution: m.original_tokens ? m.reduced_tokens / m.original_tokens : 0,
                      detail: "Tokens the assembled package costs",
                      provenance: "A5.5 metrics",
                    },
                  ],
                  confidence: null,
                  source: [
                    { ...SOURCE, fieldPath: "metrics.original_tokens" },
                    { ...SOURCE, fieldPath: "metrics.reduced_tokens" },
                  ],
                }}
              />
              <MetricTile
                label="Estimated saved"
                value={m.estimated_saved_tokens}
                unit="tokens"
                source={[{ ...SOURCE, fieldPath: "metrics.estimated_saved_tokens" }]}
                size="sm"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section>
                <Eyebrow className="mb-2">Extraction</Eyebrow>
                <dl className="flex flex-col gap-1">
                  <KeyValue label="Target file" value={pkg.target_file} mono />
                  <KeyValue
                    label="Target function"
                    value={pkg.target_function}
                    whenMissing="unavailable"
                    reason="A5.5 resolved a file but no specific function"
                    mono
                  />
                  <KeyValue label="Files extracted" value={String(m.files_extracted)} mono />
                  <KeyValue label="Functions" value={String(m.context_functions)} mono />
                  <KeyValue label="Lines" value={String(m.context_lines)} mono />
                  <KeyValue label="Budget" value={`${m.budget_chars} chars`} mono />
                  <KeyValue label="Cache hit" value={m.cache_hit ? "yes" : "no"} mono />
                  <KeyValue label="Ranking version" value={pkg.ranking_version} mono />
                </dl>
              </section>

              <section>
                <Eyebrow className="mb-2">Timings</Eyebrow>
                <dl className="flex flex-col gap-1">
                  <KeyValue label="Ranking" value={`${m.ranking_time_ms} ms`} mono />
                  <KeyValue label="Extraction" value={`${m.extraction_time_ms} ms`} mono />
                  <KeyValue label="Privacy" value={`${m.privacy_time_ms} ms`} mono />
                  <KeyValue label="Build" value={`${m.build_time_ms} ms`} mono />
                </dl>
              </section>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <StringList
                title="Acceptance criteria"
                items={pkg.acceptance_criteria}
                reason="A5.5 derived no acceptance criteria"
              />
              <StringList
                title="Patch constraints"
                items={pkg.patch_constraints}
                reason="A5.5 derived no patch constraints"
              />
              <StringList
                title="Dependency summary"
                items={pkg.dependency_summary}
                reason="A5.5 summarised no dependencies"
              />
              <StringList
                title="Contracts"
                items={pkg.contracts}
                reason="A5.5 recorded no contracts"
              />
            </div>
          </div>
        );
      }}
    </DataBoundary>
  );
}

function StringList({ title, items, reason }: { title: string; items: string[]; reason: string }) {
  return (
    <section className="min-w-0">
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <DataBoundary value={items} whenMissing="waiting" emptyIsMissing reason={reason}>
        {(list) => (
          <ul className="flex flex-col gap-1">
            {list.map((item, index) => (
              <li key={index} className="type-body-sm text-ink-soft">
                {item}
              </li>
            ))}
          </ul>
        )}
      </DataBoundary>
    </section>
  );
}
