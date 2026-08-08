/**
 * Repository tree — virtualized (blueprint Phase 2, §14).
 *
 * Rows come from the workspace manifest (roots) and the repository graph
 * export (paths). A path is shown because the backend indexed a node at it;
 * nothing is inferred from the filesystem, which the browser cannot see
 * anyway.
 *
 * Selecting a file runs the named graph queries for it — server-side
 * traversal, per §7.2. The client never indexes the repository itself.
 */

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, File, Folder, Package } from "lucide-react";
import { useMemo, useState } from "react";

import { SearchInput } from "@/design/components/Input";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { Eyebrow } from "@/design/primitives/atoms";
import { useVirtualRows } from "@/design/primitives/useVirtualRows";
import { EmptyState } from "@/design/states/EmptyState";
import { ErrorState } from "@/design/states/ErrorState";
import { SkeletonRows } from "@/design/states/Skeleton";
import { cn } from "@/lib/utils";
import {
  allBranchPaths,
  buildRepositoryTree,
  countFiles,
  flattenTree,
  type FlatTreeRow,
} from "@/lib/v2/knowledge/tree";
import { kgMetricsQuery, kgViewQuery } from "@/lib/v2/queries";
import { useRunId } from "../../RunProvider";
import { FileInspector } from "./FileInspector";

const ROW_HEIGHT = 26;
/** The export is server-capped; ask for enough to describe a repository. */
const MAX_NODES = 600;

export function RepositoryTree() {
  const runId = useRunId();
  const metrics = useQuery(kgMetricsQuery(runId));
  const graph = useQuery(kgViewQuery(runId, "repository", MAX_NODES));

  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const roots = useMemo(
    () => buildRepositoryTree(metrics.data?.workspace.packages ?? [], graph.data),
    [metrics.data, graph.data],
  );

  // Default to fully expanded: a repository small enough to index is small
  // enough to show, and a collapsed tree hides the thing the stage is about.
  const effectiveExpanded = useMemo(() => expanded ?? allBranchPaths(roots), [expanded, roots]);

  const rows = useMemo(() => {
    const all = flattenTree(roots, effectiveExpanded);
    const needle = filter.trim().toLowerCase();
    if (!needle) return all;
    // Filtering shows matching files and the branches that lead to them.
    return all.filter(
      (row) =>
        row.node.path.toLowerCase().includes(needle) ||
        row.node.name.toLowerCase().includes(needle),
    );
  }, [roots, effectiveExpanded, filter]);

  const virtual = useVirtualRows<HTMLDivElement>({
    count: rows.length,
    rowHeight: ROW_HEIGHT,
  });

  const toggle = (path: string) => {
    const next = new Set(effectiveExpanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

  if (metrics.isLoading || graph.isLoading) {
    return <SkeletonRows rows={8} label="Loading repository tree" />;
  }

  if (metrics.error || graph.error) {
    return (
      <ErrorState
        title="Could not load the repository structure"
        detail={((metrics.error ?? graph.error) as Error).message}
        source="GET /api/knowledge/{run_id}/metrics · /export/repository"
        onRetry={() => {
          void metrics.refetch();
          void graph.refetch();
        }}
        size="sm"
      />
    );
  }

  const fileCount = countFiles(roots);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <Eyebrow>Structure</Eyebrow>
          <span className="type-caption text-ink-soft">
            {fileCount} indexed file{fileCount === 1 ? "" : "s"}
            {graph.data?.truncated && " · export truncated by the server cap"}
          </span>
        </div>

        <SearchInput
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          placeholder="Filter paths"
          aria-label="Filter repository paths"
          className="mb-2 h-7"
        />

        <DataBoundary
          value={rows.length > 0 ? rows : null}
          whenMissing="waiting"
          emptyIsMissing
          reason="The repository graph published no file nodes"
          fallback={
            filter ? (
              <EmptyState title="No matching paths" size="sm" />
            ) : (
              <EmptyState
                title="No indexed files"
                description="The repository graph export returned no file nodes for this run."
                size="sm"
              />
            )
          }
        >
          {(visibleRows) => (
            <div
              ref={virtual.ref}
              onScroll={virtual.onScroll}
              className="max-h-80 overflow-y-auto rounded-card border border-border bg-surface p-1"
            >
              <div style={{ height: virtual.totalHeight, position: "relative" }}>
                <div style={{ transform: `translateY(${virtual.offsetTop}px)` }}>
                  {visibleRows.slice(virtual.start, virtual.end).map((row) => (
                    <TreeRow
                      key={`${row.node.kind}:${row.node.path}:${row.depth}`}
                      row={row}
                      selected={selected === row.node.path}
                      onToggle={() => toggle(row.node.path)}
                      onSelect={() => setSelected(row.node.path)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </DataBoundary>
      </div>

      <FileInspector file={selected} />
    </div>
  );
}

function TreeRow({
  row,
  selected,
  onToggle,
  onSelect,
}: {
  row: FlatTreeRow;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const { node, depth, expanded, hasChildren } = row;
  const Icon = node.kind === "package" ? Package : node.kind === "file" ? File : Folder;

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-xs pr-2",
        selected ? "bg-surface-muted" : "hover:bg-surface-muted/60",
      )}
      style={{ height: ROW_HEIGHT, paddingLeft: 4 + depth * 12 }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
        aria-expanded={hasChildren ? expanded : undefined}
        disabled={!hasChildren}
        className="flex size-4 shrink-0 items-center justify-center text-ink-soft disabled:opacity-0"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", expanded && "rotate-90")}
          style={{ transitionDuration: "var(--motion-fast)" }}
          strokeWidth={2}
        />
      </button>

      <button
        type="button"
        onClick={node.kind === "file" ? onSelect : onToggle}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <Icon aria-hidden className="size-3 shrink-0 text-ink-soft" strokeWidth={1.75} />
        <span
          className={cn(
            "type-mono-sm min-w-0 truncate",
            node.kind === "file" ? "text-ink" : "text-ink-soft",
          )}
        >
          {node.name}
        </span>
        {node.manifest && (
          <span className="type-caption shrink-0 text-ink-soft/60">{node.manifest}</span>
        )}
        {node.kind === "file" && node.nodeCount ? (
          <span className="type-caption shrink-0 text-ink-soft/60">{node.nodeCount}</span>
        ) : null}
      </button>
    </div>
  );
}
