/**
 * `<StageRail>` — LEFT column, 260px (blueprint §4).
 *
 * Peripheral by construction (rules A1–A4): no accent, no elevation, type
 * capped at `body-sm`, dimmed to 72% while a stage runs, and **the rail shows
 * state, not activity** — a running agent's dot pulses only inside the stage
 * that is actually active, so exactly one continuous animation exists on
 * screen.
 *
 * Stage membership, labels and order come from the backend. This component
 * chooses none of them.
 */

import { Link } from "@tanstack/react-router";

import { StatusDot } from "@/design/primitives/StatusDot";
import { EmptyState } from "@/design/states/EmptyState";
import { ErrorState } from "@/design/states/ErrorState";
import { SkeletonRows } from "@/design/states/Skeleton";
import { cn } from "@/lib/utils";
import { statusLabel, toStatusState, type StageView } from "@/lib/v2/stages/machine";
import { AgentRow } from "../agents/AgentRow";
import { useActiveStage, useRunId, useTerminal } from "../RunProvider";
import { useStageViews } from "../useStageViews";

export function StageRail({ currentStageId }: { currentStageId: string }) {
  const runId = useRunId();
  const { stages, isLoading, error, refetch } = useStageViews();
  const activeStageId = useActiveStage();
  const terminal = useTerminal();

  // Rule A3: peripheral chrome sits at ≤72% ink while a stage is running, and
  // returns to full contrast once the run is over and the story is told.
  const dimmed = terminal === null;

  return (
    <nav
      aria-label="Pipeline stages"
      className="flex h-full min-h-0 flex-col overflow-y-auto border-r border-border bg-background"
      style={{
        width: "var(--rail-width)",
        opacity: dimmed ? "var(--peripheral-opacity)" : 1,
        transition: "opacity var(--motion-slow) var(--ease-slow)",
      }}
    >
      <div className="px-4 py-3">
        {isLoading && <SkeletonRows rows={7} label="Loading pipeline stages" />}

        {error && (
          <ErrorState
            title="Could not load stages"
            detail={error.message}
            source="GET /api/runs/{id}/stages?surface=v2"
            onRetry={refetch}
            size="sm"
          />
        )}

        {!isLoading && !error && stages.length === 0 && (
          <EmptyState
            title="No stages published"
            description="The backend returned an empty stage registry for this run."
            size="sm"
          />
        )}

        <ul className="flex flex-col gap-1">
          {stages.map((stage) => (
            <StageGroup
              key={stage.id}
              stage={stage}
              runId={runId}
              isCurrent={stage.id === currentStageId}
              isActive={stage.id === activeStageId}
            />
          ))}
        </ul>
      </div>
    </nav>
  );
}

function StageGroup({
  stage,
  runId,
  isCurrent,
  isActive,
}: {
  stage: StageView;
  runId: string;
  isCurrent: boolean;
  isActive: boolean;
}) {
  const Icon = stage.icon;
  const running = stage.status === "running" || stage.status === "retrying";

  return (
    <li>
      <Link
        to="/v2/runs/$runId/$stageId"
        params={{ runId, stageId: stage.id }}
        className={cn(
          "flex items-center gap-2 rounded-card px-2 py-1.5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isCurrent ? "bg-surface-muted" : "hover:bg-surface-muted/60",
        )}
        style={{ transitionDuration: "var(--motion-instant)" }}
        aria-current={isCurrent ? "page" : undefined}
      >
        {/* The rail shows state, not activity — no pulse here even when the
            stage is running (rule A4). */}
        <StatusDot
          status={toStatusState(stage.status)}
          size="md"
          pulse={false}
          label={`${stage.label}: ${statusLabel(stage.status)}`}
        />
        {Icon && <Icon aria-hidden className="size-4 shrink-0 text-ink-soft" strokeWidth={1.75} />}
        <span
          className={cn(
            "type-body-sm min-w-0 flex-1 truncate",
            isCurrent ? "text-ink" : "text-ink-soft",
          )}
        >
          {stage.label}
        </span>
        {stage.status === "skipped" && (
          <span className="type-caption shrink-0 text-ink-soft/70">skipped</span>
        )}
      </Link>

      {stage.agents.length > 0 && (
        <ul className="ml-3 mt-0.5 flex flex-col border-l border-border pl-2">
          {stage.agents.map((agent) => (
            <li key={agent.agentId}>
              <AgentRow agent={agent} isActiveStage={isActive && running} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
