/**
 * `<RunTimeline>` — the milestone view (blueprint §4.4).
 *
 * Distinct from the activity feed's granularity: the first `started` and the
 * last terminal frame per stage, plus the decision. Entirely derived from event
 * timestamps the backend published — nothing here is scheduled or estimated.
 *
 * Vertical inside Mission Control. Each entry links to its stage route; during
 * replay (Phase 11) the same track doubles as the scrub bar, which is why the
 * entries carry their own timestamps rather than positions.
 */

import { CircleDot, Flag, Play } from "lucide-react";

import { useMemo } from "react";

import { EmptyState } from "@/design/states/EmptyState";
import { StatusDot } from "@/design/primitives/StatusDot";
import { cn } from "@/lib/utils";
import { toStatusState } from "@/lib/v2/stages/machine";
import type { TimelineEntry } from "@/lib/v2/stream/store";
import { useTimeline } from "../RunProvider";
import { useStageViews } from "../useStageViews";
import { formatElapsed } from "../shell/RunElapsed";

const ICONS = {
  "stage-started": Play,
  "stage-ended": CircleDot,
  decision: Flag,
} as const;

export function RunTimeline({ onSelect }: { onSelect?: (stageId: string) => void }) {
  const rawTimeline = useTimeline();

  /**
   * A chronology, ordered by the backend's own timestamps rather than by the
   * order frames were applied. `Array.prototype.sort` is stable, so entries
   * sharing a timestamp keep the order they arrived in.
   */
  const timeline = useMemo(() => [...rawTimeline].sort((a, b) => a.at - b.at), [rawTimeline]);
  const { stages } = useStageViews();

  if (timeline.length === 0) {
    return (
      <EmptyState
        title="No milestones yet"
        description="Milestones appear as stages start and finish."
        size="sm"
      />
    );
  }

  const labelOf = (stageId: string) => stages.find((s) => s.id === stageId)?.label ?? stageId;

  const origin = timeline[0].at;

  return (
    <ol className="flex flex-col">
      {timeline.map((entry, i) => (
        <TimelineRow
          key={entry.id}
          entry={entry}
          label={labelOf(entry.stageId)}
          offset={entry.at - origin}
          isLast={i === timeline.length - 1}
          onSelect={onSelect}
        />
      ))}
    </ol>
  );
}

function TimelineRow({
  entry,
  label,
  offset,
  isLast,
  onSelect,
}: {
  entry: TimelineEntry;
  label: string;
  offset: number;
  isLast: boolean;
  onSelect?: (stageId: string) => void;
}) {
  const Icon = ICONS[entry.kind];
  const clickable = Boolean(entry.stageId && onSelect);

  return (
    <li className="flex gap-2.5">
      {/* Rail: a dot per milestone, joined by a hairline. */}
      <div className="flex flex-col items-center">
        {entry.status ? (
          <StatusDot status={toStatusState(entry.status)} size="sm" pulse={false} />
        ) : (
          <Icon aria-hidden className="size-2.5 shrink-0 text-ink-soft" strokeWidth={2.5} />
        )}
        {!isLast && <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>

      <button
        type="button"
        disabled={!clickable}
        onClick={() => entry.stageId && onSelect?.(entry.stageId)}
        className={cn(
          "flex min-w-0 flex-1 items-baseline gap-2 rounded-xs px-1 pb-3 text-left",
          clickable ? "cursor-pointer hover:bg-surface-muted" : "cursor-default",
        )}
      >
        <span className="type-body-sm min-w-0 flex-1 truncate text-ink">
          {entry.kind === "decision" ? entry.label : label}
        </span>
        {entry.kind !== "decision" && (
          <span className="type-caption shrink-0 text-ink-soft">{entry.label}</span>
        )}
        <span className="type-mono-sm shrink-0 tabular text-ink-soft/70">
          +{formatElapsed(offset)}
        </span>
      </button>
    </li>
  );
}
