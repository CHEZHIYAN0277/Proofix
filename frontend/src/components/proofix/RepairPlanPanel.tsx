/**
 * A6 — Repair Strategy Board.
 *
 * Everything on this panel comes from `GET /api/runs/{runId}/repair-plan`
 * (`services/ui_projection.py::build_repair_plan`, sourced from A6's own
 * `FixDAGPlan`, joined read-only against A3's findings, A2's CVE records and
 * A5.5's context package). No order, dependency, conflict or "why" is
 * computed client-side — the join happens once, on the backend.
 *
 * Deliberately **not** a node-link graph, for two reasons verified against
 * the actual pipeline rather than assumed:
 *
 * 1. `execution_order` is a list, and it is read as a list — `A7` consumes
 *    exactly one value from this plan, `execution_order[0]`, as a label, and
 *    derives its real patch targets from A5's blast scope and A4's root
 *    cause instead. Drawing this as a directed graph would visually assert an
 *    execution guarantee this run cannot back up. The `executionAuthority`
 *    banner below states this outright rather than letting the ordered list
 *    imply it.
 * 2. Every other full panel in this workspace (A1, A2, A3, A3.5, A4, A5) uses
 *    sectioned cards and tables, never a full-canvas graph — the small
 *    "DAG draws itself" animation in the agent timeline is decorative chrome,
 *    not a data explorer. This panel keeps that language: a numbered
 *    timeline for order, inline backreferences and a conflict callout for
 *    relationships, and a full ledger table underneath for anyone who wants
 *    to sort or filter.
 *
 * There is no confidence anywhere on this panel. Nothing in A6 computes one.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, Info } from "lucide-react";
import type { RepairPlan, RepairStep } from "./repairPlanTypes";
import { getRepairPlan } from "@/lib/runService";
import type { AgentStatus } from "./data";

function issueKind(issueId: string): "cve" | "finding" {
  return issueId.startsWith("cve-") ? "cve" : "finding";
}

function whyLine(step: RepairStep): string {
  const why = step.why;
  if (why === null) return "No matching A3 finding or A2 CVE record — reason not measured.";
  if (why.kind === "cve") {
    const severity = why.severity ?? "severity not measured";
    return `${why.package ?? "dependency"} (${severity})${
      why.installedVersion ? ` ${why.installedVersion}` : ""
    } — reachable via ${why.reachPath?.join(", ") ?? "an unrecorded path"}`;
  }
  const severity =
    why.severityMeasured && why.severity !== null
      ? why.severity.toFixed(2)
      : "severity not measured";
  const tools = why.tools.length ? ` (${why.tools.join(", ")})` : "";
  return `${why.message ?? "static finding"}${tools} — severity ${severity}`;
}

// ------------------------------------------------------------------ chrome

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load the repair plan</span>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
      {children}
    </div>
  );
}

// ------------------------------------------------------------ authority banner

/**
 * The disclaimer layer. The "Handed to A7" card above now carries the visual
 * answer (which step, which files, why) — this banner's only job is the
 * warning the card can't say on its own: the rest of this plan is A6's
 * analysis for review, not a guarantee of what executes.
 */
function ExecutionAuthorityBanner({ plan }: { plan: RepairPlan }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-status-retry/30 bg-status-retry-bg/30 px-3 py-2"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-retry" aria-hidden />
      <p className="text-[10px] leading-relaxed text-ink-soft">
        <span className="font-semibold text-ink">
          A6 proposes this order; it does not execute it.
        </span>{" "}
        {plan.executionAuthority.note}
      </p>
    </div>
  );
}

// -------------------------------------------------------------- handed to a7

/**
 * The visual answer to "what does A7 actually receive" — exactly the step
 * where `isHandoffTarget` is true (`execution_order[0]`, named once by the
 * backend). Not a repair strategy, not a planned code change: an issue id,
 * its files, A5.5's own target function when one exists, and why the step
 * exists — the same "why" the timeline below shows, restated here as the
 * first thing on screen rather than something the user has to scroll to find.
 */
function HandedToA7({ plan }: { plan: RepairPlan }) {
  const step = plan.steps.find((s) => s.isHandoffTarget);
  const targetFunction = plan.carriedForward?.targetFunction ?? null;

  if (!step) {
    return (
      <div
        role="group"
        aria-label="Handed to A7"
        className="rounded-xl border border-border bg-surface-muted/30 p-3"
      >
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          Handed to A7
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">
          Not available — A6 sequenced no steps for A7 to receive.
        </p>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Handed to A7"
      className="rounded-xl border border-status-completed/30 bg-status-completed-bg/20 p-3"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-status-completed">
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        Handed to A7
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink">
          {step.issueId}
        </span>
        {step.files.map((file) => (
          <span
            key={file}
            className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-soft"
          >
            {file}
          </span>
        ))}
      </div>
      {targetFunction && (
        <p className="mt-1.5 text-[10px] text-ink-soft">
          Target function — <span className="font-mono text-ink">{targetFunction}()</span>{" "}
          <span className="text-ink-soft/70">(A5.5 context, not A6's own analysis)</span>
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-ink">
        <span className="text-ink-soft">Why: </span>
        {whyLine(step)}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ timeline

function StepCard({ step }: { step: RepairStep }) {
  const kind = issueKind(step.issueId);
  return (
    <li className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${
            step.ordered
              ? "bg-status-completed-bg text-status-completed"
              : "bg-surface-muted text-ink-soft"
          }`}
        >
          {step.position}
        </span>
        <span className="mt-1 h-full w-px flex-1 bg-border" aria-hidden />
      </div>
      <div
        className={`min-w-0 flex-1 pb-3 ${
          step.isHandoffTarget
            ? "-mx-2 rounded-lg border border-status-completed/30 bg-status-completed-bg/10 px-2 pt-1.5"
            : ""
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[11px] font-semibold text-ink">{step.issueId}</span>
          <span className="text-[9px] uppercase tracking-wider text-ink-soft">
            {kind === "cve" ? "dependency" : "static finding"}
          </span>
          {step.isHandoffTarget && (
            <span className="flex items-center gap-1 rounded bg-status-completed-bg px-1 text-[9px] font-semibold uppercase tracking-wider text-status-completed">
              <ArrowRight className="h-2.5 w-2.5" aria-hidden />
              handed to A7
            </span>
          )}
          {!step.ordered && (
            <span className="rounded bg-status-retry-bg px-1 text-[9px] font-medium text-status-retry">
              not named in the model's order
            </span>
          )}
        </div>
        <p className="mt-0.5 font-mono text-[10px] text-ink-soft">{step.files.join(", ") || "—"}</p>
        <p className="mt-1 text-[11px] text-ink">{whyLine(step)}</p>
        {step.incomingEdges.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {step.incomingEdges.map((edge) => (
              <li key={`${edge.fromIssue}-${edge.reason}`} className="text-[10px] text-ink-soft">
                ← depends on <span className="font-mono text-ink">{edge.fromIssue}</span>
                {edge.reason ? ` (${edge.reason})` : ""}
              </li>
            ))}
          </ul>
        )}
        {step.conflictsWith.length > 0 && (
          <p className="mt-1 flex items-start gap-1 text-[10px] text-status-retry">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            shares a file with {step.conflictsWith.join(", ")} — cannot be applied independently
          </p>
        )}
      </div>
    </li>
  );
}

function PlannedOrder({ steps }: { steps: RepairStep[] }) {
  return (
    <div>
      <SectionLabel>Planned order</SectionLabel>
      {steps.length === 0 ? (
        <p className="text-[11px] text-ink-soft">
          No fixes planned — A6 found nothing to sequence.
        </p>
      ) : (
        <ol>
          {steps.map((s) => (
            <StepCard key={s.issueId} step={s} />
          ))}
        </ol>
      )}
    </div>
  );
}

// --------------------------------------------------------------- ordering basis

function OrderingBasis({ plan }: { plan: RepairPlan }) {
  const [open, setOpen] = useState(false);
  const hasRationale = plan.orderingRationale.trim().length > 0;

  return (
    <div
      role="group"
      aria-label="Ordering basis"
      className="rounded-lg border border-border bg-surface-muted/30 p-2.5"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-ink-soft">Ordering basis</span>
        <span className="font-mono font-semibold text-ink">
          {plan.orderingSource === "llm"
            ? "LLM-ordered"
            : plan.orderingSource === "deterministic"
              ? "deterministic topological sort"
              : "Not measured"}
        </span>
      </div>
      {hasRationale && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-1 flex items-center gap-1 text-[10px] font-medium text-ink-soft transition-colors hover:text-ink"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Model's rationale
          </button>
          {open && <p className="mt-1 text-[10px] text-ink-soft">{plan.orderingRationale}</p>}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- carried forward

function CarriedForward({ plan }: { plan: RepairPlan }) {
  if (plan.carriedForward === null) {
    return (
      <p className="text-[11px] text-ink-soft">
        Constraints carried forward from A5.5 — Not measured (A5.5 has not produced a context
        package for this run).
      </p>
    );
  }
  const { acceptanceCriteria, patchConstraints } = plan.carriedForward;
  if (acceptanceCriteria.length === 0 && patchConstraints.length === 0) {
    return (
      <p className="text-[11px] text-ink-soft">
        A5.5 produced no acceptance criteria or constraints.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {acceptanceCriteria.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-ink-soft">
            Acceptance criteria (A5.5)
          </div>
          <ul className="mt-0.5 list-disc pl-4">
            {acceptanceCriteria.map((c) => (
              <li key={c} className="text-[11px] text-ink">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {patchConstraints.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-ink-soft">
            Patch constraints (A5.5)
          </div>
          <ul className="mt-0.5 list-disc pl-4">
            {patchConstraints.map((c) => (
              <li key={c} className="text-[11px] text-ink">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ledger

function StepLedger({ steps }: { steps: RepairStep[] }) {
  return (
    <div>
      <SectionLabel>Full ledger ({steps.length})</SectionLabel>
      <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-[9px] uppercase tracking-wider text-ink-soft">
              <th className="px-2 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">Issue</th>
              <th className="px-2 py-1.5 font-medium">Files</th>
              <th className="px-2 py-1.5 font-medium">Depends on</th>
              <th className="px-2 py-1.5 font-medium">Conflicts</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.issueId} className="border-b border-border/60">
                <td className="px-2 py-1 font-mono text-ink-soft">{s.position}</td>
                <td className="px-2 py-1 font-mono text-ink">{s.issueId}</td>
                <td className="px-2 py-1 font-mono text-ink-soft">{s.files.join(", ") || "—"}</td>
                <td className="px-2 py-1 font-mono text-ink-soft">
                  {s.dependsOn.join(", ") || "—"}
                </td>
                <td className="px-2 py-1 text-status-retry">{s.conflictsWith.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- panel

export function RepairPlanPanel({ runId, status }: { runId: string; status?: AgentStatus }) {
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRepairPlan(runId)
      .then((p) => {
        if (!cancelled) setPlan(p);
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

  const conflictCount = useMemo(() => plan?.conflictBatches.length ?? 0, [plan]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Repair Plan
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Loading repair plan…</p>
      </section>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (!plan) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Repair Plan
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "RUNNING — A6 is sequencing the repair plan now; this panel renders once it publishes."
            : "Pending — A6 has not completed for this run yet."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
            Repair Plan
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-soft">
            What ProoFix proposes to change, in what order, and why — joined from A3&apos;s
            findings, A2&apos;s CVE records and A5.5&apos;s evidence.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider text-ink-soft">Plan</div>
          <div className="font-mono text-sm font-semibold text-ink">
            {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"} ·{" "}
            {plan.totalDependencyEdges} edge
            {plan.totalDependencyEdges === 1 ? "" : "s"}
            {conflictCount > 0
              ? ` · ${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`
              : ""}
          </div>
        </div>
      </div>

      <HandedToA7 plan={plan} />

      <ExecutionAuthorityBanner plan={plan} />

      <PlannedOrder steps={plan.steps} />

      <OrderingBasis plan={plan} />

      <div>
        <SectionLabel>Constraints carried forward</SectionLabel>
        <CarriedForward plan={plan} />
      </div>

      {plan.steps.length > 0 && <StepLedger steps={plan.steps} />}

      <p className="text-[10px] text-ink-soft">
        Explain: every step traces to a fix node A6 built from A3&apos;s ranked findings or
        A2&apos;s reachable CVEs; the dependency and conflict facts are A6&apos;s own analysis.
        Source: <code className="font-mono">GET /api/runs/{"{run_id}"}/repair-plan</code>
      </p>
    </section>
  );
}
