/**
 * Stage registry — **presentation only**.
 *
 * `backend/services/ui_projection.py` states it outright: "Published so no
 * client hardcodes stage membership, ordering or labels; the registry is the
 * single source of truth for all three." So this file carries no label, no
 * order, no purpose and no agent list — those arrive from
 * `GET /api/runs/{id}/stages?surface=v2`.
 *
 * What it does carry is what the backend has no opinion about: the route slug
 * (needed to type the router before any data loads) and the icon.
 *
 * `assertStageCoverage` closes the loop — if the backend ever adds a stage this
 * file has not learned, the gallery-style dev warning fires rather than the UI
 * silently dropping it.
 */

import {
  Boxes,
  FileSearch,
  GitPullRequest,
  Layers,
  Sparkles,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { StageProgress } from "../types";

/**
 * The routable stage ids (blueprint §11). This union exists so the router can
 * validate `$stageId` before any request resolves; it mirrors the backend
 * `STAGE_REGISTRY` ids and is checked against the live payload at runtime.
 */
export const STAGE_IDS = [
  "repository",
  "investigation",
  "context",
  "planning",
  "patch",
  "validation",
  "learning",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export function isStageId(value: string): value is StageId {
  return (STAGE_IDS as readonly string[]).includes(value);
}

/** Icon per stage. Presentation only — no label, order or membership here. */
export const STAGE_ICONS: Record<StageId, LucideIcon> = {
  repository: Boxes,
  investigation: FileSearch,
  context: Layers,
  planning: Waypoints,
  patch: Wrench,
  validation: GitPullRequest,
  learning: Sparkles,
};

export function stageIcon(stageId: string): LucideIcon | null {
  return isStageId(stageId) ? STAGE_ICONS[stageId] : null;
}

/**
 * Warn (in development) when the backend publishes a stage this client has no
 * icon or route for. The stage still renders — it just falls back to a neutral
 * presentation, which beats disappearing.
 */
export function assertStageCoverage(stages: StageProgress[]): void {
  if (!import.meta.env.DEV) return;

  const unknown = stages.map((s) => s.id).filter((id) => !isStageId(id));
  if (unknown.length > 0) {
    console.warn(
      `[v2/stages] Backend published stages this client has no route or icon for: ` +
        `${unknown.join(", ")}. Add them to STAGE_IDS and STAGE_ICONS.`,
      { published: stages.map((s) => s.id), known: STAGE_IDS },
    );
  }
}

/**
 * The stage a run should open on: the running one, else the last that reached a
 * terminal state, else the first. Derived from the backend's own status field
 * rather than from a client guess about pipeline order.
 */
export function resolveActiveStage(stages: StageProgress[]): StageId | null {
  if (stages.length === 0) return null;

  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const running = ordered.find((s) => s.status === "running" || s.status === "retrying");
  if (running && isStageId(running.id)) return running.id;

  const settled = [...ordered]
    .reverse()
    .find((s) => s.status === "completed" || s.status === "failed");
  if (settled && isStageId(settled.id)) return settled.id;

  const first = ordered.find((s) => isStageId(s.id));
  return first ? (first.id as StageId) : null;
}
