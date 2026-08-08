/**
 * Repair Planning — the stage visualization (blueprint Phase 5).
 *
 * What A6 decided to fix, in what order, and where two fixes collide.
 *
 * Everything here comes from `GET /runs/{id}/plan`, which returns `fix_dag`
 * exactly as A6 stored it. The agent projection publishes only counts and a
 * six-node preview, so the full DAG — per-node files, per-edge reasons,
 * conflict batches — reaches the client through that route and nowhere else.
 *
 * The one query is read once here and passed down, so the three panels share a
 * single request and each states its own absence: a 404 is the fact "A6 has not
 * planned", and every panel says so in its own terms rather than blanking.
 */

import { useQuery } from "@tanstack/react-query";

import { SectionHeader } from "@/design/primitives/atoms";
import { Reveal } from "@/design/primitives/Reveal";
import { ErrorState } from "@/design/states/ErrorState";
import { SkeletonText } from "@/design/states/Skeleton";
import { ApiError } from "@/lib/v2/endpoints";
import { planQuery } from "@/lib/v2/queries";
import type { StageView } from "@/lib/v2/stages/machine";
import { useRunId } from "../../RunProvider";
import { ConflictBatchesPanel } from "./ConflictBatchesPanel";
import { DependencyGraphPanel } from "./DependencyGraphPanel";
import { ExecutionOrderPanel } from "./ExecutionOrderPanel";

export default function PlanningStageView({ stage }: { stage: StageView }) {
  void stage;

  const runId = useRunId();
  const { data, isLoading, isError, error, refetch } = useQuery(planQuery(runId));

  if (isLoading) return <SkeletonText lines={5} label="Loading the repair plan" />;

  if (isError) {
    const status = error instanceof ApiError ? error.status : null;
    const endpoint = error instanceof ApiError ? error.endpoint : null;

    return (
      <ErrorState
        size="sm"
        title="The repair plan could not be loaded"
        detail={
          <span className="flex flex-col gap-1">
            <span>
              Repair Planner · A6 — {error instanceof Error ? error.message : String(error)}
            </span>
            <span>
              This is a failed request, not an empty plan. A 404 would have meant A6 had not
              planned, and would be shown as such.
            </span>
          </span>
        }
        source={endpoint ? `${status ?? ""} ${endpoint}`.trim() : undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  const plan = data ?? null;

  return (
    <div className="flex flex-col" style={{ gap: "var(--pad-stage-section)" }}>
      <Reveal class="event" token="base" index={0} as="section">
        <SectionHeader
          level="card"
          title="Execution order"
          description="The repair sequence A6 published, revealed in that order. Where the order contradicts A6's own dependency edges, the step is flagged rather than re-sorted."
          className="mb-3"
        />
        <ExecutionOrderPanel plan={plan} />
      </Reveal>

      <Reveal class="event" token="base" index={1} as="section">
        <SectionHeader
          level="card"
          title="Dependencies"
          description="The DAG, and the reason A6 drew each edge. Steps that collide over a file are ringed; the table equivalent carries the same data."
          className="mb-3"
        />
        <DependencyGraphPanel plan={plan} />
      </Reveal>

      <Reveal class="event" token="base" index={2} as="section">
        <SectionHeader
          level="card"
          title="Conflict batches"
          description="Steps that edit the same file and therefore have to be applied together."
          className="mb-3"
        />
        <ConflictBatchesPanel plan={plan} />
      </Reveal>
    </div>
  );
}
