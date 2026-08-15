/**
 * A3 — Findings Funnel + Prioritization Ledger.
 *
 * Everything on this panel comes from `GET /api/runs/{runId}/static-findings`
 * (`services/ui_projection.py::build_static_findings`, sourced from A3's own
 * `StaticAnalysisReport`). No severity band, cluster count, or ranking is
 * computed client-side: `severity` renders exactly as A3 recorded it,
 * `severityMeasured` gates whether it is shown as a number at all (bandit
 * alone derives severity from a real per-finding measurement — semgrep and
 * ruff assign a scanner-wide constant), and `findings` is already the
 * backend's own `blast_radius_score` ordering, never re-sorted here.
 *
 * Deliberately not a tree or a node-link graph — A0.5, A1 and A2 are all
 * grouped views over the repository; A3's own work is a *pipeline*
 * (scan → cluster → prioritize) whose central question is "why did this rank
 * first", so this panel is a flow plus a ranked, explainable ledger.
 *
 * There is no synthetic "scanning" animation, no fake progress, and no
 * fabricated "clustered" count: A3's durable contract has `rawCount` and the
 * final `prioritizedCount` but not the pre-truncation cluster total, so the
 * clustering step is described as a transformation, never given an invented
 * number.
 */
import { useEffect, useMemo, useState } from "react";
import { Search, Table2, ListOrdered, X, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import type { ScannerOutcome, StaticFinding, StaticFindingsReport } from "./staticFindingsTypes";
import { getStaticFindings } from "@/lib/runService";
import type { AgentStatus } from "./data";

type ViewMode = "ledger" | "table";
type SeverityFilter = "measured" | "unmeasured";
type ConsensusFilter = "consensus" | "single";

const SCANNER_ORDER = ["bandit", "semgrep", "ruff"];

const STATUS_LABEL: Record<ScannerOutcome, string> = {
  ok: "completed",
  ok_no_findings: "completed — no findings",
  unavailable: "unavailable",
  stubbed: "stubbed (fallback heuristic)",
};

const STATUS_ICON: Record<ScannerOutcome, typeof CheckCircle2> = {
  ok: CheckCircle2,
  ok_no_findings: CheckCircle2,
  unavailable: XCircle,
  stubbed: HelpCircle,
};

const STATUS_COLOR: Record<ScannerOutcome, string> = {
  ok: "#16a34a",
  ok_no_findings: "#16a34a",
  unavailable: "#dc2626",
  stubbed: "#d97706",
};

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load static analysis</span>
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

function SeverityValue({ finding }: { finding: StaticFinding }) {
  if (!finding.severityMeasured) {
    return <span className="text-ink-soft">Not measured</span>;
  }
  return <span className="font-mono text-ink">{finding.severity.toFixed(2)}</span>;
}

function ConsensusValue({ finding }: { finding: StaticFinding }) {
  return finding.consensus ? (
    <span className="inline-flex items-center gap-1 text-status-completed">
      <CheckCircle2 className="h-3 w-3" /> Consensus
    </span>
  ) : (
    <span className="text-ink-soft">Single-tool finding</span>
  );
}

// -------------------------------------------------------------- funnel

function ScannerFunnel({ report }: { report: StaticFindingsReport }) {
  const scanners = SCANNER_ORDER.filter((s) => s in report.scannerStatus);
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Scanner analysis
      </div>
      <ul className="space-y-1 rounded-lg border border-border bg-surface-muted/30 p-2.5">
        {scanners.map((name) => {
          const status = report.scannerStatus[name];
          const Icon = STATUS_ICON[status];
          return (
            <li key={name} className="flex items-center gap-2 text-[11px]">
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: STATUS_COLOR[status] }} />
              <span className="w-16 shrink-0 font-medium capitalize text-ink">{name}</span>
              <span className="text-ink-soft">{STATUS_LABEL[status]}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-col items-stretch gap-1.5 text-[11px]">
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-muted/50 px-2.5 py-1.5">
          <span className="text-ink-soft">Raw findings</span>
          <span className="font-mono font-semibold text-ink">{report.rawCount}</span>
        </div>
        <div className="px-2.5 text-center text-[10px] text-ink-soft">
          ↓ clustered by file and nearby line, ranked by blast-radius score ↓
        </div>
        <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5">
          <span className="text-ink-soft">
            Prioritized (top {Math.min(8, report.prioritizedCount || 8)})
          </span>
          <span className="font-mono font-semibold text-ink">{report.prioritizedCount}</span>
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-ink-soft">
        Explain: A3&apos;s own pipeline — {scanners.length} scanner(s) invoked, findings clustered
        by proximity, ranked by blast-radius score, truncated to the top 8. The pre-truncation
        cluster count is not part of the durable contract, so it is described here, not counted.
        Source: <code className="font-mono">scannerStatus</code>,{" "}
        <code className="font-mono">rawCount</code>.
      </p>
    </div>
  );
}

// ------------------------------------------------------------- ledger

function LedgerRow({
  finding,
  selected,
  onSelect,
}: {
  finding: StaticFinding;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
          selected ? "border-primary/40 bg-primary/5" : "border-border hover:bg-surface-muted"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink">
            #{finding.rank}
          </span>
          <span className="truncate font-mono text-[11px] text-ink" title={finding.file}>
            {finding.file}:{finding.line}
          </span>
        </div>
        <div className="truncate text-[11px] text-ink-soft">{finding.message}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span className="text-ink-soft">
            {finding.tools.length > 0 ? finding.tools.join(", ") : "unknown tool"}
          </span>
          <SeverityValue finding={finding} />
          <ConsensusValue finding={finding} />
          <span className="ml-auto font-mono text-ink">
            blast {finding.blastRadiusScore.toFixed(3)}
          </span>
        </div>
      </button>
    </li>
  );
}

function PrioritizationLedger({
  findings,
  selectedId,
  onSelect,
}: {
  findings: StaticFinding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (findings.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface-muted/30 p-3 text-[11px] text-ink-soft">
        No prioritized findings match the current filters.
      </p>
    );
  }
  return (
    <ol className="max-h-[420px] space-y-1.5 overflow-y-auto">
      {findings.map((f) => (
        <LedgerRow
          key={f.id}
          finding={f}
          selected={f.id === selectedId}
          onSelect={() => onSelect(f.id)}
        />
      ))}
    </ol>
  );
}

// -------------------------------------------------------------- table

function FindingsTable({
  findings,
  selectedId,
  onSelect,
}: {
  findings: StaticFinding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-[9px] uppercase tracking-wider text-ink-soft">
            <th className="px-2 py-1.5 font-medium">Rank</th>
            <th className="px-2 py-1.5 font-medium">File</th>
            <th className="px-2 py-1.5 font-medium">Line</th>
            <th className="px-2 py-1.5 font-medium">Message</th>
            <th className="px-2 py-1.5 font-medium">Tools</th>
            <th className="px-2 py-1.5 font-medium">Severity</th>
            <th className="px-2 py-1.5 font-medium">Consensus</th>
            <th className="px-2 py-1.5 text-right font-medium">Blast radius</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr
              key={f.id}
              onClick={() => onSelect(f.id)}
              className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-surface-muted ${
                f.id === selectedId ? "bg-primary/5" : ""
              }`}
            >
              <td className="px-2 py-1 font-mono text-ink">#{f.rank}</td>
              <td className="max-w-[200px] truncate px-2 py-1 font-mono text-ink" title={f.file}>
                {f.file}
              </td>
              <td className="px-2 py-1 font-mono text-ink-soft">{f.line}</td>
              <td className="max-w-[220px] truncate px-2 py-1 text-ink-soft" title={f.message}>
                {f.message}
              </td>
              <td className="px-2 py-1 font-mono text-ink-soft">{f.tools.join(", ") || "—"}</td>
              <td className="px-2 py-1">
                <SeverityValue finding={f} />
              </td>
              <td className="px-2 py-1">
                <ConsensusValue finding={f} />
              </td>
              <td className="px-2 py-1 text-right font-mono text-ink">
                {f.blastRadiusScore.toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------- detail

function ScoreRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[10px] uppercase tracking-wider text-ink-soft">{label}</span>
      <span className="font-mono text-[11px] text-ink">{value}</span>
    </div>
  );
}

function FindingDetail({ finding, onClose }: { finding: StaticFinding; onClose: () => void }) {
  return (
    <aside
      aria-label="Finding detail"
      className="w-full shrink-0 rounded-2xl border border-border bg-surface p-4 lg:w-[320px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[13px] font-semibold text-ink">
            Finding #{finding.rank}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-ink-soft" title={finding.file}>
            {finding.file}:{finding.line}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close finding detail"
          className="shrink-0 rounded-md p-1 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mt-2 text-[11px] text-ink">{finding.message}</p>

      <div className="mt-3 divide-y divide-border/60 border-t border-border/60">
        <ScoreRow label="Contributing tools" value={finding.tools.join(", ") || "unknown"} />
        <ScoreRow
          label="Severity"
          value={finding.severityMeasured ? finding.severity.toFixed(2) : "Not measured"}
        />
        <ScoreRow label="Severity measured?" value={finding.severityMeasured ? "Yes" : "No"} />
        <ScoreRow
          label="Consensus"
          value={finding.consensus ? "Yes" : "No (single-tool finding)"}
        />
        <ScoreRow label="Blast radius score" value={finding.blastRadiusScore.toFixed(4)} />
        <ScoreRow label="File criticality" value={finding.criticality.toFixed(2)} />
        <ScoreRow label="Churn weight" value={finding.churnWeight.toFixed(2)} />
        <ScoreRow label="Column" value="Not measured" />
        <ScoreRow label="Confidence" value="Not measured" />
        <ScoreRow label="Category" value="Not measured" />
        <ScoreRow label="Remediation" value="Not measured" />
        <ScoreRow label="Rule ID" value="Not measured" />
      </div>

      {/* Score decomposition — every value already computed by A3; the score
          itself (`blastRadiusScore`) is never recomputed here. */}
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-soft">
          Why #{finding.rank}?
        </div>
        <div className="mt-1 space-y-0.5 rounded-md border border-border bg-surface-muted/40 p-2 font-mono text-[10px] text-ink-soft">
          <div>
            Severity{" "}
            <span className="text-ink">
              {finding.severityMeasured ? finding.severity.toFixed(2) : "Not measured"}
            </span>
          </div>
          <div>
            File criticality <span className="text-ink">{finding.criticality.toFixed(2)}</span>
          </div>
          <div>
            Tool contribution{" "}
            <span className="text-ink">
              {finding.tools.length} tool{finding.tools.length === 1 ? "" : "s"}
              {finding.tools.length > 0 ? ` (${finding.tools.join(", ")})` : ""}
            </span>
          </div>
          <div>
            Churn <span className="text-ink">{finding.churnWeight.toFixed(2)}</span>
          </div>
          <div className="mt-1 border-t border-border/60 pt-1 text-ink">
            Blast-radius score {finding.blastRadiusScore.toFixed(4)}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[10px] text-ink-soft">
        Evidence source:{" "}
        <code className="font-mono">GET /api/runs/{"{run_id}"}/static-findings → findings[]</code>
      </p>
    </aside>
  );
}

// -------------------------------------------------------------- checklist

function FindingsExplanation({ report }: { report: StaticFindingsReport }) {
  const measuredCount = report.findings.filter((f) => f.severityMeasured).length;
  const consensusCount = report.findings.filter((f) => f.consensus).length;
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        Static analysis
      </div>
      <ul className="space-y-1 text-[11px] text-ink">
        <li className="flex items-center gap-1.5">
          <span className="text-status-completed">✓</span>
          {report.rawCount} raw finding{report.rawCount === 1 ? "" : "s"} collected
        </li>
        <li className="flex items-center gap-1.5">
          <span className={report.prioritizedCount > 0 ? "text-status-completed" : "text-ink-soft"}>
            {report.prioritizedCount > 0 ? "✓" : "—"}
          </span>
          {report.prioritizedCount} prioritized finding{report.prioritizedCount === 1 ? "" : "s"}
        </li>
        {report.findings.length > 0 && (
          <>
            <li className="flex items-center gap-1.5">
              <span className={consensusCount > 0 ? "text-status-completed" : "text-ink-soft"}>
                {consensusCount > 0 ? "✓" : "—"}
              </span>
              {consensusCount} confirmed by more than one scanner
            </li>
            <li className="flex items-center gap-1.5">
              <span className="text-status-retry">—</span>
              {report.findings.length - measuredCount} of {report.findings.length} findings have an
              unmeasured severity
            </li>
          </>
        )}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------- panel

export function StaticFindingsPanel({ runId, status }: { runId: string; status?: AgentStatus }) {
  const [report, setReport] = useState<StaticFindingsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [viewMode, setViewMode] = useState<ViewMode>("ledger");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [scannerFilter, setScannerFilter] = useState<Set<string> | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Set<SeverityFilter> | null>(null);
  const [consensusFilter, setConsensusFilter] = useState<Set<ConsensusFilter> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getStaticFindings(runId)
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

  const availableScanners = useMemo(() => {
    if (!report) return [];
    return [...new Set(report.findings.flatMap((f) => f.tools))].sort();
  }, [report]);
  const activeScanners = useMemo(
    () => scannerFilter ?? new Set(availableScanners),
    [scannerFilter, availableScanners],
  );

  const search_ = search.trim().toLowerCase();
  const filteredFindings = useMemo(() => {
    if (!report) return [];
    return report.findings.filter((f) => {
      if (f.tools.length > 0 && !f.tools.some((t) => activeScanners.has(t))) return false;
      if (severityFilter) {
        const bucket: SeverityFilter = f.severityMeasured ? "measured" : "unmeasured";
        if (!severityFilter.has(bucket)) return false;
      }
      if (consensusFilter) {
        const bucket: ConsensusFilter = f.consensus ? "consensus" : "single";
        if (!consensusFilter.has(bucket)) return false;
      }
      if (!search_) return true;
      return f.file.toLowerCase().includes(search_) || f.message.toLowerCase().includes(search_);
    });
  }, [report, activeScanners, severityFilter, consensusFilter, search_]);

  const selectedFinding = report?.findings.find((f) => f.id === selectedId) ?? null;

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Static Analysis
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Static analysis loading…</p>
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
          Static Analysis
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "RUNNING — A3 is scanning now; this panel renders once it publishes."
            : "Pending — A3 has not completed yet."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Static Analysis
        </h3>
        <p className="mt-0.5 text-[11px] text-ink-soft">
          A3 runs bandit, semgrep and ruff, clusters their raw output by file and nearby line, and
          ranks the result by blast-radius score — severity weighted by the file&apos;s criticality,
          how many tools agree, and how often the file changes. This is a prioritization pipeline,
          not a repository or role graph.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <StatChip label="Raw findings" value={report.rawCount} />
        <StatChip label="Prioritized" value={report.prioritizedCount} />
        <StatChip
          label="Scanners available"
          value={
            Object.values(report.scannerStatus).filter((s) => s === "ok" || s === "ok_no_findings")
              .length
          }
        />
      </div>

      <ScannerFunnel report={report} />
      <FindingsExplanation report={report} />

      {report.prioritizedCount === 0 ? (
        <div className="rounded-lg border border-status-completed/30 bg-status-completed-bg/40 p-3 text-[11px] text-ink">
          <div className="font-semibold text-status-completed">Static analysis completed</div>
          <p className="mt-1 text-ink-soft">No prioritized findings were reported.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              {(
                [
                  ["ledger", ListOrdered, "Ledger"],
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
                placeholder="Search file or message…"
                aria-label="Search findings"
                className="w-full rounded-md border border-border bg-surface py-1 pl-7 pr-2 text-[11px] text-ink outline-none focus:border-primary/50"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {availableScanners.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by scanner">
                {availableScanners.map((s) => {
                  const on = activeScanners.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        setScannerFilter((prev) => {
                          const base = prev ?? new Set(availableScanners);
                          const next = new Set(base);
                          if (next.has(s)) next.delete(s);
                          else next.add(s);
                          return next;
                        })
                      }
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                        on ? "border-border text-ink" : "border-border/50 text-ink-soft opacity-50"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            )}

            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Filter by severity measurement"
            >
              {(["measured", "unmeasured"] as const).map((bucket) => {
                const active = severityFilter ?? new Set(["measured", "unmeasured"]);
                const on = active.has(bucket);
                return (
                  <button
                    key={bucket}
                    type="button"
                    onClick={() =>
                      setSeverityFilter((prev) => {
                        const base =
                          prev ?? new Set(["measured", "unmeasured"] as SeverityFilter[]);
                        const next = new Set(base);
                        if (next.has(bucket)) next.delete(bucket);
                        else next.add(bucket);
                        return next;
                      })
                    }
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      on ? "border-border text-ink" : "border-border/50 text-ink-soft opacity-50"
                    }`}
                  >
                    {bucket === "measured" ? "Severity measured" : "Severity not measured"}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by consensus">
              {(["consensus", "single"] as const).map((bucket) => {
                const active = consensusFilter ?? new Set(["consensus", "single"]);
                const on = active.has(bucket);
                return (
                  <button
                    key={bucket}
                    type="button"
                    onClick={() =>
                      setConsensusFilter((prev) => {
                        const base = prev ?? new Set(["consensus", "single"] as ConsensusFilter[]);
                        const next = new Set(base);
                        if (next.has(bucket)) next.delete(bucket);
                        else next.add(bucket);
                        return next;
                      })
                    }
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      on ? "border-border text-ink" : "border-border/50 text-ink-soft opacity-50"
                    }`}
                  >
                    {bucket === "consensus" ? "Consensus" : "Single-tool"}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="min-w-0 flex-1">
              {viewMode === "ledger" && (
                <PrioritizationLedger
                  findings={filteredFindings}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}
              {viewMode === "table" && (
                <FindingsTable
                  findings={filteredFindings}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}
            </div>

            {selectedFinding && (
              <FindingDetail finding={selectedFinding} onClose={() => setSelectedId(null)} />
            )}
          </div>
        </>
      )}

      <p className="text-[10px] text-ink-soft">
        Explain: findings are A3&apos;s own scan-cluster-rank pipeline over this repository&apos;s
        source — distinct from A0.5&apos;s structure, A1&apos;s roles, and A2&apos;s dependency
        risk. Source: <code className="font-mono">GET /api/runs/{"{run_id}"}/static-findings</code>
      </p>
    </section>
  );
}
