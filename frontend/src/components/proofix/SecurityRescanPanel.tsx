/**
 * A9 — Security Re-scan.
 *
 * Everything here comes from `GET /api/runs/{runId}/security`
 * (`services/ui_projection.py::build_security_rescan`, sourced from A9's own
 * `SecurityRescanResult`). A9 answers exactly one question — did the patch
 * introduce a finding that was not in A3's pre-patch baseline — and this
 * panel is built around that answer, not a generic scanner dashboard:
 *
 * - No severity is rendered anywhere. A9's own scanner calls assign every
 *   finding the same constant (0.7), never a real per-issue measurement, so
 *   the backend contract carries no severity field for `newFindings` at all.
 * - No resolved/unchanged/before-after board. A9 only ever computes the
 *   *new* side of the baseline comparison — the symmetric tally does not
 *   exist in the backend, so it is not fabricated here either.
 * - `verdict` is one of exactly three real states
 *   (`not_measured` | `new_findings` | `clean`). An absent scanner is never
 *   rendered as a pass.
 * - The bottom strip shows what A10 actually reads off this result
 *   (`axis.security`, the hard `rejected` gate) — never A10's own decision,
 *   which belongs to the merge card.
 */
import { useEffect, useState } from "react";
import { ChevronDown, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { SecurityFinding, SecurityRescanReport, SecurityVerdict } from "./securityRescanTypes";
import { getSecurityRescan } from "@/lib/runService";
import type { AgentStatus } from "./data";

const KNOWN_SCANNERS = ["bandit", "semgrep"] as const;

const VERDICT_LABEL: Record<SecurityVerdict, string> = {
  not_measured: "Not measured",
  new_findings: "New finding introduced",
  clean: "No new findings",
};

const VERDICT_CAPTION: Record<SecurityVerdict, string> = {
  not_measured: "No scanner available",
  new_findings: "Rejected — new finding versus the pre-patch baseline",
  clean: "No new findings versus the pre-patch baseline",
};

const VERDICT_ICON: Record<SecurityVerdict, typeof ShieldCheck> = {
  not_measured: ShieldQuestion,
  new_findings: ShieldAlert,
  clean: ShieldCheck,
};

const VERDICT_STYLE: Record<SecurityVerdict, string> = {
  not_measured: "border-border bg-surface-muted/50 text-ink",
  new_findings: "border-status-failed/30 bg-status-failed-bg/40 text-status-failed",
  clean: "border-status-completed/30 bg-status-completed-bg/40 text-status-completed",
};

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load security re-scan</span>
      <span className="font-mono text-ink-soft">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto rounded-md border border-border px-2 py-0.5 font-medium text-ink transition-colors hover:bg-surface-muted"
      >
        Retry
      </button>
    </div>
  );
}

function StatTile({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted/40 p-3">
      <div className="text-[9px] font-medium uppercase tracking-wider text-ink-soft">{label}</div>
      <div className="mt-0.5 font-mono text-2xl font-semibold text-ink">{value}</div>
      {caption && <p className="mt-1 text-[10px] text-ink-soft">{caption}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- verdict

function VerdictBand({ report }: { report: SecurityRescanReport }) {
  const Icon = VERDICT_ICON[report.verdict];
  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${VERDICT_STYLE[report.verdict]}`}
    >
      <Icon className="h-6 w-6 shrink-0" aria-hidden />
      <div>
        <div className="text-sm font-semibold uppercase tracking-wide">
          {VERDICT_LABEL[report.verdict]}
        </div>
        <div className="mt-0.5 text-[11px] opacity-90">{VERDICT_CAPTION[report.verdict]}</div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------- new findings

function FindingRow({ finding }: { finding: SecurityFinding }) {
  return (
    <li className="rounded-lg border border-status-failed/20 bg-status-failed-bg/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-status-failed" aria-hidden>
          ✕
        </span>
        <span className="font-mono text-[11px] text-ink">
          {finding.file}:{finding.line}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink">{finding.message}</p>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-ink-soft">
        {finding.tools.length > 0 ? finding.tools.join(", ") : "unknown tool"}
      </div>
    </li>
  );
}

function NewFindings({ findings }: { findings: SecurityFinding[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        New findings
      </div>
      {findings.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-muted/30 p-3 text-[11px] text-ink-soft">
          None — nothing in the patched repository is missing from A3&apos;s baseline.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {findings.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------- scanner coverage

function ScannerCoverage({ scannersRun }: { scannersRun: string[] }) {
  const ran = new Set(scannersRun);
  if (scannersRun.length === 0) {
    return (
      <div>
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
          Scanner coverage
        </div>
        <div className="rounded-lg border border-border bg-surface-muted/30 p-3 text-[11px] text-ink">
          <div className="flex items-center gap-1.5 text-ink-soft">
            <span aria-hidden>○</span> No security scanner executed
          </div>
          <p className="mt-1 text-ink-soft">Security result not measured.</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Scanner coverage
      </div>
      <ul className="space-y-1 rounded-lg border border-border bg-surface-muted/30 p-2.5">
        {KNOWN_SCANNERS.map((name) => {
          const executed = ran.has(name);
          return (
            <li key={name} className="flex items-center gap-2 text-[11px]">
              <span aria-hidden className={executed ? "text-status-completed" : "text-ink-soft"}>
                {executed ? "✓" : "○"}
              </span>
              <span className="font-medium capitalize text-ink">{name}</span>
              <span className="text-ink-soft">{executed ? "measured" : "unavailable"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------- security score

function SecurityScore({ report }: { report: SecurityRescanReport }) {
  return (
    <StatTile
      label="Security score"
      value={report.securityScore === null ? "—" : report.securityScore.toFixed(0)}
      caption={
        report.securityScore === null
          ? "Not measured — no scanner executed"
          : "25 points deducted per new finding."
      }
    />
  );
}

// ----------------------------------------------------------- A10 handoff

function A10Handoff({ report }: { report: SecurityRescanReport }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted/30 p-3">
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-soft">
          A9 Security Re-scan
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-soft">
          A10 Decision
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-md border border-border bg-surface px-2.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-ink-soft">Security axis</div>
          <div className="mt-0.5 font-mono text-ink">
            {report.securityScore === null ? "Not measured" : report.securityScore.toFixed(0)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface px-2.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-ink-soft">
            Security hard gate
          </div>
          <div className="mt-0.5 font-mono text-ink">
            {report.rejected ? "Blocks auto-merge" : "Does not block"}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-ink-soft">
        A9 supplies inputs to A10&apos;s mergeability decision — the decision itself is on the merge
        card.
      </p>
    </div>
  );
}

// --------------------------------------------------------- progressive disclosure

function Details({ report }: { report: SecurityRescanReport }) {
  const [open, setOpen] = useState(false);
  const hasRetryContext =
    report.retryContext &&
    (report.retryContext.assertionMessage || report.retryContext.securityConstraint);

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium text-ink"
      >
        Re-execution &amp; retry detail
        <ChevronDown
          className={`h-3.5 w-3.5 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2 text-[11px] text-ink-soft">
          <div>
            <span className="text-ink-soft">Re-execution command</span>
            <pre className="mt-1 overflow-x-auto rounded-md bg-surface-muted/50 p-2 font-mono text-[10px] text-ink">
              {report.reexecutionCommand || "—"}
            </pre>
          </div>
          <div>
            Timeout:{" "}
            <span className="font-mono text-ink">{report.reexecutionTimeoutSeconds ?? "—"}s</span>
          </div>
          {hasRetryContext && (
            <div className="space-y-1 border-t border-border/60 pt-2">
              {report.retryContext?.assertionMessage && (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-ink-soft">
                    Assertion
                  </span>
                  <p className="mt-0.5 text-ink">{report.retryContext.assertionMessage}</p>
                </div>
              )}
              {report.retryContext?.securityConstraint && (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-ink-soft">
                    Security constraint for retry
                  </span>
                  <p className="mt-0.5 text-ink">{report.retryContext.securityConstraint}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- panel

export function SecurityRescanPanel({ runId, status }: { runId: string; status?: AgentStatus }) {
  const [report, setReport] = useState<SecurityRescanReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSecurityRescan(runId)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, attempt, status]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Security Re-scan
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Security re-scan loading…</p>
      </section>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (!report) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Security Re-scan
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "RUNNING — A9 is re-scanning the patched repository now; this panel renders once it publishes."
            : "Security rescan pending — A9 has not completed yet."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Security Re-scan
        </h3>
        <p className="mt-0.5 text-[11px] text-ink-soft">
          A9 re-runs bandit and semgrep against the patched repository and compares the result to
          A3&apos;s pre-patch baseline, per scanner, by finding identity (not line number, since a
          patch moves lines). It answers one question: did this patch introduce a finding that was
          not there before.
        </p>
      </div>

      <VerdictBand report={report} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile label="New findings" value={String(report.newFindings.length)} />
        <SecurityScore report={report} />
      </div>

      <NewFindings findings={report.newFindings} />
      <ScannerCoverage scannersRun={report.scannersRun} />
      <A10Handoff report={report} />
      <Details report={report} />

      <p className="text-[10px] text-ink-soft">
        Explain: a differential re-scan of A9&apos;s own — distinct from A3&apos;s baseline scan and
        A10&apos;s merge decision. Source:{" "}
        <code className="font-mono">GET /api/runs/{"{run_id}"}/security</code>
      </p>
    </section>
  );
}
