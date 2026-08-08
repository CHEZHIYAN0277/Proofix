/**
 * Static analysis — scanners, severity and affected files.
 *
 * Source: A3's agent projection (`evidence` + `metrics`) and its `visualization`
 * payload. A3 runs bandit, semgrep and ruff and publishes a consensus-ranked
 * list; this renders that list.
 *
 * A clean scan renders as a clean scan. "0 prioritized findings" is a result
 * the reader needs — it is what A4 will investigate against — so it is stated
 * rather than hidden behind an empty section.
 */

import { useQuery } from "@tanstack/react-query";

import { DataTable, type TableColumn } from "@/design/components/Table";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { KeyValue } from "@/design/primitives/atoms";
import { Eyebrow } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import { SkeletonText } from "@/design/states/Skeleton";
import { orNull } from "@/lib/v2/absence";
import { agentsQuery } from "@/lib/v2/queries";
import type { AgentEntry } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

const STATIC_AGENT_ID = "A3";
const DEPS_AGENT_ID = "A2";

interface FindingRow {
  file: string;
  line: number | null;
  severity: number | null;
  tools: string;
  message: string;
}

export function StaticAnalysisPanel() {
  const runId = useRunId();
  const { data, isLoading } = useQuery(agentsQuery(runId));

  if (isLoading) return <SkeletonText lines={4} label="Loading static analysis" />;

  const entries = data ?? [];
  const stat = entries.find((e: AgentEntry) => e.agentId === STATIC_AGENT_ID);
  const deps = entries.find((e: AgentEntry) => e.agentId === DEPS_AGENT_ID);

  const findings = readFindings(stat);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <Eyebrow className="mb-2">Scanners</Eyebrow>
          <DataBoundary
            value={stat?.evidence?.fields}
            whenMissing="waiting"
            emptyIsMissing
            reason="A3 has not published its findings yet"
          >
            {(fields) => (
              <dl className="flex flex-col gap-1">
                {/* Index-suffixed: `evidence.fields` is a backend array with
                    no uniqueness guarantee on `label`, and two fields sharing
                    one silently drops a row. */}
                {fields.map((field, index) => (
                  <KeyValue
                    key={`${field.label}:${index}`}
                    label={field.label}
                    value={orNull(field.value)}
                    whenMissing="unavailable"
                    reason="A3 ran and recorded no value for this field"
                    mono={field.mono !== false}
                  />
                ))}
              </dl>
            )}
          </DataBoundary>
        </section>

        <section>
          <Eyebrow className="mb-2">Dependency reachability</Eyebrow>
          <DataBoundary
            value={deps?.evidence?.fields}
            whenMissing="waiting"
            emptyIsMissing
            reason="A2 has not published its reachability report yet"
          >
            {(fields) => (
              <dl className="flex flex-col gap-1">
                {/* Index-suffixed: `evidence.fields` is a backend array with
                    no uniqueness guarantee on `label`, and two fields sharing
                    one silently drops a row. */}
                {fields.map((field, index) => (
                  <KeyValue
                    key={`${field.label}:${index}`}
                    label={field.label}
                    value={orNull(field.value)}
                    whenMissing="unavailable"
                    reason="A2 ran and recorded no value for this field"
                    mono={field.mono !== false}
                  />
                ))}
              </dl>
            )}
          </DataBoundary>
        </section>
      </div>

      <section>
        <Eyebrow className="mb-2">Prioritized findings</Eyebrow>
        <DataBoundary
          value={findings.length > 0 ? findings : null}
          whenMissing="waiting"
          emptyIsMissing
          fallback={
            <EmptyState
              title="No prioritized findings"
              description="The scanners ran and the consensus ranking selected nothing. This is a result, not a gap."
              size="sm"
            />
          }
        >
          {(rows) => (
            <DataTable
              columns={FINDING_COLUMNS}
              rows={rows}
              rowKey={(row, index) => `${row.file}:${row.line}:${index}`}
              caption="Findings ranked by severity, criticality, tool consensus and churn"
              maxHeight={280}
            />
          )}
        </DataBoundary>
      </section>
    </div>
  );
}

/**
 * A3's visualization payload carries the ranked findings. Shapes vary between
 * runs (the payload predates a published schema), so each field is read
 * defensively and left `null` when absent rather than defaulted to zero — a
 * severity of 0 and an unmeasured severity are different claims.
 */
function readFindings(entry: AgentEntry | undefined): FindingRow[] {
  const data = (entry?.visualization as { data?: unknown } | undefined)?.data;
  if (!data || typeof data !== "object") return [];

  const candidates =
    (data as { findings?: unknown; prioritized?: unknown; items?: unknown }).findings ??
    (data as { prioritized?: unknown }).prioritized ??
    (data as { items?: unknown }).items;

  if (!Array.isArray(candidates)) return [];

  return candidates.map((raw) => {
    const record = (raw ?? {}) as Record<string, unknown>;
    const tools = record.tools;
    return {
      file: String(record.file ?? record.path ?? "—"),
      line: typeof record.line === "number" ? record.line : null,
      severity: typeof record.severity === "number" ? record.severity : null,
      tools: Array.isArray(tools) ? tools.join(", ") : String(tools ?? ""),
      message: String(record.message ?? record.title ?? ""),
    };
  });
}

const FINDING_COLUMNS: TableColumn<FindingRow>[] = [
  { key: "file", header: "File", cell: (row) => row.file, mono: true },
  {
    key: "line",
    header: "Line",
    cell: (row) => row.line ?? "—",
    numeric: true,
    width: "72px",
  },
  {
    key: "severity",
    header: "Severity",
    cell: (row) => (row.severity === null ? "—" : row.severity.toFixed(2)),
    numeric: true,
    width: "92px",
  },
  { key: "tools", header: "Tools", cell: (row) => row.tools, width: "140px" },
  { key: "message", header: "Finding", cell: (row) => row.message },
];
