/**
 * Typed models for the Run Report, Workspace Header, Executive Summary and
 * Repair Attempts.
 *
 * The MOCK_* defaults match the values currently rendered in the UI so the
 * visual output is identical until a backend supplies real data.
 */
/** `unknown` = the axis was never measured. Distinct from a measured bad score. */
export type TrustTone = "ok" | "warn" | "bad" | "unknown";

export interface TrustMetric {
  label: string;
  /**
   * `null` when the pipeline never measured this axis.
   *
   * A skipped security re-scan used to arrive here as `0`, which rendered a
   * full red ring — the product accusing the code of failing a check that never
   * ran, and that same 0 was averaged into `trustScore`.
   */
  value: number | null;
  tone: TrustTone;
}

export interface EvidenceFlag {
  ok: boolean;
  text: string;
}

/**
 * `blocked` is the environment precheck's outcome: A0.7 found the repository's
 * dependencies missing, so the pipeline stopped before it could reproduce
 * anything. It was absent from this union, so every consumer's fall-through
 * branch rendered it as "Draft PR" — a decision the run never reached.
 */
export type RunDecision = "merge" | "draft" | "failed" | "blocked";

export interface RunReportModel {
  runId: string;
  shortRunId: string;
  repository: string;
  branch: string;
  decision: RunDecision;
  decisionLabel: string;
  /** `null` when no axis was measured — never 0. */
  trustScore: number | null;
  trustThreshold: number;
  rootCause: {
    /** Full analyst narrative. Rendered verbatim — never slotted into a template. */
    summary: string;
    /** One-line statement of the defect, when the analysis produced one. */
    statement: string;
    /** "path/to/file.py:123" from the primary citation. */
    location: string;
    /** What the citation asserts about that location. */
    claim: string;
    /** Whether the citation was machine-verified against the source. */
    verified: boolean;
  };
  rejection: {
    attempts: number;
    survivors: number;
    /** `null` when mutation testing never ran — distinct from a measured 0. */
    score: number | null;
    /**
     * The gate A10 actually routes on: the correctness axis against
     * `SCORE_THRESHOLD`.
     *
     * There is deliberately **no** mutation-score threshold here. The pipeline
     * has never had one — the figure that used to be printed beside the
     * mutation score was invented — so the score is reported unqualified and
     * the real gate is reported separately.
     */
    /** `null` when validation never ran — A8 records no score in that case. */
    correctnessScore: number | null;
    correctnessThreshold: number;
    /** Backend-authored explanation of why no patch cleared validation. */
    reason: string;
  };
  /** Why the run routed the way it did, in the router's own words. */
  decisionReason: string;
  trust: TrustMetric[];
  files: string[];
  evidence: EvidenceFlag[];
  proofBundle: string;
  /** Total number of agents executed (used in the report footer). */
  agentCount: number;
  /** Aggregate execution duration in seconds. */
  totalDurationSeconds: number;
}

export interface WorkspaceHeaderModel {
  repository: string;
  branch: string;
  shortRunId: string;
  retries: number;
  executionTime: string;
  decisionLabel: string;
  /**
   * How the run ended, as the backend records it. Optional because the mock
   * fixtures predate the lifecycle record; live responses always carry them.
   * `status` is `RunStateModel.status`, `lifecycle` the authoritative
   * `RunLifecycleEvent` list, `environment` A0.7's report.
   */
  status?: string;
  /**
   * Repository identity, from `repository_identity()`. `repositoryId` is the key
   * every cross-run store is keyed by — repair memory, learned profiles — so it
   * is what makes "this repository has been seen before" checkable rather than
   * asserted. `headSha` and `repositoryHash` are null when this run never
   * observed them; render absence, never a guess.
   */
  repositoryId?: string | null;
  headSha?: string | null;
  repositoryHash?: string | null;
  lifecycle?: { type: string; reason?: string | null; decision_label?: string | null }[];
  environment?: {
    status?: string | null;
    language?: string | null;
    reason?: string | null;
    test_runner?: string | null;
    suggested_command?: string | null;
  } | null;
}

/**
 * One file A5.5 scored while deciding what the patch generator gets to see.
 * `signals` is the per-signal breakdown behind `score` — the reason the ranking
 * is reviewable rather than an oracle.
 */
export interface RankedContextFile {
  file: string;
  score: number;
  reason: string;
  confidence: number;
  signals: Record<string, number>;
  is_target: boolean;
  evidence: string[];
}

/**
 * One masked secret. Deliberately enough to audit and never enough to recover
 * the value — no placeholder, no prefix, no length.
 */
export interface ContextRedaction {
  file: string;
  line: number;
  kind: string;
  detector: string;
  identifier: string;
}

/**
 * A5.5's context package, from `/runs/{id}/context`.
 *
 * Partial by intent: the endpoint returns the full stored package, and this
 * types only the fields the workspace renders. `privacy_guard_status` is the
 * one that matters most — it is the evidence that secrets did not reach the
 * LLM, and `failed` means the guard itself errored, so nothing may be assumed
 * about what got through.
 */
export interface ContextPackageModel {
  target_file: string;
  target_function: string | null;
  acceptance_criteria: string[];
  patch_constraints: string[];
  ranked_files: RankedContextFile[];
  redactions: ContextRedaction[];
  privacy_guard_status: "clean" | "masked" | "failed";
  prefer_focused: boolean;
  metrics: {
    files_ranked: number;
    context_files: number;
    context_functions: number;
    original_tokens: number;
    reduced_tokens: number;
    token_reduction: number;
    privacy_redactions: number;
    degraded: boolean;
  };
}

/** One file A7 rewrote, with both sides as it recorded them. */
export interface PatchCandidateModel {
  file: string;
  original: string;
  patched: string;
  /**
   * How A7 wrote the file. Passed through from the backend untouched — it is
   * what the integrity badge is allowed to claim, so it must not be inferred
   * here.
   */
  method: string;
}

export interface BehavioralContractModel {
  assertion: string;
  location: string;
}

/**
 * A7's patch bundle, from `/runs/{id}/patch`.
 *
 * A 404 means A7 produced no bundle. That is a different fact from a bundle
 * whose `patches` list is empty: the first is "generation never completed", the
 * second is "generation completed and changed nothing".
 */
export interface PatchBundleModel {
  issue_id: string;
  patches: PatchCandidateModel[];
  contracts: BehavioralContractModel[];
  diff_text: string;
  style_exemplar_commit: string | null;
}

export interface ExecutiveSummaryModel {
  repository: string;
  bug: string;
  /**
   * `"not measured"` when A3 produced no ranked findings — a run blocked at
   * A0.7 has no scan to report a severity for, and the old `"LOW"` floor
   * claimed one came back clean. Render it neutrally, not as a red chip.
   */
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "not measured";
  rootCause: string;
  confidence: string;
  filesAffected: number;
  attempts: number;
  mutationScore: string;
  runtime: string;
  trustScore: string;
  decision: RunDecision;
  decisionReason: string;
}

export interface RetryAttempt {
  n: number;
  action: string;
  detail: string;
  result: string;
  mutation: number;
  /**
   * What to render next to the result. The backend decides the wording because
   * only it knows which score was actually measured: mutation testing only runs
   * once pytest passes, so a failed attempt has no mutation score and must not
   * be shown as `mutation 0.00`.
   */
  scoreLabel?: string;
}

export interface RepairAttemptsModel {
  attempts: RetryAttempt[];
  failureMessage: string;
  nextStepLabel: string;
}

export interface RepoMetadata {
  owner: string;
  name: string;
  language: string | null;
  /** `null` when the branch could not be determined without contacting the host. */
  branch: string | null;
  /** "Unknown" when nothing has actually checked the repository's visibility. */
  visibility: "Public" | "Private" | "Unknown";
  htmlUrl: string;
}

export const MOCK_RUN_REPORT: RunReportModel = {
  runId: "11b8-3a91",
  shortRunId: "11b8…3a91",
  repository: "vulnapi",
  branch: "main",
  decision: "draft",
  decisionLabel: "Draft PR",
  trustScore: 0.83,
  // Matches the real gate: A10's SCORE_THRESHOLD of 80, normalised to the 0-1
  // scale the trust score uses. The 0.9 here before corresponded to no
  // threshold in the pipeline — the same invented figure the backend removed.
  trustThreshold: 0.8,
  rootCause: {
    summary:
      "Missing expiry comparison branch in validate_token() — the expired_at field is read but never compared against the current time, so expired tokens were treated as valid.",
    statement: "Missing expiry comparison branch in validate_token()",
    location: "auth/token.py:142",
    claim: "expired_at < now",
    verified: true,
  },
  rejection: {
    attempts: 3,
    survivors: 7,
    score: 0.81,
    correctnessScore: 62,
    correctnessThreshold: 80,
    reason:
      "3 patch attempts were rejected by mutation testing — 7 mutants survived, meaning the tests do not actually constrain the repaired behaviour.",
  },
  trust: [
    { label: "Correctness", value: 78, tone: "warn" },
    { label: "Security", value: 91, tone: "ok" },
    { label: "Fidelity", value: 74, tone: "warn" },
    { label: "Scope Safety", value: 88, tone: "ok" },
  ],
  decisionReason:
    "The repair touches authentication logic, so ProoFix routed to a Draft PR for human review rather than auto-merging.",
  files: ["auth/token.py", "api/session.py", "tests/test_auth.py"],
  evidence: [
    { ok: true, text: "Runtime reproduced" },
    { ok: true, text: "Root cause confirmed" },
    { ok: true, text: "Blast radius analyzed" },
    { ok: false, text: "Mutation validation failed" },
    { ok: false, text: "Retry exhausted (3/3)" },
  ],
  proofBundle: "sha256:7a31…b4e2",
  agentCount: 10,
  totalDurationSeconds: 69.5,
};

export const MOCK_WORKSPACE_HEADER: WorkspaceHeaderModel = {
  repository: "vulnapi",
  branch: "main",
  shortRunId: "11b8…3a91",
  retries: 3,
  executionTime: "1m 12s",
  decisionLabel: "Draft PR",
};

export const MOCK_EXECUTIVE_SUMMARY: ExecutiveSummaryModel = {
  repository: "Secure-auth",
  bug: "JWT Validation",
  severity: "HIGH",
  rootCause: "Missing expiry check",
  confidence: "97%",
  filesAffected: 5,
  attempts: 3,
  mutationScore: "0.61 / 0.85",
  runtime: "69.5 s",
  trustScore: "0.83",
  decision: "draft",
  decisionReason: "Mutation threshold not satisfied after 3 repair attempts.",
};

export const MOCK_REPAIR_ATTEMPTS: RepairAttemptsModel = {
  attempts: [
    {
      n: 1,
      action: "Generate Patch",
      detail: "Tightened expiry check inside validate_token()",
      result: "Validation Failed",
      mutation: 0.42,
    },
    {
      n: 2,
      action: "Generate Patch",
      detail: "Added pre-check guard before _decode()",
      result: "Validation Failed",
      mutation: 0.55,
    },
    {
      n: 3,
      action: "Generate Patch",
      detail: "Refactored middleware to short-circuit expired tokens",
      result: "Validation Failed",
      mutation: 0.61,
    },
  ],
  failureMessage: "Mutation threshold of 0.85 not satisfied after 3 attempts.",
  nextStepLabel: "Proceed to Mergeability Assessment",
};
