/**
 * `<AttemptSwitcher>` — retry branches (blueprint §4).
 *
 * Hidden when attempts ≤ 1. A control that only ever shows "Attempt 1" is
 * chrome pretending to be a feature.
 *
 * Attempts are reconstructed by the backend from the event history — one A7
 * generate and one A8 validate per cycle, each carrying that cycle's own
 * payload. The score label is the backend's, so an unmeasured attempt never
 * renders as `0.00`.
 */

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/design/components/Button";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { Eyebrow } from "@/design/primitives/atoms";
import { cn } from "@/lib/utils";
import { orNull } from "@/lib/v2/absence";
import { attemptsQuery } from "@/lib/v2/queries";
import type { RepairAttempt } from "@/lib/v2/types";
import { useRunId } from "../RunProvider";

/**
 * Agents that take part in the retry loop.
 *
 * Attempts are reconstructed from A7 generate / A8 validate pairs, so they
 * describe those stages and no others. Rendering the switcher on, say,
 * Repository Understanding put "Validation Failed" under a stage that never
 * validates anything — a true statement about the run attached to the wrong
 * part of the story.
 */
const ATTEMPT_AGENT_IDS = new Set(["A7", "A8"]);

export interface AttemptSwitcherProps {
  /** Agent ids in the stage being rendered. */
  agentIds: string[];
  value: number;
  onChange: (attempt: number) => void;
}

export function AttemptSwitcher({ agentIds, value, onChange }: AttemptSwitcherProps) {
  const runId = useRunId();
  const { data } = useQuery(attemptsQuery(runId));

  const applies = agentIds.some((id) => ATTEMPT_AGENT_IDS.has(id));
  const attempts = readAttempts(data);
  if (!applies || attempts.length <= 1) return null;

  const current = attempts.find((a) => a.n === value) ?? attempts[0];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Attempts</Eyebrow>
        <div className="flex flex-wrap gap-1">
          {attempts.map((attempt) => (
            <Button
              key={attempt.n}
              size="sm"
              variant={attempt.n === value ? "primary" : "secondary"}
              aria-pressed={attempt.n === value}
              onClick={() => onChange(attempt.n)}
            >
              {attempt.n}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className={cn(
            "type-label",
            current.result.includes("Passed")
              ? "text-status-completed"
              : current.result.includes("Failed")
                ? "text-status-failed"
                : "text-ink-soft",
          )}
        >
          {current.result}
        </span>
        <span className="type-caption min-w-0 flex-1 truncate text-ink-soft">{current.detail}</span>
        <span className="flex items-center gap-1.5">
          <span className="type-caption text-ink-soft">Mutation</span>
          <DataBoundary
            value={orNull(current.scoreLabel)}
            whenMissing="unavailable"
            reason="The backend published no score for this attempt"
            inline
          >
            {(label) => <span className="type-mono text-ink">{label}</span>}
          </DataBoundary>
        </span>
      </div>
    </div>
  );
}

function readAttempts(data: unknown): RepairAttempt[] {
  if (!data || typeof data !== "object") return [];
  const attempts = (data as { attempts?: unknown }).attempts;
  return Array.isArray(attempts) ? (attempts as RepairAttempt[]) : [];
}
