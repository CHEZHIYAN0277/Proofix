/**
 * Blast radius — what a change at the origin can reach.
 *
 * A5 walks the semantic graph forward and backward from the resolved target,
 * decaying confidence per hop, and splits the result into an auto-patchable
 * scope and files needing human review.
 *
 * Hop distance is published per file (`hitAt`) and is shown. **Propagation
 * confidence is not** — `_visualization_for("blast")` emits `{name, hitAt}`
 * only, so the per-file confidence that decides which side of the split a file
 * lands on never reaches the client (G11). The split totals are published, so
 * those are shown; the per-file confidence says so.
 */

import { useQuery } from "@tanstack/react-query";

import { DataTable, type TableColumn } from "@/design/components/Table";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow, KeyValue } from "@/design/primitives/atoms";
import { DataState } from "@/design/states/DataState";
import { EmptyState } from "@/design/states/EmptyState";
import { SkeletonText } from "@/design/states/Skeleton";
import { orNull } from "@/lib/v2/absence";
import { agentsQuery } from "@/lib/v2/queries";
import type { AgentEntry } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

const BLAST_AGENT_ID = "A5";

const G11 =
  "Per-file propagation confidence is not published — the blast payload carries path and hop count only (G11)";

interface BlastData {
  source?: string;
  modules?: { name: string; hitAt: number }[];
}

interface ScopeRow {
  path: string;
  hops: number;
}

export function BlastRadiusPanel({ onSelectFile }: { onSelectFile?: (file: string) => void }) {
  const runId = useRunId();
  const { data, isLoading } = useQuery(agentsQuery(runId));

  if (isLoading) return <SkeletonText lines={4} label="Loading blast radius" />;

  const agent = (data ?? []).find((e: AgentEntry) => e.agentId === BLAST_AGENT_ID);
  const viz = (agent?.visualization as { data?: BlastData } | undefined)?.data;
  const fields = agent?.evidence?.fields ?? [];

  const field = (label: string) => orNull(fields.find((f) => f.label === label)?.value);

  const rows: ScopeRow[] =
    viz?.modules
      ?.map((module) => ({ path: module.name, hitAt: module.hitAt }))
      .map((m) => ({
        path: m.path,
        hops: m.hitAt,
      })) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Eyebrow>Scope</Eyebrow>
            <ExplainAffordance
              id="blast.scope"
              subject="Blast radius"
              spec={{
                explain:
                  "Files reachable from the resolved origin by a bounded walk of the semantic graph, split by whether A5's propagation confidence cleared its threshold.",
                why: [],
                confidence: null,
                source: [
                  {
                    label: "Impact set",
                    endpoint: "GET /api/runs/{id}/agents?surface=v2",
                    fieldPath: "[agentId=A5].evidence.fields",
                    agentId: "A5",
                  },
                ],
              }}
            />
          </div>
          <dl className="flex flex-col gap-1">
            <KeyValue
              label="Origin"
              value={field("Origins")}
              whenMissing="unavailable"
              reason="A5 resolved no origin"
              mono
            />
            <KeyValue
              label="In scope"
              value={field("In scope")}
              whenMissing="unavailable"
              reason="A5 published no scope size"
              mono
            />
            <KeyValue
              label="Auto-patchable"
              value={field("Auto-patchable")}
              whenMissing="unavailable"
              reason="A5 published no auto-patch scope"
              mono
            />
            <KeyValue
              label="Human review"
              value={field("Human review")}
              whenMissing="unavailable"
              reason="A5 published no human-review set"
              mono
            />
          </dl>
        </section>

        <section>
          <Eyebrow className="mb-2">Propagation confidence</Eyebrow>
          <DataState kind="unavailable" reason={G11} size="sm" />
          <p className="type-caption mt-2 text-ink-soft">
            A5 computes a decayed confidence per file and uses it to split the scope. The split
            totals are published; the per-file value is not.
          </p>
        </section>
      </div>

      <section>
        <Eyebrow className="mb-2">Reachable files</Eyebrow>
        <DataBoundary
          value={rows.length > 0 ? rows : null}
          whenMissing="waiting"
          emptyIsMissing
          reason="A5 placed no files in scope"
          fallback={
            <EmptyState
              title="Nothing in scope"
              description="A5 resolved no files reachable from the origin. This is a result, not a gap."
              size="sm"
            />
          }
        >
          {(scope) => (
            <DataTable
              columns={COLUMNS}
              rows={scope}
              rowKey={(row) => row.path}
              caption="Files reachable from the origin, by hop distance"
              maxHeight={240}
              onRowClick={onSelectFile ? (row) => onSelectFile(row.path) : undefined}
            />
          )}
        </DataBoundary>
      </section>
    </div>
  );
}

const COLUMNS: TableColumn<ScopeRow>[] = [
  { key: "path", header: "File", cell: (row) => row.path, mono: true },
  {
    key: "hops",
    header: "Hops",
    cell: (row) => row.hops,
    numeric: true,
    width: "80px",
  },
];
