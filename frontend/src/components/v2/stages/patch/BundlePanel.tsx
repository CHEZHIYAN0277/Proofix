/**
 * The bundle A7 produced — what it wrote, and what it is entitled to claim.
 *
 * The integrity badges are the reason this panel exists. A7 runs three checks
 * before a candidate is admitted: a no-op/abbreviation guard
 * (`validate_patch_integrity`), a Python parse, and an AST-validated write.
 * Only the last is *recorded* — it is stamped on the candidate as `method` —
 * so only it is stated here as a per-file badge. The other two are described
 * as what they are: preconditions for the candidate existing at all, not
 * results attached to it.
 *
 * That distinction is the whole difference between a badge and a decoration.
 * V1 emitted "AST validated" and "Integrity checked" on every patch whether or
 * not either check had run.
 */

import { FileCode2, Minus, Plus } from "lucide-react";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { MetricTile } from "@/design/primitives/MetricTile";
import { Eyebrow } from "@/design/primitives/atoms";
import { DataState } from "@/design/states/DataState";
import type { PatchBundle, PatchMethod } from "@/lib/v2/types";
import { diffTotals, type FileDiff } from "./diff";

const SOURCE = {
  label: "Patch bundle",
  endpoint: "GET /api/runs/{run_id}/patch",
  agentId: "A7",
} as const;

/**
 * What each write method actually asserts.
 *
 * `libcst` is in the model's `Literal` but A7 never writes it today; if it ever
 * does, the badge describes it accurately rather than falling through to the
 * AST claim.
 */
const METHOD: Record<PatchMethod, { label: string; detail: string }> = {
  ast_validated_write: {
    label: "AST validated",
    detail:
      "A7 parsed the generated file with Python's ast module before writing it. The file is syntactically valid; nothing here claims it is correct.",
  },
  libcst: {
    label: "LibCST write",
    detail:
      "A7 wrote this file through a concrete syntax tree, preserving formatting and comments outside the change.",
  },
};

export function BundlePanel({ bundle, files }: { bundle: PatchBundle; files: FileDiff[] }) {
  const totals = diffTotals(files);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Files written"
          value={bundle.patches.length}
          source={[{ ...SOURCE, fieldPath: "patches" }]}
          size="sm"
        />
        <MetricTile
          label="Lines added"
          value={totals.added}
          source={[{ ...SOURCE, fieldPath: "diff_text" }]}
          size="sm"
        />
        <MetricTile
          label="Lines removed"
          value={totals.removed}
          source={[{ ...SOURCE, fieldPath: "diff_text" }]}
          size="sm"
        />
        <MetricTile
          label="Issue"
          value={bundle.issue_id || null}
          source={[{ ...SOURCE, fieldPath: "issue_id" }]}
          size="sm"
          whenMissing="unavailable"
          reason="A7 recorded no issue id for this bundle"
        />
      </div>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Eyebrow>Integrity</Eyebrow>
          <ExplainAffordance
            id="patch.integrity"
            subject="Integrity badges"
            spec={{
              explain:
                "The write method A7 stamped on each candidate. A7 also rejects no-op and abbreviated patches and refuses a file that will not parse — but it records neither on the candidate, so a patch that failed either never reaches the bundle and the bundle cannot distinguish 'passed' from 'not run'. Only the stamped method is badged.",
              why: [],
              confidence: null,
              source: [{ ...SOURCE, fieldPath: "patches[].method" }],
            }}
          />
        </div>

        <DataBoundary
          value={bundle.patches.length > 0 ? bundle.patches : null}
          whenMissing="unavailable"
          emptyIsMissing
          reason="A7 admitted no candidate, so there is no write method to report"
        >
          {(patches) => (
            <ul className="flex flex-col gap-2">
              {patches.map((patch) => {
                const method = METHOD[patch.method];
                return (
                  <li
                    key={patch.file}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border bg-surface px-3 py-2"
                  >
                    <FileCode2
                      className="size-3.5 shrink-0 text-ink-soft"
                      strokeWidth={2}
                      aria-hidden
                    />
                    <span className="type-mono-sm min-w-0 flex-1 break-all text-ink">
                      {patch.file}
                    </span>
                    {method ? (
                      <span
                        className="type-caption rounded-full border border-border px-2 py-0.5 text-ink-soft"
                        title={method.detail}
                      >
                        {method.label}
                      </span>
                    ) : (
                      <DataState
                        kind="unavailable"
                        reason={`A7 stamped a write method this client does not recognise: ${patch.method}`}
                        label="Unrecognised method"
                        size="sm"
                        variant="inline"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DataBoundary>
      </section>

      <section>
        <Eyebrow className="mb-2">Style exemplar</Eyebrow>
        <DataBoundary
          value={bundle.style_exemplar_commit}
          whenMissing="unavailable"
          reason="A7 found no prior commit to learn this repository's style from"
          inline
        >
          {(commit) => (
            <p className="type-caption text-ink-soft">
              A7 learned the surrounding style from commit{" "}
              <span className="type-mono-sm text-ink">{commit.slice(0, 12)}</span>.
            </p>
          )}
        </DataBoundary>
      </section>

      <p className="type-caption inline-flex flex-wrap items-center gap-x-2 text-ink-soft">
        <span className="inline-flex items-center gap-1">
          <Plus className="size-3 text-status-completed" strokeWidth={2.5} aria-hidden />
          added
        </span>
        <span className="inline-flex items-center gap-1">
          <Minus className="size-3 text-status-failed" strokeWidth={2.5} aria-hidden />
          removed
        </span>
        <span>— counted from A7&apos;s own unified diff, not re-diffed here.</span>
      </p>
    </div>
  );
}
