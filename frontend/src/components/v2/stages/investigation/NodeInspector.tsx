/**
 * Node inspector — explainability for a selected graph node (blueprint §9).
 *
 * "Explainability registered on every node" is a Phase 3 requirement, and this
 * is where it is honoured: a selected node answers **Explain · Why · Confidence
 * · Source** from the graph's own attributes plus the named queries the server
 * runs for it.
 *
 * Confidence is `null` — the graph publishes structure, not belief, and no node
 * in the call export carries a confidence. Rendering "Not published" is the
 * correct answer, and a synthesized number would be the failure this contract
 * exists to prevent.
 */

import { useQuery } from "@tanstack/react-query";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow, KeyValue } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import { SkeletonText } from "@/design/states/Skeleton";
import { orNull } from "@/lib/v2/absence";
import { runNamedQuery } from "@/lib/v2/queries";
import type { GraphNode, QueryResultNode } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

/** Questions the graph can answer about a callable, and their queries. */
const CALLABLE_QUERIES = [
  { name: "callers_of", label: "Called by" },
  { name: "functions_called_by", label: "Calls" },
  { name: "supporting_tests", label: "Tested by" },
] as const;

export function NodeInspector({ node, file }: { node: GraphNode | null; file: string | null }) {
  if (!node && !file) {
    return (
      <aside className="rounded-card border border-dashed border-border p-4">
        <Eyebrow className="mb-2">Inspector</Eyebrow>
        <p className="type-caption text-ink-soft">
          Select a node, a citation or a reachable file to see what the graph knows about it.
        </p>
      </aside>
    );
  }

  const attributes = (node?.attributes ?? {}) as Record<string, unknown>;
  const lineno = typeof attributes.lineno === "number" ? attributes.lineno : null;
  const endLineno = typeof attributes.end_lineno === "number" ? attributes.end_lineno : null;
  const docstring = typeof attributes.docstring === "string" ? attributes.docstring : null;
  const decorators = Array.isArray(attributes.decorators)
    ? (attributes.decorators as string[])
    : [];

  return (
    <aside className="min-w-0 rounded-card border border-border bg-surface p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <Eyebrow>Inspector</Eyebrow>
        {node && (
          <ExplainAffordance
            id={`graph.node.${node.id}`}
            subject={node.label || node.qualname || node.id}
            spec={{
              explain: `A ${node.type} node the repository graph indexed${
                node.file ? ` in ${node.file}` : ""
              }.`,
              // Structural facts the export published, each stated with its
              // provenance. No weights are invented — the graph does not rank
              // its own nodes.
              why: [
                ...(lineno !== null
                  ? [
                      {
                        signal: "span",
                        value: endLineno ? `${lineno}–${endLineno}` : String(lineno),
                        contribution: 0,
                        detail: "Line span recorded by the AST index",
                        provenance: "repository_graph",
                      },
                    ]
                  : []),
                ...decorators.map((decorator) => ({
                  signal: "decorator",
                  value: decorator,
                  contribution: 0,
                  detail: "Applied at the definition site",
                  provenance: "repository_graph",
                })),
              ],
              confidence: null,
              source: [
                {
                  label: "Call graph export",
                  endpoint: "GET /api/knowledge/{run_id}/export/call?fmt=json",
                  fieldPath: `nodes[id=${node.id}]`,
                },
              ],
            }}
          />
        )}
      </div>

      {node ? (
        <>
          <p className="type-mono-sm mb-2 break-all text-ink">
            {node.qualname || node.label || node.id}
          </p>
          <dl className="mb-3 flex flex-col gap-1">
            <KeyValue label="Type" value={node.type} mono />
            <KeyValue
              label="File"
              value={orNull(node.file)}
              whenMissing="unavailable"
              reason="This node is not anchored to a file"
              mono
            />
            <KeyValue
              label="Lines"
              value={lineno === null ? null : endLineno ? `${lineno}–${endLineno}` : String(lineno)}
              whenMissing="unavailable"
              reason="The index recorded no line span"
              mono
            />
          </dl>
          {docstring && <p className="type-caption mb-3 text-ink-soft">{docstring}</p>}
        </>
      ) : (
        <p className="type-mono-sm mb-3 break-all text-ink">{file}</p>
      )}

      {file && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {CALLABLE_QUERIES.map((query) => (
            <QuerySection
              key={query.name}
              file={file}
              qualname={node?.qualname ?? undefined}
              name={query.name}
              label={query.label}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function QuerySection({
  file,
  qualname,
  name,
  label,
}: {
  file: string;
  qualname?: string;
  name: string;
  label: string;
}) {
  const runId = useRunId();

  const { data, isLoading, error } = useQuery({
    queryKey: ["v2", "kg", runId, "query", name, file, qualname ?? ""],
    queryFn: ({ signal }) => runNamedQuery(runId, name, { file, qualname }, signal),
    staleTime: Infinity,
    retry: 1,
  });

  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="type-label text-ink-soft">{label}</span>
        {data && <span className="type-mono-sm text-ink-soft/60">{data.count}</span>}
      </div>

      {isLoading && <SkeletonText lines={1} label={`Running ${name}`} />}

      {/* A query the graph cannot answer for this target is reported as such,
          not silently blank. */}
      {error && <p className="type-caption text-ink-soft">Query unavailable for this target.</p>}

      {data && (
        <DataBoundary
          value={data.results.length > 0 ? data.results : null}
          whenMissing="waiting"
          emptyIsMissing
          fallback={<EmptyState title="None" size="sm" />}
        >
          {(results) => (
            <ul className="flex flex-col gap-0.5">
              {results.map((result: QueryResultNode) => (
                <li key={result.id} className="min-w-0">
                  <span
                    className="type-mono-sm block truncate text-ink"
                    title={result.qualname ?? result.name}
                  >
                    {result.qualname ?? result.name}
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
