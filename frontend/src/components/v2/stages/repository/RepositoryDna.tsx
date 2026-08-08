/**
 * Repository DNA — A0.5's own published metrics.
 *
 * `RepositoryIntelligenceMetrics` reaches the client as A0.5's `metrics` array
 * on the agent projection: an ordered list of `{label, value}` the backend
 * chose and formatted. Rendering it as published means the card cannot drift
 * from the agent, and a new metric appears here the day A0.5 emits it.
 *
 * The counterpart to that: nothing is added. No derived ratio, no "health
 * score", no trend — A0.5 publishes none of those, and inventing one here
 * would be a number with no provenance in a product whose claim is provenance.
 */

import { useQuery } from "@tanstack/react-query";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { KeyValue } from "@/design/primitives/atoms";
import { SkeletonText } from "@/design/states/Skeleton";
import { orNull } from "@/lib/v2/absence";
import { agentsQuery } from "@/lib/v2/queries";
import type { AgentEntry } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

/** The agent that publishes repository intelligence. */
const DNA_AGENT_ID = "A0.5";

export function RepositoryDna({ compact = false }: { compact?: boolean }) {
  const runId = useRunId();
  const { data, isLoading } = useQuery(agentsQuery(runId));

  const agent = (data ?? []).find((entry: AgentEntry) => entry.agentId === DNA_AGENT_ID);

  if (isLoading) return <SkeletonText lines={4} label="Loading repository DNA" />;

  return (
    <DataBoundary
      value={agent?.metrics}
      whenMissing="waiting"
      emptyIsMissing
      reason={
        agent ? "A0.5 has not published its metrics yet" : "A0.5 is not on this run's agent surface"
      }
    >
      {(metrics) => (
        <dl className={compact ? "flex flex-col gap-1" : "grid gap-x-6 gap-y-1 sm:grid-cols-2"}>
          {/* Index-suffixed: `metrics` is a backend array with no uniqueness
              guarantee on `label`, and two entries sharing one make React drop
              a row silently. */}
          {metrics.map((metric, index) => (
            <KeyValue
              key={`${metric.label}:${index}`}
              label={metric.label}
              value={orNull(metric.value)}
              whenMissing="unavailable"
              reason="A0.5 ran and recorded no value for this metric"
              mono
            />
          ))}
        </dl>
      )}
    </DataBoundary>
  );
}
