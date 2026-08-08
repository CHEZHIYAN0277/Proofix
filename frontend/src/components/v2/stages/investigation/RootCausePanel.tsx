/**
 * Root cause — the brief, and every claim anchored to a file and line.
 *
 * Citation verification is the strongest idea in the pipeline: A4 resolves each
 * cited path, then tries exact line → line window → AST function lookup →
 * unique-fingerprint match, and re-investigates when claims do not anchor.
 *
 * **G11 — a gap this panel makes visible.** That per-citation result never
 * reaches the client. `_visualization_for("root")` publishes `{code, probe}`
 * pairs only, and `_evidence_for("root")` publishes the *counts* ("Citations 4,
 * Verified 3"). So the aggregate is shown, because it is real, and each
 * citation's own state renders `Unavailable` naming the gap — rather than a
 * green tick this client cannot justify.
 */

import { useQuery } from "@tanstack/react-query";
import { FileCode } from "lucide-react";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { EvidenceList } from "@/design/primitives/EvidenceList";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Eyebrow, KeyValue } from "@/design/primitives/atoms";
import { DataState } from "@/design/states/DataState";
import { EmptyState } from "@/design/states/EmptyState";
import { SkeletonText } from "@/design/states/Skeleton";
import type { Evidence } from "@/design/types";
import { orNull } from "@/lib/v2/absence";
import { agentsQuery } from "@/lib/v2/queries";
import type { AgentEntry } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

const ROOT_AGENT_ID = "A4";

const G11 =
  "Per-citation verification is not published — the root-cause payload carries file, line and claim only (G11)";

interface RootData {
  lines?: { code: string; probe: string }[];
  bugMessage?: string;
  evidence?: { n: number; title: string; detail: string; conf: number }[];
}

export function RootCausePanel({ onSelectFile }: { onSelectFile?: (file: string) => void }) {
  const runId = useRunId();
  const { data, isLoading } = useQuery(agentsQuery(runId));

  if (isLoading) return <SkeletonText lines={4} label="Loading root cause" />;

  const agent = (data ?? []).find((e: AgentEntry) => e.agentId === ROOT_AGENT_ID);
  const viz = (agent?.visualization as { data?: RootData } | undefined)?.data;
  const fields = agent?.evidence?.fields ?? [];

  const field = (label: string) => orNull(fields.find((f) => f.label === label)?.value);

  const citationCount = field("Citations");
  const verifiedCount = field("Verified");
  const confidence = field("Confidence");

  /**
   * A4's own evidence refs, each with the weight it assigned. Mapped into the
   * contract's `Evidence` shape — the weights are the backend's, scaled from
   * the percentage it published.
   */
  const evidence: Evidence[] = (viz?.evidence ?? []).map((ref) => ({
    signal: ref.title,
    contribution: ref.conf / 100,
    detail: ref.detail,
    provenance: "A4 evidence_refs",
  }));

  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Eyebrow>Brief</Eyebrow>
          <ExplainAffordance
            id="root-cause.brief"
            subject="Root cause"
            spec={{
              explain:
                "A4's statement of why the bug occurred, with each claim anchored to a file and line it verified against the source.",
              why: evidence,
              // A4 publishes a confidence; it is shown, never synthesized.
              confidence: confidence ? Number.parseFloat(confidence) / 100 : null,
              source: [
                {
                  label: "Root cause brief",
                  endpoint: "GET /api/runs/{id}/agents?surface=v2",
                  fieldPath: "[agentId=A4].visualization.data",
                  agentId: "A4",
                },
              ],
            }}
          />
        </div>
        <DataBoundary
          value={orNull(viz?.bugMessage)}
          whenMissing="waiting"
          reason="A4 has not published a root-cause statement yet"
        >
          {(message) => <p className="type-body text-ink">{message}</p>}
        </DataBoundary>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <Eyebrow className="mb-2">Anchoring</Eyebrow>
          <dl className="flex flex-col gap-1">
            <KeyValue
              label="Citations"
              value={citationCount}
              whenMissing="unavailable"
              reason="A4 published no citation count"
              mono
            />
            <KeyValue
              label="Verified"
              value={citationCount && verifiedCount ? `${verifiedCount} of ${citationCount}` : null}
              whenMissing="unavailable"
              reason="A4 published no verification count"
              mono
            />
            <KeyValue
              label="Confidence"
              value={confidence}
              whenMissing="unavailable"
              reason="A4 published no confidence"
              mono
            />
          </dl>
        </section>

        <section>
          <Eyebrow className="mb-2">Evidence</Eyebrow>
          <DataBoundary
            value={evidence.length > 0 ? evidence : null}
            whenMissing="waiting"
            emptyIsMissing
            reason="A4 published no weighted evidence refs"
            fallback={<EmptyState title="No weighted evidence" size="sm" />}
          >
            {(items) => <EvidenceList evidence={items} compact />}
          </DataBoundary>
        </section>
      </div>

      <section>
        <Eyebrow className="mb-2">Citations</Eyebrow>
        <DataBoundary
          value={viz?.lines?.length ? viz.lines : null}
          whenMissing="waiting"
          emptyIsMissing
          reason="A4 anchored no claims to a file and line"
          fallback={<EmptyState title="No citations" size="sm" />}
        >
          {(lines) => (
            <ul className="flex flex-col gap-2">
              {lines.map((line, index) => {
                const file = line.code.split(":")[0];
                return (
                  <li
                    key={`${line.code}:${index}`}
                    className="rounded-card border border-border bg-surface p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => onSelectFile?.(file)}
                        disabled={!onSelectFile}
                        className="flex min-w-0 items-center gap-1.5 text-left"
                      >
                        <FileCode
                          aria-hidden
                          className="size-3.5 shrink-0 text-ink-soft"
                          strokeWidth={1.75}
                        />
                        <span className="type-mono-sm min-w-0 break-all text-ink">{line.code}</span>
                      </button>
                      {/* The aggregate above is real; this one is not published. */}
                      <DataState
                        kind="unavailable"
                        reason={G11}
                        size="sm"
                        label="Verification"
                        className="shrink-0"
                      />
                    </div>
                    <p className="type-body-sm mt-1.5 text-ink-soft">{line.probe}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </DataBoundary>
      </section>
    </div>
  );
}
