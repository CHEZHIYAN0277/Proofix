/**
 * The diff — one `<DiffView>` per file A7 wrote.
 *
 * **The reveal is paced by the data, not by a timer.** Files stagger in on
 * mount through `<Reveal>`, in the order A7 wrote them, and that is the end of
 * the motion. There is no typewriter: a character-by-character animation of a
 * patch that was generated seconds ago in one LLM response would be a
 * dramatisation of an event that did not happen that way, and this stage is
 * the one place where the reader most needs to trust that what moves on screen
 * corresponds to something real. When A7 emits a frame, the bundle query is
 * invalidated and the newly written files appear — that is the streaming.
 */

import { AlertTriangle } from "lucide-react";

import { DiffView } from "@/design/components/DiffView";
import { Reveal } from "@/design/primitives/Reveal";
import { DataState } from "@/design/states/DataState";
import { EmptyState } from "@/design/states/EmptyState";
import type { FileDiff } from "./diff";

export function DiffPanel({ files }: { files: FileDiff[] }) {
  if (files.length === 0) {
    return (
      <EmptyState
        title="No file was written"
        description="A7 completed and admitted no candidate. The bundle records what was written, not why nothing was — a run where A6 produced no plan and one where every generated patch was rejected both arrive here. The attempt history distinguishes them."
        size="sm"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {files.map((file, index) => (
        <Reveal key={file.file} class="event" token="base" index={index} as="section">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="type-mono-sm min-w-0 break-all text-ink">{file.file}</span>
            <span className="type-caption tabular text-ink-soft">
              <span className="text-status-completed">+{file.added}</span>{" "}
              <span className="text-status-failed">−{file.removed}</span>
            </span>
          </div>

          {file.missingFromDiff ? (
            <div className="flex items-start gap-2 rounded-card border border-border bg-surface px-3 py-2">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0 text-status-retry"
                strokeWidth={2}
                aria-hidden
              />
              <div className="min-w-0">
                <DataState
                  kind="unavailable"
                  reason="A7's unified diff carries no section for this file"
                  label="No diff for this file"
                  size="sm"
                  variant="inline"
                />
                <p className="type-caption mt-1 text-ink-soft">
                  A7 admitted this candidate, which means its semantic-difference check passed, yet
                  the diff it generated has no hunk for the path. The two disagree; neither is
                  overridden here.
                </p>
              </div>
            </div>
          ) : (
            <DiffView
              lines={file.lines}
              original={file.candidate.original}
              patched={file.candidate.patched}
              filename={file.file}
            />
          )}
        </Reveal>
      ))}
    </div>
  );
}
