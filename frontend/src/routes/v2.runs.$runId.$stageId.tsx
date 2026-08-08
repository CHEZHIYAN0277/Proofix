/**
 * `/v2/runs/$runId/$stageId` — the stage holds the center (blueprint §11).
 *
 * Search params carried by the route rather than by component state, because
 * the URL is the truth for *what is on screen*. Live progress never enters it
 * (§12) — `follow` is a user intent, not a run fact.
 */

import { createFileRoute } from "@tanstack/react-router";

import { WorkspaceV2Root } from "@/components/v2/WorkspaceV2Root";
import { isStageId } from "@/lib/v2/stages/registry";

interface StageSearch {
  /** Track the active stage as the pipeline advances. */
  follow?: boolean;
  /** Mission Control panel, Why Panel target, attempt index — Phases 2+. */
  panel?: string;
  why?: string;
  attempt?: number;
}

export const Route = createFileRoute("/v2/runs/$runId/$stageId")({
  validateSearch: (search: Record<string, unknown>): StageSearch => ({
    follow:
      search.follow === undefined
        ? undefined
        : search.follow !== false && search.follow !== "false",
    panel: typeof search.panel === "string" ? search.panel : undefined,
    why: typeof search.why === "string" ? search.why : undefined,
    attempt: typeof search.attempt === "number" ? search.attempt : undefined,
  }),
  head: () => ({
    meta: [{ title: "ProoFix — Workspace" }, { name: "robots", content: "noindex" }],
  }),
  component: StageRoute,
});

function StageRoute() {
  const { runId, stageId } = Route.useParams();
  const { follow } = Route.useSearch();
  const navigate = Route.useNavigate();

  /**
   * Following is opt-in via the URL, not a default.
   *
   * `/v2/runs/{id}` sets `?follow=true` when it resolves the active stage —
   * "open this run and carry me along". A link to a *named* stage is a request
   * for that stage, so it stays there. Defaulting to true made every deep link
   * bounce to whatever was active, which made the rail, the timeline and the
   * palette all appear broken.
   */
  const following = follow ?? false;

  return (
    <WorkspaceV2Root
      runId={runId}
      // An unknown stage id still renders — the container reports that the
      // backend published no such stage, which is more useful than a 404.
      stageId={isStageId(stageId) ? stageId : stageId}
      follow={following}
      onFollowChange={(next) =>
        void navigate({ search: (prev) => ({ ...prev, follow: next }), replace: true })
      }
    />
  );
}
