/**
 * `<AgentRow>` and `<AgentIdentityCard>` (blueprint §5).
 *
 * The target: a user glances at a row and knows *what this AI is doing right
 * now*. Icon and mark come from `agent_id` — never the display name, which is
 * V1's F4 bug — and everything else is either a backend fact or an honest
 * absence.
 *
 * Presentation is uniform; **content degrades honestly per agent.** Only A4 and
 * A6 publish a confidence, so every other agent says "Not published" rather
 * than receiving a synthesized number. Token usage, cost and memory are
 * G9/G10: the backend has no such metric, so the card says so.
 */

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusDot } from "@/design/primitives/StatusDot";
import { DataState } from "@/design/states/DataState";
import { AgentAvatar } from "@/design/identity/AgentAvatar";
import { agentIcon } from "@/design/identity/icons";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { Eyebrow, KeyValue } from "@/design/primitives/atoms";
import { cn } from "@/lib/utils";
import { statusLabel, toStatusState, type StageAgentView } from "@/lib/v2/stages/machine";

const G9 = "Per-agent tokens and cost are not attributed (G9)";
const G10 = "No memory-usage metric exists in the backend (G10)";

export interface AgentRowProps {
  agent: StageAgentView;
  /** Rule A4 — only the active stage's running agent may pulse. */
  isActiveStage?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

export function AgentRow({
  agent,
  isActiveStage = false,
  selected = false,
  onSelect,
}: AgentRowProps) {
  const Icon = agentIcon(agent.agentId);
  const status = toStatusState(agent.status);
  const running = agent.status === "running" || agent.status === "retrying";

  return (
    <HoverCard openDelay={220} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className={cn(
            "flex w-full items-center gap-2 rounded-card px-2 py-1.5 text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected ? "bg-surface-muted" : "hover:bg-surface-muted/60",
          )}
          style={{
            transitionDuration: "var(--motion-instant)",
            opacity: agent.status === "skipped" ? 0.55 : undefined,
          }}
        >
          <StatusDot
            status={status}
            size="sm"
            pulse={isActiveStage && running}
            label={`${agent.name}: ${statusLabel(agent.status)}`}
          />
          <Icon aria-hidden className="size-3.5 shrink-0 text-ink-soft" strokeWidth={1.75} />
          {/* Rule A2: peripheral type caps at body-sm. */}
          <span className="type-body-sm min-w-0 flex-1 truncate text-ink">{agent.name}</span>
          <span className="type-mono-sm shrink-0 text-ink-soft/70">{agent.duration ?? ""}</span>
        </button>
      </HoverCardTrigger>

      <HoverCardContent side="right" align="start" className="w-80 rounded-panel p-4">
        <AgentIdentityCard agent={agent} />
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * The full identity set. Reached by hovering or expanding a row — the same
 * fields for every agent, whether or not the backend published them.
 */
export function AgentIdentityCard({ agent }: { agent: StageAgentView }) {
  const Icon = agentIcon(agent.agentId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <AgentAvatar agentId={agent.agentId} name={agent.name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon aria-hidden className="size-3.5 shrink-0 text-ink-soft" strokeWidth={1.75} />
            <span className="type-title-3 truncate text-ink">{agent.name}</span>
          </div>
          <span className="type-mono-sm text-ink-soft">{agent.agentId}</span>
        </div>
        <StatusDot status={toStatusState(agent.status)} size="md" />
      </div>

      <div>
        <Eyebrow className="mb-1">Mission</Eyebrow>
        <p className="type-body-sm text-ink-soft">{agent.purpose}</p>
      </div>

      <div>
        <Eyebrow className="mb-1">Current task</Eyebrow>
        <DataBoundary
          value={agent.message}
          whenMissing="waiting"
          reason="This agent has emitted no message yet"
          inline
        >
          {(message) => <p className="type-body-sm text-ink">{message}</p>}
        </DataBoundary>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <KeyValue label="Status" value={statusLabel(agent.status)} />
        <KeyValue
          label="Elapsed"
          value={agent.duration}
          reason="The backend measured no span for this agent"
        />
        <KeyValue label="Hands off" value={agent.handoff} />

        {/* Confidence: published by A4 and A6 only. Fabricating one per agent
            is exactly the failure this product exists to prevent. */}
        <div className="flex items-baseline justify-between gap-4">
          <span className="type-label shrink-0 text-ink-soft">Confidence</span>
          <DataBoundary
            value={agent.confidence}
            whenMissing="unavailable"
            reason="This agent publishes no confidence"
            label="Not published"
            inline
          >
            {(confidence) => (
              <span className="type-mono text-ink">{Math.round(confidence * 100)}%</span>
            )}
          </DataBoundary>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <span className="type-label shrink-0 text-ink-soft">Tokens · cost</span>
          <DataState kind="unavailable" reason={G9} size="sm" label="G9" variant="inline" />
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <span className="type-label shrink-0 text-ink-soft">Memory</span>
          <DataState kind="unavailable" reason={G10} size="sm" label="G10" variant="inline" />
        </div>
      </div>
    </div>
  );
}
