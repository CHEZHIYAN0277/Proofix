/**
 * Color system (blueprint §3.5).
 *
 * Four layers: semantic (inherited from styles.css), status (extended to six),
 * data-state (new — the grammar of the primary rule) and the graph palette.
 *
 * Both themes are first-class. Every token below is defined in `:root` and in
 * `.dark`; nothing here resolves to a literal, so a theme swap is a variable
 * swap.
 */

import type { DataStateKind, GraphEdgeType, GraphNodeType, StatusState } from "../types";

/* -------------------------------------------------------------------------
   Semantic — inherited, listed so the gallery can prove them
   ---------------------------------------------------------------------- */

export const SEMANTIC_COLORS = [
  { token: "background", cssVar: "--background", use: "Page" },
  { token: "surface", cssVar: "--surface", use: "Card, panel" },
  { token: "surface-muted", cssVar: "--surface-muted", use: "Inset, peripheral" },
  { token: "card", cssVar: "--card", use: "Card body" },
  { token: "ink", cssVar: "--ink", use: "Primary text" },
  { token: "ink-soft", cssVar: "--ink-soft", use: "Secondary text" },
  { token: "border", cssVar: "--border", use: "Hairlines" },
  { token: "primary", cssVar: "--primary", use: "Accent — active stage only (rule A1)" },
  { token: "destructive", cssVar: "--destructive", use: "Destructive action" },
] as const;

/* -------------------------------------------------------------------------
   Status — six states
   ---------------------------------------------------------------------- */

export interface StatusColorSpec {
  state: StatusState;
  label: string;
  fg: string;
  bg: string;
  /** Tailwind text class. */
  text: string;
  /** Tailwind background class. */
  surface: string;
  /** Whether the state represents work happening right now. */
  active: boolean;
  hue: string;
}

export const STATUS_COLORS: Record<StatusState, StatusColorSpec> = {
  waiting: {
    state: "waiting",
    label: "Waiting",
    fg: "var(--status-waiting)",
    bg: "var(--status-waiting-bg)",
    text: "text-status-waiting",
    surface: "bg-status-waiting-bg",
    active: false,
    hue: "neutral",
  },
  running: {
    state: "running",
    label: "Running",
    fg: "var(--status-running)",
    bg: "var(--status-running-bg)",
    text: "text-status-running",
    surface: "bg-status-running-bg",
    active: true,
    hue: "blue",
  },
  retry: {
    state: "retry",
    label: "Retrying",
    fg: "var(--status-retry)",
    bg: "var(--status-retry-bg)",
    text: "text-status-retry",
    surface: "bg-status-retry-bg",
    active: true,
    hue: "amber",
  },
  completed: {
    state: "completed",
    label: "Completed",
    fg: "var(--status-completed)",
    bg: "var(--status-completed-bg)",
    text: "text-status-completed",
    surface: "bg-status-completed-bg",
    active: false,
    hue: "green",
  },
  failed: {
    state: "failed",
    label: "Failed",
    fg: "var(--status-failed)",
    bg: "var(--status-failed-bg)",
    text: "text-status-failed",
    surface: "bg-status-failed-bg",
    active: false,
    hue: "red",
  },
  draft: {
    state: "draft",
    label: "Draft",
    fg: "var(--status-draft)",
    bg: "var(--status-draft-bg)",
    text: "text-status-draft",
    surface: "bg-status-draft-bg",
    active: false,
    hue: "violet",
  },
};

/* -------------------------------------------------------------------------
   Data-state

   These three are never colored as errors. Absence of data is not failure,
   and rendering it as red trains users to distrust the product.
   ---------------------------------------------------------------------- */

export interface DataStateSpec {
  kind: DataStateKind;
  label: string;
  fg: string;
  bg: string;
  text: string;
  surface: string;
  /** Dashed hairline marks "the backend has not reached this yet". */
  dashedBorder: boolean;
  /** A single quiet shimmer marks "in flight now". */
  shimmer: boolean;
  /** `unavailable` must always carry a reason string. */
  requiresReason: boolean;
  meaning: string;
}

export const DATA_STATE_COLORS: Record<DataStateKind, DataStateSpec> = {
  waiting: {
    kind: "waiting",
    label: "Waiting",
    fg: "var(--data-waiting)",
    bg: "var(--data-waiting-bg)",
    text: "text-data-waiting",
    surface: "bg-data-waiting-bg",
    dashedBorder: true,
    shimmer: false,
    requiresReason: false,
    meaning: "The backend has not reached this yet.",
  },
  pending: {
    kind: "pending",
    label: "Pending",
    fg: "var(--data-pending)",
    bg: "var(--data-pending-bg)",
    text: "text-data-pending",
    surface: "bg-data-pending-bg",
    dashedBorder: false,
    shimmer: true,
    requiresReason: false,
    meaning: "In flight now.",
  },
  unavailable: {
    kind: "unavailable",
    label: "Unavailable",
    fg: "var(--data-unavailable)",
    bg: "var(--data-unavailable-bg)",
    text: "text-data-unavailable",
    surface: "bg-data-unavailable-bg",
    dashedBorder: false,
    shimmer: false,
    requiresReason: true,
    meaning: "Capability is off or unsupported. Always carries a reason.",
  },
};

/* -------------------------------------------------------------------------
   Graph palette

   One fixed hue per node type, AA in both themes (audited below).
   ---------------------------------------------------------------------- */

export interface GraphNodeColorSpec {
  type: GraphNodeType;
  label: string;
  fg: string;
  text: string;
  /** Measured WCAG contrast against `--surface` in each theme. */
  contrast: { light: number; dark: number };
}

/**
 * Contrast measured against `#ffffff` (light `--surface`) and `#141414`
 * (dark `--surface`). AA for normal text is 4.5; the lowest here is 4.92.
 */
export const GRAPH_NODE_COLORS: Record<GraphNodeType, GraphNodeColorSpec> = {
  module: {
    type: "module",
    label: "Module",
    fg: "var(--node-module)",
    text: "text-node-module",
    contrast: { light: 6.7, dark: 7.25 },
  },
  file: {
    type: "file",
    label: "File",
    fg: "var(--node-file)",
    text: "text-node-file",
    contrast: { light: 5.36, dark: 10.19 },
  },
  function: {
    type: "function",
    label: "Function",
    fg: "var(--node-function)",
    text: "text-node-function",
    contrast: { light: 7.1, dark: 6.77 },
  },
  class: {
    type: "class",
    label: "Class",
    fg: "var(--node-class)",
    text: "text-node-class",
    contrast: { light: 4.92, dark: 11.04 },
  },
  test: {
    type: "test",
    label: "Test",
    fg: "var(--node-test)",
    text: "text-node-test",
    contrast: { light: 5.02, dark: 10.57 },
  },
  capability: {
    type: "capability",
    label: "Capability",
    fg: "var(--node-capability)",
    text: "text-node-capability",
    contrast: { light: 6.04, dark: 6.96 },
  },
  memory: {
    type: "memory",
    label: "Memory",
    fg: "var(--node-memory)",
    text: "text-node-memory",
    contrast: { light: 7.58, dark: 7.18 },
  },
};

/** AA threshold for normal text. Asserted by the gallery's contrast audit. */
export const AA_CONTRAST_MIN = 4.5;

/**
 * Assignment order for graphs that color by index.
 *
 * Follows the Okabe–Ito sequence (blue → orange → sky → green → … → purple),
 * so the first few types in any view stay separable under deuteranopia and
 * protanopia.
 */
export const GRAPH_NODE_ORDER: readonly GraphNodeType[] = [
  "module",
  "class",
  "file",
  "test",
  "capability",
  "function",
  "memory",
];

/**
 * Edge types differ by dash and weight, never by hue alone — an edge that
 * only encodes meaning in color is invisible to a colorblind reader and
 * illegible on a dense graph.
 */
export interface GraphEdgeStyleSpec {
  type: GraphEdgeType;
  label: string;
  /** SVG `stroke-dasharray`; `null` for solid. */
  dash: string | null;
  width: number;
  /** Rendered at reduced opacity when the edge is structural background. */
  opacity: number;
}

export const GRAPH_EDGE_STYLES: Record<GraphEdgeType, GraphEdgeStyleSpec> = {
  imports: { type: "imports", label: "Imports", dash: null, width: 1.5, opacity: 0.7 },
  calls: { type: "calls", label: "Calls", dash: null, width: 2.25, opacity: 1 },
  owns: { type: "owns", label: "Owns", dash: "4 3", width: 1.5, opacity: 0.7 },
  tests: { type: "tests", label: "Tests", dash: "1 3", width: 1.5, opacity: 0.8 },
  part_of: { type: "part_of", label: "Part of", dash: "2 2", width: 1, opacity: 0.55 },
  repaired: { type: "repaired", label: "Repaired", dash: "6 2", width: 2.5, opacity: 1 },
  depends: { type: "depends", label: "Depends on", dash: "5 3", width: 2, opacity: 0.9 },
};

/** Resolve the hue for a node type. */
export function nodeColor(type: GraphNodeType): string {
  return GRAPH_NODE_COLORS[type].fg;
}

/** Resolve the stroke style for an edge type. */
export function edgeStyle(type: GraphEdgeType): GraphEdgeStyleSpec {
  return GRAPH_EDGE_STYLES[type];
}
