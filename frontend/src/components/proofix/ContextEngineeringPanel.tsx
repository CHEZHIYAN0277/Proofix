/**
 * A5.5 — Context Reduction Funnel.
 *
 * Everything here comes from `GET /api/runs/{runId}/context`
 * (`ContextPackage`, A5.5's own artifact — stored under the run's `context`
 * key, never on `RunStateModel` itself). No count, bar width, glyph or status
 * is invented: every number below is a direct field read, and the two
 * derived facts (which files are "in context", and the relative bar widths)
 * are deterministic set-membership and ratio computations over fields the
 * backend already sent — the same kind of client-side aggregation A1 already
 * does when it groups files by role.
 *
 * Distinct from A5 (blast radius: what changing a file could affect) and A6
 * (the repair plan: what will be changed and in what order). A5.5 answers
 * neither — it answers "what code did ProoFix decide the repair actually
 * needs to see, and did it pass the privacy check before A6/A7 got it."
 *
 * Design: a five-stage funnel is the entire above-the-fold view — no
 * paragraphs, no evidence text, no acceptance criteria. Everything else
 * (why a file ranked, the redaction ledger, extracted source, constraints,
 * timing) is behind a click. There is no "Scanning → Extracting → Redacting"
 * animation: A5.5 emits exactly one started/completed event pair, and
 * animating intermediate stages that do not exist would fake agent activity.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Braces,
  ChevronDown,
  ChevronRight,
  Circle,
  Files,
  Filter,
  FlaskConical,
  Flame,
  FolderCode,
  Link2,
  Lock,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Shuffle,
  Target,
  TrendingDown,
  UserCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ContextPackageModel, ExtractedSymbol, RankedContextFile } from "@/mocks/runReport";
import { getRunContext } from "@/lib/runService";
import type { AgentStatus } from "./data";

// -------------------------------------------------------------- signal glyphs

/** Every signal key the ranker actually writes (`services/context_ranker.py`
 * `.add(...)` call sites), mapped to a static icon and label. Purely
 * presentational — no signal is invented, and a key not in this map still
 * renders (with a generic icon) rather than being silently dropped. */
const SIGNAL_ICON: Record<string, LucideIcon> = {
  target_resolution: Target,
  runtime_stack: Flame,
  reproduction_evidence: Flame,
  root_cause_confidence: FolderCode,
  static_finding: AlertTriangle,
  sig_distance: Link2,
  import_distance: Link2,
  call_graph_distance: Link2,
  dependency_centrality: Link2,
  call_fan_in: Link2,
  call_fan_out: Link2,
  graph_related: Link2,
  git_churn: Activity,
  history_churn: Activity,
  recent_modification: Activity,
  mutation_relevance: Activity,
  prior_repair: Wrench,
  co_change: Shuffle,
  ownership: UserCheck,
  documentation: BookOpen,
  graph_validated: FlaskConical,
  shared_utility_penalty: TrendingDown,
};

const SIGNAL_LABEL: Record<string, string> = {
  target_resolution: "Resolved patch target",
  runtime_stack: "Runtime stack frame",
  reproduction_evidence: "Reproduction evidence",
  root_cause_confidence: "Root-cause citation",
  static_finding: "Static finding",
  sig_distance: "Blast propagation",
  import_distance: "Import distance",
  call_graph_distance: "Call-graph edge",
  dependency_centrality: "Dependency centrality",
  call_fan_in: "Inbound calls",
  call_fan_out: "Outbound calls",
  graph_related: "Knowledge-graph proximity",
  git_churn: "Bug-fix churn",
  history_churn: "Historical churn",
  recent_modification: "Modified earlier this run",
  mutation_relevance: "Validation-failure relevance",
  prior_repair: "Prior successful repair",
  co_change: "Co-change history",
  ownership: "Ownership signal",
  documentation: "Documented",
  graph_validated: "Test coverage",
  shared_utility_penalty: "Shared-utility penalty",
};

function signalLabel(key: string): string {
  return SIGNAL_LABEL[key] ?? key.replace(/_/g, " ");
}

function signalIcon(key: string): LucideIcon {
  return SIGNAL_ICON[key] ?? Circle;
}

/** Nonzero signals only — a zero contributes nothing and must not draw as if it did. */
function nonzeroSignals(signals: Record<string, number>): [string, number][] {
  return Object.entries(signals).filter(([, v]) => v !== 0);
}

/** One signal key per distinct icon for the compact glyph row — several
 * signal keys share one icon (e.g. every dependency-distance signal is a
 * link), and showing the same glyph six times in a row would be noise, not
 * information. The first key to claim an icon lends it its tooltip label. */
function distinctSignalKeys(signals: Record<string, number>): string[] {
  const seenIcons = new Set<LucideIcon>();
  const keys: string[] = [];
  for (const [key] of nonzeroSignals(signals)) {
    const icon = signalIcon(key);
    if (seenIcons.has(icon)) continue;
    seenIcons.add(icon);
    keys.push(key);
  }
  return keys;
}

// ------------------------------------------------------------------ helpers

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
}

/** Which files A5.5's extraction actually kept, derived the same way
 * `context_package.py` itself decides it: the target file counts once any of
 * its extraction lists is non-empty; a supporting file counts once it
 * contributes at least one symbol to `related_utilities`. Not a new fact —
 * a restatement of fields already in the payload. Plain function, not a
 * hook: called only once the package is known to exist. */
function inContextFiles(pkg: ContextPackageModel): Set<string> {
  const set = new Set<string>();
  const targetHasExtraction =
    pkg.relevant_imports.length > 0 ||
    pkg.relevant_classes.length > 0 ||
    pkg.relevant_functions.length > 0 ||
    pkg.constants.length > 0;
  if (targetHasExtraction && pkg.target_file) set.add(pkg.target_file);
  for (const symbol of pkg.related_utilities) {
    if (symbol.file) set.add(symbol.file);
  }
  return set;
}

/** The real in-context files, target first — a presentation order over the
 * genuine membership set, not new data. */
function selectedFiles(pkg: ContextPackageModel, inContextSet: Set<string>): string[] {
  return [...inContextSet].sort((a, b) => {
    if (a === pkg.target_file) return -1;
    if (b === pkg.target_file) return 1;
    return a.localeCompare(b);
  });
}

/** The three symbol categories the funnel's "selected context" is grouped
 * into, derived from `symbol.kind` — the backend's own label
 * (`context_extractor._label_function` / `_label_class` / `_label_constant`),
 * never guessed from the name. `config_object` is deliberately "other": the
 * backend applies that kind to both a config-shaped class and a
 * config-shaped constant, so it is genuinely ambiguous between the two and
 * must not be forced into either. */
type SymbolCategory = "function" | "class" | "other";

const FUNCTION_KINDS = new Set([
  "target_function",
  "dependent_function",
  "caller_function",
  "validation_helper",
  "utility",
]);
const CLASS_KINDS = new Set(["class_definition", "dataclass", "typed_model"]);

function symbolCategory(kind: string): SymbolCategory {
  if (CLASS_KINDS.has(kind)) return "class";
  if (FUNCTION_KINDS.has(kind)) return "function";
  return "other";
}

const CATEGORY_GLYPH: Record<SymbolCategory, string> = {
  function: "ƒ",
  class: "◇",
  other: "•",
};

const CATEGORY_LABEL: Record<SymbolCategory, string> = {
  function: "Function",
  class: "Class",
  other: "Other",
};

interface SelectedSymbol {
  name: string;
  category: SymbolCategory;
  isCallable: boolean;
}

/** Real selected symbols the repair context carries — `relevant_functions`
 * (the target file) plus `related_utilities` (supporting files),
 * deduplicated by name. `category`/`isCallable` come from the backend's own
 * `symbol.kind`, never guessed, so a constant is never labelled with a
 * misleading `()` and a class is never counted as a function. */
function selectedContextSymbols(pkg: ContextPackageModel): SelectedSymbol[] {
  const seen = new Set<string>();
  const out: SelectedSymbol[] = [];
  for (const symbol of [
    ...pkg.relevant_functions,
    ...pkg.relevant_classes,
    ...pkg.constants,
    ...pkg.related_utilities,
  ]) {
    if (!symbol.name || seen.has(symbol.name)) continue;
    seen.add(symbol.name);
    const category = symbolCategory(symbol.kind);
    out.push({ name: symbol.name, category, isCallable: category === "function" });
  }
  return out;
}

/** Extracted symbols grouped by the file they actually came from — every
 * symbol in these four lists already carries its own `.file`. */
function symbolsByFileOf(pkg: ContextPackageModel): Map<string, ExtractedSymbol[]> {
  const map = new Map<string, ExtractedSymbol[]>();
  for (const symbol of [
    ...pkg.relevant_classes,
    ...pkg.relevant_functions,
    ...pkg.constants,
    ...pkg.related_utilities,
  ]) {
    if (!symbol.file) continue;
    const list = map.get(symbol.file) ?? [];
    list.push(symbol);
    map.set(symbol.file, list);
  }
  return map;
}

// ------------------------------------------------------------------ chrome

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load the context package</span>
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

/**
 * A compact row of real names — selected files or selected functions —
 * with a real overflow count rather than an unbounded list, so a large
 * package never grows the card past a glance. Chips, not a sentence: the
 * point of this row is that the names are visible without reading prose.
 */
function ChipRow({ items, max = 6 }: { items: string[]; max?: number }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  const overflow = items.length - shown.length;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {shown.map((label) => (
        <span
          key={label}
          className="max-w-[220px] truncate rounded-md border border-border bg-surface-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft"
          title={label}
        >
          {label}
        </span>
      ))}
      {overflow > 0 && (
        <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-ink-soft/70">
          +{overflow} more
        </span>
      )}
    </div>
  );
}

/**
 * Selected symbols, typed — each chip carries its category glyph (ƒ / ◇ / •)
 * rather than every symbol looking identical regardless of whether it is a
 * function, a class, or a constant. The category comes from the backend's
 * own `symbol.kind`; nothing here infers a type from the name.
 */
function SymbolChipRow({ symbols, max = 8 }: { symbols: SelectedSymbol[]; max?: number }) {
  if (symbols.length === 0) return null;
  const shown = symbols.slice(0, max);
  const overflow = symbols.length - shown.length;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {shown.map((s) => (
        <span
          key={s.name}
          className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-md border border-border bg-surface-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft"
          title={`${CATEGORY_LABEL[s.category]}: ${s.name}`}
        >
          <span aria-hidden className="text-ink-soft/70">
            {CATEGORY_GLYPH[s.category]}
          </span>
          <span className="truncate">
            {s.name}
            {s.isCallable ? "()" : ""}
          </span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-ink-soft/70">
          +{overflow} more
        </span>
      )}
    </div>
  );
}

/**
 * The actual output of A5.5's reduction: which files survived, and what was
 * pulled from them. This is the funnel's final band made concrete — instead
 * of ending on a bare count, the panel shows the real filenames (full
 * repository-relative paths, not basenames) and the real, typed symbol list.
 */
function SelectedContext({
  fileNames,
  symbols,
  lines,
}: {
  fileNames: string[];
  symbols: SelectedSymbol[];
  lines: number;
}) {
  if (fileNames.length === 0 && symbols.length === 0) return null;

  const counts: Record<SymbolCategory, number> = { function: 0, class: 0, other: 0 };
  for (const s of symbols) counts[s.category] += 1;
  const categoryOrder: SymbolCategory[] = ["function", "class", "other"];

  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-ink-soft">
        <span>
          {fileNames.length} selected file{fileNames.length === 1 ? "" : "s"}
        </span>
        {lines > 0 && <span>{lines} lines</span>}
      </div>
      <ChipRow items={fileNames} max={8} />

      {symbols.length > 0 && (
        <>
          <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-soft">
            {categoryOrder
              .filter((c) => counts[c] > 0)
              .map((c) => (
                <span key={c} className="flex items-center gap-1">
                  <span aria-hidden>{CATEGORY_GLYPH[c]}</span>
                  {counts[c]} {CATEGORY_LABEL[c]}
                  {counts[c] === 1 ? "" : "s"}
                </span>
              ))}
          </div>
          <SymbolChipRow symbols={symbols} />
        </>
      )}
    </div>
  );
}

/**
 * A short flow connector between pipeline stages — a drawn line with an
 * arrowhead, not a bare glyph. Purely decorative (`aria-hidden`): the stages
 * it joins are the real content.
 */
function FlowConnector() {
  return (
    <div className="flex justify-center" aria-hidden>
      <svg width="16" height="18" viewBox="0 0 16 18" className="flow-connector text-ink-soft/40">
        <line x1="8" y1="0" x2="8" y2="11" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M3 10 L8 16 L13 10"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// -------------------------------------------------------------- reduction funnel

/**
 * A real, narrowing funnel — three full-width rows whose *fill* is the
 * ratio, stacked so the shrinking fill reads as one continuous reduction.
 * Every fill is `count / candidates`. Deliberately plain rectangles: an
 * earlier version clipped each row into a trapezoid to taper the edges, and
 * the clip-path seams did not render cleanly against the row borders in a
 * real browser — visible notches and misaligned joins, exactly the "doesn't
 * look right" this replaces. A rectangle whose fill shrinks says the same
 * thing and cannot render incorrectly.
 *
 * The label/value text sits on its own layer above the fill (not inside it),
 * so a heavily reduced row — fill near the clamped minimum — never clips or
 * shrinks its own numbers; every row reads at the same size.
 */
const MIN_FILL_PCT = 6;

function fillPct(count: number, base: number): number {
  if (base <= 0) return 100;
  const ratio = Math.max(0, Math.min(1, count / base));
  return MIN_FILL_PCT + (100 - MIN_FILL_PCT) * ratio;
}

function FunnelBarRow({
  widthPct,
  trackClass,
  fillClass,
  icon: Icon,
  label,
  value,
  sublabel,
  onClick,
  expanded,
}: {
  widthPct: number;
  trackClass: string;
  fillClass: string;
  icon: LucideIcon;
  label: string;
  value: string;
  sublabel?: string;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-expanded={onClick ? expanded : undefined}
      className={`funnel-row relative block h-11 w-full overflow-hidden rounded-lg border text-left ${trackClass} ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div
        aria-hidden
        className={`funnel-fill absolute inset-y-0 left-0 rounded-l-lg transition-[width] duration-500 ${fillClass}`}
        style={{ width: `${widthPct}%` }}
      />
      <div className="relative flex h-full items-center gap-1.5 px-3">
        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden />
        <span className="truncate text-[10px] font-medium uppercase tracking-wider text-ink-soft">
          {label}
        </span>
        {onClick &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-ink-soft" aria-hidden />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-ink-soft" aria-hidden />
          ))}
        {sublabel && (
          <span className="ml-auto shrink-0 truncate pl-2 text-[9px] text-ink-soft">
            {sublabel}
          </span>
        )}
        <span
          className={`shrink-0 pl-2 font-mono text-base font-semibold text-ink ${sublabel ? "" : "ml-auto"}`}
        >
          {value}
        </span>
      </div>
    </Wrapper>
  );
}

function ReductionFunnel({
  candidates,
  extracted,
  contextFiles,
  contextFunctions,
  contextLines,
  extractedExpanded,
  onToggleExtracted,
}: {
  candidates: number;
  extracted: number;
  contextFiles: number;
  contextFunctions: number;
  contextLines: number;
  extractedExpanded: boolean;
  onToggleExtracted: () => void;
}) {
  const wCandidates = 100;
  const wExtracted = fillPct(extracted, candidates);
  const wContext = fillPct(contextFiles, candidates);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-2">
      <FunnelBarRow
        widthPct={wCandidates}
        trackClass="border-border"
        fillClass="bg-ink-soft/12"
        icon={Files}
        label="Candidates considered"
        value={String(candidates)}
      />
      <FunnelBarRow
        widthPct={wExtracted}
        trackClass="border-primary/25 hover:border-primary/40"
        fillClass="bg-primary/20"
        icon={Filter}
        label="Files extracted"
        value={String(extracted)}
        onClick={onToggleExtracted}
        expanded={extractedExpanded}
      />
      <FunnelBarRow
        widthPct={wContext}
        trackClass="border-primary/40"
        fillClass="bg-primary/35"
        icon={Braces}
        label="Minimal repair context"
        value={`${contextFunctions} function${contextFunctions === 1 ? "" : "s"}`}
        sublabel={`${contextLines} lines · ${contextFiles} file${contextFiles === 1 ? "" : "s"}`}
      />
    </div>
  );
}

// ------------------------------------------------------------------ privacy

const PRIVACY_ICON: Record<ContextPackageModel["privacy_guard_status"], LucideIcon> = {
  clean: ShieldCheck,
  masked: ShieldAlert,
  failed: ShieldX,
};

const PRIVACY_COLOR: Record<ContextPackageModel["privacy_guard_status"], string> = {
  clean: "#16a34a",
  masked: "#d97706",
  failed: "#dc2626",
};

function PrivacyStage({
  pkg,
  onClick,
  expanded,
}: {
  pkg: ContextPackageModel;
  onClick: () => void;
  expanded: boolean;
}) {
  const status = pkg.privacy_guard_status;
  const StatusIcon = PRIVACY_ICON[status];
  const color = PRIVACY_COLOR[status];
  const count = pkg.metrics.privacy_redactions;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="w-full rounded-xl border p-3 text-left transition-colors"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-ink-soft" aria-hidden />
        <ArrowRight className="h-3 w-3 text-ink-soft/50" aria-hidden />
        <Lock className="h-4 w-4 text-ink-soft" aria-hidden />
        <ArrowRight className="h-3 w-3 text-ink-soft/50" aria-hidden />
        <StatusIcon className="h-5 w-5" style={{ color }} aria-hidden />
        <span className="text-sm font-bold uppercase tracking-wide" style={{ color }}>
          {status}
        </span>
        {expanded ? (
          <ChevronDown className="ml-auto h-3 w-3 text-ink-soft" aria-hidden />
        ) : (
          <ChevronRight className="ml-auto h-3 w-3 text-ink-soft" aria-hidden />
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-ink-soft">
        {status === "failed"
          ? "The guard errored. No safety claim can be made about this context."
          : count > 0
            ? `${count} redaction${count === 1 ? "" : "s"}`
            : "No secrets detected."}
      </p>
    </button>
  );
}

function RedactionLedger({ pkg }: { pkg: ContextPackageModel }) {
  if (pkg.privacy_guard_status === "failed") {
    return (
      <p className="rounded-md border border-status-failed/30 bg-status-failed-bg/40 px-2 py-1.5 text-[11px] text-ink">
        The guard errored. No claim can be made about what this context contained.
      </p>
    );
  }
  if (pkg.redactions.length === 0) {
    return (
      <p className="text-[11px] text-ink-soft">
        No secrets detected in the context handed to the patch generator.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {pkg.redactions.map((r, i) => (
        <li
          key={`${r.file}:${r.line}:${i}`}
          className="flex flex-wrap items-center gap-x-2 rounded-md border border-status-retry/30 bg-status-retry-bg/40 px-2 py-1 font-mono text-[10px] text-ink"
        >
          <span>
            {r.file}:{r.line}
          </span>
          <span className="text-ink-soft">{r.identifier || r.kind}</span>
          <span className="ml-auto text-ink-soft">masked by {r.detector}</span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ adoption

function AdoptionStage({ pkg }: { pkg: ContextPackageModel }) {
  const [open, setOpen] = useState(false);
  const adopted = pkg.prefer_focused;
  const hasReason = pkg.metrics.adoption_reason.trim().length > 0;

  return (
    <div
      role="group"
      aria-label="Adoption by A6/A7"
      className={`rounded-xl border p-3 ${
        adopted
          ? "border-status-completed/30 bg-status-completed-bg/20"
          : "border-status-retry/30 bg-status-retry-bg/20"
      }`}
    >
      <div className="flex items-center gap-2">
        <ArrowRight className="h-4 w-4 text-ink-soft" aria-hidden />
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-soft">
          A6 Repair Planner
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span
          className={`text-sm font-semibold uppercase tracking-wide ${adopted ? "text-status-completed" : "text-status-retry"}`}
        >
          {adopted ? "✓ ADOPTED" : "✕ NOT ADOPTED"}
        </span>
      </div>
      {/* Always visible, not behind a click: a package that was fully built
          and privacy-checked can still be unused by A7, and that fact must
          be the first thing on screen, not something the user has to know to
          go looking for. */}
      <p className="mt-1 text-[11px] text-ink-soft">
        {adopted
          ? "Focused context accepted — A7 uses this package instead of its own extraction."
          : "A7 keeps its own extraction; this package was not used."}
      </p>
      {!adopted && hasReason && (
        <p className="mt-1 text-[11px] text-ink-soft">Reason: {pkg.metrics.adoption_reason}.</p>
      )}
      {adopted && hasReason && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 flex items-center gap-1 text-[10px] font-medium text-ink-soft transition-colors hover:text-ink"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Why
        </button>
      )}
      {adopted && hasReason && open && (
        <p className="mt-1 text-[11px] text-ink-soft">{pkg.metrics.adoption_reason}.</p>
      )}
    </div>
  );
}

// -------------------------------------------------------------- relevance map

function ExtractedSymbolBlock({ symbol }: { symbol: ExtractedSymbol }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted/40 p-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[11px] font-semibold text-ink">
          {symbol.qualname || symbol.name}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-ink-soft">{symbol.kind}</span>
        {symbol.signature_only && (
          <span className="text-[9px] uppercase tracking-wider text-status-retry">
            signature only
          </span>
        )}
        <span className="ml-auto font-mono text-[9px] text-ink-soft">
          L{symbol.lineno}-{symbol.end_lineno}
        </span>
      </div>
      {symbol.source && (
        <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-ink">
          {symbol.source}
        </pre>
      )}
    </div>
  );
}

/** The three "why selected" badge groups — a quick-glance summary above the
 * full signal breakdown, not a replacement for it. Every badge is gated on
 * a real nonzero signal already in `file.signals`; a file with none of
 * these three groups simply shows no badge (its reason is still visible in
 * the full Signals list below). */
const REASON_BADGES: { glyph: string; label: string; signals: string[] }[] = [
  { glyph: "🎯", label: "Target", signals: ["target_resolution"] },
  { glyph: "🔥", label: "Runtime evidence", signals: ["runtime_stack", "reproduction_evidence"] },
  {
    glyph: "🔗",
    label: "Dependency",
    signals: [
      "sig_distance",
      "import_distance",
      "call_graph_distance",
      "dependency_centrality",
      "call_fan_in",
      "call_fan_out",
      "graph_related",
    ],
  },
];

function reasonBadges(signals: Record<string, number>): { glyph: string; label: string }[] {
  return REASON_BADGES.filter(({ signals: keys }) => keys.some((k) => (signals[k] || 0) !== 0));
}

/** Real lines the extractor kept for this file — the sum of each full-body
 * (non signature-only) symbol's own span. Signature-only symbols contribute
 * no body lines, so they are not counted; this is a fact already implied by
 * `ExtractedSymbol`, not a new measurement. */
function linesSelected(symbols: ExtractedSymbol[]): number {
  return symbols
    .filter((s) => !s.signature_only)
    .reduce((total, s) => total + Math.max(0, s.end_lineno - s.lineno + 1), 0);
}

function FileDetail({
  file,
  inContext,
  symbols,
}: {
  file: RankedContextFile;
  inContext: boolean;
  symbols: ExtractedSymbol[];
}) {
  const signals = nonzeroSignals(file.signals);
  const badges = reasonBadges(file.signals);
  const lines = linesSelected(symbols);
  return (
    <div className="space-y-2 border-t border-border/60 px-2 py-2">
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span
              key={b.label}
              className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-ink"
            >
              <span aria-hidden>{b.glyph}</span>
              {b.label}
            </span>
          ))}
        </div>
      )}
      {inContext && lines > 0 && (
        <div className="text-[10px] text-ink-soft">
          <span className="font-mono font-semibold text-ink">{lines}</span> line
          {lines === 1 ? "" : "s"} selected
        </div>
      )}
      {signals.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-ink-soft">Signals</div>
          <ul className="mt-0.5 space-y-0.5">
            {signals.map(([key, value]) => {
              const Icon = signalIcon(key);
              return (
                <li key={key} className="flex items-center gap-1.5 text-[10px]">
                  <Icon className="h-3 w-3 text-ink-soft" aria-hidden />
                  <span className="text-ink">{signalLabel(key)}</span>
                  <span className="ml-auto font-mono text-ink-soft">
                    {value > 0 ? "+" : ""}
                    {value.toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {file.evidence.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-ink-soft">Evidence</div>
          <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-[10px] text-ink-soft">
            {file.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-[10px] text-ink-soft">
        File confidence: <span className="font-mono text-ink">{file.confidence.toFixed(2)}</span>
      </div>
      {inContext && symbols.length > 0 && (
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-wider text-ink-soft">
            Extracted source
          </div>
          <div className="space-y-1.5">
            {symbols.map((s) => (
              <ExtractedSymbolBlock
                key={`${s.file}:${s.qualname || s.name}:${s.lineno}`}
                symbol={s}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RelevanceMapRow({
  file,
  topScore,
  inContext,
  symbols,
}: {
  file: RankedContextFile;
  topScore: number;
  inContext: boolean;
  symbols: ExtractedSymbol[];
}) {
  const [open, setOpen] = useState(false);
  const width = topScore > 0 ? ratio(Math.max(file.score, 0), topScore) : 0;

  return (
    <div className="rounded-lg border border-border bg-surface-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate font-mono text-[11px] text-ink" title={file.file}>
              {file.file}
            </span>
            {file.is_target && (
              <span className="rounded bg-primary/15 px-1 text-[9px] font-semibold uppercase tracking-wider text-primary">
                target
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${Math.round(width * 100)}%` }}
              />
            </span>
            {/* The bar is normalized for display; this is the real,
                un-normalized backend score, so nothing here can be mistaken
                for a fabricated percentage. */}
            <span className="shrink-0 font-mono text-[10px] text-ink-soft">
              {file.score.toFixed(2)}
            </span>
            <span className="flex shrink-0 gap-1">
              {distinctSignalKeys(file.signals).map((key) => {
                const Icon = signalIcon(key);
                return (
                  <span key={key} title={signalLabel(key)}>
                    <Icon className="h-3 w-3 text-ink-soft" aria-hidden />
                  </span>
                );
              })}
            </span>
          </span>
        </span>
        <span
          className={`shrink-0 text-[9px] font-semibold uppercase tracking-wider ${
            inContext ? "text-status-completed" : "text-ink-soft"
          }`}
        >
          {inContext ? "✓ in context" : "— excluded"}
        </span>
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-ink-soft" aria-hidden />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-ink-soft" aria-hidden />
        )}
      </button>
      {open && <FileDetail file={file} inContext={inContext} symbols={symbols} />}
    </div>
  );
}

function RelevanceMap({
  pkg,
  inContextSet,
  symbolsByFile,
}: {
  pkg: ContextPackageModel;
  inContextSet: Set<string>;
  symbolsByFile: Map<string, ExtractedSymbol[]>;
}) {
  const topScore = useMemo(
    () => Math.max(0, ...pkg.ranked_files.map((f) => f.score)),
    [pkg.ranked_files],
  );

  if (pkg.ranked_files.length === 0) {
    return <p className="text-[11px] text-ink-soft">No candidate files were ranked.</p>;
  }

  return (
    <div className="space-y-1">
      {pkg.ranked_files.map((file) => (
        <RelevanceMapRow
          key={file.file}
          file={file}
          topScore={topScore}
          inContext={inContextSet.has(file.file)}
          symbols={symbolsByFile.get(file.file) ?? []}
        />
      ))}
    </div>
  );
}

// -------------------------------------------------------------- collapsibles

function CollapsibleSection({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border">
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
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink">{label}</span>
        {count !== undefined && (
          <span className="ml-auto font-mono text-[10px] text-ink-soft">{count}</span>
        )}
      </button>
      {open && <div className="px-2.5 pb-2">{children}</div>}
    </div>
  );
}

function StringList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-[11px] text-ink-soft">{empty}</p>;
  return (
    <ul className="list-inside list-disc space-y-0.5 text-[11px] text-ink">
      {items.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  );
}

function PerformanceDetails({ pkg }: { pkg: ContextPackageModel }) {
  const m = pkg.metrics;
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        <dt className="text-ink-soft">Estimated original tokens</dt>
        <dd className="font-mono text-ink">{m.original_tokens}</dd>
        <dt className="text-ink-soft">Estimated reduced tokens</dt>
        <dd className="font-mono text-ink">{m.reduced_tokens}</dd>
        <dt className="text-ink-soft">Estimated tokens saved</dt>
        <dd className="font-mono text-ink">{m.estimated_saved_tokens}</dd>
        <dt className="text-ink-soft">Token reduction (estimated)</dt>
        <dd className="font-mono text-ink">{pct(m.token_reduction)}</dd>
        <dt className="text-ink-soft">Cache</dt>
        <dd className="text-ink">{m.cache_hit ? "hit" : "miss"}</dd>
        <dt className="text-ink-soft">Degraded by budget</dt>
        <dd className="text-ink">{m.degraded ? "yes" : "no"}</dd>
        <dt className="text-ink-soft">Ranking time</dt>
        <dd className="font-mono text-ink">{m.ranking_time_ms}ms</dd>
        <dt className="text-ink-soft">Extraction time</dt>
        <dd className="font-mono text-ink">{m.extraction_time_ms}ms</dd>
        <dt className="text-ink-soft">Privacy scan time</dt>
        <dd className="font-mono text-ink">{m.privacy_time_ms}ms</dd>
        <dt className="text-ink-soft">Total build time</dt>
        <dd className="font-mono text-ink">{m.build_time_ms}ms</dd>
      </dl>
      <p className="mt-1 text-[9px] text-ink-soft">
        Token counts are estimated (≈4 characters per token), not exact tokenizer output.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- panel

export function ContextEngineeringPanel({
  runId,
  status,
}: {
  runId: string;
  status?: AgentStatus;
}) {
  const [pkg, setPkg] = useState<ContextPackageModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [relevanceOpen, setRelevanceOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRunContext(runId)
      .then((p) => {
        if (!cancelled) setPkg(p);
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

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Context Engineering
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">Loading context package…</p>
      </section>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (!pkg) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Context Engineering
        </h3>
        <p className="mt-1.5 text-xs text-ink-soft">
          {status === "running"
            ? "RUNNING — A5.5 is engineering the repair context now; this panel renders once it publishes."
            : "PENDING — Context Engineering has not produced a package yet."}
        </p>
      </section>
    );
  }

  const inContextSet = inContextFiles(pkg);
  const symbolsByFile = symbolsByFileOf(pkg);
  const candidates = pkg.metrics.files_ranked;
  const extracted = pkg.metrics.files_extracted;
  // Full repository-relative paths — never truncated to a basename that
  // could name any file in the tree. `ChipRow`/`SelectedContext` truncate
  // visually with CSS and keep the full path in a tooltip.
  const selectedFileNames = selectedFiles(pkg, inContextSet);
  const selectedSymbols = selectedContextSymbols(pkg);

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
          Context Engineering
        </h3>
        <span className="font-mono text-[11px] text-ink">
          {pkg.target_file}
          {pkg.target_function && <span className="text-ink-soft"> :: {pkg.target_function}</span>}
        </span>
      </div>

      {/* The funnel — a real, narrowing shape, not stat rows with a bar
          underneath. Each band's *width* is `count / candidates`; "Context"
          narrows against the same denominator as "Extracted" rather than
          having no ratio at all, since both are file counts against the
          same starting pool. */}
      <ReductionFunnel
        candidates={candidates}
        extracted={extracted}
        contextFiles={pkg.metrics.context_files}
        contextFunctions={pkg.metrics.context_functions}
        contextLines={pkg.metrics.context_lines}
        extractedExpanded={relevanceOpen}
        onToggleExtracted={() => setRelevanceOpen((o) => !o)}
      />
      <SelectedContext
        fileNames={selectedFileNames}
        symbols={selectedSymbols}
        lines={pkg.metrics.context_lines}
      />

      {relevanceOpen && (
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
            Context Map ({pkg.ranked_files.length} candidate
            {pkg.ranked_files.length === 1 ? "" : "s"} scored)
          </div>
          <RelevanceMap pkg={pkg} inContextSet={inContextSet} symbolsByFile={symbolsByFile} />
        </div>
      )}

      <FlowConnector />

      <PrivacyStage pkg={pkg} onClick={() => setPrivacyOpen((o) => !o)} expanded={privacyOpen} />
      {privacyOpen && (
        <div className="rounded-lg border border-border bg-surface-muted/20 p-2.5">
          <RedactionLedger pkg={pkg} />
        </div>
      )}

      <FlowConnector />

      <AdoptionStage pkg={pkg} />

      <CollapsibleSection
        label="Constraints carried forward"
        count={
          pkg.acceptance_criteria.length +
          pkg.patch_constraints.length +
          pkg.contracts.length +
          pkg.validation_requirements.length
        }
      >
        <div className="space-y-2">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-ink-soft">
              Acceptance criteria
            </div>
            <StringList items={pkg.acceptance_criteria} empty="None recorded." />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-ink-soft">
              Patch constraints
            </div>
            <StringList items={pkg.patch_constraints} empty="None recorded." />
          </div>
          {pkg.contracts.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-ink-soft">Contracts</div>
              <StringList items={pkg.contracts} empty="None recorded." />
            </div>
          )}
          {pkg.validation_requirements.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-ink-soft">
                Validation requirements
              </div>
              <StringList items={pkg.validation_requirements} empty="None recorded." />
            </div>
          )}
          {pkg.dependency_summary.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-ink-soft">
                Dependency summary
              </div>
              <StringList items={pkg.dependency_summary} empty="None recorded." />
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection label="Token & performance details">
        <PerformanceDetails pkg={pkg} />
      </CollapsibleSection>

      <p className="text-[10px] text-ink-soft">
        Explain: the funnel narrows from every candidate file A5.5 scored to the minimal,
        privacy-checked context A6/A7 actually receive. Source:{" "}
        <code className="font-mono">GET /api/runs/{"{run_id}"}/context</code>
      </p>
    </section>
  );
}
