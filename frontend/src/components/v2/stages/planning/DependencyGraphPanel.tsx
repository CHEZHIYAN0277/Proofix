/**
 * Dependency edges — the DAG itself, and the reason A6 drew each edge.
 *
 * The canvas is the product's one graph renderer, so the repair DAG gets the
 * same layered layout, legend, hover-neighbourhood and table equivalent as the
 * call graph. Layout is deterministic per data version: re-fetching an
 * unchanged plan moves nothing.
 *
 * The reason strings are the part that matters. A dependency drawn without a
 * stated reason is an ordering the reader cannot check, so every edge is listed
 * with its own — and an edge A6 left unexplained says so rather than borrowing
 * a plausible sentence.
 */

import { Suspense, lazy } from "react";

import { DataTable, type TableColumn } from "@/design/components/Table";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow } from "@/design/primitives/atoms";
import { DataState } from "@/design/states/DataState";
import { EmptyState } from "@/design/states/EmptyState";
import { LoadingState } from "@/design/states/LoadingState";
import type { DependencyEdge, RepairPlan } from "@/lib/v2/types";
import { conflictedSteps, planGraph } from "./plan";

const GraphCanvas = lazy(() => import("../../graph/GraphCanvas"));

export function DependencyGraphPanel({ plan }: { plan: RepairPlan | null }) {
  const graph = plan ? planGraph(plan) : null;
  const edges = plan?.dependency_edges ?? [];
  // Steps that collide over a file are ringed — the graph shows ordering, the
  // ring shows where that ordering is load-bearing.
  const implicated = plan ? conflictedSteps(plan) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<LoadingState label="Loading the repair DAG" />}>
        <GraphCanvas
          title="Repair DAG"
          graph={graph}
          implicated={implicated}
          height={360}
          emptyTitle="No repair DAG"
          emptyDescription={
            plan
              ? "A6 planned no steps for this run, so the DAG has no nodes."
              : "A6 has not completed for this run."
          }
        />
      </Suspense>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Eyebrow>Dependency edges</Eyebrow>
          <ExplainAffordance
            id="planning.edges"
            subject="Dependency edges"
            spec={{
              explain:
                "Each edge means the source step must land before the target. A6 derives them from the semantic graph and from CVE records — a dependency upgrade precedes the application code that imports it.",
              why: [],
              confidence: null,
              source: [
                {
                  label: "Repair plan",
                  endpoint: "GET /api/runs/{run_id}/plan",
                  fieldPath: "dependency_edges",
                  agentId: "A6",
                },
              ],
            }}
          />
        </div>

        <DataBoundary
          value={edges.length > 0 ? edges : null}
          whenMissing="waiting"
          emptyIsMissing
          reason="A6 drew no dependency edges"
          fallback={
            plan ? (
              <EmptyState
                title="No dependencies"
                description="A6 found no ordering constraint between the steps — they are independent. This is a result, not a gap."
                size="sm"
              />
            ) : (
              <EmptyState
                title="No repair plan yet"
                description="A6 has not completed for this run."
                size="sm"
              />
            )
          }
        >
          {(rows) => (
            <DataTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(row, index) => `${row.from_issue}->${row.to_issue}:${index}`}
              caption="Ordering constraints A6 drew between repair steps"
              maxHeight={240}
            />
          )}
        </DataBoundary>
      </section>
    </div>
  );
}

const COLUMNS: TableColumn<DependencyEdge>[] = [
  { key: "from_issue", header: "Must land first", cell: (row) => row.from_issue, mono: true },
  { key: "to_issue", header: "Before", cell: (row) => row.to_issue, mono: true },
  {
    key: "reason",
    header: "Reason",
    cell: (row) =>
      row.reason?.trim() ? (
        // `DataTable` cells are `truncate`, which in a table means *nowrap*:
        // auto layout then widens the table to fit the longest reason on one
        // line — measured at 2448px against a 1440px viewport — so the column
        // scrolls sideways and the sentence is cut off rather than read.
        // A6's reasons are prose, and prose has to wrap.
        <span className="block whitespace-normal break-words py-1.5">{row.reason}</span>
      ) : (
        <DataState
          kind="unavailable"
          reason="A6 drew this edge without recording a reason"
          size="sm"
          variant="inline"
        />
      ),
  },
];
