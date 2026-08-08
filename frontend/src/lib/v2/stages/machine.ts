/**
 * Stage reconciliation (blueprint §12).
 *
 * Two sources describe a stage and both are right about different things:
 *
 *   - `GET /runs/{id}/stages` is authoritative for **membership, ordering,
 *     labels and purpose**, and it is the only source that can say `skipped` —
 *     a stage the pipeline routed around emits no frames at all, so the stream
 *     cannot tell "skipped" from "not yet".
 *   - The frame stream is **fresher**: a frame lands before the invalidated
 *     refetch returns, so during a live run it leads the projection by a round
 *     trip.
 *
 * This module merges them under one rule, in one place, so no component has to
 * decide which to trust.
 */

import type { StageRuntimeState, StageRuntimeStatus } from "../stream/store";
import type { StageProgress, BackendStageStatus } from "../types";
import { orNull } from "../absence";
import { stageIcon } from "./registry";

export interface StageAgentView {
  agentId: string;
  /** Card id, e.g. `repo-intel`. */
  cardId: string;
  name: string;
  purpose: string;
  handoff: string;
  /** Reconciled status. `waiting` when nothing has reported. */
  status: StageRuntimeStatus;
  /** Latest message this agent emitted, or `""` when it has said nothing. */
  message: string;
  /** Backend-formatted duration, or `null` when it measured no span. */
  duration: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** `null` unless the agent actually published one (only A4 and A6 do). */
  confidence: number | null;
}

export interface StageView {
  id: string;
  label: string;
  order: number;
  purpose: string;
  status: StageRuntimeStatus;
  agents: StageAgentView[];
  startedAt: number | null;
  endedAt: number | null;
  icon: ReturnType<typeof stageIcon>;
}

/** Backend statuses map 1:1 except `retrying`, which the store spells the same. */
function fromBackend(status: BackendStageStatus): StageRuntimeStatus {
  return status;
}

function reconcileStatus(
  backend: BackendStageStatus,
  runtime: StageRuntimeState | undefined,
  runIsTerminal: boolean,
): StageRuntimeStatus {
  // Only the backend can observe that a stage was routed around.
  if (backend === "skipped") return "skipped";

  // Once the run has settled nothing is in flight; the backend has already
  // folded that in, and the stream's last frame may still say `running`.
  if (runIsTerminal) return fromBackend(backend);

  // Live: the stream leads by a round trip — but only where it has evidence.
  if (runtime && Object.keys(runtime.agents).length > 0) return runtime.status;

  return fromBackend(backend);
}

export function buildStageViews(
  stages: StageProgress[],
  runtime: Record<string, StageRuntimeState>,
  runIsTerminal: boolean,
): StageView[] {
  return [...stages]
    .sort((a, b) => a.order - b.order)
    .map((stage) => {
      const live = runtime[stage.id];

      const agents: StageAgentView[] = stage.agents.map((agent) => {
        const liveAgent = live?.agents[agent.agentId];

        // The backend reports `running` for an agent with no events on a live
        // run (`ui_projection.py:427`). The stream knows better: no frames
        // means it has not started.
        const status: StageRuntimeStatus = liveAgent
          ? liveAgent.status
          : agent.status === "skipped"
            ? "skipped"
            : runIsTerminal && agent.status !== "running"
              ? agent.status === "draft" || agent.status === "retry"
                ? "completed"
                : agent.status
              : "waiting";

        return {
          agentId: agent.agentId,
          cardId: agent.id,
          name: agent.name,
          purpose: agent.purpose,
          handoff: agent.handoff,
          status,
          message: liveAgent?.message ?? agent.message ?? "",
          duration: orNull(agent.duration),
          startedAt: liveAgent?.startedAt ?? null,
          endedAt: liveAgent?.endedAt ?? null,
          confidence: liveAgent?.confidence ?? null,
        };
      });

      const status = reconcileStatus(stage.status, live, runIsTerminal);
      const settled = status === "completed" || status === "failed";

      /**
       * The stream only stamps `endedAt` when every agent in the stage
       * reported. A stage containing a skipped agent — the security re-scan is
       * routed around whenever validation fails — therefore settles according
       * to the backend while the stream still has no ending for it.
       *
       * The last agent that actually finished *is* an observed end time, so it
       * stands in. Without this the header reads "Completed · Waiting", which
       * is technically true of the stream and useless to a reader.
       */
      const lastAgentEnd = agents.reduce<number | null>(
        (latest, agent) => (agent.endedAt === null ? latest : Math.max(latest ?? 0, agent.endedAt)),
        null,
      );

      return {
        id: stage.id,
        label: stage.label,
        order: stage.order,
        purpose: stage.purpose,
        status,
        agents,
        startedAt: live?.startedAt ?? null,
        endedAt: live?.endedAt ?? (settled ? lastAgentEnd : null),
        icon: stageIcon(stage.id),
      };
    });
}

/** Map a stage/agent status onto the design system's six-state language. */
export function toStatusState(
  status: StageRuntimeStatus,
): "waiting" | "running" | "retry" | "completed" | "failed" | "draft" {
  switch (status) {
    case "retrying":
      return "retry";
    case "skipped":
      // Skipped is not a failure and not a completion. It reads as the neutral
      // state, with the label carrying the distinction.
      return "waiting";
    default:
      return status;
  }
}

/** Human label, kept in one place so the rail and the narrative agree. */
export function statusLabel(status: StageRuntimeStatus): string {
  switch (status) {
    case "waiting":
      return "Waiting";
    case "running":
      return "Running";
    case "retrying":
      return "Retrying";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
  }
}
