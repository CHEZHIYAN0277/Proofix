/**
 * Shared contracts for the design system.
 *
 * These types are deliberately structural: the design system never imports
 * from `lib/v2` or from any run-data module, so every surface in the product
 * (V1, V2, Dashboard, Security, Learning) can consume it.
 */

/* -------------------------------------------------------------------------
   Status (blueprint §3.5) — six states, one shape language
   ---------------------------------------------------------------------- */

export const STATUS_STATES = [
  "waiting",
  "running",
  "retry",
  "completed",
  "failed",
  "draft",
] as const;

export type StatusState = (typeof STATUS_STATES)[number];

/* -------------------------------------------------------------------------
   Data-state (§3.5) — the visual grammar of the primary rule.

   Absence of data is not failure. None of these is ever colored as an error.
   ---------------------------------------------------------------------- */

export const DATA_STATES = ["waiting", "pending", "unavailable"] as const;

export type DataStateKind = (typeof DATA_STATES)[number];

/* -------------------------------------------------------------------------
   Explainability contract (§9)

   Any surface that asserts something non-trivial implements this. Confidence
   is `null` whenever the producer publishes none — it is never synthesized.
   ---------------------------------------------------------------------- */

/** One deterministic signal that contributed to a conclusion. */
export interface Evidence {
  /** Name of the signal, e.g. `stack_frame_exact`. */
  signal: string;
  /** The signal's observed value, already formatted for display. */
  value?: string | number | null;
  /** Weighted contribution, 0..1. Drives the bar length in `<EvidenceList>`. */
  contribution: number;
  /** One line of human detail. */
  detail?: string;
  /** Where the signal came from — agent id, service, or field path. */
  provenance?: string;
}

/** A checkable answer to "where did this number come from?". */
export interface SourceRef {
  /** Human label, e.g. "Run report". */
  label: string;
  /** Literal endpoint, e.g. `GET /api/runs/{id}/report`. */
  endpoint?: string;
  /** Dotted field path within the payload, e.g. `mutation_result.score`. */
  fieldPath?: string;
  /** Producing agent id, e.g. `a8_mutation_validator`. */
  agentId?: string;
}

/**
 * The uniform explainability surface. Registered surfaces implement all four.
 * Never chain-of-thought — deterministic signals with weights and provenance.
 */
export interface Explainable {
  /** One sentence, plain language: what this shows. */
  explain(): string;
  /** Weighted deterministic signals behind it. */
  why(): Evidence[];
  /** `null` when the producer publishes none. Renders "Not published". */
  confidence(): number | null;
  /** Endpoint / payload / agent / field path. */
  source(): SourceRef[];
}

/** Plain-object form of `Explainable`, for surfaces built from data. */
export interface ExplainSpec {
  explain: string;
  why?: Evidence[];
  confidence?: number | null;
  source?: SourceRef[];
}

/* -------------------------------------------------------------------------
   Graph (§3.5)
   ---------------------------------------------------------------------- */

export const GRAPH_NODE_TYPES = [
  "module",
  "file",
  "function",
  "class",
  "test",
  "capability",
  "memory",
] as const;

export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export const GRAPH_EDGE_TYPES = [
  "imports",
  "calls",
  "owns",
  "tests",
  "part_of",
  "repaired",
  /** A6's repair ordering: the source step must land before the target. */
  "depends",
] as const;

export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number];
