/**
 * `<StageElapsed>` — elapsed time for one stage.
 *
 * Same rule as the run counter (§1.3): both endpoints come from backend frame
 * timestamps, it ticks only while the stage is genuinely in flight, and it
 * stops the moment the stage settles. A stage that has emitted nothing renders
 * `Waiting` rather than `0s`.
 */

import { useEffect, useState } from "react";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import type { StageView } from "@/lib/v2/stages/machine";
import { formatElapsed } from "./RunElapsed";

export function StageElapsed({ stage }: { stage: StageView }) {
  const running = stage.status === "running" || stage.status === "retrying";
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (stage.startedAt === null || !running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [stage.startedAt, running]);

  const elapsed =
    stage.startedAt === null
      ? null
      : stage.endedAt !== null
        ? stage.endedAt - stage.startedAt
        : running && now !== null
          ? now - stage.startedAt
          : null;

  return (
    <DataBoundary
      value={elapsed}
      whenMissing="waiting"
      reason="This stage has emitted no frame yet"
      inline
    >
      {(ms) => <span className="type-mono-sm tabular text-ink-soft">{formatElapsed(ms)}</span>}
    </DataBoundary>
  );
}
