/**
 * Execution order — the sequence A6 published, revealed in that sequence.
 *
 * The stagger is the point: steps arrive in topological order, so the reveal
 * *is* the ordering, not decoration on top of it. It is a mount-time reveal
 * caused by the plan arriving, and `prefers-reduced-motion` collapses it to
 * zero in `<Reveal>` — the order still reads, it just stops moving.
 *
 * Two things this panel refuses to do:
 *
 *   - **Invent a planning confidence.** `FixDAGPlan` carries none. A6 is the
 *     one agent besides A4 whose output is a judgement about ordering, and it
 *     publishes no number for it, so the panel says exactly that.
 *   - **Re-sort into agreement.** When A6's LLM ordering contradicts A6's own
 *     dependency edges, the step is flagged. Silently sorting it would hide a
 *     real planning defect behind a tidy list.
 */

import { AlertTriangle, Layers } from "lucide-react";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Reveal } from "@/design/primitives/Reveal";
import { Eyebrow } from "@/design/primitives/atoms";
import { DataState } from "@/design/states/DataState";
import { EmptyState } from "@/design/states/EmptyState";
import { cn } from "@/lib/utils";
import type { RepairPlan } from "@/lib/v2/types";
import { conflictedSteps, planSteps, type PlanStep } from "./plan";

const NO_CONFIDENCE =
  "A6 publishes no planning confidence — FixDAGPlan carries nodes, order, edges and conflict batches only";

export function ExecutionOrderPanel({ plan }: { plan: RepairPlan | null }) {
  const steps = plan ? planSteps(plan) : [];
  const conflicted = plan ? conflictedSteps(plan) : new Set<string>();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Eyebrow>Sequence</Eyebrow>
        <ExplainAffordance
          id="planning.order"
          subject="Execution order"
          spec={{
            explain:
              "The order A6 sequenced the repair steps in. Ordering is topological over the dependency edges, unless an LLM ordering was accepted for this run — the plan does not record which of the two produced it.",
            why: [],
            confidence: null,
            source: [
              {
                label: "Repair plan",
                endpoint: "GET /api/runs/{run_id}/plan",
                fieldPath: "execution_order",
                agentId: "A6",
              },
            ],
          }}
        />
      </div>

      <DataBoundary
        value={steps.length > 0 ? steps : null}
        whenMissing="waiting"
        emptyIsMissing
        reason="A6 has sequenced no repair steps"
        fallback={
          plan ? (
            <EmptyState
              title="No repair steps"
              description="A6 completed and planned nothing — no static finding, CVE record or scoped file produced a fix node. This is a result, not a gap."
              size="sm"
            />
          ) : (
            <EmptyState
              title="No repair plan yet"
              description="A6 has not completed for this run, so there is no sequence to show."
              size="sm"
            />
          )
        }
      >
        {(ordered) => (
          <ol className="flex flex-col gap-2">
            {ordered.map((step, index) => (
              <Reveal key={step.issueId} class="event" token="base" index={index} as="li">
                <StepRow step={step} conflicted={conflicted.has(step.issueId)} />
              </Reveal>
            ))}
          </ol>
        )}
      </DataBoundary>

      <section>
        <Eyebrow className="mb-2">Planning confidence</Eyebrow>
        <DataState kind="unavailable" reason={NO_CONFIDENCE} size="sm" />
        <p className="type-caption mt-2 text-ink-soft">
          A4 publishes a confidence for its root cause; A6 publishes none for its ordering. The
          sequence above is stated, not scored.
        </p>
      </section>
    </div>
  );
}

function StepRow({ step, conflicted }: { step: PlanStep; conflicted: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-border bg-surface px-3 py-2">
      <span
        className={cn(
          "type-mono-sm tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
          step.position === null
            ? "border-dashed border-border text-ink-soft"
            : "border-border text-ink",
        )}
        aria-hidden
      >
        {step.position ?? "–"}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-mono-sm break-all text-ink">{step.issueId}</span>
          {step.position === null && (
            <DataState
              kind="unavailable"
              reason="A6 built this fix node but left it out of the execution order"
              label="Unscheduled"
              size="sm"
              variant="inline"
            />
          )}
          {conflicted && (
            <span className="type-caption inline-flex items-center gap-1 text-ink-soft">
              <Layers className="size-3" strokeWidth={2} aria-hidden />
              In a conflict batch
            </span>
          )}
        </div>

        <DataBoundary
          value={step.files.length > 0 ? step.files : null}
          whenMissing="unavailable"
          emptyIsMissing
          reason="A6 attached no file to this step"
          inline
          className="mt-1"
        >
          {(files) => (
            <p className="type-mono-sm mt-1 break-all text-ink-soft">{files.join("  ·  ")}</p>
          )}
        </DataBoundary>

        {step.dependsOn.length > 0 && (
          <p className="type-caption mt-1 text-ink-soft">After {step.dependsOn.join(", ")}</p>
        )}

        {step.unsatisfied.length > 0 && (
          <p className="type-caption mt-1 inline-flex items-start gap-1 text-status-retry">
            <AlertTriangle className="mt-px size-3 shrink-0" strokeWidth={2} aria-hidden />
            <span>
              Scheduled before {step.unsatisfied.join(", ")}, which A6&apos;s own dependency edges
              place first.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
