/**
 * Context Engineering — the flagship stage (blueprint Phase 4).
 *
 * How an entire repository becomes the few hundred tokens a repair needs, and
 * why each of those tokens earned its place.
 *
 * Everything on this stage comes from `GET /runs/{id}/context`, which returns
 * exactly what A5.5 stored. A 404 there is a fact — the stage has not produced
 * a package — so every panel renders `Pending` rather than substituting a
 * value. That matters more here than anywhere else in the product: this is the
 * stage whose entire claim is that the context was *chosen*, deterministically
 * and for stated reasons.
 */

import { useQuery } from "@tanstack/react-query";

import { SectionHeader } from "@/design/primitives/atoms";
import { Reveal } from "@/design/primitives/Reveal";
import { ErrorState } from "@/design/states/ErrorState";
import { ApiError } from "@/lib/v2/endpoints";
import { contextQuery } from "@/lib/v2/queries";
import type { StageView } from "@/lib/v2/stages/machine";
import { useRunId } from "../../RunProvider";
import { ContextFunnel } from "./ContextFunnel";
import { PackagePanel } from "./PackagePanel";
import { PrivacyPanel } from "./PrivacyPanel";
import { RankingExplorer } from "./RankingExplorer";

const SECTIONS = [
  {
    id: "funnel",
    title: "Reduction funnel",
    description:
      "Repository → Knowledge Graph → Ranking → Privacy → Firewall → Package → LLM. Every band reads one published field; a band with no field stays flat and says Pending.",
    render: () => <ContextFunnel />,
  },
  {
    id: "ranking",
    title: "Ranking",
    description:
      "A5.5 makes no LLM call. Every score is a weighted sum of named signals, and each weight is published.",
    render: () => <RankingExplorer />,
  },
  {
    id: "privacy",
    title: "Privacy",
    description:
      "The guard's verdict, and every value it masked before the context left the process.",
    render: () => <PrivacyPanel />,
  },
  {
    id: "package",
    title: "Assembled package",
    description: "Token reduction as A5.5 measured it, and what the model will be told.",
    render: () => <PackagePanel />,
  },
] as const;

export default function ContextStageView({ stage }: { stage: StageView }) {
  void stage;

  return (
    <div className="flex flex-col" style={{ gap: "var(--pad-stage-section)" }}>
      <ContextUnavailableNotice />
      {SECTIONS.map((section, index) => (
        <Reveal key={section.id} class="event" token="base" index={index} as="section">
          <SectionHeader
            level="card"
            title={section.title}
            description={section.description}
            className="mb-3"
          />
          {section.render()}
        </Reveal>
      ))}
    </div>
  );
}

/**
 * One notice when the context package request fails outright.
 *
 * All four panels on this stage read the same query, so a per-panel error would
 * render the same failure four times. A 404 never reaches here — `contextQuery`
 * resolves it to `null`, because "A5.5 produced no package" is a fact the
 * panels state individually and precisely. What is left is a genuine failure:
 * a 500, or a backend that did not answer.
 */
function ContextUnavailableNotice() {
  const runId = useRunId();
  const { isError, error, refetch } = useQuery(contextQuery(runId));

  if (!isError) return null;

  const status = error instanceof ApiError ? error.status : null;
  const endpoint = error instanceof ApiError ? error.endpoint : null;

  return (
    <ErrorState
      size="sm"
      title="The context package could not be loaded"
      detail={
        <span className="flex flex-col gap-1">
          <span>
            Context Engineering · A5.5 — {error instanceof Error ? error.message : String(error)}
          </span>
          <span>
            This is a failed request, not an empty package. The panels below cannot describe a
            package they never received.
          </span>
        </span>
      }
      source={endpoint ? `${status ?? ""} ${endpoint}`.trim() : undefined}
      onRetry={() => void refetch()}
    />
  );
}
