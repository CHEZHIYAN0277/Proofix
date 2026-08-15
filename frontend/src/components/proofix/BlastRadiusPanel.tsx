/**
 * A5 — Blast Radius Impact Ledger.
 *
 * Everything on this panel comes from `GET /api/runs/{runId}/blast`
 * (`services/ui_projection.py::build_blast_impact`, sourced from A5's own
 * `BlastGraphResult`, joined read-only against A1's SIG and A3's findings).
 * No hop count, direction, score or capability is computed client-side beyond
 * deterministic grouping (by hop, by directory) of what the backend sent.
 *
 * Distinct from A2's Dependency Risk panel: A2 answers whether a third-party
 * advisory *reaches into* this repository. This panel answers what could be
 * affected if the file A4 is investigating *changes* — the opposite
 * direction, over the repository's own files. It reads as the continuation of
 * the A4 board: A4 ends at "we believe this is real and it lives here"; A5
 * opens at "here is what changing there could touch".
 *
 * Vocabulary this panel is careful never to blur, because the backend only
 * ever knows reachability, never certainty:
 *   "changing"            the resolved origin
 *   "could be affected"   hop 1 — a direct import edge exists
 *   "reachable"           hop 2-3 — transitive, confidence decays with distance
 *   "priority"            not "risk" — `priorityScore` cannot distinguish "no
 *                         churn measured" from "measured zero churn"; the
 *                         caveat the backend sends is always shown, not
 *                         summarised away
 * Nothing here is ever labelled "affected" or "definitely affected".
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Pin,
} from "lucide-react";
import type { BlastImpact, BlastScopeFile } from "./blastTypes";
import { getBlastImpact } from "@/lib/runService";
import type { AgentStatus } from "./data";

const ROLE_LABEL: Record<string, string> = {
  "auth-boundary": "Auth Boundary",
  "data-access": "Data Access",
  "public-api": "Public API",
  "config-surface": "Config Surface",
  "test-only": "Test Only",
  "internal-util": "Internal Utility",
};

const SOURCE_LABEL: Record<string, string> = {
  stack_trace: "resolved from the reproduced stack trace",
  root_cause: "resolved from A4's root-cause citation",
  sig_lookup: "resolved by matching the semantic graph",
  import_mapping: "resolved from a failing test's import chain",
  fallback: "resolved by path fallback — lowest-confidence route",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function directoryOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "(root)" : path.slice(0, idx);
}

// ------------------------------------------------------------------ chrome

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load the blast-radius impact</span>
      <span className="font-mono text-ink-soft">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto rounded-md border border-border px-2 py-0.5 font-medium text-ink transition-colors hover:bg-surface-muted"
      >
        Retry
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
      {children}
    </div>
  );
}

function Flow() {
  return (
    <div className="flex justify-center" aria-hidden>
      <ArrowDown className="h-3.5 w-3.5 text-ink-soft/60" />
    </div>
  );
}

// ------------------------------------------------------------------ origin

function OriginCard({ impact }: { impact: BlastImpact }) {
  const origin = impact.origin;
  if (!origin) {
    return (
      <div
        role="group"
        aria-label="Change origin"
        className="rounded-xl border border-border bg-surface-muted/30 p-3 text-[11px] text-ink-soft"
      >
        No origin — A5 ran but resolved no file to traverse from (no semantic graph, or no citations
        to anchor to).
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Change origin"
      className="rounded-xl border border-border bg-surface-muted/30 p-3"
    >
      <div className="text-[10px] uppercase tracking-wider text-ink-soft">Changing</div>
      <p className="mt-0.5 font-mono text-sm font-semibold text-ink">
        {origin.resolvedPath ?? origin.normalizedPath}
      </p>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-ink-soft">
        <span>
          {origin.source
            ? (SOURCE_LABEL[origin.source] ?? origin.source)
            : "Resolution source not measured"}
        </span>
        {origin.confidence !== null && (
          <span>
            confidence <span className="font-mono text-ink">{pct(origin.confidence)}</span>
          </span>
        )}
        {origin.runtimeConfirmed === true && (
          <span className="text-status-completed">runtime-confirmed by A3.5</span>
        )}
        {origin.pinned === true && (
          <span className="flex items-center gap-1 text-status-retry">
            <Pin className="h-3 w-3" aria-hidden />
            pinned into auto-patch scope
          </span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ direct impact

function DirectionBadges({ file }: { file: BlastScopeFile }) {
  const up = file.directions.includes("backward");
  const down = file.directions.includes("forward");
  return (
    <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-ink-soft">
      {up && down ? (
        <ArrowRightLeft className="h-3 w-3" aria-label="reached both as caller and dependency" />
      ) : up ? (
        <ArrowLeft className="h-3 w-3" aria-label="calls the origin" />
      ) : down ? (
        <ArrowRight className="h-3 w-3" aria-label="called by the origin" />
      ) : null}
    </span>
  );
}

function ScopeFileRow({ file, onSelect }: { file: BlastScopeFile; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-1.5 border-t border-border/60 py-1.5 text-left first:border-t-0"
    >
      <DirectionBadges file={file} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate font-mono text-[11px] text-ink">{file.path}</span>
          {file.role && (
            <span className="text-[9px] uppercase tracking-wider text-ink-soft">
              {ROLE_LABEL[file.role] ?? file.role}
            </span>
          )}
          {file.hasStaticFinding && (
            <span className="rounded bg-status-retry-bg px-1 text-[9px] font-medium text-status-retry">
              A3 flagged
            </span>
          )}
        </span>
        {file.edgeBasis === "name_contains" && (
          <span className="mt-0.5 block text-[9px] text-status-retry">
            name-matched only — could be a false edge
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-ink-soft">
        {file.propagationConfidence !== null ? pct(file.propagationConfidence) : "—"}
      </span>
    </button>
  );
}

function DirectImpact({
  files,
  onSelect,
}: {
  files: BlastScopeFile[];
  onSelect: (file: BlastScopeFile) => void;
}) {
  const upstream = files.filter((f) => f.directions.includes("backward"));
  const downstream = files.filter(
    (f) => f.directions.includes("forward") && !f.directions.includes("backward"),
  );

  return (
    <div
      role="group"
      aria-label="Direct impact"
      className="rounded-lg border border-border bg-surface-muted/30 p-2.5"
    >
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink">
          Could be affected — direct (hop 1)
        </span>
        <span className="font-mono text-[10px] text-ink-soft">{files.length}</span>
      </div>
      {files.length === 0 ? (
        <p className="py-1.5 text-[10px] text-ink-soft">
          No direct impact — Not measured, or nothing reaches this file within one hop.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-0.5 flex items-center gap-1 text-[9px] uppercase tracking-wider text-ink-soft">
              <ArrowLeft className="h-3 w-3" aria-hidden />
              upstream · calls the origin
            </div>
            {upstream.length ? (
              <ul>
                {upstream.map((f) => (
                  <li key={f.path}>
                    <ScopeFileRow file={f} onSelect={() => onSelect(f)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-1 text-[10px] text-ink-soft">None found</p>
            )}
          </div>
          <div>
            <div className="mb-0.5 flex items-center gap-1 text-[9px] uppercase tracking-wider text-ink-soft">
              <ArrowRight className="h-3 w-3" aria-hidden />
              downstream · the origin calls it
            </div>
            {downstream.length ? (
              <ul>
                {downstream.map((f) => (
                  <li key={f.path}>
                    <ScopeFileRow file={f} onSelect={() => onSelect(f)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-1 text-[10px] text-ink-soft">None found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- transitive

function TransitiveImpact({
  files,
  onSelect,
}: {
  files: BlastScopeFile[];
  onSelect: (file: BlastScopeFile) => void;
}) {
  const [open, setOpen] = useState(false);
  const byDirectory = useMemo(() => {
    const groups = new Map<string, BlastScopeFile[]>();
    for (const f of files) {
      const key = directoryOf(f.path);
      const list = groups.get(key) ?? [];
      list.push(f);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [files]);

  return (
    <div
      role="group"
      aria-label="Transitive impact"
      className="rounded-lg border border-border bg-surface-muted/30"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={files.length === 0}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left disabled:cursor-default"
      >
        {files.length > 0 &&
          (open ? (
            <ChevronDown className="h-3 w-3 text-ink-soft" />
          ) : (
            <ChevronRight className="h-3 w-3 text-ink-soft" />
          ))}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink">
          Reachable — transitive (hop 2–3)
        </span>
        <span className="ml-auto font-mono text-[10px] text-ink-soft">{files.length}</span>
      </button>
      {files.length === 0 && (
        <p className="px-2.5 pb-1.5 text-[10px] text-ink-soft">
          Transitive impact — Not measured, or nothing reachable beyond hop 1.
        </p>
      )}
      {open && (
        <div className="space-y-2 px-2.5 pb-2">
          {byDirectory.map(([dir, group]) => (
            <div key={dir}>
              <div className="text-[9px] uppercase tracking-wider text-ink-soft">
                {dir} <span className="font-mono">({group.length})</span>
              </div>
              <ul>
                {group.map((f) => (
                  <li key={f.path}>
                    <ScopeFileRow file={f} onSelect={() => onSelect(f)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ capabilities

function CapabilityRollup({ capabilities }: { capabilities: BlastImpact["capabilities"] }) {
  if (capabilities === null) {
    return (
      <div className="text-[11px] text-ink-soft">
        Potentially affected areas — Not measured. A0.5&apos;s repository index did not run for this
        run.
      </div>
    );
  }
  if (capabilities.length === 0) {
    return (
      <div className="text-[11px] text-ink-soft">
        No capability signal matched the impact scope.
      </div>
    );
  }

  const max = Math.max(...capabilities.map((c) => c.filesInScope.length), 1);

  return (
    <div role="group" aria-label="Potentially affected areas" className="space-y-1.5">
      {capabilities.map((c) => (
        <div key={c.slug}>
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="font-medium text-ink">{c.name}</span>
            <span className="font-mono text-[10px] text-ink-soft">
              {c.filesInScope.length}
              {c.totalFilesInCapability !== null
                ? ` of ${c.totalFilesInCapability} files`
                : " files"}
            </span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-status-running"
              style={{ width: `${Math.round((c.filesInScope.length / max) * 100)}%` }}
            />
          </div>
          <p className="mt-0.5 text-[9px] text-ink-soft">
            {c.confidence !== null ? `${pct(c.confidence)} confidence — ` : ""}
            {c.why}
          </p>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------- patch authority

function PatchAuthorityStrip({ impact }: { impact: BlastImpact }) {
  return (
    <div
      role="group"
      aria-label="Patch authority"
      className="rounded-lg border border-border bg-surface-muted/30 p-2.5"
    >
      <div className="flex flex-wrap gap-4 text-[11px]">
        <span>
          Auto-patchable{" "}
          <span className="font-mono font-semibold text-ink">{impact.autoPatchScope.length}</span>
        </span>
        <span>
          Human review{" "}
          <span className="font-mono font-semibold text-ink">
            {impact.humanReviewRequired.length}
          </span>
        </span>
      </div>
      {impact.patchAuthorityOverlap.length > 0 && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[10px] text-ink-soft">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-status-retry" aria-hidden />
          {impact.patchAuthorityOverlap.join(", ")}{" "}
          {impact.patchAuthorityOverlap.length === 1 ? "is" : "are"} in both lists at once: the
          resolved target was pinned into auto-patch scope while its own propagation confidence
          independently placed it in human review. Both facts are real.
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------- inspector

function Inspector({ file, onClose }: { file: BlastScopeFile; onClose: () => void }) {
  return (
    <div
      role="group"
      aria-label={`Details for ${file.path}`}
      className="rounded-lg border border-border bg-surface-muted/30 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[11px] font-semibold text-ink">{file.path}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] text-ink-soft hover:text-ink"
        >
          Close
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        <dt className="text-ink-soft">Hop distance</dt>
        <dd className="font-mono text-ink">{file.hopCount ?? "Not measured"}</dd>
        <dt className="text-ink-soft">Reached via</dt>
        <dd className="font-mono text-ink">{file.reachedVia ?? "origin"}</dd>
        <dt className="text-ink-soft">Edge basis</dt>
        <dd className="text-ink">
          {file.edgeBasis === "resolved_suffix"
            ? "precise match (import resolves to this file's path)"
            : file.edgeBasis === "name_contains"
              ? "name-matched only — could be a false edge"
              : "n/a (origin)"}
        </dd>
        <dt className="text-ink-soft">Propagation confidence</dt>
        <dd className="font-mono text-ink">
          {file.propagationConfidence !== null ? pct(file.propagationConfidence) : "Not measured"}
        </dd>
        <dt className="text-ink-soft">Role (A1)</dt>
        <dd className="text-ink">
          {file.role ? (ROLE_LABEL[file.role] ?? file.role) : "Not measured"}
        </dd>
        <dt className="text-ink-soft">Criticality (A1)</dt>
        <dd className="font-mono text-ink">
          {file.criticality !== null ? file.criticality.toFixed(2) : "Not measured"}
        </dd>
        <dt className="text-ink-soft">Flagged by A3</dt>
        <dd className="text-ink">{file.hasStaticFinding ? "Yes" : "No"}</dd>
      </dl>
    </div>
  );
}

// ------------------------------------------------------------------ ledger

type SortKey = "hop" | "priority" | "path";

function ScopeLedger({
  scope,
  caveat,
  onSelect,
}: {
  scope: BlastScopeFile[];
  caveat: string;
  onSelect: (file: BlastScopeFile) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("hop");
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const rows = useMemo(() => {
    const filtered = onlyFlagged ? scope.filter((f) => f.hasStaticFinding) : scope;
    const sorted = [...filtered];
    if (sortKey === "hop") sorted.sort((a, b) => (a.hopCount ?? 99) - (b.hopCount ?? 99));
    if (sortKey === "priority")
      sorted.sort((a, b) => (b.priorityScore ?? -1) - (a.priorityScore ?? -1));
    if (sortKey === "path") sorted.sort((a, b) => a.path.localeCompare(b.path));
    return sorted;
  }, [scope, sortKey, onlyFlagged]);

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <SectionLabel>Scope ledger ({rows.length})</SectionLabel>
        <div className="ml-auto flex items-center gap-2 text-[10px]">
          <label className="flex items-center gap-1 text-ink-soft">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => setOnlyFlagged(e.target.checked)}
            />
            A3-flagged only
          </label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort scope ledger"
            className="rounded border border-border bg-surface px-1 py-0.5 text-ink"
          >
            <option value="hop">Sort: hop</option>
            <option value="priority">Sort: priority</option>
            <option value="path">Sort: path</option>
          </select>
        </div>
      </div>
      <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-[9px] uppercase tracking-wider text-ink-soft">
              <th className="px-2 py-1.5 font-medium">Path</th>
              <th className="px-2 py-1.5 font-medium">Hop</th>
              <th className="px-2 py-1.5 font-medium">Direction</th>
              <th className="px-2 py-1.5 font-medium">Role</th>
              <th className="px-2 py-1.5 font-medium">Propagation</th>
              <th className="px-2 py-1.5 font-medium">Priority</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr
                key={f.path}
                onClick={() => onSelect(f)}
                className="cursor-pointer border-b border-border/60 transition-colors hover:bg-surface-muted"
              >
                <td className="px-2 py-1 font-mono text-ink">
                  {f.path}
                  {f.hasStaticFinding && <span className="ml-1 text-status-retry">●</span>}
                </td>
                <td className="px-2 py-1 font-mono text-ink-soft">{f.hopCount ?? "—"}</td>
                <td className="px-2 py-1 text-ink-soft">{f.directions.join(" + ") || "—"}</td>
                <td className="px-2 py-1 text-ink-soft">
                  {f.role ? (ROLE_LABEL[f.role] ?? f.role) : "Not measured"}
                </td>
                <td className="px-2 py-1 font-mono text-ink-soft">
                  {f.propagationConfidence !== null ? pct(f.propagationConfidence) : "—"}
                </td>
                <td className="px-2 py-1 font-mono text-ink-soft">
                  {f.priorityScore !== null ? f.priorityScore.toFixed(2) : "Not measured"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-ink-soft">{caveat}</p>
    </div>
  );
}

// ------------------------------------------------------------------- panel

export function BlastRadiusPanel({ runId, status }: { runId: string; status?: AgentStatus }) {
  const [impact, setImpact] = useState<BlastImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<BlastScopeFile | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getBlastImpact(runId)
      .then((i) => {
        if (!cancelled) setImpact(i);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, attempt, status]);

  const direct = useMemo(() => (impact?.scope ?? []).filter((f) => f.hopCount === 1), [impact]);
  const transitive = useMemo(
    () => (impact?.scope ?? []).filter((f) => (f.hopCount ?? 0) >= 2),
    [impact],
  );

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Blast Radius
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Loading impact analysis…</p>
      </section>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (!impact) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Blast Radius
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "RUNNING — A5 is traversing the impact scope now; this panel renders once it publishes."
            : "Pending — A5 has not completed for this run yet."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
            Blast Radius
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-soft">
            If this change is real, what parts of the repository could potentially be affected — not
            what a third-party advisory reaches (that is A2), but what changing this file could
            reach.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider text-ink-soft">Scope</div>
          <div className="font-mono text-sm font-semibold text-ink">
            {impact.scope.length} file{impact.scope.length === 1 ? "" : "s"} · {impact.maxHop} hop
            {impact.maxHop === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <OriginCard impact={impact} />

      {impact.scope.length > 0 && (
        <>
          <Flow />
          <DirectImpact files={direct} onSelect={setSelected} />
          <TransitiveImpact files={transitive} onSelect={setSelected} />

          <Flow />
          <div>
            <SectionLabel>Potentially affected areas</SectionLabel>
            <CapabilityRollup capabilities={impact.capabilities} />
          </div>

          <Flow />
          <div>
            <SectionLabel>Patch authority</SectionLabel>
            <PatchAuthorityStrip impact={impact} />
          </div>

          {selected && <Inspector file={selected} onClose={() => setSelected(null)} />}

          <ScopeLedger
            scope={impact.scope}
            caveat={impact.riskMeasurementCaveat}
            onSelect={setSelected}
          />
        </>
      )}

      <p className="text-[10px] text-ink-soft">
        Explain: every file here traces to a real traversal step over A1&apos;s import graph, from
        the file A4 is investigating. Reachability is not proof of breakage — the outer hops are
        potential impact, decayed by distance. Source:{" "}
        <code className="font-mono">GET /api/runs/{"{run_id}"}/blast</code>
      </p>
    </section>
  );
}
