/**
 * Deterministic graph layout (blueprint §13 rule 4, §8.2).
 *
 * **Layout is computed once per data version and memoized; frames change node
 * *state* only, never geometry.** A graph that re-lays-out under the user is
 * unreadable and expensive, and it is the single most common way a live graph
 * becomes unusable.
 *
 * The algorithm is a layered (Sugiyama-style) assignment without the crossing
 * minimisation pass: longest-path layering, then a stable within-layer sort.
 * Two runs over the same export produce byte-identical coordinates, which is
 * what makes "memoized per data version" meaningful — and what lets a
 * screenshot of a graph be compared against another.
 */

import type { GraphEdge, GraphNode } from "../types";

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  layer: number;
  node: GraphNode;
}

export interface GraphLayout {
  nodes: LaidOutNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  /** Adjacency, for hover-neighbour highlighting without re-scanning edges. */
  neighbours: Map<string, Set<string>>;
}

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 40;
const LAYER_GAP = 96;
const ROW_GAP = 16;

/**
 * Longest-path layering.
 *
 * A node sits one layer past its deepest caller. Cycles are broken by capping
 * the walk at the node count — a recursive call graph is legitimate input, and
 * refusing to lay it out would be worse than laying it out imperfectly.
 */
function assignLayers(nodeIds: string[], edges: GraphEdge[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) incoming.set(id, []);
  for (const edge of edges) {
    if (incoming.has(edge.target)) incoming.get(edge.target)!.push(edge.source);
  }

  const layer = new Map<string, number>();
  const visiting = new Set<string>();

  const depth = (id: string, guard: number): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (guard <= 0 || visiting.has(id)) return 0;

    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const value =
      parents.length === 0 ? 0 : Math.max(...parents.map((parent) => depth(parent, guard - 1) + 1));
    visiting.delete(id);

    layer.set(id, value);
    return value;
  };

  for (const id of nodeIds) depth(id, nodeIds.length);
  return layer;
}

/**
 * Lay out a graph export.
 *
 * Pure and deterministic: same input, same output, every time. Callers memoize
 * on a data version rather than on object identity.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphLayout {
  const present = new Set(nodes.map((n) => n.id));
  // An edge to a node the server capped out of the export would otherwise
  // stretch the layout toward a node that is not there.
  const usable = edges.filter((e) => present.has(e.source) && present.has(e.target));

  const layers = assignLayers(
    nodes.map((n) => n.id),
    usable,
  );

  // Group by layer, then sort within it. The sort key is content, never
  // insertion order, so the result does not depend on how the server ordered
  // its response.
  const byLayer = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const layer = layers.get(node.id) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(node);
  }
  for (const group of byLayer.values()) {
    group.sort(
      (a, b) =>
        (a.file ?? "").localeCompare(b.file ?? "") ||
        (a.label ?? "").localeCompare(b.label ?? "") ||
        a.id.localeCompare(b.id),
    );
  }

  /**
   * Rows a layer may hold before it wraps into another column.
   *
   * Without this, a call graph puts every uncalled function — tests, entry
   * points, dead code — in layer 0, producing one column tens of nodes tall.
   * `fitView` then zooms out until no label is readable, which is the same as
   * rendering nothing. Wrapping keeps the aspect ratio close to the viewport's.
   */
  const MAX_ROWS_PER_LAYER = 10;

  const laidOut: LaidOutNode[] = [];
  let maxRows = 0;
  let columnCursor = 0;

  for (const [layer, group] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    const columns = Math.max(1, Math.ceil(group.length / MAX_ROWS_PER_LAYER));
    const rows = Math.ceil(group.length / columns);
    maxRows = Math.max(maxRows, rows);

    group.forEach((node, index) => {
      // Column-major within the layer, so reading order stays top-to-bottom.
      const column = Math.floor(index / rows);
      const row = index % rows;
      laidOut.push({
        id: node.id,
        x: (columnCursor + column) * (NODE_WIDTH + LAYER_GAP),
        y: row * (NODE_HEIGHT + ROW_GAP),
        layer,
        node,
      });
    });

    columnCursor += columns;
  }

  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  for (const edge of usable) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }

  return {
    nodes: laidOut,
    edges: usable,
    width: (columnCursor || 1) * (NODE_WIDTH + LAYER_GAP),
    height: (maxRows || 1) * (NODE_HEIGHT + ROW_GAP),
    neighbours,
  };
}

/**
 * A stable identity for "this is the same graph".
 *
 * Memoizing on the array reference would recompute on every refetch, since
 * TanStack Query hands back a new object each time even when the bytes are
 * identical. Hashing the ids and edges instead means an unchanged graph keeps
 * its geometry across refetches — which is the whole point of rule 4.
 */
export function graphVersion(nodes: GraphNode[], edges: GraphEdge[]): string {
  let hash = 0x811c9dc5;
  const mix = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const node of nodes) mix(node.id);
  for (const edge of edges) {
    mix(edge.source);
    mix(edge.target);
  }
  return `${nodes.length}:${edges.length}:${(hash >>> 0).toString(36)}`;
}
