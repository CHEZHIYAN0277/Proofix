/**
 * Knowledge-graph summary.
 *
 * Node and edge composition from `GET /knowledge/{run_id}/metrics`, plus the
 * capability groups the graph derived.
 *
 * Coverage is shown as the backend reports it. Note `files_represented` can
 * exceed `files_total` — the graph indexes documents and configs the workspace
 * scan does not count — so the ratio is presented as the two numbers rather
 * than a percentage that would read as >100%.
 */

import { useQuery } from "@tanstack/react-query";

import { DataTable, type TableColumn } from "@/design/components/Table";
import { MetricTile } from "@/design/primitives/MetricTile";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow } from "@/design/primitives/atoms";
import { GRAPH_NODE_COLORS, GRAPH_NODE_ORDER } from "@/design/tokens/color";
import { QueryBoundary } from "@/design/states/QueryBoundary";
import { kgCapabilitiesQuery, kgMetricsQuery } from "@/lib/v2/queries";
import type { Capability, KnowledgeMetrics } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

const SOURCE = [
  {
    label: "Knowledge graph metrics",
    endpoint: "GET /api/knowledge/{run_id}/metrics",
  },
];

export function KnowledgeGraphSummary() {
  const runId = useRunId();
  const query = useQuery(kgMetricsQuery(runId));

  return (
    <QueryBoundary
      query={query}
      label="the knowledge graph metrics"
      stage="Repository Intelligence"
      agent="A1"
      skeletonLines={4}
      // The graph is keyed on the repository hash, so a run that never
      // resolved one has no graph to report. That is a fact about the run,
      // not a fault — `Unavailable` with the reason, never an error.
      notFoundReason="No knowledge graph was built for this run — the pipeline resolved no repository hash to key it on."
    >
      {(metrics) => <KnowledgeGraphMetrics data={metrics} />}
    </QueryBoundary>
  );
}

function KnowledgeGraphMetrics({ data }: { data: KnowledgeMetrics }) {
  const typeRows = Object.entries(data?.nodes_by_type ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([type, count], index) => ({
      type,
      count,
      color: GRAPH_NODE_COLORS[GRAPH_NODE_ORDER[index % GRAPH_NODE_ORDER.length]].fg,
    }));

  const edgeRows = Object.entries(data?.edges_by_type ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Nodes"
          value={data?.node_count ?? null}
          source={[{ ...SOURCE[0], fieldPath: "node_count" }]}
          size="sm"
        />
        <MetricTile
          label="Edges"
          value={data?.edge_count ?? null}
          source={[{ ...SOURCE[0], fieldPath: "edge_count" }]}
          size="sm"
        />
        <MetricTile
          label="Average degree"
          value={data?.average_degree ?? null}
          source={[{ ...SOURCE[0], fieldPath: "average_degree" }]}
          size="sm"
        />
        <MetricTile
          label="Files represented"
          value={data ? `${data.files_represented} / ${data.files_total}` : null}
          source={[{ ...SOURCE[0], fieldPath: "files_represented / files_total" }]}
          size="sm"
          explain={{
            explain:
              "How many files the knowledge graph holds nodes for, against the workspace scan's file count.",
            why: [],
            confidence: null,
            source: [
              { ...SOURCE[0], fieldPath: "files_represented" },
              { ...SOURCE[0], fieldPath: "files_total" },
            ],
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Eyebrow className="mb-2">Nodes by type</Eyebrow>
          <DataBoundary
            value={typeRows.length > 0 ? typeRows : null}
            whenMissing="waiting"
            emptyIsMissing
          >
            {(rows) => (
              <DataTable
                columns={NODE_COLUMNS}
                rows={rows}
                rowKey={(row) => row.type}
                caption="Knowledge graph node composition"
                maxHeight={200}
              />
            )}
          </DataBoundary>
        </div>

        <div>
          <Eyebrow className="mb-2">Edges by type</Eyebrow>
          <DataBoundary
            value={edgeRows.length > 0 ? edgeRows : null}
            whenMissing="waiting"
            emptyIsMissing
          >
            {(rows) => (
              <DataTable
                columns={EDGE_COLUMNS}
                rows={rows}
                rowKey={(row) => row.type}
                caption="Knowledge graph edge composition"
                maxHeight={200}
              />
            )}
          </DataBoundary>
        </div>
      </div>

      <Capabilities />
    </div>
  );
}

function Capabilities() {
  const runId = useRunId();
  const query = useQuery(kgCapabilitiesQuery(runId));

  return (
    <div>
      <Eyebrow className="mb-2">Capabilities</Eyebrow>
      <QueryBoundary
        query={query}
        label="the capability groups"
        stage="Repository Intelligence"
        agent="A1"
        skeletonLines={2}
        notFoundReason="No knowledge graph was built for this run, so it grouped no capabilities."
      >
        {(caps) => (
          <DataBoundary
            value={caps.length > 0 ? caps : null}
            whenMissing="waiting"
            emptyIsMissing
            reason="The graph grouped no capabilities for this repository"
          >
            {(capabilities) => (
              <ul className="flex flex-col gap-2">
                {capabilities.map((capability: Capability) => (
                  <li
                    key={capability.slug}
                    className="rounded-card border border-border bg-surface p-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="type-label text-ink">{capability.name}</span>
                      <span className="flex items-center gap-2">
                        <span className="type-mono-sm text-ink-soft">
                          {Math.round(capability.confidence * 100)}%
                        </span>
                        <ExplainAffordance
                          id={`capability.${capability.slug}`}
                          subject={capability.name}
                          spec={{
                            explain: capability.why,
                            // The capability endpoint publishes evidence as
                            // preformatted strings rather than weighted signals, so
                            // each becomes a row with its detail intact and no
                            // fabricated contribution.
                            why: capability.evidence.map((detail) => ({
                              signal: detail.split("=")[0] ?? "signal",
                              contribution: 0,
                              detail,
                              provenance: "knowledge/capabilities",
                            })),
                            confidence: capability.confidence,
                            source: [
                              {
                                label: "Capabilities",
                                endpoint: "GET /api/knowledge/{run_id}/capabilities",
                                fieldPath: `[slug=${capability.slug}]`,
                              },
                            ],
                          }}
                        />
                      </span>
                    </div>
                    <p className="type-caption mt-1 text-ink-soft">
                      {capability.files.length} file{capability.files.length === 1 ? "" : "s"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </DataBoundary>
        )}
      </QueryBoundary>
    </div>
  );
}

const NODE_COLUMNS: TableColumn<{ type: string; count: number; color: string }>[] = [
  {
    key: "type",
    header: "Type",
    cell: (row) => (
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: row.color }}
        />
        {row.type}
      </span>
    ),
  },
  { key: "count", header: "Nodes", cell: (row) => row.count, numeric: true, width: "84px" },
];

const EDGE_COLUMNS: TableColumn<{ type: string; count: number }>[] = [
  { key: "type", header: "Type", cell: (row) => row.type, mono: true },
  { key: "count", header: "Edges", cell: (row) => row.count, numeric: true, width: "84px" },
];
