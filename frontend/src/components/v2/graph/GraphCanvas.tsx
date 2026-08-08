/**
 * `<GraphCanvas>` — the product's one graph renderer (blueprint §3.6, Phase 3).
 *
 * React Flow mounted inside the design system's `<GraphChrome>`: toolbar,
 * legend, minimap at ≥1280px, hover-neighbour highlight, selection, empty
 * state, and **the table equivalent every graph is required to ship** — both
 * the accessibility contract and the escape hatch on mobile.
 *
 * Two rules from §13 are structural here, not advisory:
 *   - layout is memoized per *data version*, never per object identity, so a
 *     refetch that returns identical bytes does not move a single node;
 *   - frames change node **state** only. Nothing in this component recomputes
 *     geometry in response to a run frame.
 *
 * Client-only: React Flow measures the DOM, so it is loaded lazily and never
 * during SSR.
 */

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnNodesChange,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";

import "@xyflow/react/dist/style.css";

import { GraphChrome } from "@/design/components/GraphChrome";
import { DataTable, type TableColumn } from "@/design/components/Table";
import { GRAPH_EDGE_STYLES, GRAPH_NODE_COLORS } from "@/design/tokens/color";
import type { GraphEdgeType, GraphNodeType } from "@/design/types";
import { NODE_HEIGHT, NODE_WIDTH, graphVersion, layoutGraph } from "@/lib/v2/graph/layout";
import { GRAPH_NODE_TYPES, GraphEmphasisProvider } from "./GraphNodeView";
import type { GraphEdge, GraphExport, GraphNode } from "@/lib/v2/types";

/** Backend node types that map onto the design system's palette. */
const EMPTY_SET: ReadonlySet<string> = new Set();

const NODE_TYPE_MAP: Record<string, GraphNodeType> = {
  module: "module",
  package: "module",
  file: "file",
  function: "function",
  callable: "function",
  class: "class",
  test: "test",
  capability: "capability",
  memory: "memory",
  document: "memory",
  config: "capability",
  repository: "module",
};

/** Backend edge types that map onto the design system's dash/weight language. */
const EDGE_TYPE_MAP: Record<string, GraphEdgeType> = {
  CALLS: "calls",
  IMPORTS: "imports",
  CONTAINS: "part_of",
  DEFINES: "part_of",
  TESTS: "tests",
  VALIDATES: "tests",
  DESCRIBES: "owns",
  OWNS: "owns",
  REPAIRED: "repaired",
  DEPENDS_ON: "depends",
};

function nodeType(raw: string): GraphNodeType {
  return NODE_TYPE_MAP[raw] ?? "module";
}

function edgeType(raw: string): GraphEdgeType {
  return EDGE_TYPE_MAP[raw] ?? "imports";
}

export interface GraphCanvasProps {
  title: string;
  graph: GraphExport | null | undefined;
  /**
   * Node ids the run implicated — citation targets, blast scope. Rendered with
   * the accent ring; every other node stays neutral.
   */
  implicated?: ReadonlySet<string>;
  /** Called when a node is selected, for the inspector beside the canvas. */
  onSelect?: (node: GraphNode | null) => void;
  height?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}

export default function GraphCanvas({
  title,
  graph,
  implicated,
  onSelect,
  height = 420,
  emptyTitle = "No graph data",
  emptyDescription,
}: GraphCanvasProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const rawNodes = graph?.nodes ?? [];
  const rawEdges = graph?.edges ?? [];

  // Memoized on a content hash, not on the arrays: TanStack Query returns a new
  // object per refetch, and keying on identity would re-lay-out an unchanged
  // graph under the reader.
  const version = useMemo(() => graphVersion(rawNodes, rawEdges), [rawNodes, rawEdges]);
  const layout = useMemo(
    () => layoutGraph(rawNodes, rawEdges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  const focus = hovered ?? selected;
  const focusSet = useMemo(() => {
    if (!focus) return null;
    const set = new Set<string>([focus]);
    for (const id of layout.neighbours.get(focus) ?? []) set.add(id);
    return set;
  }, [focus, layout]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return new Set(
      layout.nodes
        .filter(
          (n) =>
            n.node.label?.toLowerCase().includes(needle) ||
            n.node.qualname?.toLowerCase().includes(needle) ||
            n.node.file?.toLowerCase().includes(needle),
        )
        .map((n) => n.id),
    );
  }, [query, layout]);

  const flowNodes = useMemo<Node[]>(
    () =>
      layout.nodes.map((item) => ({
        id: item.id,
        type: "proofix",
        position: { x: item.x, y: item.y },
        // Declared, not measured. `onNodesChange` deliberately drops dimension
        // changes (geometry comes from the layout), and a controlled flow that
        // ignores them never populates `measured` — which is what the minimap
        // reads, so it rendered as an empty grey panel. `<GraphNodeView>` sizes
        // every node to exactly these constants, so stating them here is the
        // same fact the layout already uses.
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        data: {
          label: item.node.label || item.node.qualname || item.id,
          nodeType: nodeType(item.node.type),
        },
        draggable: false,
      })),
    // Layout only. Adding hover or selection here rebuilds every node object,
    // which re-creates the DOM mid-click and breaks selection outright.
    [layout],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      layout.edges.map((edge, index) => {
        const spec = GRAPH_EDGE_STYLES[edgeType(edge.type)];
        const dimmed =
          focusSet !== null && !(focusSet.has(edge.source) && focusSet.has(edge.target));
        return {
          id: `${edge.source}->${edge.target}:${index}`,
          source: edge.source,
          target: edge.target,
          // Dash and weight carry the type. Never hue alone (§3.5).
          style: {
            stroke: "var(--ink-soft)",
            strokeWidth: spec.width,
            strokeDasharray: spec.dash ?? undefined,
            opacity: dimmed ? 0.06 : spec.opacity,
          },
          animated: false,
        };
      }),
    [layout, focusSet],
  );

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      onSelect?.(id ? (layout.nodes.find((n) => n.id === id)?.node ?? null) : null);
    },
    [onSelect, layout],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => select(selected === node.id ? null : node.id),
    [selected, select],
  );

  /**
   * `nodes` is controlled and derived from the memoized layout, so React Flow
   * cannot own it. But a controlled flow with no `onNodesChange` silently
   * discards every change it emits — including selection, which is why
   * clicking a node did nothing at all.
   *
   * Only selection changes are honoured. Position and dimension changes are
   * deliberately dropped: geometry comes from the layout and nothing else
   * (§13 rule 4), so a drag or a resize must never move a node.
   */
  const onNodesChange = useCallback<OnNodesChange>(
    (changes) => {
      for (const change of changes) {
        if (change.type === "select" && change.selected) select(change.id);
      }
    },
    [select],
  );

  const tableRows = useMemo(
    () =>
      layout.nodes.map((item) => ({
        id: item.id,
        label: item.node.label || item.node.qualname || item.id,
        type: item.node.type,
        file: item.node.file || "—",
        degree: layout.neighbours.get(item.id)?.size ?? 0,
        implicated: implicated?.has(item.id) ?? false,
      })),
    [layout, implicated],
  );

  const nodeTypes = useMemo(() => [...new Set(rawNodes.map((n) => nodeType(n.type)))], [rawNodes]);
  const edgeTypes = useMemo(() => [...new Set(rawEdges.map((e) => edgeType(e.type)))], [rawEdges]);

  return (
    <GraphChrome
      title={title}
      nodeCount={rawNodes.length}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      height={height}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      controls={{ onSearch: setQuery }}
      tableView={
        <DataTable
          columns={TABLE_COLUMNS}
          rows={tableRows}
          rowKey={(row) => row.id}
          caption={`${title} — table equivalent of the graph`}
          maxHeight={height}
          onRowClick={(row) => {
            setSelected(row.id);
            onSelect?.(layout.nodes.find((n) => n.id === row.id)?.node ?? null);
          }}
        />
      }
    >
      <div style={{ height }}>
        <GraphEmphasisProvider
          value={{ focusSet, matches, implicated: implicated ?? EMPTY_SET, selected }}
        >
          <ReactFlow
            nodes={flowNodes}
            nodeTypes={GRAPH_NODE_TYPES}
            edges={flowEdges}
            onNodeClick={onNodeClick}
            onNodesChange={onNodesChange}
            onPaneClick={() => select(null)}
            onNodeMouseEnter={(_e, node) => setHovered(node.id)}
            onNodeMouseLeave={() => setHovered(null)}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            fitView
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
            aria-label={`${title} graph`}
          >
            <Background color="var(--border)" gap={20} size={1} />
            <Controls showInteractive={false} />
            {/* Minimap at ≥1280px only — below that it costs more space than the
              orientation it buys. */}
            <MiniMap
              className="!hidden xl:!block"
              pannable
              zoomable
              maskColor="color-mix(in srgb, var(--background) 70%, transparent)"
              nodeColor={(node) => {
                const raw = layout.nodes.find((n) => n.id === node.id)?.node.type ?? "module";
                return GRAPH_NODE_COLORS[nodeType(raw)].fg;
              }}
            />
          </ReactFlow>
        </GraphEmphasisProvider>
      </div>
    </GraphChrome>
  );
}

const TABLE_COLUMNS: TableColumn<{
  id: string;
  label: string;
  type: string;
  file: string;
  degree: number;
  implicated: boolean;
}>[] = [
  {
    key: "label",
    header: "Node",
    cell: (row) => <span className={row.implicated ? "text-primary" : undefined}>{row.label}</span>,
    mono: true,
  },
  { key: "type", header: "Type", cell: (row) => row.type, width: "110px" },
  { key: "file", header: "File", cell: (row) => row.file, mono: true },
  { key: "degree", header: "Links", cell: (row) => row.degree, numeric: true, width: "76px" },
];

/** Re-exported so callers can fit the view after a data change. */
export { useReactFlow };
