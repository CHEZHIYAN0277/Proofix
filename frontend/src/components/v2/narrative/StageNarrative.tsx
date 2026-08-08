/**
 * `<StageNarrative>` — the six-part stage story (blueprint §6).
 *
 *   MISSION      what this stage is for
 *   INPUT        what it received, and from whom
 *   THINKING     what it is doing right now
 *   EVIDENCE     what it found, with citations
 *   OUTPUT       what it produced
 *   PASSED TO    who receives it next
 *
 * **One component, identical across all seven stages.** Consistency is what
 * turns thirteen agents into one engineer.
 *
 * Five of the six are backed by data that exists today: Mission and Passed To
 * come from `AGENT_REGISTRY`, Thinking from the live event message, Input from
 * the previous stage's handoff, Evidence from the agent projection. Any part
 * without data renders its `DataBoundary` state — a stage that produced no
 * evidence says so rather than showing an empty section.
 */

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { Reveal } from "@/design/primitives/Reveal";
import { Eyebrow } from "@/design/primitives/atoms";
import { orNull } from "@/lib/v2/absence";
import { agentsQuery, runQuery } from "@/lib/v2/queries";
import type { AgentEntry } from "@/lib/v2/types";
import type { StageView } from "@/lib/v2/stages/machine";
import { cn } from "@/lib/utils";
import { useRunId, useTerminal } from "../RunProvider";
import { useStageViews } from "../useStageViews";

export interface StageNarrativeProps {
  stage: StageView;
}

export function StageNarrative({ stage }: StageNarrativeProps) {
  const runId = useRunId();
  const terminal = useTerminal();
  const { stages } = useStageViews();
  const { data: agents } = useQuery(agentsQuery(runId));

  const previous = stages.find((s) => s.order === stage.order - 1) ?? null;
  const next = stages.find((s) => s.order === stage.order + 1) ?? null;

  const entriesForStage = (agents ?? []).filter((a) => a.stage === stage.id);

  const running = stage.status === "running" || stage.status === "retrying";

  /**
   * Thinking is the live message while work is in flight, and freezes to the
   * final message once the stage settles — a settled stage showing a live
   * verb reads as work that never ended.
   */
  const thinking = lastMessage(stage);

  return (
    <div className="flex flex-col gap-5">
      <Part label="Mission">
        <DataBoundary value={stage.purpose} whenMissing="waiting">
          {(purpose) => <p className="type-body text-ink">{purpose}</p>}
        </DataBoundary>
      </Part>

      <Part label="Input">
        {previous ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="type-body text-ink">{handoffOf(previous)}</span>
            <span className="type-caption text-ink-soft">from {previous.label}</span>
          </span>
        ) : (
          /* The first stage's input is the repository itself — a fact the run
             header publishes, not an absence to report as `Waiting`. */
          <FirstStageInput />
        )}
      </Part>

      <Part label="Thinking">
        <DataBoundary
          value={thinking}
          whenMissing={running ? "pending" : "waiting"}
          reason={
            running
              ? "The stage is running but has emitted no message yet"
              : "This stage has emitted no message"
          }
        >
          {(message) => (
            <Reveal class="event" token="base" from="up">
              <p className={cn("type-body", running ? "text-ink" : "text-ink-soft")}>{message}</p>
            </Reveal>
          )}
        </DataBoundary>
      </Part>

      <Part label="Evidence">
        <StageEvidence entries={entriesForStage} settled={terminal !== null} />
      </Part>

      <Part label="Output">
        <DataBoundary
          value={entriesForStage.length > 0 ? entriesForStage : null}
          whenMissing={running ? "pending" : "waiting"}
          emptyIsMissing
          reason="No agent in this stage has published an output"
        >
          {(entries) => (
            <ul className="flex flex-wrap gap-2">
              {entries.map((entry) => (
                <li
                  key={entry.agentId}
                  className="type-caption rounded-full border border-border bg-surface-muted px-2 py-1 text-ink-soft"
                >
                  {entry.handoff}
                </li>
              ))}
            </ul>
          )}
        </DataBoundary>
      </Part>

      <Part label="Passed to">
        <DataBoundary
          value={next}
          whenMissing="waiting"
          reason="This is the final stage — its output is the decision"
        >
          {(stageNext) => (
            <span className="flex items-center gap-2">
              <ArrowRight aria-hidden className="size-3.5 shrink-0 text-ink-soft" strokeWidth={2} />
              <span className="type-body text-ink">{stageNext.label}</span>
            </span>
          )}
        </DataBoundary>
      </Part>
    </div>
  );
}

/**
 * What the pipeline was handed to start with: the repository, at the branch
 * and commit the run actually recorded. Each part is wrapped separately, so a
 * run with no commit still states the repository rather than the whole line
 * collapsing to `Waiting`.
 */
function FirstStageInput() {
  const runId = useRunId();
  const { data } = useQuery(runQuery(runId));

  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <DataBoundary value={data?.repository} whenMissing="pending" inline>
        {(repository) => <span className="type-body text-ink">{repository}</span>}
      </DataBoundary>
      <DataBoundary
        value={orNull(data?.branch)}
        whenMissing="unavailable"
        reason="The pipeline could not read a branch from .git/HEAD"
        inline
      >
        {(branch) => <span className="type-mono-sm text-ink-soft">{branch}</span>}
      </DataBoundary>
      <DataBoundary
        value={data?.headSha}
        whenMissing="unavailable"
        reason="The pipeline recorded no commit for this run"
        inline
      >
        {(sha) => (
          <span className="type-mono-sm text-ink-soft" title={sha}>
            {sha.slice(0, 7)}
          </span>
        )}
      </DataBoundary>
    </span>
  );
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[104px_1fr] items-baseline gap-4">
      <Eyebrow className="pt-0.5">{label}</Eyebrow>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * Evidence from the agent projection: `_evidence_for(card, state)` publishes a
 * title, subtitle, fields and pills per agent. Rendered as-is — nothing is
 * summarised or inferred here.
 */
function StageEvidence({ entries, settled }: { entries: AgentEntry[]; settled: boolean }) {
  const withEvidence = entries.filter((e) => e.evidence && hasContent(e.evidence));

  return (
    <DataBoundary
      value={withEvidence.length > 0 ? withEvidence : null}
      whenMissing={settled ? "waiting" : "pending"}
      emptyIsMissing
      reason={
        settled ? "This stage published no evidence" : "Evidence appears as the stage produces it"
      }
    >
      {(items) => (
        <ul className="flex flex-col gap-3">
          {items.map((entry, index) => {
            const evidence = entry.evidence!;
            return (
              <Reveal key={entry.agentId} class="event" token="base" index={index} as="li">
                <div className="rounded-card border border-border bg-surface p-3">
                  {evidence.title && <p className="type-label text-ink">{evidence.title}</p>}
                  {evidence.subtitle && (
                    <p className="type-caption mt-0.5 text-ink-soft">{evidence.subtitle}</p>
                  )}

                  {evidence.fields && evidence.fields.length > 0 && (
                    <dl className="mt-2 flex flex-col gap-1">
                      {evidence.fields.map((field, i) => (
                        <div key={i} className="flex items-baseline justify-between gap-4">
                          <dt className="type-caption shrink-0 text-ink-soft">{field.label}</dt>
                          <dd className="type-mono-sm min-w-0 truncate text-right text-ink">
                            {field.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {evidence.pills && evidence.pills.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {evidence.pills.map((pill, i) => (
                        <li
                          key={i}
                          className="type-mono-sm rounded-full bg-surface-muted px-2 py-0.5 text-ink-soft"
                        >
                          {pill}
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="type-caption mt-2 text-ink-soft/70">
                    {entry.agent} · {entry.agentId}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </ul>
      )}
    </DataBoundary>
  );
}

function hasContent(evidence: AgentEntry["evidence"]): boolean {
  if (!evidence) return false;
  return Boolean(
    evidence.title ||
    evidence.subtitle ||
    (evidence.fields && evidence.fields.length > 0) ||
    (evidence.pills && evidence.pills.length > 0),
  );
}

/** The last thing any agent in this stage said. */
function lastMessage(stage: StageView): string | null {
  for (let i = stage.agents.length - 1; i >= 0; i -= 1) {
    const message = stage.agents[i].message;
    if (message) return message;
  }
  return null;
}

/** What the previous stage handed over — its last agent's handoff label. */
function handoffOf(stage: StageView): string {
  const last = stage.agents[stage.agents.length - 1];
  return last?.handoff ?? stage.label;
}
