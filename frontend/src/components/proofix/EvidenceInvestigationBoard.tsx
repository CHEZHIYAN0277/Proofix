/**
 * A4 — Evidence Investigation Board.
 *
 * Answers one question at a glance: *why does ProoFix believe this finding is
 * real?* The board reads top to bottom as the argument itself —
 *
 *   Finding → Evidence sources → Correlation → Root cause → Confidence
 *
 * Everything comes from `GET /api/runs/{runId}/investigation`
 * (`services/ui_projection.py::build_investigation`, sourced from A4's own
 * `InvestigationReport`). No verdict, stance, strength or confidence is
 * computed here — those are A4's judgements over real upstream artifacts, and
 * recomputing any of them in the browser would let the screen disagree with
 * the run.
 *
 * Three distinctions the layout is careful to preserve, because collapsing any
 * of them would make the board lie:
 *
 * 1. A source that **ran and found nothing** is not a source that **could not
 *    run**. The first is a result; the second is rendered "Not measured".
 * 2. Neither of those is evidence *against* the finding. Only the
 *    contradicting column carries that, and today it is populated by exactly
 *    one real signal: a citation the verifier could not anchor to source.
 * 3. `null` confidence means nothing was scored — never 0%.
 *
 * There is no "View source" control: the repository clone is removed when a
 * run ends, so the backend genuinely cannot serve the cited lines, and a
 * button that could not work would be worse than its absence.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FlaskConical,
  HelpCircle,
  MinusCircle,
  Package,
  ScanLine,
  FileCode2,
  XCircle,
} from "lucide-react";
import type {
  ConfidenceComponent,
  EvidenceCategory,
  EvidenceItem,
  EvidenceStatus,
  InvestigationReport,
} from "./investigationTypes";
import { getInvestigation } from "@/lib/runService";
import type { AgentStatus } from "./data";

const CATEGORY_ORDER: EvidenceCategory[] = ["scanner", "reproduction", "source", "dependency"];

const CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  scanner: "Scanners",
  reproduction: "Reproduction",
  source: "Source",
  dependency: "Dependencies",
};

const CATEGORY_ICON: Record<EvidenceCategory, typeof ScanLine> = {
  scanner: ScanLine,
  reproduction: FlaskConical,
  source: FileCode2,
  dependency: Package,
};

/** What each category would prove if it answered — shown when it did not. */
const CATEGORY_EMPTY: Record<EvidenceCategory, string> = {
  scanner: "Scanner evidence — Not measured",
  reproduction: "Reproduction — Unavailable",
  source: "Source evidence — Not measured",
  dependency: "Dependency evidence — Not measured",
};

const STATUS_ICON: Record<EvidenceStatus, typeof CheckCircle2> = {
  present: CheckCircle2,
  absent: MinusCircle,
  unavailable: HelpCircle,
  error: AlertTriangle,
};

const STATUS_COLOR: Record<EvidenceStatus, string> = {
  present: "#16a34a",
  absent: "#64748b",
  unavailable: "#d97706",
  error: "#dc2626",
};

const STATUS_LABEL: Record<EvidenceStatus, string> = {
  present: "reported",
  absent: "nothing found",
  unavailable: "not measured",
  error: "execution error",
};

const REPRODUCTION_LABEL = {
  reproduced: "REPRODUCED",
  not_reproduced: "NOT REPRODUCED",
  unavailable: "UNAVAILABLE",
  error: "EXECUTION ERROR",
} as const;

const REPRODUCTION_COLOR = {
  reproduced: "#16a34a",
  not_reproduced: "#64748b",
  unavailable: "#d97706",
  error: "#dc2626",
} as const;

const INVESTIGATION_LABEL = {
  complete: "COMPLETE",
  partial: "PARTIAL",
  no_finding: "NO FINDING",
  error: "DEGRADED",
} as const;

const INVESTIGATION_COLOR = {
  complete: "#16a34a",
  partial: "#d97706",
  no_finding: "#64748b",
  error: "#dc2626",
} as const;

/** A3's 0..1 severity as a band. Only ever called when a tool measured it. */
function severityBand(severity: number): string {
  if (severity >= 0.8) return "HIGH";
  if (severity >= 0.5) return "MEDIUM";
  return "LOW";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// ------------------------------------------------------------------ chrome

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load the investigation</span>
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

function Flow() {
  return (
    <div className="flex justify-center" aria-hidden>
      <ArrowDown className="h-3.5 w-3.5 text-ink-soft/60" />
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

// ----------------------------------------------------------------- finding

function FindingCard({ report }: { report: InvestigationReport }) {
  if (report.subjectKind === null) {
    return (
      <div
        role="group"
        aria-label="Finding under investigation"
        className="rounded-xl border border-border bg-surface-muted/30 p-3 text-[11px] text-ink-soft"
      >
        No finding — neither a reproduced failure nor a ranked static finding was available to
        investigate. A4 ran; there was nothing for it to take as its subject.
      </div>
    );
  }

  const repro = report.reproductionStatus;
  return (
    <div
      role="group"
      aria-label="Finding under investigation"
      className="rounded-xl border border-border bg-surface-muted/30 p-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">
          {report.findingId ?? "unidentified"}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-ink-soft">
          {report.subjectKind === "runtime_failure" ? "runtime failure" : "static finding"}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-ink">{report.title ?? "Untitled finding"}</p>
      <p className="mt-0.5 font-mono text-[11px] text-ink-soft">
        {report.file ?? "Not measured"}
        {report.line !== null ? `:${report.line}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px]">
        <span className="text-ink-soft">
          Severity:{" "}
          <span className="font-semibold text-ink">
            {report.severity !== null && report.severityMeasured
              ? `${severityBand(report.severity)} (${report.severity.toFixed(2)})`
              : "Not measured"}
          </span>
        </span>
        <span className="text-ink-soft">
          Reproduction:{" "}
          {repro ? (
            <span className="font-semibold" style={{ color: REPRODUCTION_COLOR[repro] }}>
              {REPRODUCTION_LABEL[repro]}
            </span>
          ) : (
            <span className="font-semibold text-ink">Not measured</span>
          )}
        </span>
      </div>
      {report.severity !== null && !report.severityMeasured && (
        <p className="mt-1 text-[10px] text-ink-soft">
          A3 ranked this at {report.severity.toFixed(2)}, but no scanner assigned a severity — the
          number is a ranking input, not a measurement, so no band is shown.
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------- correlation

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const [open, setOpen] = useState(false);
  const Icon = STATUS_ICON[item.status];
  const color = STATUS_COLOR[item.status];
  const detailEntries = Object.entries(item.detail).filter(
    ([, value]) =>
      value !== null && value !== undefined && !(Array.isArray(value) && !value.length),
  );
  const expandable = detailEntries.length > 0 || item.strengthBasis !== null;

  return (
    <li className="border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className="flex w-full items-start gap-1.5 py-1.5 text-left disabled:cursor-default"
      >
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="truncate font-mono text-[11px] text-ink">{item.source}</span>
            <span className="text-[9px] uppercase tracking-wider" style={{ color }}>
              {STATUS_LABEL[item.status]}
            </span>
            {item.stance !== "neutral" && (
              <span
                className="text-[9px] uppercase tracking-wider"
                style={{ color: item.stance === "supporting" ? "#16a34a" : "#dc2626" }}
              >
                {item.stance}
              </span>
            )}
            {item.strength !== null && (
              <span className="font-mono text-[9px] text-ink-soft">
                strength {item.strength.toFixed(2)}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[10px] leading-snug text-ink-soft">
            {item.description}
          </span>
        </span>
        {expandable &&
          (open ? (
            <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-ink-soft" />
          ) : (
            <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-ink-soft" />
          ))}
      </button>
      {open && (
        <div className="pb-2 pl-5">
          {item.strengthBasis && (
            <p className="mb-1 text-[10px] text-ink-soft">Strength: {item.strengthBasis}</p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
            {detailEntries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-ink-soft">{key}</dt>
                <dd className="break-all font-mono text-ink">
                  {Array.isArray(value) ? value.join(", ") : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  );
}

function CategoryCard({
  category,
  items,
  status,
}: {
  category: EvidenceCategory;
  items: EvidenceItem[];
  status: EvidenceStatus | undefined;
}) {
  const [open, setOpen] = useState(true);
  const Icon = CATEGORY_ICON[category];
  const measured = status === "present" || status === "absent";

  return (
    <div
      role="group"
      aria-label={`${CATEGORY_LABEL[category]} evidence`}
      className="rounded-lg border border-border bg-surface-muted/30"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-ink-soft" />
        ) : (
          <ChevronRight className="h-3 w-3 text-ink-soft" />
        )}
        <Icon className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink">
          {CATEGORY_LABEL[category]}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {!measured && <Circle className="h-2 w-2 text-status-pending" aria-hidden />}
          <span className="font-mono text-[10px] text-ink-soft">{items.length}</span>
        </span>
      </button>
      {open && (
        <div className="px-2.5 pb-1">
          {items.length ? (
            <ul>
              {items.map((item) => (
                <EvidenceRow key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <p className="py-1.5 text-[10px] text-ink-soft">{CATEGORY_EMPTY[category]}</p>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- root cause

function RootCauseCard({ report }: { report: InvestigationReport }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted/30 p-3">
      {report.rootCause ? (
        <>
          <p className="text-[12px] leading-relaxed text-ink">{report.rootCause}</p>
          <p className="mt-1.5 text-[10px] text-ink-soft">
            {report.rootCauseSource === "llm"
              ? "Produced by the LLM analysis, then every citation re-verified against source."
              : report.rootCauseSource === "deterministic"
                ? "Produced by the deterministic analysis from the evidence above — no LLM involved."
                : "Provenance not recorded."}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-ink-soft">Root cause — Not measured.</p>
      )}
    </div>
  );
}

// --------------------------------------------------------------- confidence

function ConfidenceSection({
  confidence,
  breakdown,
}: {
  confidence: number | null;
  breakdown: ConfidenceComponent[];
}) {
  const [open, setOpen] = useState(false);

  if (confidence === null) {
    return (
      <div>
        <SectionLabel>Evidence strength</SectionLabel>
        <p className="text-[11px] text-ink-soft">
          Confidence — Not measured. No evidence was available to score, which is not the same as
          scoring zero.
        </p>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel>Evidence strength</SectionLabel>
      <div className="flex items-center gap-2">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-label="Evidence confidence"
          aria-valuenow={Math.round(confidence * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-status-completed"
            style={{ width: `${Math.round(confidence * 100)}%` }}
          />
        </div>
        <span className="font-mono text-sm font-semibold text-ink">{pct(confidence)}</span>
      </div>
      {breakdown.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-1 flex items-center gap-1 text-[10px] font-medium text-ink-soft transition-colors hover:text-ink"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            How this was calculated ({breakdown.length} term
            {breakdown.length === 1 ? "" : "s"})
          </button>
          {open && (
            <ul className="mt-1 space-y-1">
              {breakdown.map((c) => (
                <li key={c.component} className="flex items-baseline gap-2 text-[10px]">
                  <span className="font-mono text-ink">+{c.points.toFixed(2)}</span>
                  <span className="font-medium text-ink">{c.component}</span>
                  <span className="text-ink-soft">{c.basis}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function StanceColumn({
  title,
  items,
  emptyLabel,
  color,
}: {
  title: string;
  items: EvidenceItem[];
  emptyLabel: string;
  color: string;
}) {
  return (
    <div
      role="group"
      aria-label={title}
      className="rounded-lg border border-border bg-surface-muted/30 p-2.5"
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
        {title} ({items.length})
      </div>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id} className="text-[10px] leading-snug">
              <span className="font-mono text-ink">{item.source}</span>
              <span className="text-ink-soft"> — {item.description}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] text-ink-soft">{emptyLabel}</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- board

export function EvidenceInvestigationBoard({
  runId,
  status,
}: {
  runId: string;
  status?: AgentStatus;
}) {
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInvestigation(runId)
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

  const byCategory = useMemo(() => {
    const grouped = new Map<EvidenceCategory, EvidenceItem[]>();
    for (const category of CATEGORY_ORDER) grouped.set(category, []);
    for (const item of report?.evidence ?? []) grouped.get(item.category)?.push(item);
    return grouped;
  }, [report]);

  const supporting = useMemo(
    () => (report?.evidence ?? []).filter((e) => e.stance === "supporting"),
    [report],
  );
  const contradicting = useMemo(
    () => (report?.evidence ?? []).filter((e) => e.stance === "contradicting"),
    [report],
  );

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Evidence Investigation
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Loading investigation…</p>
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
          Evidence Investigation
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "RUNNING — A4 is correlating evidence now; this board renders once it publishes."
            : "Pending — A4 has not completed for this run yet."}
        </p>
      </section>
    );
  }

  const completeness = report.completeness;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
            Evidence Investigation
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-soft">
            Why ProoFix believes this finding is real — every source A4 consulted, and what each one
            actually said.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wider text-ink-soft">Confidence</div>
            <div className="font-mono text-sm font-semibold text-ink">
              {report.confidence === null ? "Not measured" : pct(report.confidence)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wider text-ink-soft">Status</div>
            <div
              className="text-sm font-semibold"
              style={{ color: INVESTIGATION_COLOR[report.status] }}
            >
              {INVESTIGATION_LABEL[report.status]}
            </div>
          </div>
        </div>
      </div>

      {report.errors.length > 0 && (
        <div className="rounded-lg border border-status-failed/30 bg-status-failed-bg/30 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-status-failed">
            <XCircle className="h-3 w-3" aria-hidden />
            Investigation degraded
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {report.errors.map((message) => (
              <li key={message} className="text-[10px] text-ink-soft">
                {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <SectionLabel>Finding</SectionLabel>
        <FindingCard report={report} />
      </div>

      <Flow />

      <div>
        <SectionLabel>Evidence correlation</SectionLabel>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          {CATEGORY_ORDER.map((category) => (
            <CategoryCard
              key={category}
              category={category}
              items={byCategory.get(category) ?? []}
              status={completeness.categoryStatus[category]}
            />
          ))}
        </div>
        <p className="mt-1 text-[10px] text-ink-soft">
          Coverage:{" "}
          {completeness.ratio === null
            ? "Not measured"
            : `${completeness.measuredCategories}/${completeness.totalCategories} evidence categories answered`}
          . A category counts only when its source actually ran — one that could not run is not a
          result, and is never read as evidence against the finding.
        </p>
      </div>

      <Flow />

      <div>
        <SectionLabel>Root cause</SectionLabel>
        <RootCauseCard report={report} />
      </div>

      <Flow />

      <ConfidenceSection confidence={report.confidence} breakdown={report.confidenceBreakdown} />

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <StanceColumn
          title="Supporting evidence"
          items={supporting}
          emptyLabel="Supporting evidence — None measured"
          color="#16a34a"
        />
        <StanceColumn
          title="Contradicting evidence"
          items={contradicting}
          emptyLabel="Contradicting evidence — None measured"
          color="#dc2626"
        />
      </div>

      {report.unavailableSources.length > 0 && (
        <div>
          <SectionLabel>Sources unavailable ({report.unavailableSources.length})</SectionLabel>
          <ul className="space-y-0.5">
            {report.unavailableSources.map((u) => (
              <li key={`${u.source}:${u.reason}`} className="text-[10px] text-ink-soft">
                <span className="font-mono text-ink">{u.source}</span> — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-ink-soft">
        Explain: every item above is A4&apos;s reading of an artifact another agent persisted —
        A3&apos;s scanner outcomes, A3.5&apos;s pytest result, A2&apos;s reachability verdict, and
        the citation verifier&apos;s anchoring result. Source:{" "}
        <code className="font-mono">GET /api/runs/{"{run_id}"}/investigation</code>
      </p>
    </section>
  );
}
