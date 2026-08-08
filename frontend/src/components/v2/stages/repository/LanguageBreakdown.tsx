/**
 * Language breakdown from `workspace.languages`.
 *
 * The backend publishes a language → file-count map. Percentages are derived
 * from those counts and nothing else — no bytes, no lines, no weighting. The
 * count is stated alongside every share so the reader can check the
 * arithmetic, which is the difference between a chart and an assertion.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { DataTable, type TableColumn } from "@/design/components/Table";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { GRAPH_NODE_COLORS, GRAPH_NODE_ORDER } from "@/design/tokens/color";
import { QueryBoundary } from "@/design/states/QueryBoundary";
import { kgMetricsQuery } from "@/lib/v2/queries";
import type { KnowledgeMetrics } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

interface LanguageRow {
  language: string;
  files: number;
  share: number;
  color: string;
}

export function LanguageBreakdown() {
  const runId = useRunId();
  const query = useQuery(kgMetricsQuery(runId));

  return (
    <QueryBoundary
      query={query}
      label="the language breakdown"
      stage="Repository Intelligence"
      agent="A1"
      skeletonLines={3}
      notFoundReason="No knowledge graph was built for this run, so the workspace scan published no language counts."
    >
      {(metrics) => <LanguageRows data={metrics} />}
    </QueryBoundary>
  );
}

function LanguageRows({ data }: { data: KnowledgeMetrics }) {
  const rows = useMemo<LanguageRow[]>(() => {
    const languages = data?.workspace.languages ?? {};
    const total = Object.values(languages).reduce((sum, n) => sum + n, 0);
    if (total === 0) return [];

    return Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .map(([language, files], index) => ({
        language,
        files,
        share: files / total,
        // Drawn from the graph palette, so the ordering stays separable under
        // deuteranopia and every swatch is AA in both themes.
        color: GRAPH_NODE_COLORS[GRAPH_NODE_ORDER[index % GRAPH_NODE_ORDER.length]].fg,
      }));
  }, [data]);

  return (
    <DataBoundary
      value={rows.length > 0 ? rows : null}
      whenMissing="waiting"
      emptyIsMissing
      reason="The workspace summary published no language counts"
    >
      {(languages) => (
        <div className="flex flex-col gap-3">
          {/* A single stacked bar: the composition is the point, not the trend. */}
          <div
            className="flex h-2 w-full overflow-hidden rounded-full bg-surface-muted"
            role="img"
            aria-label={languages
              .map((l) => `${l.language} ${Math.round(l.share * 100)}%`)
              .join(", ")}
          >
            {languages.map((row) => (
              <div
                key={row.language}
                style={{ width: `${row.share * 100}%`, backgroundColor: row.color }}
                title={`${row.language}: ${row.files} files`}
              />
            ))}
          </div>

          {/* The table equivalent is not optional — §3.6. */}
          <DataTable
            columns={COLUMNS}
            rows={languages}
            rowKey={(row) => row.language}
            caption="File count per language, from the workspace summary"
          />
        </div>
      )}
    </DataBoundary>
  );
}

const COLUMNS: TableColumn<LanguageRow>[] = [
  {
    key: "language",
    header: "Language",
    cell: (row) => (
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: row.color }}
        />
        {row.language}
      </span>
    ),
  },
  { key: "files", header: "Files", cell: (row) => row.files, numeric: true, width: "80px" },
  {
    key: "share",
    header: "Share",
    cell: (row) => `${(row.share * 100).toFixed(1)}%`,
    numeric: true,
    width: "88px",
  },
];
