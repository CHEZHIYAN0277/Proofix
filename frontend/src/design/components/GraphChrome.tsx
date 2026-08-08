/**
 * Graph chrome (blueprint §3.6).
 *
 * The frame every graph in the product sits inside: toolbar (fit · zoom ·
 * search · layout), legend, minimap slot at ≥1280px, selection, empty state,
 * and the **table equivalent** — required for accessibility and as the escape
 * hatch on mobile.
 *
 * Phase 0 ships the chrome, not the renderer. React Flow arrives in Phase 3
 * and mounts into the `children` slot; the toolbar talks to it through
 * `controls`, so the chrome never depends on a graph library and stays in the
 * base bundle (§14).
 */

import { Maximize2, Table2, Workflow, ZoomIn, ZoomOut } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { GRAPH_EDGE_STYLES, GRAPH_NODE_COLORS } from "../tokens/color";
import { EmptyState } from "../states/EmptyState";
import type { GraphEdgeType, GraphNodeType } from "../types";
import { Button } from "./Button";
import { SearchInput } from "./Input";

/* -------------------------------------------------------------------------
   Legend
   ---------------------------------------------------------------------- */

export interface GraphLegendProps {
  nodeTypes?: readonly GraphNodeType[];
  edgeTypes?: readonly GraphEdgeType[];
  className?: string;
}

export function GraphLegend({ nodeTypes = [], edgeTypes = [], className }: GraphLegendProps) {
  if (nodeTypes.length === 0 && edgeTypes.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {nodeTypes.map((t) => {
        const spec = GRAPH_NODE_COLORS[t];
        return (
          <span key={t} className="type-caption inline-flex items-center gap-1.5 text-ink-soft">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: spec.fg }}
            />
            {spec.label}
          </span>
        );
      })}

      {edgeTypes.map((t) => {
        const spec = GRAPH_EDGE_STYLES[t];
        return (
          <span key={t} className="type-caption inline-flex items-center gap-1.5 text-ink-soft">
            {/* Edge types differ by dash and weight, never by hue alone. */}
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line
                x1="0"
                y1="4"
                x2="18"
                y2="4"
                stroke="var(--ink-soft)"
                strokeWidth={spec.width}
                strokeDasharray={spec.dash ?? undefined}
                strokeLinecap="round"
                opacity={spec.opacity}
              />
            </svg>
            {spec.label}
          </span>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Chrome
   ---------------------------------------------------------------------- */

export interface GraphControls {
  fit?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  /** Cycles the layout. The label is shown in the toolbar. */
  cycleLayout?: () => void;
  layoutLabel?: string;
  onSearch?: (query: string) => void;
}

export interface GraphChromeProps {
  title?: ReactNode;
  /** The renderer. Phase 3 mounts React Flow here. */
  children?: ReactNode;
  /**
   * The mandatory table equivalent. Every graph ships one — pass a
   * `<DataTable>` built from the same column definitions.
   */
  tableView?: ReactNode;
  /** Rendered at ≥1280px only, per the blueprint. */
  minimap?: ReactNode;
  nodeTypes?: readonly GraphNodeType[];
  edgeTypes?: readonly GraphEdgeType[];
  controls?: GraphControls;
  /** Number of nodes; `0` renders the empty state instead of the canvas. */
  nodeCount?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  height?: number | string;
  className?: string;
}

export function GraphChrome({
  title,
  children,
  tableView,
  minimap,
  nodeTypes = [],
  edgeTypes = [],
  controls,
  nodeCount,
  emptyTitle = "No graph data",
  emptyDescription,
  height = 420,
  className,
}: GraphChromeProps) {
  const [view, setView] = useState<"graph" | "table">("graph");
  const isEmpty = nodeCount === 0;

  return (
    <div className={cn("rounded-card border border-border bg-surface", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {title && <span className="type-label truncate text-ink">{title}</span>}
          {nodeCount !== undefined && (
            <span className="type-mono-sm text-ink-soft">{nodeCount} nodes</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {controls?.onSearch && (
            <SearchInput
              placeholder="Search nodes"
              aria-label="Search graph nodes"
              className="h-7 w-40"
              onChange={(e) => controls.onSearch?.(e.currentTarget.value)}
            />
          )}
          {controls?.cycleLayout && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Workflow />}
              onClick={controls.cycleLayout}
              aria-label={`Change layout${controls.layoutLabel ? `: ${controls.layoutLabel}` : ""}`}
            />
          )}
          {controls?.zoomOut && (
            <Button
              size="sm"
              variant="ghost"
              icon={<ZoomOut />}
              onClick={controls.zoomOut}
              aria-label="Zoom out"
            />
          )}
          {controls?.zoomIn && (
            <Button
              size="sm"
              variant="ghost"
              icon={<ZoomIn />}
              onClick={controls.zoomIn}
              aria-label="Zoom in"
            />
          )}
          {controls?.fit && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Maximize2 />}
              onClick={controls.fit}
              aria-label="Fit to view"
            />
          )}
          {tableView && (
            <Button
              size="sm"
              variant={view === "table" ? "secondary" : "ghost"}
              icon={<Table2 />}
              onClick={() => setView(view === "graph" ? "table" : "graph")}
              aria-label={view === "graph" ? "Show table equivalent" : "Show graph"}
              aria-pressed={view === "table"}
            />
          )}
        </div>
      </div>

      <div className="relative" style={{ minHeight: height }}>
        {isEmpty ? (
          <div className="p-4">
            <EmptyState title={emptyTitle} description={emptyDescription} />
          </div>
        ) : view === "table" && tableView ? (
          <div className="p-3">{tableView}</div>
        ) : (
          <>
            {children}
            {minimap && (
              // Minimap at ≥1280px only — below that it costs more space than
              // the orientation it buys.
              <div className="absolute bottom-3 right-3 hidden xl:block">{minimap}</div>
            )}
          </>
        )}
      </div>

      {(nodeTypes.length > 0 || edgeTypes.length > 0) && (
        <div className="border-t border-border px-3 py-2">
          <GraphLegend nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
        </div>
      )}
    </div>
  );
}
