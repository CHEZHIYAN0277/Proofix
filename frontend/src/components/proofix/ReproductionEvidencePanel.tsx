/**
 * A3.5 — Reproduction Evidence Console + Execution Trace.
 *
 * Everything on this panel comes from `GET /api/runs/{runId}/reproduction`
 * (`services/ui_projection.py::build_reproduction_evidence`, sourced from
 * A3.5's own `ReproductionResult`). No verdict, confidence, or stage status
 * is computed client-side.
 *
 * A3.5 does not target a specific A3 finding — confirmed by reading
 * `orchestrator/nodes.py::reproduction_gate`, which never passes A3's
 * `static_report` into this stage. It is an independent full-suite pytest
 * gate that answers one question: does the reported bug reproduce as a
 * failing test right now. This panel never implies a finding-to-reproduction
 * link that does not exist.
 *
 * The five-stage execution trace is a deterministic, backend-computed
 * decomposition of the final recorded result — not live progress. A3.5 runs
 * as a single atomic subprocess call with no intermediate events, so while it
 * is running this panel shows exactly that fact and nothing else: no
 * fabricated "Analyzing → Executing → Observing" animation, because the
 * backend has no such states to drive one from.
 */
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  MinusCircle,
  HelpCircle,
  AlertTriangle,
  Circle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Terminal,
} from "lucide-react";
import type { ReproductionEvidence, ReproductionUiStatus, StageStatus } from "./reproductionTypes";
import { getReproductionEvidence } from "@/lib/runService";
import type { AgentStatus } from "./data";

const STATUS_LABEL: Record<ReproductionUiStatus, string> = {
  reproduced: "REPRODUCED",
  not_reproduced: "NOT REPRODUCED",
  unavailable: "UNAVAILABLE",
  error: "EXECUTION ERROR",
};

const STATUS_COLOR: Record<ReproductionUiStatus, string> = {
  reproduced: "#16a34a",
  not_reproduced: "#64748b",
  unavailable: "#d97706",
  error: "#dc2626",
};

const STATUS_ICON: Record<ReproductionUiStatus, typeof CheckCircle2> = {
  reproduced: CheckCircle2,
  not_reproduced: MinusCircle,
  unavailable: HelpCircle,
  error: AlertTriangle,
};

const STATUS_SUMMARY: Record<ReproductionUiStatus, string> = {
  reproduced: "The reported bug reproduced as a failing test with captured evidence.",
  not_reproduced: "Every collected test passed — the reported bug did not reproduce here.",
  unavailable: "pytest collected zero tests, so there was nothing to reproduce against.",
  error: "The pytest subprocess could not complete, so reproduction is unresolved.",
};

const STAGE_ICON: Record<StageStatus, typeof CheckCircle2> = {
  done: CheckCircle2,
  not_triggered: MinusCircle,
  skipped: Circle,
  failed: XCircle,
};

const STAGE_COLOR: Record<StageStatus, string> = {
  done: "#16a34a",
  not_triggered: "#64748b",
  skipped: "#94a3b8",
  failed: "#dc2626",
};

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load reproduction evidence</span>
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

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted/60 px-2.5 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-wider text-ink-soft">{label}</div>
      <div className="font-mono text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

// -------------------------------------------------------------- verdict

function VerdictBanner({ evidence }: { evidence: ReproductionEvidence }) {
  const Icon = STATUS_ICON[evidence.uiStatus];
  const color = STATUS_COLOR[evidence.uiStatus];
  return (
    <div
      className="rounded-xl border p-3"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 shrink-0" style={{ color }} />
        <span className="text-sm font-bold tracking-wide" style={{ color }}>
          {STATUS_LABEL[evidence.uiStatus]}
        </span>
        {evidence.failingTest && (
          <span
            className="truncate font-mono text-[11px] text-ink-soft"
            title={evidence.failingTest}
          >
            {evidence.failingTest}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-ink-soft">{STATUS_SUMMARY[evidence.uiStatus]}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatChip label="Confidence" value={evidence.confidence.toFixed(2)} />
        {evidence.evidenceSource && (
          <StatChip
            label="Evidence source"
            value={
              evidence.evidenceSource === "pytest_report"
                ? "Structured report"
                : "Output text match"
            }
          />
        )}
        {evidence.durationSeconds !== null && (
          <StatChip label="Duration" value={`${evidence.durationSeconds.toFixed(2)}s`} />
        )}
        {evidence.timedOut && <StatChip label="Timed out" value="Yes" />}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- trace

function ExecutionTrace({ evidence }: { evidence: ReproductionEvidence }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Execution trace
      </div>
      <ol className="space-y-1.5">
        {evidence.stages.map((stage, i) => {
          const Icon = STAGE_ICON[stage.status];
          const color = STAGE_COLOR[stage.status];
          const isLast = i === evidence.stages.length - 1;
          return (
            <li key={stage.id} className="flex gap-2.5">
              <div className="flex flex-col items-center">
                <Icon className="h-4 w-4 shrink-0" style={{ color }} />
                {!isLast && <span className="mt-1 h-full w-px flex-1 bg-border" aria-hidden />}
              </div>
              <div className="min-w-0 flex-1 pb-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold text-ink">
                    {i + 1}. {stage.label}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider" style={{ color }}>
                    {stage.status === "not_triggered"
                      ? "no failure"
                      : stage.status === "skipped"
                        ? "not reached"
                        : stage.status}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-ink-soft">{stage.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-[10px] text-ink-soft">
        Explain: these five stages are computed once, after the run, from A3.5&apos;s recorded
        result — A3.5 executes as a single subprocess call with no intermediate progress events, so
        nothing here is animated or polled. Source: <code className="font-mono">stages</code>.
      </p>
    </div>
  );
}

// ------------------------------------------------------------ strategy

function StrategyCard({ evidence }: { evidence: ReproductionEvidence }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted/30 p-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Reproduction strategy
      </div>
      <dl className="space-y-2 text-[11px]">
        <div>
          <dt className="text-[9px] uppercase tracking-wider text-ink-soft">Strategy</dt>
          <dd className="mt-0.5 text-ink">
            Full-suite gate — A3.5 always runs the repository&apos;s entire test suite once, rather
            than targeting a single test.
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wider text-ink-soft">Command executed</dt>
          <dd className="mt-0.5 break-all font-mono text-ink">
            {evidence.command || "Not measured"}
          </dd>
        </div>
        {evidence.reexecutionCommand && (
          <div>
            <dt className="text-[9px] uppercase tracking-wider text-ink-soft">
              Targeted re-execution command (for later validation — not run here)
            </dt>
            <dd className="mt-0.5 break-all font-mono text-ink-soft">
              {evidence.reexecutionCommand}
              <span className="ml-1.5 text-[9px]">
                ({evidence.reexecutionIsTargeted ? "targeted" : "full-suite fallback"})
              </span>
            </dd>
          </div>
        )}
        <div>
          <dt className="text-[9px] uppercase tracking-wider text-ink-soft">Environment</dt>
          <dd className="mt-0.5 text-ink-soft">Not measured</dd>
        </div>
      </dl>
    </div>
  );
}

// ------------------------------------------------------------- console

function ExecutionConsole({ evidence }: { evidence: ReproductionEvidence }) {
  const [expanded, setExpanded] = useState(true);
  const hasOutput = Boolean(evidence.stdout || evidence.stderr);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 border-b border-border bg-surface-muted/50 px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-ink-soft"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Terminal className="h-3 w-3" />
        Execution console
        {evidence.exitCode !== null && (
          <span className="ml-auto font-mono normal-case text-ink">
            Exit code: {evidence.exitCode}
          </span>
        )}
      </button>
      {expanded && (
        <div className="max-h-[320px] overflow-auto bg-[#0b0f14] p-3 font-mono text-[11px] leading-relaxed">
          <div className="text-[#7dd3fc]">$ {evidence.command || "Not measured"}</div>
          {evidence.stdout && (
            <div className="mt-2">
              <div className="text-[9px] uppercase tracking-wider text-[#64748b]">stdout</div>
              <pre className="whitespace-pre-wrap break-all text-[#e2e8f0]">{evidence.stdout}</pre>
            </div>
          )}
          {evidence.stderr && (
            <div className="mt-2">
              <div className="text-[9px] uppercase tracking-wider text-[#f87171]">stderr</div>
              <pre className="whitespace-pre-wrap break-all text-[#fca5a5]">{evidence.stderr}</pre>
            </div>
          )}
          {!hasOutput && (
            <div className="mt-2 text-[#64748b]">
              No stdout or stderr was captured for this run.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- evidence

function EvidenceCard({ evidence }: { evidence: ReproductionEvidence }) {
  const [tracebackOpen, setTracebackOpen] = useState(false);

  if (evidence.uiStatus !== "reproduced") {
    return (
      <div className="rounded-lg border border-border bg-surface-muted/30 p-3 text-[11px] text-ink-soft">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
          Evidence collected
        </div>
        {evidence.uiStatus === "not_reproduced"
          ? "No evidence to collect — the suite passed, so there was no failure to capture."
          : evidence.infraDetail || "No evidence was captured."}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-status-completed/30 bg-status-completed-bg/30 p-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Evidence collected
      </div>
      <dl className="space-y-2 text-[11px]">
        <div>
          <dt className="text-[9px] uppercase tracking-wider text-ink-soft">Error signature</dt>
          <dd className="mt-0.5 font-mono text-ink">{evidence.errorSignature ?? "Not measured"}</dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wider text-ink-soft">Location</dt>
          <dd className="mt-0.5 font-mono text-ink">
            {evidence.failingFile ?? "Not measured"}
            {evidence.failingLine !== null ? `:${evidence.failingLine}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wider text-ink-soft">Observed behavior</dt>
          <dd className="mt-0.5 text-ink">{evidence.exceptionMessage ?? "Not measured"}</dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wider text-ink-soft">Evidence type</dt>
          <dd className="mt-0.5 text-ink">
            {evidence.evidenceSource === "pytest_report"
              ? "Structured pytest JSON report"
              : evidence.evidenceSource === "output_text"
                ? "Output text pattern match (lower confidence)"
                : "Not measured"}
          </dd>
        </div>
      </dl>
      {evidence.traceback && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setTracebackOpen((o) => !o)}
            aria-expanded={tracebackOpen}
            className="flex items-center gap-1 text-[10px] font-medium text-ink-soft transition-colors hover:text-ink"
          >
            {tracebackOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Full traceback
          </button>
          {tracebackOpen && (
            <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-surface-muted/50 p-2 text-[10px] text-ink">
              {evidence.traceback}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- panel

export function ReproductionEvidencePanel({
  runId,
  status,
}: {
  runId: string;
  status?: AgentStatus;
}) {
  const [evidence, setEvidence] = useState<ReproductionEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getReproductionEvidence(runId)
      .then((e) => {
        if (!cancelled) setEvidence(e);
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

  const baselineOthers = useMemo(() => evidence?.baselineFailures ?? [], [evidence]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Failure Reproduction
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Loading reproduction evidence…</p>
      </section>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (!evidence) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Failure Reproduction
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "RUNNING — A3.5 is executing the test suite now; this panel renders once it publishes."
            : "Pending — A3.5 has not completed for this run yet."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Failure Reproduction
        </h3>
        <p className="mt-0.5 text-[11px] text-ink-soft">
          A3.5 runs the repository&apos;s full test suite once and classifies the result — proof the
          reported bug is real before any repair is attempted. It does not target a specific A3
          finding; it verifies the reported failure independently.
        </p>
      </div>

      <VerdictBanner evidence={evidence} />
      <ExecutionTrace evidence={evidence} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <StrategyCard evidence={evidence} />
        <EvidenceCard evidence={evidence} />
      </div>

      <ExecutionConsole evidence={evidence} />

      {baselineOthers.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
            Other pre-existing failures ({baselineOthers.length})
          </div>
          <ul className="space-y-0.5">
            {baselineOthers.map((t) => (
              <li key={t} className="truncate font-mono text-[10px] text-ink-soft" title={t}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-ink-soft">
        Explain: reproduction is A3.5&apos;s own full-suite pytest gate — distinct from A3&apos;s
        static findings above. Source:{" "}
        <code className="font-mono">GET /api/runs/{"{run_id}"}/reproduction</code>
      </p>
    </section>
  );
}
