/**
 * Investigation — the stage visualization (blueprint Phase 3).
 *
 * Reproduction, root cause, blast radius, and the call graph with the files
 * this run actually implicated ringed in accent.
 *
 * "Implicated" is derived from two published facts and nothing else: the files
 * A4 cited, and the files A5 placed in scope. A node is highlighted because the
 * run named it — never because it looked interesting.
 *
 * The graph is loaded lazily inside the already-lazy stage view, so React Flow
 * reaches only a reader who opens Investigation.
 */

import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useMemo, useState } from "react";

import { SectionHeader } from "@/design/primitives/atoms";
import { Reveal } from "@/design/primitives/Reveal";
import { LoadingState } from "@/design/states/LoadingState";
import { agentsQuery, kgViewQuery } from "@/lib/v2/queries";
import type { AgentEntry, GraphNode } from "@/lib/v2/types";
import type { StageView } from "@/lib/v2/stages/machine";
import { useRunId } from "../../RunProvider";
import { NodeInspector } from "./NodeInspector";
import { BlastRadiusPanel } from "./BlastRadiusPanel";
import { ReproductionPanel } from "./ReproductionPanel";
import { RootCausePanel } from "./RootCausePanel";

const GraphCanvas = lazy(() => import("../../graph/GraphCanvas"));

const MAX_NODES = 300;

export default function InvestigationStageView({ stage }: { stage: StageView }) {
  void stage;

  const runId = useRunId();
  const graph = useQuery(kgViewQuery(runId, "call", MAX_NODES));
  const agents = useQuery(agentsQuery(runId));

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  /**
   * Files this run implicated: A4's citation targets and A5's reachable set.
   * Both are read from the published payloads; nothing is inferred.
   */
  const implicatedFiles = useMemo(() => {
    const files = new Set<string>();
    for (const entry of (agents.data ?? []) as AgentEntry[]) {
      const data = (entry.visualization as { data?: unknown } | undefined)?.data as
        { lines?: { code: string }[]; modules?: { name: string }[] } | undefined;
      if (!data) continue;
      for (const line of data.lines ?? []) files.add(line.code.split(":")[0]);
      for (const module of data.modules ?? []) files.add(module.name);
    }
    return files;
  }, [agents.data]);

  /** Graph node ids whose file is implicated. */
  const implicated = useMemo(() => {
    const ids = new Set<string>();
    for (const node of graph.data?.nodes ?? []) {
      if (node.file && implicatedFiles.has(node.file)) ids.add(node.id);
    }
    return ids;
  }, [graph.data, implicatedFiles]);

  const focusFile = selectedNode?.file ?? selectedFile;

  return (
    <div className="flex flex-col" style={{ gap: "var(--pad-stage-section)" }}>
      <Reveal class="event" token="base" index={0} as="section">
        <SectionHeader level="card" title="Runtime reproduction" className="mb-3" />
        <ReproductionPanel />
      </Reveal>

      <Reveal class="event" token="base" index={1} as="section">
        <SectionHeader level="card" title="Root cause" className="mb-3" />
        <RootCausePanel onSelectFile={setSelectedFile} />
      </Reveal>

      <Reveal class="event" token="base" index={2} as="section">
        <SectionHeader
          level="card"
          title="Call graph"
          description="Nodes the run implicated are ringed. Hover to isolate a neighbourhood; the table equivalent carries the same data."
          className="mb-3"
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
          <Suspense fallback={<LoadingState label="Loading the call graph" />}>
            <GraphCanvas
              title="Call graph"
              graph={graph.data}
              implicated={implicated}
              onSelect={setSelectedNode}
              height={420}
              emptyTitle="No call graph"
              emptyDescription="The call export returned no nodes for this run."
            />
          </Suspense>
          <NodeInspector node={selectedNode} file={focusFile} />
        </div>
      </Reveal>

      <Reveal class="event" token="base" index={3} as="section">
        <SectionHeader level="card" title="Blast radius" className="mb-3" />
        <BlastRadiusPanel onSelectFile={setSelectedFile} />
      </Reveal>
    </div>
  );
}
