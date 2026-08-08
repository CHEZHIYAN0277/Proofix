/**
 * File inspector — named graph queries for the selected path.
 *
 * Every answer is a **server-side traversal** through the existing query
 * engine (`GET /knowledge/{id}/query/{name}?file=`). The client holds no index
 * and computes no relationships; it asks and renders.
 *
 * A query that returns nothing renders as empty, not as a gap: "no test
 * exercises this file" is a finding, and hiding it would lose it.
 */

import { useQuery } from "@tanstack/react-query";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { Eyebrow } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import { ErrorState } from "@/design/states/ErrorState";
import { SkeletonText } from "@/design/states/Skeleton";
import { runNamedQuery } from "@/lib/v2/queries";
import type { QueryResultNode } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

/** The three questions worth answering about a file, and their queries. */
const QUERIES = [
  { name: "functions_in_file", label: "Defines" },
  { name: "supporting_tests", label: "Tested by" },
  { name: "owners_of", label: "Owned by" },
] as const;

export function FileInspector({ file }: { file: string | null }) {
  if (!file) {
    return (
      <aside className="rounded-card border border-dashed border-border p-4">
        <Eyebrow className="mb-2">Inspector</Eyebrow>
        <p className="type-caption text-ink-soft">
          Select a file to run the repository's own graph queries against it.
        </p>
      </aside>
    );
  }

  return (
    <aside className="min-w-0 rounded-card border border-border bg-surface p-4">
      <Eyebrow className="mb-1">Inspector</Eyebrow>
      <p className="type-mono-sm mb-3 break-all text-ink">{file}</p>

      <div className="flex flex-col gap-4">
        {QUERIES.map((query) => (
          <NamedQuerySection key={query.name} file={file} name={query.name} label={query.label} />
        ))}
      </div>
    </aside>
  );
}

function NamedQuerySection({ file, name, label }: { file: string; name: string; label: string }) {
  const runId = useRunId();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["v2", "kg", runId, "query", name, file],
    queryFn: ({ signal }) => runNamedQuery(runId, name, { file }, signal),
    staleTime: Infinity,
    retry: 1,
  });

  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="type-label text-ink-soft">{label}</span>
        {data && <span className="type-mono-sm text-ink-soft/60">{data.count}</span>}
      </div>

      {isLoading && <SkeletonText lines={2} label={`Running ${name}`} />}

      {error && (
        <ErrorState
          title={`Query "${name}" failed`}
          detail={(error as Error).message}
          source={`GET /api/knowledge/{run_id}/query/${name}?file=`}
          onRetry={() => void refetch()}
          size="sm"
        />
      )}

      {data && (
        <DataBoundary
          value={data.results.length > 0 ? data.results : null}
          whenMissing="waiting"
          emptyIsMissing
          fallback={<EmptyState title="None" size="sm" />}
        >
          {(results) => (
            <ul className="flex flex-col gap-0.5">
              {results.map((node: QueryResultNode) => (
                <li key={node.id} className="min-w-0">
                  <span
                    className="type-mono-sm block truncate text-ink"
                    title={node.qualname ?? node.name}
                  >
                    {node.qualname ?? node.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DataBoundary>
      )}
    </section>
  );
}
