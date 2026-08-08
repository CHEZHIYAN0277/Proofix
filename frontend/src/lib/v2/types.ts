/**
 * Backend payload shapes consumed by Workspace V2.
 *
 * Hand-written mirrors of what `backend/services/ui_projection.py` and
 * `backend/state/events.py` publish today. Track B replaces this file with
 * `lib/v2/types/generated`, produced from the Pydantic models — until then
 * every field here was read off the backend, not assumed.
 *
 * Fields the backend may omit are typed optional or nullable so a
 * `<DataBoundary>` has something honest to test. Nothing is defaulted here:
 * substituting a value at the type boundary is the same lie as substituting it
 * in a component.
 */

/* -------------------------------------------------------------------------
   Events — `backend/state/events.py`
   ---------------------------------------------------------------------- */

export type AgentEventStatus = "started" | "progress" | "completed" | "failed" | "retry";

export interface AgentStatusEvent {
  run_id: string;
  agent_id: string;
  status: AgentEventStatus;
  timestamp: string;
  message: string;
  payload?: Record<string, unknown> | null;
  sequence: number;
}

/**
 * `run.blocked` is a third terminal outcome: the pipeline declined to continue
 * because the repository's tests could not be executed. Neither a completed
 * repair nor a failure — see `backend/state/events.py`.
 */
export type RunLifecycleType = "run.started" | "run.completed" | "run.failed" | "run.blocked";

export type PRType = "auto_mergeable" | "diff_only" | "draft";

export interface RunLifecycleEvent {
  type: RunLifecycleType;
  run_id: string;
  timestamp: string;
  decision?: PRType | null;
  decision_label?: string;
  reason?: string | null;
  sequence: number;
}

/** The socket also sends `{type:"ping"}` keep-alives and a legacy terminal frame. */
export interface PingFrame {
  type: "ping";
}

/**
 * Legacy fallback the socket sends when a lifecycle event never landed
 * (`ws.py:162`). It carries a run status rather than a decision.
 */
export interface LegacyTerminalFrame {
  type: "run.completed";
  status: string;
  decision?: undefined;
  sequence?: undefined;
}

export type SocketFrame = AgentStatusEvent | RunLifecycleEvent | PingFrame | LegacyTerminalFrame;

/* -------------------------------------------------------------------------
   Run header — `build_workspace_header` + `get_run_header`
   ---------------------------------------------------------------------- */

export interface RunHeader {
  runId: string;
  status: string;
  currentAgent: string;
  repository: string;
  branch: string;
  shortRunId: string;
  retries: number;
  /** Pre-formatted by the backend, e.g. `4m 12s`. */
  executionTime: string;
  decisionLabel: string;
  /** G4 — present today. `null` when the pipeline never observed a commit. */
  repositoryId: string | null;
  repositoryName: string;
  headSha: string | null;
  repositoryHash: string | null;
  lifecycle: RunLifecycleEvent[];
  /**
   * The environment precheck's report. `null` before A0.7 runs, when the
   * precheck is disabled, or on runs that predate it.
   */
  environment?: Record<string, unknown> | null;
}

/* -------------------------------------------------------------------------
   Agents — `build_agent_entries(surface="v2")`
   ---------------------------------------------------------------------- */

/** Statuses the backend projection publishes for an agent. */
export type BackendAgentStatus = "running" | "completed" | "failed" | "retry" | "skipped" | "draft";

/** One `{label, value}` pair from an agent's metrics array. */
export interface AgentMetric {
  label: string;
  value: string;
}

export interface AgentEvidenceField {
  label: string;
  value: string;
  /** The backend marks identifiers and numbers for mono rendering. */
  mono?: boolean;
}

export interface AgentEvidence {
  title?: string;
  subtitle?: string;
  fields?: AgentEvidenceField[];
  pills?: string[];
  bars?: { label: string; value: number }[];
  [key: string]: unknown;
}

export interface AgentEntry {
  /** Card id, e.g. `repo-intel`. Stable within a surface. */
  id: string;
  index: number;
  /** Display name from `AGENT_REGISTRY`. */
  agent: string;
  purpose: string;
  handoff: string;
  /** Backend `agent_id`, e.g. `A5.5`. The identity key for icons and marks. */
  agentId: string;
  stage: string;
  stageLabel: string;
  stageOrder: number;
  status: BackendAgentStatus;
  /** Pre-formatted, or `—` when the backend measured no span. */
  duration: string;
  lines: string[];
  /** An ordered array, not a map — the backend controls the order. */
  metrics?: AgentMetric[];
  evidence?: AgentEvidence | null;
  visualization?: Record<string, unknown>;
  modifiedFiles?: string[];
  pills?: string[];
}

/* -------------------------------------------------------------------------
   Stages — `build_stage_progress(surface="v2")`

   The backend is the single source of truth for stage membership, ordering and
   labels. The client contributes presentation only (icons, route slugs).
   ---------------------------------------------------------------------- */

export type BackendStageStatus =
  "waiting" | "running" | "retrying" | "completed" | "failed" | "skipped";

export interface StageAgentSummary {
  id: string;
  agentId: string;
  name: string;
  purpose: string;
  handoff: string;
  status: BackendAgentStatus;
  duration: string;
  message: string;
}

export interface StageProgress {
  id: string;
  label: string;
  order: number;
  purpose: string;
  status: BackendStageStatus;
  agents: StageAgentSummary[];
}

export interface StagesResponse {
  runId: string;
  stages: StageProgress[];
}

/* -------------------------------------------------------------------------
   Attempts — `build_repair_attempts`
   ---------------------------------------------------------------------- */

export interface RepairAttempt {
  n: number;
  action: string;
  detail: string;
  result: string;
  mutation: number;
  /** What the UI shows — never `0.00` for an unmeasured attempt. */
  scoreLabel: string;
}

export interface RepairAttemptsResponse {
  attempts?: RepairAttempt[];
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------
   Chat
   ---------------------------------------------------------------------- */

export interface ChatResponse {
  answer: string;
}

/* -------------------------------------------------------------------------
   Repositories — sidebar / palette
   ---------------------------------------------------------------------- */

export interface RepositoryEntry {
  id?: string;
  name?: string;
  runId?: string;
  repository?: string;
  status?: string;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------
   Knowledge graph — `backend/api/routes/knowledge.py`
   ---------------------------------------------------------------------- */

export interface WorkspacePackage {
  path: string;
  name: string;
  manifest: string;
  language: string;
  is_root: boolean;
}

export interface WorkspaceSummary {
  kind: string;
  packages: WorkspacePackage[];
  nested_repositories: string[];
  /** language → file count. */
  languages: Record<string, number>;
}

export interface KnowledgeMetrics {
  repository_hash: string;
  node_count: number;
  edge_count: number;
  average_degree: number;
  nodes_by_type: Record<string, number>;
  edges_by_type: Record<string, number>;
  index_build_ms: number;
  query_count: number;
  average_query_ms: number;
  cache_hit_rate: number;
  cache_hits: number;
  cache_misses: number;
  memory_bytes: number;
  index_size_bytes: number;
  repository_coverage: number;
  files_total: number;
  files_represented: number;
  workspace: WorkspaceSummary;
}

/** Matches `design/types.ts` `Evidence` exactly — the risk endpoint is the
 *  reference producer for the explainability contract. */
export interface RiskEvidence {
  signal: string;
  value: number;
  contribution: number;
  detail: string;
  provenance: string;
}

export interface RiskEntry {
  module: string;
  risk: number;
  band: string;
  why: string;
  signals: string[];
  evidence: RiskEvidence[];
}

export interface Hotspot {
  kind: string;
  target: string;
  severity: number;
  why: string;
  signals: string[];
  /** Preformatted strings here, unlike `RiskEntry.evidence`. */
  evidence: string[];
  members: string[];
}

export interface Capability {
  name: string;
  slug: string;
  confidence: number;
  files: string[];
  entry_points: string[];
  signals: Record<string, number>;
  why: string;
  evidence: string[];
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  file: string;
  qualname: string;
  color?: string;
  attributes?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  [key: string]: unknown;
}

export interface GraphExport {
  name: string;
  truncated: boolean;
  total_nodes: number;
  nodes: GraphNode[];
  edges?: GraphEdge[];
}

/** One row from `GET /knowledge/{id}/query/{name}`. */
export interface QueryResultNode {
  id: string;
  type: string;
  name: string;
  file: string | null;
  qualname: string | null;
  weight?: number;
}

export interface QueryResponse {
  query: string;
  file: string | null;
  qualname: string | null;
  count: number;
  results: QueryResultNode[];
  query_ms: number;
}

/* -------------------------------------------------------------------------
   Context package — `GET /api/runs/{run_id}/context`

   Exactly what A5.5 stored. A 404 means the stage has not produced a package
   yet, which is a fact the caller renders rather than a value to substitute.
   ---------------------------------------------------------------------- */

export interface RankedFile {
  file: string;
  /** Weighted sum of `signals`. Not normalised — it can exceed 1. */
  score: number;
  /** One-line summary of why this file ranked where it did. */
  reason: string;
  /** Human-readable contributions, one per signal that fired. */
  evidence: string[];
  /** 0–1, published by the ranker. */
  confidence: number;
  /** signal name → weighted contribution. The ranking's actual arithmetic. */
  signals: Record<string, number>;
  is_target: boolean;
}

export interface Redaction {
  file?: string;
  line?: number;
  detector?: string;
  placeholder?: string;
  [key: string]: unknown;
}

/** `failed` is blocking: the guard could not certify the context is clean. */
export type PrivacyGuardStatus = "clean" | "masked" | "failed";

export interface ContextMetrics {
  files_ranked: number;
  files_extracted: number;
  context_files: number;
  context_functions: number;
  context_lines: number;
  original_tokens: number;
  reduced_tokens: number;
  estimated_prompt_tokens: number;
  estimated_saved_tokens: number;
  /** 0–1. Published by A5.5; never recomputed client-side. */
  token_reduction: number;
  ranking_time_ms: number;
  extraction_time_ms: number;
  privacy_time_ms: number;
  build_time_ms: number;
  cache_hit: boolean;
  privacy_redactions: number;
  budget_chars: number;
  /** True when A5.5 could not build a full package and fell back. */
  degraded: boolean;
}

export interface ContextPackage {
  schema_version: string;
  ranking_version: string;
  cache_key: string;
  root_cause_summary: string;
  runtime_evidence: Record<string, unknown>;
  target_file: string;
  target_function: string | null;
  acceptance_criteria: string[];
  relevant_imports: string[];
  relevant_classes: string[];
  relevant_functions: string[];
  related_utilities: string[];
  constants: string[];
  dependency_summary: string[];
  contracts: string[];
  validation_requirements: string[];
  patch_constraints: string[];
  expected_output_format: string;
  focused_context: string;
  prefer_focused: boolean;
  ranked_files: RankedFile[];
  redactions: Redaction[];
  privacy_guard_status: PrivacyGuardStatus;
  metrics: ContextMetrics;
}

/* -------------------------------------------------------------------------
   Repair plan — `GET /runs/{id}/plan` (A6, Phase 5)
   ---------------------------------------------------------------------- */

/** One repair step. `issue_id` is the identity the whole DAG is keyed on. */
export interface FixNode {
  issue_id: string;
  /** Files this step edits. Empty is legitimate: a step can be scope-only. */
  files: string[];
  /** Steps that must land first, as A6 resolved them. */
  depends_on: string[];
}

/** A dependency A6 drew between two steps, with the reason it drew it. */
export interface DependencyEdge {
  from_issue: string;
  to_issue: string;
  reason: string;
}

/**
 * `FixDAGPlan` as A6 stored it.
 *
 * Note what is *not* here: a planning confidence. A6 publishes none, so the
 * stage says so rather than deriving one — a number invented at the point a
 * repair order is justified is exactly the failure this product exists to
 * prevent.
 */
export interface RepairPlan {
  nodes: FixNode[];
  execution_order: string[];
  conflict_batches: string[][];
  dependency_edges: DependencyEdge[];
}

/* -------------------------------------------------------------------------
   Patch bundle — `GET /runs/{id}/patch` (A7, Phase 6)
   ---------------------------------------------------------------------- */

/**
 * How A7 wrote the file.
 *
 * This is the *only* integrity claim the stage is allowed to make, because it
 * is the only one A7 stamps per candidate. A7 also runs a no-op/abbreviation
 * check and a Python parse before a candidate exists at all, but it records
 * neither on the candidate — a patch that failed either never reaches the
 * bundle, so the bundle cannot distinguish "passed" from "not run".
 */
export type PatchMethod = "ast_validated_write" | "libcst";

/** One file A7 rewrote, with both sides of the change. */
export interface PatchCandidate {
  file: string;
  original: string;
  patched: string;
  method: PatchMethod;
}

/**
 * A behaviour the patch is claimed to guarantee, as A7's model stated it.
 *
 * Written by the generator, not verified here — A8 is what tests whether it
 * holds. The stage attributes it accordingly.
 */
export interface BehavioralContract {
  assertion: string;
  location: string;
}

/**
 * `PatchBundle` as A7 stored it.
 *
 * `patches: []` with a bundle present is a real outcome — every plan failed
 * integrity — and is distinct from the 404 that means A7 never completed.
 */
export interface PatchBundle {
  issue_id: string;
  patches: PatchCandidate[];
  contracts: BehavioralContract[];
  /** Commit A7 learned the repository's style from, when it found one. */
  style_exemplar_commit: string | null;
  /** Unified diff A7 generated across every candidate. */
  diff_text: string;
}
