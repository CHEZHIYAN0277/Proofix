/**
 * `<WorkspaceHeader>` — persistent, 56px, glass, above all three columns
 * (blueprint §4.2).
 *
 * Four clusters: repository identity · run status · platform · posture.
 *
 * The blocked fields are the point of this component. LLM provider, estimated
 * cost and security posture depend on **G9** — `run_id` never reaches
 * `LLMGateway`, so `AuditEvent.run_id` is always `""` and every run-scoped
 * security query returns empty. Rather than hide them or invent them, they
 * render `Unavailable` with the reason. Visible, honest, and a standing
 * reminder of what is left to wire.
 */

import { useQuery } from "@tanstack/react-query";
import { GitBranch, GitCommitHorizontal, RefreshCw } from "lucide-react";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { StatusPill } from "@/design/primitives/StatusDot";
import { DataState } from "@/design/states/DataState";
import { glass } from "@/design/tokens/elevation";
import { cn } from "@/lib/utils";
import { orNull } from "@/lib/v2/absence";
import { runQuery } from "@/lib/v2/queries";
import {
  useActiveStage,
  useConnection,
  useFrameCount,
  useRunId,
  useTerminal,
} from "../RunProvider";
import { useStageViews } from "../useStageViews";
import { PlaybackControls, PlaybackNotice } from "./PlaybackControls";
import { RunElapsed } from "./RunElapsed";

/** Reasons a field is unavailable. Each names the gap, not just "no data". */
const REASONS = {
  g9: "run_id never reaches LLMGateway (G9) — audit events carry no run scope",
  g4Learning: "Learning is repository-scoped and not published on the run",
  noCommit: "The pipeline recorded no commit for this run",
} as const;

export function WorkspaceHeader() {
  const runId = useRunId();
  const { data, isLoading, error } = useQuery(runQuery(runId));
  const connection = useConnection();
  const terminal = useTerminal();
  const activeStageId = useActiveStage();
  const { stages } = useStageViews();

  const activeStage = stages.find((s) => s.id === activeStageId) ?? null;

  return (
    <header
      className={cn(
        glass("workspace-header"),
        "sticky top-0 z-30 flex items-center gap-6 border-x-0 border-t-0 rounded-none px-5",
      )}
      style={{ height: "var(--workspace-header-height)" }}
    >
      {/* --- Repository identity ---------------------------------------- */}
      <div className="flex min-w-0 shrink items-center gap-3">
        <DataBoundary
          value={data?.repository}
          whenMissing={isLoading ? "pending" : "waiting"}
          reason={error ? "Run header request failed" : undefined}
        >
          {(repository) => <span className="type-label truncate text-ink">{repository}</span>}
        </DataBoundary>

        <span className="flex min-w-0 items-center gap-1.5 text-ink-soft">
          <GitBranch aria-hidden className="size-3 shrink-0" strokeWidth={2} />
          <DataBoundary
            value={orNull(data?.branch)}
            whenMissing="unavailable"
            reason="The pipeline could not read a branch from .git/HEAD"
            inline
          >
            {(branch) => <span className="type-mono-sm truncate">{branch}</span>}
          </DataBoundary>
        </span>

        <span className="hidden min-w-0 items-center gap-1.5 text-ink-soft lg:flex">
          <GitCommitHorizontal aria-hidden className="size-3 shrink-0" strokeWidth={2} />
          <DataBoundary
            value={data?.headSha}
            whenMissing="unavailable"
            reason={REASONS.noCommit}
            inline
          >
            {(sha) => (
              <span className="type-mono-sm truncate" title={sha}>
                {sha.slice(0, 7)}
              </span>
            )}
          </DataBoundary>
        </span>
      </div>

      <div className="h-5 w-px shrink-0 bg-border" aria-hidden />

      {/* --- Run status -------------------------------------------------- */}
      <div className="flex min-w-0 shrink items-center gap-3">
        <RunStatusPill />

        <DataBoundary value={activeStage?.label} whenMissing="waiting" inline>
          {(label) => <span className="type-caption truncate text-ink-soft">{label}</span>}
        </DataBoundary>

        <RunElapsed />

        {data && data.retries > 0 && (
          <span
            className="type-caption flex shrink-0 items-center gap-1 text-status-retry"
            title={`${data.retries} repair ${data.retries === 1 ? "retry" : "retries"}`}
          >
            <RefreshCw aria-hidden className="size-3" strokeWidth={2} />
            <span className="tabular">{data.retries}</span>
          </span>
        )}
      </div>

      {/* Sits beside the elapsed time on purpose: that is where a slowed
          reveal could otherwise be mistaken for a slower pipeline. */}
      <PlaybackNotice />

      <div className="flex-1" />

      <PlaybackControls className="hidden shrink-0 lg:flex" />

      {/* --- Platform + posture ------------------------------------------ */}
      <div className="hidden shrink-0 items-center gap-3 xl:flex">
        <HeaderField label="Provider">
          <DataState kind="unavailable" reason={REASONS.g9} size="sm" label="G9" />
        </HeaderField>
        <HeaderField label="Cost">
          <DataState kind="unavailable" reason={REASONS.g9} size="sm" label="G9" />
        </HeaderField>
        <HeaderField label="Security">
          <DataState kind="unavailable" reason={REASONS.g9} size="sm" label="G9" />
        </HeaderField>
        <HeaderField label="Learning">
          <DataBoundary
            value={data?.repositoryId}
            whenMissing="unavailable"
            reason={REASONS.g4Learning}
            label="Repo scope"
          >
            {(repositoryId) => (
              <span className="type-mono-sm truncate text-ink-soft" title={repositoryId}>
                {repositoryId.slice(0, 12)}
              </span>
            )}
          </DataBoundary>
        </HeaderField>
      </div>

      <ConnectionIndicator state={connection} terminal={terminal !== null} />
    </header>
  );
}

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="type-caption text-ink-soft/70">{label}</span>
      {children}
    </div>
  );
}

/**
 * The run's status, not a roll-up of its stages.
 *
 * Deriving it from stage statuses made the pill read "Waiting" in the gap
 * between one stage finishing and the next emitting — every stage observed so
 * far was complete and none had started, which is true of the stages and false
 * of the run.
 *
 * So: the terminal frame decides when it has arrived; before that the run is
 * running from the moment anything has been observed. A run whose ending is
 * already known to REST but whose history is still draining stays "running" —
 * the viewer is still being told the story, and announcing the outcome early
 * would spoil an ending they have not reached.
 */
function RunStatusPill() {
  const terminal = useTerminal();
  const frameCount = useFrameCount();

  if (terminal) {
    // `blocked` gets the retry tint, not the failure tint: the pipeline did not
    // fail, it declined to continue against a repository it could not run.
    // Painting it red blamed the code for the environment.
    const status =
      terminal.kind === "failed"
        ? "failed"
        : terminal.kind === "blocked"
          ? "retry"
          : "completed";
    const fallback =
      terminal.kind === "failed"
        ? "Failed"
        : terminal.kind === "blocked"
          ? "Environment not prepared"
          : "Completed";
    return (
      <StatusPill status={status} size="sm">
        {terminal.decisionLabel || fallback}
      </StatusPill>
    );
  }

  if (frameCount === 0) return <StatusPill status="waiting" size="sm" />;
  return <StatusPill status="running" size="sm" pulse={false} />;
}

/**
 * Connection state is about the transport, never about the run. A closed
 * socket does not mean a finished run — it is reported as its own fact.
 */
function ConnectionIndicator({
  state,
  terminal,
}: {
  state: "idle" | "replaying" | "live" | "reconnecting" | "closed";
  terminal: boolean;
}) {
  // A closed socket on a finished run is the expected ending, not a problem.
  if (state === "live" || (state === "closed" && terminal)) return null;

  const label =
    state === "replaying"
      ? "Replaying history"
      : state === "reconnecting"
        ? "Reconnecting"
        : state === "closed"
          ? "Disconnected"
          : "Connecting";

  return (
    <span
      className="type-caption shrink-0 text-ink-soft"
      role="status"
      aria-live="polite"
      title={`Stream: ${label.toLowerCase()}`}
    >
      {label}
    </span>
  );
}
