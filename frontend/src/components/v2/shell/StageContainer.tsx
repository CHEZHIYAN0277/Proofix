/**
 * `<StageContainer>` — the CENTER column (blueprint §4).
 *
 * The active stage owns 70–80% of visual attention, so this is the only place
 * that may use accent color, `shadow-md` and motion (rule A1), and the only
 * place type rises above `body-sm` (rule A2).
 *
 * Three bands: completed stages collapse upward into history, the active stage
 * holds the middle, and future stages sit dimmed and non-interactive. Phase 1
 * fills the active panel with the six-part narrative; the seven stage
 * visualizations arrive in Phases 2–8 through `<StageView>`.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, Pin, PinOff } from "lucide-react";

import { Button } from "@/design/components/Button";
import { Card } from "@/design/components/Card";
import { StatusDot, StatusPill } from "@/design/primitives/StatusDot";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Reveal } from "@/design/primitives/Reveal";
import { Eyebrow } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import { ErrorState } from "@/design/states/ErrorState";
import { SkeletonCard } from "@/design/states/Skeleton";
import { cn } from "@/lib/utils";
import { statusLabel, toStatusState, type StageView } from "@/lib/v2/stages/machine";
import { AttemptSwitcher } from "../narrative/AttemptSwitcher";
import { StageNarrative } from "../narrative/StageNarrative";
import { StageViewSlot } from "../stages/StageViewSlot";
import { useActiveStage, useRunId, useTerminal } from "../RunProvider";
import { useStageViews } from "../useStageViews";
import { StageElapsed } from "./RunElapsed.stage";

export interface StageContainerProps {
  stageId: string;
  /** Follow the run: navigate as the active stage advances. */
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

export function StageContainer({ stageId, follow, onFollowChange }: StageContainerProps) {
  const runId = useRunId();
  const { stages, isLoading, error, refetch } = useStageViews();
  const activeStageId = useActiveStage();
  const [attempt, setAttempt] = useState(1);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on stage change. Scrolls the container, never the page, and
  // respects reduced motion through the browser's own setting.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [stageId]);

  const current = stages.find((s) => s.id === stageId) ?? null;
  const index = current ? stages.findIndex((s) => s.id === stageId) : -1;
  const history = index > 0 ? stages.slice(0, index) : [];
  const future = index >= 0 ? stages.slice(index + 1) : [];

  return (
    <div ref={scrollRef} className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      <div
        className="mx-auto flex w-full flex-col"
        style={{
          maxWidth: "var(--center-max-width)",
          padding: "var(--pad-stage-section)",
          gap: "var(--stage-rhythm)",
        }}
      >
        {isLoading && <SkeletonCard label="Loading stage" />}

        {error && (
          <ErrorState
            title="Could not load this stage"
            detail={error.message}
            source="GET /api/runs/{id}/stages?surface=v2"
            onRetry={refetch}
          />
        )}

        {!isLoading && !error && !current && (
          <EmptyState
            title="Stage not published"
            description={`The backend did not publish a stage called "${stageId}" for this run.`}
          />
        )}

        {history.length > 0 && <StageHistory stages={history} runId={runId} />}

        {current && (
          <ActiveStagePanel
            stage={current}
            isActive={current.id === activeStageId}
            attempt={attempt}
            onAttemptChange={setAttempt}
            follow={follow}
            onFollowChange={onFollowChange}
          />
        )}

        {current && <StageHandoff stage={current} next={future[0] ?? null} runId={runId} />}

        {future.length > 0 && <StageFuture stages={future} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Active stage
   ---------------------------------------------------------------------- */

function ActiveStagePanel({
  stage,
  isActive,
  attempt,
  onAttemptChange,
  follow,
  onFollowChange,
}: {
  stage: StageView;
  isActive: boolean;
  attempt: number;
  onAttemptChange: (n: number) => void;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}) {
  const Icon = stage.icon;
  const running = stage.status === "running" || stage.status === "retrying";

  return (
    <Reveal class="event" token="slow" from="up">
      <Card variant="active" status={isActive ? toStatusState(stage.status) : undefined}>
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow tone={isActive ? "accent" : "soft"} className="mb-1.5">
              Stage {stage.order}
            </Eyebrow>
            <div className="flex items-center gap-2.5">
              {Icon && <Icon aria-hidden className="size-6 shrink-0 text-ink" strokeWidth={1.5} />}
              {/* The one `title-1` on the screen (§3.1). */}
              <h1 className="type-title-1 min-w-0 truncate text-ink">{stage.label}</h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <StatusPill
                status={toStatusState(stage.status)}
                size="sm"
                pulse={isActive && running}
              >
                {statusLabel(stage.status)}
              </StatusPill>
              <StageElapsed stage={stage} />
              <span className="type-caption text-ink-soft">
                {stage.agents.length} agent{stage.agents.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={follow ? <Pin /> : <PinOff />}
              aria-label={follow ? "Stop following the run" : "Follow the run"}
              aria-pressed={follow}
              onClick={() => onFollowChange(!follow)}
            />
            <ExplainAffordance
              id={`stage.${stage.id}`}
              subject={stage.label}
              spec={{
                explain: stage.purpose,
                why: stage.agents
                  .filter((a) => a.status !== "waiting")
                  .map((a) => ({
                    signal: a.agentId,
                    value: statusLabel(a.status),
                    // Every agent in a stage contributes equally to whether it
                    // is done — this is a completion share, not a weight the
                    // backend published.
                    contribution: 1 / Math.max(1, stage.agents.length),
                    detail: a.message || a.purpose,
                    provenance: a.name,
                  })),
                confidence: stage.agents.find((a) => a.confidence !== null)?.confidence ?? null,
                source: [
                  {
                    label: "Stage projection",
                    endpoint: "GET /api/runs/{id}/stages?surface=v2",
                    fieldPath: `stages[id=${stage.id}]`,
                  },
                  {
                    label: "Live timeline",
                    endpoint: "WS /ws/runs/{id}",
                    fieldPath: "AgentStatusEvent",
                  },
                ],
              }}
            />
          </div>
        </header>

        <div className="mt-5 flex flex-col gap-5">
          <AttemptSwitcher
            agentIds={stage.agents.map((a) => a.agentId)}
            value={attempt}
            onChange={onAttemptChange}
          />
          <StageNarrative stage={stage} />
          <StageViewSlot stage={stage} />
        </div>
      </Card>
    </Reveal>
  );
}

/* -------------------------------------------------------------------------
   History, handoff, future
   ---------------------------------------------------------------------- */

function StageHistory({ stages, runId }: { stages: StageView[]; runId: string }) {
  return (
    <ul
      className="flex flex-col gap-1"
      // Collapsed history is off the paint path until it scrolls into view (§14).
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 44px" }}
    >
      {stages.map((stage) => (
        <li key={stage.id}>
          <Link
            to="/v2/runs/$runId/$stageId"
            params={{ runId, stageId: stage.id }}
            className="flex items-center gap-2.5 rounded-card border border-border bg-surface-muted px-4 py-2 transition-colors hover:bg-surface"
            style={{ transitionDuration: "var(--motion-instant)" }}
          >
            <StatusDot status={toStatusState(stage.status)} size="sm" pulse={false} />
            <span className="type-body-sm min-w-0 flex-1 truncate text-ink-soft">
              {stage.label}
            </span>
            {stage.status === "completed" && (
              <Check
                aria-hidden
                className="size-3.5 shrink-0 text-status-completed"
                strokeWidth={2}
              />
            )}
            <span className="type-caption shrink-0 text-ink-soft/70">
              {statusLabel(stage.status)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StageHandoff({
  stage,
  next,
  runId,
}: {
  stage: StageView;
  next: StageView | null;
  runId: string;
}) {
  const terminal = useTerminal();

  if (!next) {
    if (!terminal) return null;
    return (
      <div className="flex items-center gap-2 px-1">
        <span className="type-caption text-ink-soft">Run ended:</span>
        <span className="type-label text-ink">
          {terminal.decisionLabel ||
            (terminal.kind === "failed"
              ? "Failed"
              : terminal.kind === "blocked"
                ? "Environment not prepared"
                : "Completed")}
        </span>
        {terminal.reason && (
          <span className="type-caption min-w-0 truncate text-ink-soft">{terminal.reason}</span>
        )}
      </div>
    );
  }

  const settled = stage.status === "completed" || stage.status === "failed";

  return (
    <div className={cn("flex items-center gap-2 px-1", !settled && "opacity-60")}>
      <span className="type-caption text-ink-soft">Passes to</span>
      <Link
        to="/v2/runs/$runId/$stageId"
        params={{ runId, stageId: next.id }}
        className="type-label flex items-center gap-1 text-ink hover:text-primary"
      >
        {next.label}
        <ChevronRight aria-hidden className="size-3.5" strokeWidth={2} />
      </Link>
    </div>
  );
}

function StageFuture({ stages }: { stages: StageView[] }) {
  return (
    <ul className="flex flex-col gap-1" aria-label="Upcoming stages">
      {stages.map((stage) => (
        <li
          key={stage.id}
          aria-disabled
          className="flex items-center gap-2.5 rounded-card border border-dashed border-border px-4 py-2"
          style={{ opacity: 0.45 }}
        >
          <StatusDot status={toStatusState(stage.status)} size="sm" pulse={false} />
          <span className="type-body-sm min-w-0 flex-1 truncate text-ink-soft">{stage.label}</span>
          <span className="type-caption shrink-0 text-ink-soft/70">
            {statusLabel(stage.status)}
          </span>
        </li>
      ))}
    </ul>
  );
}
