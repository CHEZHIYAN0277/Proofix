/**
 * Conflict batches — steps that edit the same file.
 *
 * A6 groups steps whose file sets overlap: applying them independently would
 * have two patches racing over one file. The batch is the unit that has to be
 * generated and validated together.
 *
 * Zero batches is a *result*, and it is stated as one. The empty state here is
 * the difference between "A6 checked and found no collision" and "A6 never
 * ran", which is why the panel takes the plan rather than a batch list — a
 * `null` plan cannot claim the first.
 */

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import type { RepairPlan } from "@/lib/v2/types";
import { planSteps } from "./plan";

export function ConflictBatchesPanel({ plan }: { plan: RepairPlan | null }) {
  const batches = plan?.conflict_batches ?? [];
  const filesFor = new Map((plan ? planSteps(plan) : []).map((step) => [step.issueId, step.files]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Eyebrow>Batches</Eyebrow>
        <ExplainAffordance
          id="planning.conflicts"
          subject="Conflict batches"
          spec={{
            explain:
              "Steps whose file sets overlap. A6 groups them so two patches never race over the same file; every step in a batch has to be generated and validated as one unit.",
            why: [],
            confidence: null,
            source: [
              {
                label: "Repair plan",
                endpoint: "GET /api/runs/{run_id}/plan",
                fieldPath: "conflict_batches",
                agentId: "A6",
              },
            ],
          }}
        />
      </div>

      <DataBoundary
        value={batches.length > 0 ? batches : null}
        whenMissing="waiting"
        emptyIsMissing
        reason="A6 grouped no steps into conflict batches"
        fallback={
          plan ? (
            <EmptyState
              title="No conflicting steps"
              description="No two steps in this plan edit the same file, so each can be applied on its own. This is a result, not a gap."
              size="sm"
            />
          ) : (
            <EmptyState
              title="No repair plan yet"
              description="A6 has not completed for this run, so nothing has been checked for conflicts."
              size="sm"
            />
          )
        }
      >
        {(groups) => (
          <ul className="flex flex-col gap-2">
            {groups.map((batch, index) => (
              <li
                key={batch.join("|") || index}
                className="rounded-card border border-border bg-surface px-3 py-2"
              >
                <p className="type-caption mb-1 text-ink-soft">
                  Batch {index + 1} · {batch.length} steps
                </p>
                <ul className="flex flex-col gap-1">
                  {batch.map((issueId) => {
                    const files = filesFor.get(issueId) ?? [];
                    return (
                      <li key={issueId} className="min-w-0">
                        <span className="type-mono-sm break-all text-ink">{issueId}</span>
                        {files.length > 0 && (
                          <span className="type-mono-sm ml-2 break-all text-ink-soft">
                            {files.join("  ·  ")}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </DataBoundary>
    </div>
  );
}
