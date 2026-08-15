/**
 * A2 — Dependency Risk Map.
 *
 * Everything on this panel comes from `GET /api/runs/{runId}/dependency-risk`
 * (`services/ui_projection.py::build_dependency_risk`, sourced from A2's own
 * `CVEReachabilityReport`). No advisory, severity, or reachability verdict is
 * computed client-side — `classification` (`Critical` / `Informational` /
 * `Unknown`) is A2's own reachability verdict against A1's import graph, and
 * `severity` is rendered exactly as OSV reported it (a CVSS score or the
 * literal word "HIGH") rather than rebucketed into invented severity bands.
 *
 * Distinct from both A0.5's structural graph and A1's semantic role map: this
 * panel is grouped by reachability verdict, not by containment or role, and
 * its only edges are "package → files that import it" — real SIG edges A2
 * looked up, never guessed from a name.
 *
 * Layout is computed once per report (memoized); there is no synthetic
 * "scanning" animation and no fabricated progress counter — while A2 is
 * running this panel shows exactly that and nothing else.
 */
import { useEffect, useMemo, useState } from "react";
import { Search, Table2, Network, X, ShieldAlert, ShieldQuestion, ShieldCheck } from "lucide-react";
import type {
  DependencyClassification,
  DependencyFinding,
  DependencyRiskReport,
} from "./dependencyRiskTypes";
import { getDependencyRisk } from "@/lib/runService";
import type { AgentStatus } from "./data";

type ViewMode = "riskmap" | "table";

const CLASS_LABEL: Record<DependencyClassification, string> = {
  Critical: "REACHABLE",
  Informational: "NOT REACHABLE",
  Unknown: "UNKNOWN",
};

const CLASS_COLOR: Record<DependencyClassification, string> = {
  Critical: "#dc2626",
  Informational: "#64748b",
  Unknown: "#d97706",
};

const CLASS_ICON: Record<DependencyClassification, typeof ShieldAlert> = {
  Critical: ShieldAlert,
  Informational: ShieldCheck,
  Unknown: ShieldQuestion,
};

const CLASS_ORDER: DependencyClassification[] = ["Critical", "Unknown", "Informational"];

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load dependency analysis</span>
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

function ClassBadge({ classification }: { classification: DependencyClassification }) {
  const Icon = CLASS_ICON[classification];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{
        color: CLASS_COLOR[classification],
        background: `color-mix(in srgb, ${CLASS_COLOR[classification]} 14%, transparent)`,
      }}
    >
      <Icon className="h-3 w-3" />
      {CLASS_LABEL[classification]}
    </span>
  );
}

// ------------------------------------------------------------ distribution

function RiskDistribution({ report }: { report: DependencyRiskReport }) {
  const counts: Record<DependencyClassification, number> = {
    Critical: report.reachableCount,
    Informational: report.informationalCount,
    Unknown: report.unknownCount,
  };
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Dependency risk
      </div>
      <div className="space-y-1">
        {CLASS_ORDER.map((cls) => {
          const count = counts[cls];
          const Icon = CLASS_ICON[cls];
          return (
            <div key={cls} className="flex items-center gap-2">
              <Icon className="h-3 w-3 shrink-0" style={{ color: CLASS_COLOR[cls] }} aria-hidden />
              <span className="w-[130px] shrink-0 truncate text-[10px] text-ink-soft">
                {CLASS_LABEL[cls]}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: count === 0 ? "0%" : `${Math.max(4, (count / max) * 100)}%`,
                    background: CLASS_COLOR[cls],
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
        Explain: reachability verdicts A2 computed by matching each advisory&apos;s package against
        A1&apos;s import graph — not a CVSS severity band. Source:{" "}
        <code className="font-mono">classification</code> per finding.
      </p>
    </div>
  );
}

// -------------------------------------------------------------- checklist

function DependencyExplanation({ report }: { report: DependencyRiskReport }) {
  const lines: { mark: string; text: string; className: string }[] = [];
  lines.push({
    mark: "✓",
    text: `${report.totalDependencies} dependenc${report.totalDependencies === 1 ? "y" : "ies"} analyzed`,
    className: "text-status-completed",
  });
  lines.push({
    mark: report.advisoryCount > 0 ? "✓" : "—",
    text: `${report.advisoryCount} advisor${report.advisoryCount === 1 ? "y" : "ies"} detected`,
    className: report.advisoryCount > 0 ? "text-status-completed" : "text-ink-soft",
  });
  if (report.reachableCount > 0) {
    lines.push({
      mark: "⚠",
      text: `${report.reachableCount} reachable vulnerabilit${report.reachableCount === 1 ? "y" : "ies"}`,
      className: "text-status-failed",
    });
  }
  if (report.unknownCount > 0) {
    lines.push({
      mark: "—",
      text: `${report.unknownCount} dependenc${report.unknownCount === 1 ? "y" : "ies"} with undetermined reachability`,
      className: "text-status-retry",
    });
  }
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Dependency analysis
      </div>
      <ul className="space-y-1">
        {lines.map((l) => (
          <li key={l.text} className="flex items-center gap-1.5 text-[11px] text-ink">
            <span className={l.className}>{l.mark}</span>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------- inspector

function VulnerabilityDetail({
  finding,
  onClose,
}: {
  finding: DependencyFinding;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Vulnerability detail"
      className="w-full shrink-0 rounded-2xl border border-border bg-surface p-4 lg:w-[320px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="truncate font-mono text-[13px] font-semibold text-ink"
            title={finding.package}
          >
            {finding.package}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-ink-soft" title={finding.cveId}>
            {finding.cveId}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close vulnerability detail"
          className="shrink-0 rounded-md p-1 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3">
        <ClassBadge classification={finding.classification} />
      </div>

      <div className="mt-3 divide-y divide-border/60 border-t border-border/60">
        <div className="flex items-baseline justify-between gap-3 py-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-soft">Version</span>
          <span className="font-mono text-[11px] text-ink">
            {finding.installedVersion ?? "Not measured"}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-soft">Severity</span>
          <span className="font-mono text-[11px] text-ink">
            {finding.severity || "Not measured"}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-soft">Reachability</span>
          <span className="font-mono text-[11px] text-ink">
            {finding.reachable === null
              ? "Not measured"
              : finding.reachable
                ? "Reachable"
                : "Not reachable"}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-soft">Affected range</span>
          <span className="font-mono text-[11px] text-ink">Not measured</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-soft">Fixed version</span>
          <span className="font-mono text-[11px] text-ink">Not measured</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-soft">Declared in</span>
          <span className="font-mono text-[11px] text-ink">requirements.txt (direct)</span>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-soft">Code impact</div>
        {finding.reachPath && finding.reachPath.length > 0 ? (
          <div className="mt-1.5 space-y-1 font-mono text-[10px] text-ink-soft">
            <div className="text-ink">{finding.package}</div>
            {finding.reachPath.map((path, i) => (
              <div key={path} className="pl-2">
                {i === finding.reachPath!.length - 1 ? "└── " : "├── "}
                {path}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-ink-soft">
            {finding.reachable === false
              ? "No production file in the indexed source imports this package."
              : "Not measured — the repository index was unavailable when this advisory was matched."}
          </p>
        )}
      </div>

      <p className="mt-3 text-[10px] text-ink-soft">
        Evidence:{" "}
        {finding.reachable === null
          ? "reachability undetermined — A1's semantic graph was not available."
          : finding.reachable
            ? `${finding.reachPath?.length ?? 0} production file(s) import this package.`
            : "no production import of this package was found in A1's semantic graph."}
      </p>
    </aside>
  );
}

// -------------------------------------------------------------- risk map

function RiskMap({
  findings,
  selectedCve,
  onSelect,
}: {
  findings: DependencyFinding[];
  selectedCve: string | null;
  onSelect: (cveId: string) => void;
}) {
  const byClass = useMemo(() => {
    const map = new Map<DependencyClassification, DependencyFinding[]>();
    for (const c of CLASS_ORDER) map.set(c, []);
    for (const f of findings) map.get(f.classification)?.push(f);
    return map;
  }, [findings]);

  const present = CLASS_ORDER.filter((c) => (byClass.get(c) ?? []).length > 0);

  if (present.length === 0) return null;

  return (
    <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border bg-surface-muted/30 p-2.5">
      <div className="px-1 py-1 font-mono text-[11px] font-semibold text-ink">APPLICATION</div>
      <ul>
        {present.map((cls, ci) => {
          const items = byClass.get(cls) ?? [];
          const Icon = CLASS_ICON[cls];
          const isLastClass = ci === present.length - 1;
          return (
            <li key={cls}>
              <div className="flex items-center gap-1 py-0.5 pl-2 font-mono text-[11px]">
                <span className="w-3.5 shrink-0 select-none text-center text-ink-soft/40">
                  {isLastClass ? "└─" : "├─"}
                </span>
                <Icon className="h-3 w-3 shrink-0" style={{ color: CLASS_COLOR[cls] }} />
                <span className="font-semibold text-ink">{CLASS_LABEL[cls]}</span>
                <span className="text-[9px] text-ink-soft/60">({items.length})</span>
              </div>
              <ul>
                {items.map((f, fi) => (
                  <li key={f.cveId}>
                    <button
                      type="button"
                      onClick={() => onSelect(f.cveId)}
                      className={`flex w-full items-center gap-1 rounded px-1 py-[3px] pl-8 text-left font-mono text-[11px] transition-colors hover:bg-surface-muted ${
                        f.cveId === selectedCve ? "bg-primary/10 text-primary" : "text-ink"
                      }`}
                    >
                      <span className="w-3.5 shrink-0 select-none text-ink-soft/25">
                        {isLastClass ? " " : "│"}
                      </span>
                      <span className="w-3.5 shrink-0 select-none text-ink-soft/40">
                        {fi === items.length - 1 ? "└─" : "├─"}
                      </span>
                      <span className="truncate">
                        {f.package} <span className="text-ink-soft">({f.cveId})</span>
                      </span>
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

// ------------------------------------------------------------------ table

function FindingsTable({
  findings,
  selectedCve,
  onSelect,
}: {
  findings: DependencyFinding[];
  selectedCve: string | null;
  onSelect: (cveId: string) => void;
}) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-[9px] uppercase tracking-wider text-ink-soft">
            <th className="px-2 py-1.5 font-medium">Package</th>
            <th className="px-2 py-1.5 font-medium">Version</th>
            <th className="px-2 py-1.5 font-medium">Advisory</th>
            <th className="px-2 py-1.5 font-medium">Severity</th>
            <th className="px-2 py-1.5 font-medium">Reachability</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr
              key={f.cveId}
              onClick={() => onSelect(f.cveId)}
              className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-surface-muted ${
                f.cveId === selectedCve ? "bg-primary/5" : ""
              }`}
            >
              <td className="px-2 py-1 font-mono text-ink">{f.package}</td>
              <td className="px-2 py-1 font-mono text-ink-soft">
                {f.installedVersion ?? "Not measured"}
              </td>
              <td className="px-2 py-1 font-mono text-ink-soft">{f.cveId}</td>
              <td className="px-2 py-1 font-mono text-ink-soft">{f.severity || "Not measured"}</td>
              <td className="px-2 py-1 font-mono text-ink-soft">
                {f.reachable === null
                  ? "Not measured"
                  : f.reachable
                    ? "Reachable"
                    : "Not reachable"}
              </td>
              <td className="px-2 py-1">
                <ClassBadge classification={f.classification} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------- panel

export function DependencyRiskPanel({
  runId,
  status,
}: {
  runId: string;
  /** The agent's live status — refetches once A2 transitions to a settled state. */
  status?: AgentStatus;
}) {
  const [report, setReport] = useState<DependencyRiskReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [viewMode, setViewMode] = useState<ViewMode>("riskmap");
  const [selectedCve, setSelectedCve] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<Set<DependencyClassification> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDependencyRisk(runId)
      .then((r) => {
        if (!cancelled) setReport(r);
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

  const presentClasses = useMemo(() => {
    if (!report) return [];
    return CLASS_ORDER.filter((c) => report.findings.some((f) => f.classification === c));
  }, [report]);
  const activeClasses = useMemo(
    () => classFilter ?? new Set(presentClasses),
    [classFilter, presentClasses],
  );

  const search_ = search.trim().toLowerCase();
  const filteredFindings = useMemo(() => {
    if (!report) return [];
    return report.findings.filter((f) => {
      if (!activeClasses.has(f.classification)) return false;
      if (!search_) return true;
      return f.package.toLowerCase().includes(search_) || f.cveId.toLowerCase().includes(search_);
    });
  }, [report, activeClasses, search_]);

  const selectedFinding = report?.findings.find((f) => f.cveId === selectedCve) ?? null;

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Dependency Risk Map
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Analyzing dependency graph…</p>
      </section>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (!report) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Dependency Risk Map
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "RUNNING — A2 is querying advisories now; this panel renders once it publishes."
            : "Pending — A2 has not completed dependency analysis for this run yet."}
        </p>
      </section>
    );
  }

  if (!report.manifest) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Dependency Risk Map
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          Dependency analysis unavailable — no manifest (requirements.txt) was found in this
          repository.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Dependency Risk Map
        </h3>
        <p className="mt-0.5 text-[11px] text-ink-soft">
          A2 queries OSV for every dependency the manifest declares and narrows each advisory by
          A1&apos;s import graph — whether this repository&apos;s own code actually reaches the
          vulnerable package. This is a risk graph, not the structural or semantic graphs above.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <StatChip label="Dependencies analyzed" value={report.totalDependencies} />
        <StatChip label="Advisories" value={report.advisoryCount} />
        <StatChip label="Reachable" value={report.reachableCount} />
        <StatChip label={`Manifest`} value={`${report.manifest} (${report.ecosystem ?? "—"})`} />
      </div>

      <RiskDistribution report={report} />
      <DependencyExplanation report={report} />

      {report.advisoryCount === 0 ? (
        <div className="rounded-lg border border-status-completed/30 bg-status-completed-bg/40 p-3 text-[11px] text-ink">
          <div className="font-semibold text-status-completed">SAFE DEPENDENCY SET</div>
          <p className="mt-1 text-ink-soft">
            OSV reported no advisories for any of the {report.totalDependencies} dependencies A2
            analyzed from {report.manifest}.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              {(
                [
                  ["riskmap", Network, "Risk Map"],
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
                placeholder="Search package or advisory…"
                aria-label="Search dependencies"
                className="w-full rounded-md border border-border bg-surface py-1 pl-7 pr-2 text-[11px] text-ink outline-none focus:border-primary/50"
              />
            </div>
          </div>

          {presentClasses.length > 1 && (
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Filter by reachability"
            >
              {presentClasses.map((cls) => {
                const on = activeClasses.has(cls);
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() =>
                      setClassFilter((prev) => {
                        const base = prev ?? new Set(presentClasses);
                        const next = new Set(base);
                        if (next.has(cls)) next.delete(cls);
                        else next.add(cls);
                        return next;
                      })
                    }
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      on ? "border-border text-ink" : "border-border/50 text-ink-soft opacity-50"
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: CLASS_COLOR[cls] }}
                    />
                    {CLASS_LABEL[cls]}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="min-w-0 flex-1">
              {viewMode === "riskmap" && (
                <RiskMap
                  findings={filteredFindings}
                  selectedCve={selectedCve}
                  onSelect={setSelectedCve}
                />
              )}
              {viewMode === "table" && (
                <FindingsTable
                  findings={filteredFindings}
                  selectedCve={selectedCve}
                  onSelect={setSelectedCve}
                />
              )}
            </div>

            {selectedFinding && (
              <VulnerabilityDetail finding={selectedFinding} onClose={() => setSelectedCve(null)} />
            )}
          </div>
        </>
      )}

      <p className="text-[10px] text-ink-soft">
        Explain: dependency risk is A2&apos;s own reachability verdict over OSV advisories — not
        A1&apos;s semantic roles or A0.5&apos;s structural graph. Source:{" "}
        <code className="font-mono">GET /api/runs/{"{run_id}"}/dependency-risk</code>
      </p>
    </section>
  );
}
