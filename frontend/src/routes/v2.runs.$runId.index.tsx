/**
 * `/v2/runs/$runId` — resolves the active stage and redirects (blueprint §11).
 *
 * The stage is chosen from the backend's own stage statuses, never from a
 * client guess about pipeline order: the running stage, else the last one that
 * settled, else the first published.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { LoadingState } from "@/design/states/LoadingState";
import { ErrorState } from "@/design/states/ErrorState";
import { stagesQuery } from "@/lib/v2/queries";
import { resolveActiveStage } from "@/lib/v2/stages/registry";

export const Route = createFileRoute("/v2/runs/$runId/")({
  head: () => ({
    meta: [{ title: "ProoFix — Workspace" }, { name: "robots", content: "noindex" }],
  }),
  component: RunIndexRoute,
});

function RunIndexRoute() {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery(stagesQuery(runId));

  const target = data ? resolveActiveStage(data.stages) : null;

  useEffect(() => {
    if (!target) return;
    void navigate({
      to: "/v2/runs/$runId/$stageId",
      params: { runId, stageId: target },
      // Opening the run means "take me along as it progresses". Landing on a
      // named stage directly does not.
      search: { follow: true },
      replace: true,
    });
  }, [target, navigate, runId]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {isLoading && <LoadingState label="Resolving the active stage" />}

      {error && (
        <ErrorState
          title="Could not open this run"
          detail={(error as Error).message}
          source="GET /api/runs/{id}/stages?surface=v2"
          onRetry={() => void refetch()}
        />
      )}

      {!isLoading && !error && !target && (
        <ErrorState
          title="This run published no stages"
          detail="The stage registry came back empty, so there is nothing to open."
          source="GET /api/runs/{id}/stages?surface=v2"
          onRetry={() => void refetch()}
        />
      )}
    </div>
  );
}
