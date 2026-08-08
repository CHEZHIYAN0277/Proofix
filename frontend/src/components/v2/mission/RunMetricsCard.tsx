/**
 * Run Metrics — what the run itself measured.
 *
 * Retries, elapsed, indexed files and graph size are real. Token count and
 * cost are **G9**: `run_id` never reaches `LLMGateway`, so `AuditEvent.run_id`
 * is always `""` and no audit row can be attributed to this run. Those two
 * render `Unavailable` with the gap named rather than being dropped, so the
 * card's shape stays honest about what is missing.
 */

import { useQuery } from "@tanstack/react-query";

import { KeyValue } from "@/design/primitives/atoms";
import { DataState } from "@/design/states/DataState";
import { SkeletonText } from "@/design/states/Skeleton";
import { orNull } from "@/lib/v2/absence";
import { kgMetricsQuery, runQuery } from "@/lib/v2/queries";
import { useRunId } from "../RunProvider";

const G9 = "run_id never reaches LLMGateway (G9) — audit events carry no run scope";

export function RunMetricsCard() {
  const runId = useRunId();
  const run = useQuery(runQuery(runId));
  const kg = useQuery(kgMetricsQuery(runId));

  if (run.isLoading) return <SkeletonText lines={4} label="Loading run metrics" />;

  return (
    <dl className="flex flex-col gap-1">
      <KeyValue label="Elapsed" value={orNull(run.data?.executionTime)} mono />
      <KeyValue
        label="Retries"
        value={run.data ? String(run.data.retries) : null}
        reason="The run header published no retry count"
        mono
      />
      <KeyValue
        label="Indexed files"
        value={kg.data ? `${kg.data.files_represented} / ${kg.data.files_total}` : null}
        reason="The knowledge graph published no coverage"
        mono
      />
      <KeyValue
        label="Graph size"
        value={kg.data ? `${kg.data.node_count}n / ${kg.data.edge_count}e` : null}
        reason="The knowledge graph published no counts"
        mono
      />
      <KeyValue
        label="Cache hits"
        value={
          kg.data ? `${kg.data.cache_hits} / ${kg.data.cache_hits + kg.data.cache_misses}` : null
        }
        reason="The knowledge graph published no cache counters"
        mono
      />

      <div className="flex items-baseline justify-between gap-4">
        <span className="type-label shrink-0 text-ink-soft">Tokens</span>
        <DataState kind="unavailable" reason={G9} size="sm" label="G9" variant="inline" />
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="type-label shrink-0 text-ink-soft">Est. cost</span>
        <DataState kind="unavailable" reason={G9} size="sm" label="G9" variant="inline" />
      </div>
    </dl>
  );
}
