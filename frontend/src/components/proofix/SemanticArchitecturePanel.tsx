/**
 * A1 — Semantic Architecture Map.
 *
 * Everything on this panel comes from `GET /api/runs/{runId}/semantic-graph`
 * (`services/ui_projection.py::build_semantic_graph`, sourced from A1's own
 * `SemanticIntentGraph`). No role, count, edge or criticality figure is
 * computed client-side beyond deterministic aggregation of that response
 * (grouping by role, sorting, filtering) — nothing is invented.
 *
 * This is deliberately NOT the A0.5 Repository Knowledge Graph
 * (`RepositoryIntelligencePanel`). A0.5 answers "what exists and how is it
 * wired" — a containment tree of files/classes/functions plus import edges.
 * A1 answers "what does this code appear to do" — one of six architectural
 * roles per file (`SemanticRole`), which A0.5 never assigns. The two panels
 * read different endpoints, group by different axes, and never share a
 * layout: A0.5 is a containment tree, A1 is grouped by semantic role.
 *
 * Layout is computed once per graph payload (memoized) and never recomputed
 * on selection/search — those only change which nodes are dimmed/highlighted.
 * There is no synthetic "understanding" animation: the graph either has not
 * loaded yet, has not been published for this run (A1 has not completed), or
 * is on screen in full.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Table2,
  Network,
  FolderTree,
  X,
  KeyRound,
  Database,
  Globe2,
  Settings2,
  FlaskConical,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { SemanticFile, SemanticGraphExport, SemanticRole } from "./semanticGraphTypes";
import { SEMANTIC_ROLES } from "./semanticGraphTypes";
import { getSemanticGraph } from "@/lib/runService";
import type { AgentStatus } from "./data";

type ViewMode = "architecture" | "relationships" | "table";

const MAX_RELATIONSHIP_NODES = 150;

const ROLE_LABEL: Record<SemanticRole, string> = {
  "auth-boundary": "Auth Boundary",
  "data-access": "Data Access",
  "public-api": "Public API",
  "config-surface": "Config Surface",
  "test-only": "Test Only",
  "internal-util": "Internal Utility",
};

const ROLE_COLOR: Record<SemanticRole, string> = {
  "auth-boundary": "#dc2626",
  "data-access": "#0891b2",
  "public-api": "#3b82f6",
  "config-surface": "#d97706",
  "test-only": "#16a34a",
  "internal-util": "#64748b",
};

const ROLE_ICON: Record<SemanticRole, LucideIcon> = {
  "auth-boundary": KeyRound,
  "data-access": Database,
  "public-api": Globe2,
  "config-surface": Settings2,
  "test-only": FlaskConical,
  "internal-util": Wrench,
};

/** Statements A1's own discoveries support — never generic marketing copy. */
const ROLE_EXPLANATION: Record<SemanticRole, string> = {
  "auth-boundary": "Authentication / authorization logic identified",
  "data-access": "Data access / persistence layer identified",
  "public-api": "Public API entrypoints identified",
  "config-surface": "Configuration surface identified",
  "test-only": "Test modules identified",
  "internal-util": "Internal utility modules identified",
};

function criticalityTier(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 0.7) return "HIGH";
  if (score >= 0.4) return "MEDIUM";
  return "LOW";
}

const TIER_CLASS: Record<string, string> = {
  HIGH: "text-status-failed",
  MEDIUM: "text-status-retry",
  LOW: "text-ink-soft",
};

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load the semantic graph</span>
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

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted/60 px-2.5 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-wider text-ink-soft">{label}</div>
      <div className="font-mono text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

// ------------------------------------------------------------ distribution

function RoleDistribution({ roleCounts }: { roleCounts: Record<SemanticRole, number> }) {
  const max = Math.max(1, ...Object.values(roleCounts));
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        <span>Semantic role distribution</span>
      </div>
      <div className="space-y-1">
        {SEMANTIC_ROLES.map((role) => {
          const count = roleCounts[role] ?? 0;
          const Icon = ROLE_ICON[role];
          return (
            <div key={role} className="flex items-center gap-2">
              <Icon className="h-3 w-3 shrink-0" style={{ color: ROLE_COLOR[role] }} aria-hidden />
              <span className="w-[110px] shrink-0 truncate text-[10px] text-ink-soft">
                {ROLE_LABEL[role]}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: count === 0 ? "0%" : `${Math.max(4, (count / max) * 100)}%`,
                    background: ROLE_COLOR[role],
                  }}
                />
              </div>
              <span className="w-6 shrink-0 text-right font-mono text-[10px] text-ink">
                {count}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-ink-soft">
        Explain: counts of the six architectural roles A1 assigns to every production file it
        indexed. Source: <code className="font-mono">roleCounts</code> on the semantic graph
        response.
      </p>
    </div>
  );
}

// --------------------------------------------------------------- hotspots

function SemanticHotspots({ files }: { files: SemanticFile[] }) {
  const top = files.slice(0, 8);
  if (top.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Semantic hotspots
      </div>
      <div className="divide-y divide-border/60 rounded-lg border border-border">
        {top.map((f) => {
          const tier = criticalityTier(f.criticality);
          return (
            <div key={f.path} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
              <span className="min-w-0 truncate font-mono text-[11px] text-ink" title={f.path}>
                {f.path}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[10px] text-ink-soft">
                  {f.criticality.toFixed(2)}
                </span>
                <span className={`text-[10px] font-semibold ${TIER_CLASS[tier]}`}>{tier}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-ink-soft">
        Explain: files ranked by A1&apos;s criticality score (role weighted by git churn).
        HIGH/MEDIUM/LOW are fixed bands over that score (≥0.7 / ≥0.4 / below), shown alongside the
        real number. Source: <code className="font-mono">criticality</code> per file.
      </p>
    </div>
  );
}

// -------------------------------------------------------------- checklist

function SemanticExplanation({ roleCounts }: { roleCounts: Record<SemanticRole, number> }) {
  const detected = SEMANTIC_ROLES.filter((r) => (roleCounts[r] ?? 0) > 0);
  if (detected.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        What A1 discovered
      </div>
      <ul className="space-y-1">
        {detected.map((role) => (
          <li key={role} className="flex items-center gap-1.5 text-[11px] text-ink">
            <span className="text-status-completed">✓</span>
            {ROLE_EXPLANATION[role]}
            <span className="font-mono text-ink-soft">({roleCounts[role]})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------- inspector

function ModuleInspector({
  file,
  onClose,
  onSelectPath,
}: {
  file: SemanticFile;
  onClose: () => void;
  onSelectPath: (path: string) => void;
}) {
  const Icon = ROLE_ICON[file.role];
  const related = [...new Set([...file.imports, ...file.importedBy])];
  return (
    <aside
      aria-label="Module inspector"
      className="w-full shrink-0 rounded-2xl border border-border bg-surface p-4 lg:w-[300px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-semibold text-ink" title={file.path}>
            {fileName(file.path)}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-ink-soft" title={file.path}>
            {file.path}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close module inspector"
          className="shrink-0 rounded-md p-1 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-1.5 rounded-md border border-border bg-surface-muted/50 px-2 py-1">
        <Icon className="h-3.5 w-3.5" style={{ color: ROLE_COLOR[file.role] }} />
        <span className="text-[11px] font-medium text-ink">{ROLE_LABEL[file.role]}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <StatChip label="Criticality" value={file.criticality.toFixed(2)} />
        <StatChip label="Churn weight" value={file.churnWeight.toFixed(2)} />
        <StatChip label="Imports" value={file.imports.length} />
        <StatChip label="Imported by" value={file.importedBy.length} />
        <StatChip label="Functions" value="Not measured" />
        <StatChip label="Tests" value="Not measured" />
      </div>

      {related.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-soft">Related modules</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {related.slice(0, 12).map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => onSelectPath(path)}
                className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-soft transition-colors hover:bg-primary/10 hover:text-primary"
                title={path}
              >
                {fileName(path)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

// ------------------------------------------------------------- architecture

function ArchitectureTree({
  files,
  roleCounts,
  selectedPath,
  onSelect,
}: {
  files: SemanticFile[];
  roleCounts: Record<SemanticRole, number>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const byRole = useMemo(() => {
    const map = new Map<SemanticRole, SemanticFile[]>();
    for (const role of SEMANTIC_ROLES) map.set(role, []);
    for (const f of files) map.get(f.role)?.push(f);
    return map;
  }, [files]);

  const presentRoles = SEMANTIC_ROLES.filter((r) => (roleCounts[r] ?? 0) > 0);

  return (
    <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border bg-surface-muted/30 p-2.5">
      <div className="px-1 py-1 font-mono text-[11px] font-semibold text-ink">APPLICATION</div>
      <ul>
        {presentRoles.map((role, ri) => {
          const roleFiles = byRole.get(role) ?? [];
          const Icon = ROLE_ICON[role];
          const isLastRole = ri === presentRoles.length - 1;
          return (
            <li key={role}>
              <div className="flex items-center gap-1 py-0.5 pl-2 font-mono text-[11px]">
                <span className="w-3.5 shrink-0 select-none text-center text-ink-soft/40">
                  {isLastRole ? "└─" : "├─"}
                </span>
                <Icon className="h-3 w-3 shrink-0" style={{ color: ROLE_COLOR[role] }} />
                <span className="font-semibold text-ink">{ROLE_LABEL[role]}</span>
                <span className="text-[9px] text-ink-soft/60">({roleFiles.length})</span>
              </div>
              <ul>
                {roleFiles.map((f, fi) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => onSelect(f.path)}
                      className={`flex w-full items-center gap-1 rounded px-1 py-[3px] pl-8 text-left font-mono text-[11px] transition-colors hover:bg-surface-muted ${
                        f.path === selectedPath ? "bg-primary/10 text-primary" : "text-ink"
                      }`}
                    >
                      <span className="w-3.5 shrink-0 select-none text-ink-soft/25">
                        {isLastRole ? " " : "│"}
                      </span>
                      <span className="w-3.5 shrink-0 select-none text-ink-soft/40">
                        {fi === roleFiles.length - 1 ? "└─" : "├─"}
                      </span>
                      <span className="truncate">{fileName(f.path)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ relationships

interface Positioned {
  file: SemanticFile;
  x: number;
  y: number;
}

function layoutByRole(files: SemanticFile[]): {
  positions: Map<string, Positioned>;
  width: number;
  height: number;
} {
  const COL_GAP = 190;
  const ROW_GAP = 26;
  const byRole = new Map<SemanticRole, SemanticFile[]>();
  for (const role of SEMANTIC_ROLES) byRole.set(role, []);
  for (const f of files) byRole.get(f.role)?.push(f);

  const positions = new Map<string, Positioned>();
  let colIndex = 0;
  let maxRows = 1;
  for (const role of SEMANTIC_ROLES) {
    const roleFiles = byRole.get(role) ?? [];
    if (roleFiles.length === 0) continue;
    roleFiles.forEach((f, row) => {
      positions.set(f.path, { file: f, x: colIndex * COL_GAP, y: row * ROW_GAP });
    });
    maxRows = Math.max(maxRows, roleFiles.length);
    colIndex += 1;
  }
  return {
    positions,
    width: Math.max(1, colIndex * COL_GAP),
    height: Math.max(1, maxRows * ROW_GAP),
  };
}

function RelationshipsView({
  files,
  edges,
  selectedPath,
  matchSet,
  onSelect,
}: {
  files: SemanticFile[];
  edges: [string, string][];
  selectedPath: string | null;
  matchSet: Set<string> | null;
  onSelect: (path: string) => void;
}) {
  const rendered = useMemo(() => files.slice(0, MAX_RELATIONSHIP_NODES), [files]);
  const layout = useMemo(() => layoutByRole(rendered), [rendered]);
  const renderedSet = useMemo(() => new Set(rendered.map((f) => f.path)), [rendered]);
  const visibleEdges = useMemo(
    () => edges.filter(([a, b]) => renderedSet.has(a) && renderedSet.has(b)),
    [edges, renderedSet],
  );

  return (
    <div className="overflow-auto rounded-lg border border-border bg-surface-muted/30">
      <svg
        role="img"
        aria-label="Semantic role relationships"
        width={layout.width + 220}
        height={Math.max(240, layout.height + 40)}
        className="block"
      >
        <g transform="translate(90, 20)">
          {visibleEdges.map(([a, b], i) => {
            const pa = layout.positions.get(a);
            const pb = layout.positions.get(b);
            if (!pa || !pb) return null;
            const dimmed = matchSet && !(matchSet.has(a) || matchSet.has(b));
            return (
              <line
                key={`${a}-${b}-${i}`}
                x1={pa.x + 6}
                y1={pa.y + 4}
                x2={pb.x + 6}
                y2={pb.y + 4}
                stroke="currentColor"
                strokeWidth={0.8}
                className={dimmed ? "text-border/20" : "text-border"}
              />
            );
          })}
          {[...layout.positions.values()].map((p) => {
            const dimmed = matchSet && !matchSet.has(p.file.path);
            const isSelected = p.file.path === selectedPath;
            return (
              <g
                key={p.file.path}
                transform={`translate(${p.x} ${p.y})`}
                className={`cursor-pointer transition-opacity duration-150 ${dimmed ? "opacity-25" : "opacity-100"}`}
                onClick={() => onSelect(p.file.path)}
              >
                <title>{p.file.path}</title>
                <circle
                  r={isSelected ? 6 : 4.5}
                  fill={ROLE_COLOR[p.file.role]}
                  stroke={isSelected ? "hsl(var(--primary))" : "transparent"}
                  strokeWidth={isSelected ? 2.5 : 0}
                />
                <text
                  x={9}
                  y={4}
                  className={`fill-current font-mono text-[9px] ${
                    isSelected ? "text-ink font-semibold" : "text-ink-soft"
                  }`}
                >
                  {fileName(p.file.path)}
                </text>
              </g>
            );
          })}
          {SEMANTIC_ROLES.filter((r) => layout.positions.size > 0).map((role, i) => {
            const has = [...layout.positions.values()].some((p) => p.file.role === role);
            if (!has) return null;
            const colIndex =
              SEMANTIC_ROLES.filter(
                (r2, i2) =>
                  i2 <= i && [...layout.positions.values()].some((p) => p.file.role === r2),
              ).length - 1;
            return (
              <text
                key={role}
                x={colIndex * 190}
                y={-6}
                className="fill-current font-mono text-[9px] font-semibold uppercase tracking-wider"
                style={{ color: ROLE_COLOR[role] }}
              >
                {ROLE_LABEL[role]}
              </text>
            );
          })}
        </g>
      </svg>
      {files.length > rendered.length && (
        <p className="border-t border-border px-2 py-1.5 text-[10px] text-ink-soft">
          Showing the {rendered.length} highest-criticality of {files.length} files — the full graph
          is too large to render legibly. Use Table to see every file.
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- table

function FilesTable({
  files,
  selectedPath,
  onSelect,
}: {
  files: SemanticFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const rows = files.slice(0, 300);
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-[9px] uppercase tracking-wider text-ink-soft">
            <th className="px-2 py-1.5 font-medium">Path</th>
            <th className="px-2 py-1.5 font-medium">Role</th>
            <th className="px-2 py-1.5 text-right font-medium">Criticality</th>
            <th className="px-2 py-1.5 text-right font-medium">Churn</th>
            <th className="px-2 py-1.5 text-right font-medium">Imports</th>
            <th className="px-2 py-1.5 text-right font-medium">Imported by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr
              key={f.path}
              onClick={() => onSelect(f.path)}
              className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-surface-muted ${
                f.path === selectedPath ? "bg-primary/5" : ""
              }`}
            >
              <td className="max-w-[220px] truncate px-2 py-1 font-mono text-ink" title={f.path}>
                {f.path}
              </td>
              <td className="px-2 py-1">
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    color: ROLE_COLOR[f.role],
                    background: `color-mix(in srgb, ${ROLE_COLOR[f.role]} 14%, transparent)`,
                  }}
                >
                  {ROLE_LABEL[f.role]}
                </span>
              </td>
              <td className="px-2 py-1 text-right font-mono text-ink">
                {f.criticality.toFixed(2)}
              </td>
              <td className="px-2 py-1 text-right font-mono text-ink-soft">
                {f.churnWeight.toFixed(2)}
              </td>
              <td className="px-2 py-1 text-right font-mono text-ink-soft">{f.imports.length}</td>
              <td className="px-2 py-1 text-right font-mono text-ink-soft">
                {f.importedBy.length}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {files.length > rows.length && (
        <div className="border-t border-border px-2 py-1.5 text-[10px] text-ink-soft">
          Showing {rows.length} of {files.length} files.
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- panel

export function SemanticArchitecturePanel({
  runId,
  status,
}: {
  runId: string;
  /** The agent's live status — refetches once A1 transitions to a settled state. */
  status?: AgentStatus;
}) {
  const [graph, setGraph] = useState<SemanticGraphExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [viewMode, setViewMode] = useState<ViewMode>("architecture");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSemanticGraph(runId)
      .then((g) => {
        if (!cancelled) setGraph(g);
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
    // Refetch when the agent settles (running -> completed/failed) so a panel
    // mounted while A1 was still executing picks up the graph without a
    // manual retry, without polling while nothing has changed.
  }, [runId, attempt, status]);

  const search_ = search.trim().toLowerCase();
  const filteredFiles = useMemo(() => {
    if (!graph) return [];
    if (!search_) return graph.files;
    return graph.files.filter(
      (f) =>
        f.path.toLowerCase().includes(search_) ||
        ROLE_LABEL[f.role].toLowerCase().includes(search_) ||
        f.role.includes(search_),
    );
  }, [graph, search_]);

  const matchSet = useMemo(() => {
    if (!search_ || !graph) return null;
    return new Set(filteredFiles.map((f) => f.path));
  }, [search_, graph, filteredFiles]);

  const selectedFile = graph?.files.find((f) => f.path === selectedPath) ?? null;

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Semantic Architecture Map
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Loading…</p>
      </section>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (!graph) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Semantic Architecture Map
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "Semantic mapping — running. A1 is classifying files now; this panel renders once it publishes."
            : "Pending — A1 has not published a semantic graph for this run yet."}
        </p>
      </section>
    );
  }

  if (graph.files.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Semantic Architecture Map
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          A1 completed but classified no production files in this repository.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Semantic Architecture Map
        </h3>
        <p className="mt-0.5 text-[11px] text-ink-soft">
          A1 reads the structural graph A0.5 already built and assigns each production file one of
          six architectural roles — what the code appears to do, not what it contains. This is not
          the repository containment graph; it is a role-grouped view over {graph.totalFiles}{" "}
          classified files.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <StatChip label="Files classified" value={graph.totalFiles} />
        <StatChip label="Import edges" value={graph.totalEdges} />
        <StatChip label="Source roots" value={graph.sourceRoots.length} />
        <StatChip
          label="Roles present"
          value={SEMANTIC_ROLES.filter((r) => (graph.roleCounts[r] ?? 0) > 0).length}
        />
      </div>

      <RoleDistribution roleCounts={graph.roleCounts} />
      <SemanticExplanation roleCounts={graph.roleCounts} />
      <SemanticHotspots files={graph.files} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5">
          {(
            [
              ["architecture", FolderTree, "Architecture"],
              ["relationships", Network, "Relationships"],
              ["table", Table2, "Table"],
            ] as const
          ).map(([mode, Icon, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                viewMode === mode
                  ? "bg-primary/10 text-primary"
                  : "text-ink-soft hover:bg-surface-muted"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-soft" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files or roles…"
            aria-label="Search semantic graph"
            className="w-full rounded-md border border-border bg-surface py-1 pl-7 pr-2 text-[11px] text-ink outline-none focus:border-primary/50"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="min-w-0 flex-1">
          {viewMode === "architecture" && (
            <ArchitectureTree
              files={filteredFiles}
              roleCounts={graph.roleCounts}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          )}
          {viewMode === "relationships" && (
            <RelationshipsView
              files={graph.files}
              edges={graph.edges}
              selectedPath={selectedPath}
              matchSet={matchSet}
              onSelect={setSelectedPath}
            />
          )}
          {viewMode === "table" && (
            <FilesTable
              files={filteredFiles}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          )}
        </div>

        {selectedFile && (
          <ModuleInspector
            file={selectedFile}
            onClose={() => setSelectedPath(null)}
            onSelectPath={setSelectedPath}
          />
        )}
      </div>

      <p className="text-[10px] text-ink-soft">
        Explain: semantic roles represent architectural responsibilities A1 detected — this is
        different from A0.5&apos;s repository containment graph above, which shows structure, not
        meaning. Source:{" "}
        <code className="font-mono">GET /api/runs/{"{run_id}"}/semantic-graph</code>
      </p>
    </section>
  );
}
