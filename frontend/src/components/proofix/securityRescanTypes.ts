/**
 * Types for A9's security re-scan endpoint
 * (`GET /api/runs/{runId}/security`, `services/ui_projection.py::build_security_rescan`).
 *
 * A9 answers exactly one question — did the patch introduce a finding that
 * was not in A3's pre-patch baseline — by re-running bandit and semgrep
 * against the patched repository and diffing against A3's baseline scan.
 * Nothing here is invented:
 *
 * - No severity. A9's own scanner calls assign every finding the same
 *   constant (0.7), never a real per-issue measurement, so `SecurityFinding`
 *   carries no severity field at all — there is nothing honest to show.
 * - No resolved/unchanged counts. A9 only ever computes the *new* side of
 *   the baseline comparison; the symmetric tally does not exist in the
 *   backend's `SecurityRescanResult`, so this contract does not carry it.
 * - No rule ID / CWE / category. Neither scanner call captures them today.
 */

/** The three real states A9 can report — never a fourth, invented one. */
export type SecurityVerdict = "not_measured" | "new_findings" | "clean";

/** One finding A9 found in the patched repo with no counterpart in A3's baseline. */
export interface SecurityFinding {
  id: string;
  file: string;
  line: number;
  message: string;
  /** Which scanner(s) reported it — e.g. `["bandit"]`. */
  tools: string[];
}

/** A9's own retry brief content for a rejected patch — not A10's decision. */
export interface SecurityRetryContext {
  assertionMessage: string | null;
  securityConstraint: string | null;
}

/** `GET /api/runs/{runId}/security`. */
export interface SecurityRescanReport {
  verdict: SecurityVerdict;
  rejected: boolean;
  /** `null` when no scanner executed this rescan — absent is not zero. */
  securityScore: number | null;
  newFindings: SecurityFinding[];
  /** Scanners that actually ran this rescan — subset of `["bandit", "semgrep"]`. */
  scannersRun: string[];
  reexecutionCommand: string;
  reexecutionTimeoutSeconds: number | null;
  retryContext: SecurityRetryContext | null;
}
