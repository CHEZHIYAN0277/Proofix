/**
 * Behavioural contracts, and the acceptance criteria they were written against.
 *
 * Two lists that look alike and mean opposite things, so the panel keeps them
 * visibly apart:
 *
 *   **Acceptance criteria** (`ContextPackage.acceptance_criteria`, A5.5) are
 *   *requirements* — derived deterministically from the reproduction before any
 *   model was called. They are what the patch had to satisfy.
 *
 *   **Contracts** (`PatchBundle.contracts`, A7) are *claims* — the generating
 *   model's own statement about what its patch guarantees. Nothing at this
 *   stage has tested them; A8 is what does that, one stage later.
 *
 * Presenting a model's claim as a verified property is the specific mistake
 * this product exists to avoid, so the attribution is stated on the panel
 * rather than left to the reader.
 */

import { useQuery } from "@tanstack/react-query";
import { FileCheck2, Quote } from "lucide-react";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow } from "@/design/primitives/atoms";
import { SkeletonText } from "@/design/states/Skeleton";
import { contextQuery } from "@/lib/v2/queries";
import type { PatchBundle } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

export function ContractsPanel({ bundle }: { bundle: PatchBundle }) {
  const runId = useRunId();
  const { data: pkg, isLoading } = useQuery(contextQuery(runId));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Eyebrow>Acceptance criteria</Eyebrow>
          <ExplainAffordance
            id="patch.acceptance"
            subject="Acceptance criteria"
            spec={{
              explain:
                "What the patch had to achieve, derived by A5.5 from the reproduced failure before any model was called. A5.5 makes no LLM call, so these are requirements the run computed, not text a model wrote.",
              why: [],
              confidence: null,
              source: [
                {
                  label: "Context package",
                  endpoint: "GET /api/runs/{run_id}/context",
                  fieldPath: "acceptance_criteria",
                  agentId: "A5.5",
                },
              ],
            }}
          />
        </div>

        {isLoading ? (
          <SkeletonText lines={3} label="Loading the acceptance criteria" />
        ) : (
          <DataBoundary
            value={pkg?.acceptance_criteria ?? null}
            whenMissing={pkg ? "unavailable" : "waiting"}
            emptyIsMissing
            reason={
              pkg
                ? "A5.5 derived no acceptance criteria for this repair"
                : "A5.5 has not produced a context package for this run"
            }
          >
            {(criteria) => (
              <ul className="flex flex-col gap-2">
                {criteria.map((criterion, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-card border border-border bg-surface px-3 py-2"
                  >
                    <FileCheck2
                      className="mt-0.5 size-3.5 shrink-0 text-ink-soft"
                      strokeWidth={2}
                      aria-hidden
                    />
                    {/* Criteria quote pytest node ids — one unbroken token of
                        60+ characters. Without an explicit break they overrun
                        the card and the tail is simply lost. */}
                    <span className="type-body-sm min-w-0 break-words text-ink">{criterion}</span>
                  </li>
                ))}
              </ul>
            )}
          </DataBoundary>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Eyebrow>Contracts A7 recorded</Eyebrow>
          <ExplainAffordance
            id="patch.contracts"
            subject="Behavioural contracts"
            spec={{
              explain:
                "What the generating model stated its patch guarantees, recorded verbatim with the location it named. Untested at this stage — A8 runs the target test, the regression suite and mutation testing, and its result is where a contract is either supported or contradicted.",
              why: [],
              confidence: null,
              source: [
                {
                  label: "Patch bundle",
                  endpoint: "GET /api/runs/{run_id}/patch",
                  fieldPath: "contracts",
                  agentId: "A7",
                },
              ],
            }}
          />
        </div>

        <DataBoundary
          value={bundle.contracts.length > 0 ? bundle.contracts : null}
          whenMissing="unavailable"
          emptyIsMissing
          reason="A7 recorded no behavioural contract for this bundle"
        >
          {(contracts) => (
            <ul className="flex flex-col gap-2">
              {contracts.map((contract, i) => (
                <li key={i} className="rounded-card border border-border bg-surface px-3 py-2">
                  <div className="flex items-start gap-2">
                    <Quote
                      className="mt-0.5 size-3.5 shrink-0 text-ink-soft"
                      strokeWidth={2}
                      aria-hidden
                    />
                    <span className="type-body-sm min-w-0 break-words text-ink">
                      {contract.assertion}
                    </span>
                  </div>
                  <DataBoundary
                    value={contract.location}
                    whenMissing="unavailable"
                    reason="A7 recorded no location for this contract"
                    inline
                    className="mt-1"
                  >
                    {(location) => (
                      <p className="type-mono-sm mt-1 break-all text-ink-soft">{location}</p>
                    )}
                  </DataBoundary>
                </li>
              ))}
            </ul>
          )}
        </DataBoundary>

        <p className="type-caption mt-2 text-ink-soft">
          Claims, not results. Validation is the next stage.
        </p>
      </section>
    </div>
  );
}
