/**
 * The one place stage data is assembled.
 *
 * Joins the backend's stage projection (membership, labels, order, `skipped`)
 * with the live frame stream (freshness) via `buildStageViews`, and feeds the
 * store its topology so frames can be filed against the right stage.
 *
 * Every stage surface — rail, container, narrative, timeline, palette — reads
 * this. Two components deriving stage state by different routes is exactly how
 * a rail and a stage header end up disagreeing about what is running.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { stagesQuery } from "@/lib/v2/queries";
import { assertStageCoverage } from "@/lib/v2/stages/registry";
import { buildStageViews, type StageView } from "@/lib/v2/stages/machine";
import type { RunStoreSnapshot } from "@/lib/v2/stream/store";
import { useRunId, useRunSelector, useRunStore, useTerminal } from "./RunProvider";

const selectStages = (s: RunStoreSnapshot) => s.stages;

export interface StageViewsResult {
  stages: StageView[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useStageViews(): StageViewsResult {
  const runId = useRunId();
  const store = useRunStore();
  const terminal = useTerminal();
  const runtime = useRunSelector(selectStages);

  const query = useQuery(stagesQuery(runId));
  const published = query.data?.stages;

  // Teach the store which agents belong to which stage. `setTopology` is a
  // no-op when nothing changed, so this cannot loop.
  useEffect(() => {
    if (!published) return;
    assertStageCoverage(published);
    store.setTopology(published);
  }, [published, store]);

  const stages = useMemo(
    () => (published ? buildStageViews(published, runtime, terminal !== null) : []),
    [published, runtime, terminal],
  );

  return {
    stages,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: () => void query.refetch(),
  };
}

/** One stage by id, or `null` when the backend has not published it. */
export function useStageView(stageId: string): StageView | null {
  const { stages } = useStageViews();
  return useMemo(() => stages.find((s) => s.id === stageId) ?? null, [stages, stageId]);
}
