/**
 * The custom node React Flow renders.
 *
 * Why this exists rather than styling nodes inline on the `nodes` array:
 * hover-neighbour highlighting changes how *every* node looks, so computing
 * styles into the array meant rebuilding all of them on each `mouseenter`.
 * React Flow then re-created the node elements, and a node re-created between
 * `mousedown` and `mouseup` never completes a `click` — so selection silently
 * did nothing.
 *
 * Emphasis now travels through context instead. The `nodes` array is memoized
 * on the layout alone and never changes on hover, which fixes selection and
 * keeps the interaction off the 60 FPS budget: hovering re-renders these leaf
 * components, not the flow.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { createContext, useContext, type ReactNode } from "react";

import { GRAPH_NODE_COLORS } from "@/design/tokens/color";
import type { GraphNodeType } from "@/design/types";
import { NODE_HEIGHT, NODE_WIDTH } from "@/lib/v2/graph/layout";

export interface GraphEmphasis {
  /** Ids in the hovered/selected neighbourhood; `null` means "no focus". */
  focusSet: ReadonlySet<string> | null;
  /** Ids matching the search box; `null` means "no query". */
  matches: ReadonlySet<string> | null;
  /** Ids the run implicated — citation targets and blast scope. */
  implicated: ReadonlySet<string>;
  selected: string | null;
}

const EmphasisContext = createContext<GraphEmphasis>({
  focusSet: null,
  matches: null,
  implicated: new Set(),
  selected: null,
});

export function GraphEmphasisProvider({
  value,
  children,
}: {
  value: GraphEmphasis;
  children: ReactNode;
}) {
  return <EmphasisContext.Provider value={value}>{children}</EmphasisContext.Provider>;
}

export interface GraphNodeData extends Record<string, unknown> {
  label: string;
  nodeType: GraphNodeType;
}

export function GraphNodeView({ id, data }: NodeProps) {
  const { focusSet, matches, implicated, selected } = useContext(EmphasisContext);
  const { label, nodeType } = data as GraphNodeData;

  const dimmed = (focusSet !== null && !focusSet.has(id)) || (matches !== null && !matches.has(id));
  const isImplicated = implicated.has(id);
  const isSelected = selected === id;

  return (
    <div
      className="type-mono-sm flex items-center truncate px-2"
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        borderRadius: 10,
        background: "var(--surface)",
        color: "var(--ink)",
        border: `1px solid ${isSelected || isImplicated ? "var(--primary)" : "var(--border)"}`,
        // Only the implicated nodes carry a glow — accent is scarce (rule A1).
        boxShadow: isImplicated ? "var(--shadow-glow-running)" : undefined,
        borderLeft: `3px solid ${GRAPH_NODE_COLORS[nodeType].fg}`,
        // Opacity only — never layout (§14).
        opacity: dimmed ? 0.2 : 1,
        transition: "opacity var(--motion-fast) var(--ease-fast)",
      }}
      title={label}
    >
      {/* Connection points. Hidden, but required for edges to attach. */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} isConnectable={false} />
      <span className="truncate">{label}</span>
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0 }}
        isConnectable={false}
      />
    </div>
  );
}

export const GRAPH_NODE_TYPES = { proofix: GraphNodeView };
