/**
 * Patch Generation — the stage visualization (blueprint Phase 6).
 *
 * What A7 actually wrote, line by line, and what it is entitled to claim about
 * it.
 *
 * Everything on this stage comes from `GET /runs/{id}/patch`, which returns
 * `patch_bundle` exactly as A7 stored it — both sides of every file, the write
 * method, the contracts and A7's own unified diff. The agent projection
 * publishes an eight-line preview and two filenames, so the full patch reaches
 * the client through that route and nowhere else.
 *
 * Three states this view keeps distinct, because collapsing any two of them
 * would misreport the run:
 *
 *   **404** — A7 has not completed. Nothing was written *yet*.
 *   **200, `patches: []`** — A7 completed and admitted nothing: every plan it
 *     generated was rejected. Something was attempted and failed.
 *   **200 with patches** — the diff below is the change.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { SectionHeader } from "@/design/primitives/atoms";
import { Reveal } from "@/design/primitives/Reveal";
import { DataState } from "@/design/states/DataState";
import { ErrorState } from "@/design/states/ErrorState";
import { SkeletonText } from "@/design/states/Skeleton";
import { ApiError } from "@/lib/v2/endpoints";
import { patchQuery } from "@/lib/v2/queries";
import type { StageView } from "@/lib/v2/stages/machine";
import { useAgent, useRunId } from "../../RunProvider";
import { BundlePanel } from "./BundlePanel";
import { ContractsPanel } from "./ContractsPanel";
import { DiffPanel } from "./DiffPanel";
import { fileDiffs } from "./diff";

export default function PatchStageView({ stage }: { stage: StageView }) {
  const runId = useRunId();
  const { data, isLoading, isError, error, refetch } = useQuery(patchQuery(runId));

  // A7 stores the bundle once, at the end of its run, so while it is working
  // there is nothing to render but its own latest message. That message is the
  // frame — it is what paces this stage, and it is real.
  const a7 = useAgent(stage.id, "A7");

  const files = useMemo(() => (data ? fileDiffs(data) : []), [data]);

  if (isLoading) return <SkeletonText lines={6} label="Loading the generated patch" />;

  if (isError) {
    const status = error instanceof ApiError ? error.status : null;
    const endpoint = error instanceof ApiError ? error.endpoint : null;

    return (
      <ErrorState
        size="sm"
        title="The patch could not be loaded"
        detail={
          <span className="flex flex-col gap-1">
            <span>
              Patch Generator · A7 — {error instanceof Error ? error.message : String(error)}
            </span>
            <span>
              This is a failed request, not an absent patch. A 404 would have meant A7 had not
              completed, and would be shown as such.
            </span>
          </span>
        }
        source={endpoint ? `${status ?? ""} ${endpoint}`.trim() : undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data) {
    const working = a7?.status === "running" || a7?.status === "retrying";

    // The 404 is the whole message, so it is said in words. A bare `Waiting`
    // chip carries the reason only in its tooltip and accessible name, which
    // leaves a sighted reader looking at an empty stage with no statement of
    // why — the same gap the planning stage answers with a written sentence.
    return (
      <div className="flex flex-col gap-2">
        <DataState
          kind={working ? "pending" : "waiting"}
          reason={
            working
              ? "A7 is generating; the bundle is stored once it finishes"
              : "A7 has not completed for this run, so no patch bundle exists"
          }
          size="sm"
          className="self-start"
        />
        <p className="type-body-sm text-ink-soft">
          {working
            ? "A7 is generating. The bundle is stored in one write when it finishes, so the diff appears complete rather than growing line by line."
            : "A7 has not completed for this run, so there is no patch to show. This is the absence of a bundle, not a bundle containing no files — a run where every candidate was rejected reports that separately."}
        </p>
        {a7?.message && <p className="type-caption text-ink-soft">{a7.message}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: "var(--pad-stage-section)" }}>
      <Reveal class="event" token="base" index={0} as="section">
        <SectionHeader
          level="card"
          title="What was written"
          description="The files A7 admitted, the change size counted from its own diff, and the one integrity claim it stamped per file."
          className="mb-3"
        />
        <BundlePanel bundle={data} files={files} />
      </Reveal>

      <Reveal class="event" token="base" index={1} as="section">
        <SectionHeader
          level="card"
          title="Diff"
          description="A7's unified diff, parsed and highlighted — never re-diffed. This is the same text A10's mergeability check reads and the proof bundle records."
          className="mb-3"
        />
        <DiffPanel files={files} />
      </Reveal>

      <Reveal class="event" token="base" index={2} as="section">
        <SectionHeader
          level="card"
          title="Criteria and claims"
          description="What the repair had to satisfy, next to what the generator says it guarantees. The second is untested until the next stage."
          className="mb-3"
        />
        <ContractsPanel bundle={data} />
      </Reveal>
    </div>
  );
}
