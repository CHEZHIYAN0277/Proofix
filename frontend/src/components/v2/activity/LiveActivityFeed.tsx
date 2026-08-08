/**
 * `<LiveActivityFeed>` — a chronological, backend-only feed (blueprint §4.3).
 *
 * Distinct from chat (which is asked) and from the timeline (which is
 * milestones). Every row is one `AgentStatusEvent.message` the backend
 * actually emitted, rendered `[hh:mm:ss] [agent] message`.
 *
 * **No client-authored entries.** If the backend never said it, the feed never
 * shows it — the store drops frames with an empty message rather than
 * inventing a line for them.
 *
 * Newest first, capped at 200 by the store, windowed on render, filterable by
 * stage and agent.
 */

import { useMemo, useRef, useState } from "react";

import { SearchInput } from "@/design/components/Input";
import { EmptyState } from "@/design/states/EmptyState";
import { AgentAvatar } from "@/design/identity/AgentAvatar";
import { cn } from "@/lib/utils";
import type { ActivityEntry } from "@/lib/v2/stream/store";
import { useActivity, useAttempts } from "../RunProvider";
import { useStageViews } from "../useStageViews";

/**
 * Rows rendered at once. The store caps history at 200; this caps *painting*,
 * which is what the 60 FPS budget cares about. "Show all" lifts it on demand.
 */
const WINDOW = 60;

const STATUS_TINT: Record<ActivityEntry["status"], string> = {
  started: "text-ink-soft",
  progress: "text-ink-soft",
  completed: "text-status-completed",
  failed: "text-status-failed",
  retry: "text-status-retry",
};

function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function LiveActivityFeed({ onJumpToStage }: { onJumpToStage?: (stageId: string) => void }) {
  const activity = useActivity();
  // Only used to decide whether attempt numbers are worth showing at all.
  const attemptCount = useAttempts().length;
  const { stages } = useStageViews();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const stageLabels = useMemo(
    () => Object.fromEntries(stages.map((s) => [s.id, s.label])),
    [stages],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return activity;
    return activity.filter(
      (entry) =>
        entry.message.toLowerCase().includes(needle) ||
        entry.agentId.toLowerCase().includes(needle) ||
        (entry.stageId ? (stageLabels[entry.stageId] ?? "").toLowerCase().includes(needle) : false),
    );
  }, [activity, query, stageLabels]);

  const visible = expanded ? filtered : filtered.slice(0, WINDOW);

  if (activity.length === 0) {
    return (
      <EmptyState
        title="Nothing emitted yet"
        description="The feed shows only what the backend reported. It fills as agents run."
        size="sm"
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        placeholder="Filter activity"
        aria-label="Filter activity feed"
        className="h-7"
      />

      {filtered.length === 0 ? (
        <EmptyState title="No matching activity" size="sm" />
      ) : (
        <ol ref={listRef} className="flex flex-col gap-0.5" aria-live="polite">
          {visible.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={!entry.stageId || !onJumpToStage}
                onClick={() => entry.stageId && onJumpToStage?.(entry.stageId)}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded-xs px-1 py-1 text-left",
                  entry.stageId && onJumpToStage
                    ? "cursor-pointer hover:bg-surface-muted"
                    : "cursor-default",
                )}
                title={
                  entry.stageId
                    ? `Jump to ${stageLabels[entry.stageId] ?? entry.stageId}`
                    : undefined
                }
              >
                <time
                  dateTime={new Date(entry.at).toISOString()}
                  className="type-mono-sm shrink-0 tabular text-ink-soft/60"
                >
                  {clockOf(entry.at)}
                </time>
                <AgentAvatar agentId={entry.agentId} size={14} variant="initials" />
                {/* Shown only once the run has actually retried. On a
                    single-attempt run every row would read "#1", which is
                    noise; on a retrying run it is the only thing telling four
                    identical messages apart. */}
                {entry.attempt !== null && attemptCount > 1 && (
                  <span
                    className="type-mono-sm shrink-0 tabular text-ink-soft/60"
                    title={`Repair attempt ${entry.attempt}`}
                  >
                    #{entry.attempt}
                  </span>
                )}
                <span className={cn("type-caption min-w-0 flex-1", STATUS_TINT[entry.status])}>
                  {entry.message}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {!expanded && filtered.length > WINDOW && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="type-caption self-start text-ink-soft hover:text-ink"
        >
          Show all {filtered.length}
        </button>
      )}
    </div>
  );
}
