/**
 * A10 — Mergeability Decision.
 *
 * Everything here comes from `GET /api/runs/{runId}/decision`
 * (`services/ui_projection.py::build_mergeability_decision`, sourced from
 * A10's own `PRRoutingDecision` and `VerificationBundle`). A10 does not
 * re-verify correctness or security — the `correctness` and `security` axes
 * below are A8's and A9's own scores, passed through unchanged. A10 verifies
 * exactly one thing itself (the MCI phantom check) and computes two axes of
 * its own (fidelity, scope safety); this panel labels that distinction
 * rather than presenting all four axes as A10's independent findings.
 *
 * Design: hybrid scorecard + gate board (approved direction "E"). The
 * ten-gate `hardGates` trace mirrors `a10_routing.gate_checks` exactly —
 * same order, same wording — and a gate marked `checked: false` is rendered
 * as "not reached", never as passed. `routingModifiers` (citation review,
 * reproduction confidence, the stricter security auto-merge bar) is shown
 * only when `hardGatesClear` is true; a hard-blocked run never reached those
 * facts, so nothing is guessed in their place.
 *
 * The composite `trust` score is captioned as descriptive, not the gate
 * itself — the real routing decision comes from the per-axis thresholds and
 * the hard gates, not from the mean clearing a bar.
 */
import { useEffect, useState } from "react";
import { ChevronDown, CircleCheck, CircleDashed, CircleX, GitPullRequest } from "lucide-react";
import type { HardGate, MergeabilityAxis, MergeabilityDecision, PRType } from "./mergeabilityTypes";
import { getMergeabilityDecision } from "@/lib/runService";
import type { AgentStatus } from "./data";

const VERDICT_LABEL: Record<PRType, string> = {
  auto_mergeable: "Auto-Mergeable",
  diff_only: "Diff Only",
  draft: "Draft PR",
};

const VERDICT_CAPTION: Record<PRType, string> = {
  auto_mergeable: "Every hard gate cleared and both axis thresholds were met.",
  diff_only: "Technically valid, but not eligible for auto-merge — manual review required.",
  draft: "A hard gate blocked this run — manual verification required before merge.",
};

const VERDICT_STYLE: Record<PRType, string> = {
  auto_mergeable: "border-status-completed/30 bg-status-completed-bg/40 text-status-completed",
  diff_only: "border-status-retry/30 bg-status-retry-bg/40 text-status-retry",
  draft: "border-status-failed/30 bg-status-failed-bg/40 text-status-failed",
};

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load mergeability decision</span>
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

function VerdictBand({ decision }: { decision: MergeabilityDecision }) {
  return (
    <div role="status" className={`rounded-xl border px-4 py-3 ${VERDICT_STYLE[decision.prType]}`}>
      <div className="text-sm font-semibold uppercase tracking-wide">
        {VERDICT_LABEL[decision.prType]}
      </div>
      <div className="mt-0.5 text-[11px] opacity-90">{VERDICT_CAPTION[decision.prType]}</div>
      {decision.reviewNote && (
        <p className="mt-2 border-t border-current/20 pt-2 text-[11.5px] leading-relaxed opacity-95">
          {decision.reviewNote}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ axes

function AxisRow({ axis }: { axis: MergeabilityAxis }) {
  const display = axis.value === null ? "not measured" : axis.value.toFixed(0);
  const tone =
    axis.meetsLowThreshold === null
      ? "text-ink-soft"
      : axis.meetsLowThreshold
        ? "text-status-completed"
        : "text-status-failed";
  return (
    <div className="rounded-lg border border-border bg-surface-muted/30 px-3 py-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-ink">{axis.label}</span>
        <span className={`font-mono font-semibold ${tone}`}>{display}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-ink-soft">
        <span>
          ≥ {axis.lowThreshold.toFixed(0)}{" "}
          {axis.meetsLowThreshold === null ? "— not measured" : axis.meetsLowThreshold ? "✓" : "✕"}
        </span>
        {axis.autoMergeThreshold !== undefined && (
          <span>
            ≥ {axis.autoMergeThreshold.toFixed(0)} for auto-merge{" "}
            {axis.meetsAutoMergeThreshold === null
              ? "— not measured"
              : axis.meetsAutoMergeThreshold
                ? "✓"
                : "✕"}
          </span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- hard gates

function GateRow({ gate }: { gate: HardGate }) {
  const Icon = !gate.checked ? CircleDashed : gate.passed ? CircleCheck : CircleX;
  const tone = !gate.checked
    ? "text-ink-soft"
    : gate.passed
      ? "text-status-completed"
      : "text-status-failed";
  return (
    <li className="flex items-start gap-2 text-[11px]">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden />
      <div className="min-w-0">
        <div className={!gate.checked ? "text-ink-soft" : "text-ink"}>
          {gate.label}
          {!gate.checked && <span className="ml-1.5 text-[10px] text-ink-soft">not reached</span>}
        </div>
        {gate.detail && <p className="mt-0.5 text-[10px] text-status-failed">{gate.detail}</p>}
      </div>
    </li>
  );
}

function HardGates({ gates }: { gates: HardGate[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Hard gates
      </div>
      <ul className="space-y-1.5 rounded-lg border border-border bg-surface-muted/30 p-2.5">
        {gates.map((g) => (
          <GateRow key={g.code} gate={g} />
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ routing modifiers

function RoutingModifiers({ decision }: { decision: MergeabilityDecision }) {
  const mods = decision.routingModifiers;
  if (!mods.hardGatesClear) {
    return (
      <p className="rounded-lg border border-border bg-surface-muted/30 p-3 text-[11px] text-ink-soft">
        Not applicable — a hard gate blocked this run before these facts were evaluated.
      </p>
    );
  }
  return (
    <ul className="space-y-1 rounded-lg border border-border bg-surface-muted/30 p-2.5 text-[11px] text-ink">
      <li>
        Citation review needed:{" "}
        <span className="font-mono">{mods.citationReviewNeeded ? "yes" : "no"}</span>
      </li>
      <li>
        Reproduction confidence:{" "}
        <span className="font-mono">{mods.reproductionConfidence ?? "—"}</span>
      </li>
      <li>
        Security meets auto-merge threshold:{" "}
        <span className="font-mono">
          {mods.securityMeetsAutoMergeThreshold === null
            ? "not measured"
            : mods.securityMeetsAutoMergeThreshold
              ? "yes"
              : "no"}
        </span>
      </li>
    </ul>
  );
}

// --------------------------------------------------------- progressive disclosure

function Details({ decision }: { decision: MergeabilityDecision }) {
  const [open, setOpen] = useState(false);
  const proof = decision.proofBundle;
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium text-ink"
      >
        PR &amp; proof-bundle detail
        <ChevronDown
          className={`h-3.5 w-3.5 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3 py-2 text-[11px] text-ink-soft">
          <div className="flex items-center gap-2">
            <GitPullRequest className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {decision.prUrl ? (
              <a
                href={decision.prUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate font-mono text-ink underline"
              >
                {decision.prUrl}
              </a>
            ) : (
              <span>Not published — no PR target configured, or publishing failed.</span>
            )}
          </div>
          <div>
            Phantom changes detected:{" "}
            <span className="font-mono text-ink">
              {decision.phantomChangesDetected ? "yes" : "no"}
            </span>
          </div>
          {decision.descriptionWhy && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-ink-soft">
                Description — why
              </span>
              <p className="mt-0.5 text-ink">{decision.descriptionWhy}</p>
            </div>
          )}
          {decision.descriptionWhat && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-ink-soft">
                Description — what
              </span>
              <p className="mt-0.5 text-ink">{decision.descriptionWhat}</p>
            </div>
          )}
          {proof && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-ink-soft">
                Proof bundle
              </span>
              <div className="mt-0.5 font-mono text-[10px] text-ink">{proof.bundleHash ?? "—"}</div>
              {proof.steps.length > 0 && (
                <ul className="mt-1.5 space-y-1.5">
                  {proof.steps.map((s) => (
                    <li
                      key={s.name}
                      className="rounded-md bg-surface-muted/50 p-2 font-mono text-[10px] text-ink"
                    >
                      <div className="text-ink-soft">{s.name}</div>
                      <div>{s.command}</div>
                      <div className="text-ink-soft">expects: {s.expectedResult}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- panel

export function MergeabilityDecisionPanel({
  runId,
  status,
}: {
  runId: string;
  status?: AgentStatus;
}) {
  const [decision, setDecision] = useState<MergeabilityDecision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMergeabilityDecision(runId)
      .then((d) => {
        if (!cancelled) setDecision(d);
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
          Mergeability Decision
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Mergeability decision loading…</p>
      </section>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (!decision) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Mergeability Decision
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "RUNNING — A10 is scoring and routing now; this panel renders once it publishes."
            : "Mergeability decision pending — A10 has not completed yet."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Mergeability Decision
        </h3>
        <p className="mt-0.5 text-[11px] text-ink-soft">
          A10 does not re-verify correctness or security — the axes below for those two are
          A8&apos;s and A9&apos;s own scores. A10 checks the PR description against the diff for
          phantom claims, computes fidelity and scope safety itself, and routes through the same ten
          hard gates shown below before deciding.
        </p>
      </div>

      <VerdictBand decision={decision} />

      <StatTile
        label="Trust (measured axes only)"
        value={decision.trust === null ? "—" : decision.trust.toFixed(2)}
        caption="Descriptive mean of the axes that were measured — not itself the routing gate. The decision comes from the per-axis thresholds and hard gates below."
      />

      <div>
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
          Axes
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {decision.axes.map((a) => (
            <AxisRow key={a.name} axis={a} />
          ))}
        </div>
      </div>

      <HardGates gates={decision.hardGates} />

      <div>
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
          Routing modifiers
        </div>
        <RoutingModifiers decision={decision} />
      </div>

      <Details decision={decision} />

      <p className="text-[10px] text-ink-soft">
        Explain: A10 reads A8&apos;s and A9&apos;s scores, verifies its own phantom check, and
        routes — it does not re-run tests or re-scan for vulnerabilities. Source:{" "}
        <code className="font-mono">GET /api/runs/{"{run_id}"}/decision</code>
      </p>
    </section>
  );
}
