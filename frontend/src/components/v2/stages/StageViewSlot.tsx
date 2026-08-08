/**
 * `<StageViewSlot>` — where a stage's visualization mounts.
 *
 * One `React.lazy` per stage, so each stage view is its own route chunk and a
 * viewer downloads only the stages they open (§14: <180KB gzip per stage,
 * <250KB initial).
 *
 * A stage with no view yet says so plainly. A placeholder that looked like a
 * broken visualization would be worse than a sentence — the narrative above it
 * is real backend data, and the reader needs to know which is which.
 */

import { Suspense, lazy, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";

import { ErrorState } from "@/design/states/ErrorState";
import { LoadingState } from "@/design/states/LoadingState";
import { ApiError } from "@/lib/v2/endpoints";
import { agentsQuery } from "@/lib/v2/queries";
import type { StageView } from "@/lib/v2/stages/machine";
import { useRunId, useTerminal } from "../RunProvider";
import { EnvironmentBlockedPanel } from "./EnvironmentBlockedPanel";

type StageViewComponent = ComponentType<{ stage: StageView }>;

/**
 * Stage id → view. Populated one phase at a time; a stage absent from this map
 * renders the "not built yet" note rather than nothing at all.
 */
const STAGE_VIEWS: Record<string, () => Promise<{ default: StageViewComponent }>> = {
  repository: () => import("./repository/RepositoryStageView"),
  investigation: () => import("./investigation/InvestigationStageView"),
  context: () => import("./context/ContextStageView"),
  planning: () => import("./planning/PlanningStageView"),
  patch: () => import("./patch/PatchStageView"),
};

const LAZY: Record<string, StageViewComponent> = Object.fromEntries(
  Object.entries(STAGE_VIEWS).map(([id, loader]) => [id, lazy(loader)]),
);

export function StageViewSlot({ stage }: { stage: StageView }) {
  const View = LAZY[stage.id];
  const terminal = useTerminal();

  const blocked = terminal?.kind === "blocked";

  // A blocked run has no stage output past Repository Understanding —
  // reproduction and everything downstream never ran. Rendering those stages'
  // empty panels would show "0 files / 0 functions / 0 patches" seven times and
  // let the reader conclude the analysis found nothing, which is the opposite
  // of what happened.
  if (blocked && stage.id !== "repository") {
    return <EnvironmentBlockedPanel />;
  }

  // Repository Understanding is different: A1/A2/A3 read source and need no
  // installed dependencies, so their findings are real and worth showing. But
  // this is also the stage the viewer lands on, so the explanation goes *above*
  // that output rather than replacing it — otherwise the run looks like it
  // simply stopped for no stated reason.
  if (blocked && View) {
    return (
      <div className="flex flex-col gap-4">
        <EnvironmentBlockedPanel />
        <Suspense fallback={<LoadingState label={`Loading the ${stage.label} view`} />}>
          <View stage={stage} />
        </Suspense>
      </div>
    );
  }

  if (!View) {
    return (
      <div className="rounded-card border border-dashed border-border px-4 py-3">
        <p className="type-caption text-ink-soft">
          The <span className="text-ink">{stage.label}</span> visualization arrives in a later
          phase. Everything above is live backend data.
        </p>
      </div>
    );
  }

  return (
    <Suspense fallback={<LoadingState label={`Loading the ${stage.label} view`} />}>
      <AgentsUnavailableNotice stage={stage} />
      <View stage={stage} />
    </Suspense>
  );
}

/**
 * One notice when the agent projection itself fails.
 *
 * Eight panels across the stage views read `agentsQuery` and pick their own
 * agent out of the result. Giving each its own `<QueryBoundary>` would render
 * eight error boxes for one failed request — technically honest, practically
 * unreadable. So the shared query gets one surface here, above the panels that
 * depend on it, and each panel's own `Waiting`/`Pending` states stay meaningful
 * for the case they actually describe: the agent has not reported yet.
 *
 * A 404 is excluded: for the agent projection it means the run itself is not
 * found, which the route already handles at a higher level.
 */
function AgentsUnavailableNotice({ stage }: { stage: StageView }) {
  const runId = useRunId();
  const { isError, error, refetch } = useQuery(agentsQuery(runId));

  if (!isError) return null;
  if (error instanceof ApiError && error.isNotFound) return null;

  const status = error instanceof ApiError ? error.status : null;
  const endpoint = error instanceof ApiError ? error.endpoint : null;
  const unreachable = !(error instanceof ApiError);

  return (
    <ErrorState
      size="sm"
      className="mb-4"
      title="Agent results could not be loaded"
      detail={
        <span className="flex flex-col gap-1">
          <span>
            {stage.label} — {error instanceof Error ? error.message : String(error)}
          </span>
          <span>
            {unreachable
              ? "The backend did not respond. The panels below show what was already received; they refresh once it recovers."
              : "The panels below show only what had already been received."}
          </span>
        </span>
      }
      source={endpoint ? `${status ?? ""} ${endpoint}`.trim() : undefined}
      onRetry={() => void refetch()}
    />
  );
}
