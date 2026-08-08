/**
 * `<ContextFunnel>` — Repository → Knowledge Graph → Ranking → Privacy →
 * Firewall → Package → LLM (blueprint Phase 4).
 *
 * The narrative spine of the flagship stage: how an entire repository becomes
 * the few hundred tokens a repair actually needs.
 *
 * **Every band comes from a real field. An absent band renders `Pending` — it
 * is never estimated, interpolated, or carried over from its neighbour.** A
 * funnel is a persuasive shape, and a persuasive shape built from guesses is
 * exactly the thing this product exists not to be. So each band names the
 * field it read, and a band with no field says so and stays flat.
 *
 * **Bars compare only what is comparable.** The bands do not share a unit:
 * files, graph nodes, redactions, lines and tokens are different things, and
 * scaling them against one peak would say 59 nodes is "more" than 10 files.
 * So each band declares a scale group, bars are normalised inside their group
 * only, and a band with no comparable sibling shows its number with no bar
 * rather than a width that means nothing.
 *
 * Two real narrowings survive that rule and carry the story: files
 * (repository → ranked → packaged) and tokens (original → prompt).
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { ExplainAffordance } from "@/design/primitives/ExplainAffordance";
import { Reveal } from "@/design/primitives/Reveal";
import { DataState } from "@/design/states/DataState";
import { GRAPH_NODE_COLORS, GRAPH_NODE_ORDER } from "@/design/tokens/color";
import type { DataStateKind, ExplainSpec } from "@/design/types";
import { cn } from "@/lib/utils";
import { contextQuery, kgMetricsQuery } from "@/lib/v2/queries";
import type { ContextPackage, KnowledgeMetrics } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

const G9 =
  "run_id never reaches LLMGateway (G9) — the security timeline carries no run scope, so the firewall's per-run verdict cannot be read";

/**
 * Units that can honestly be drawn against each other. `none` means the band
 * has no comparable sibling, so it gets a value and no bar.
 */
type ScaleGroup = "files" | "tokens" | "none";

interface Band {
  id: string;
  label: string;
  scale: ScaleGroup;
  /** `null` means the backend published nothing — renders Pending. */
  value: number | null;
  unit: string;
  /** Why this band is absent, when it is. */
  missingKind: DataStateKind;
  missingReason?: string;
  explain: ExplainSpec;
  /** `failed` privacy makes a band blocking and red. */
  blocking?: boolean;
}

function buildBands(
  pkg: ContextPackage | null | undefined,
  kg: KnowledgeMetrics | undefined,
): Band[] {
  const m = pkg?.metrics;

  return [
    {
      id: "repository",
      scale: "files",
      label: "Repository",
      value: kg?.files_total ?? null,
      unit: "files",
      missingKind: "waiting",
      missingReason: "The workspace scan has not published a file count",
      explain: {
        explain: "Every file the workspace scan found in the repository.",
        why: [],
        confidence: null,
        source: [
          {
            label: "Knowledge graph metrics",
            endpoint: "GET /api/knowledge/{run_id}/metrics",
            fieldPath: "files_total",
          },
        ],
      },
    },
    {
      id: "knowledge",
      scale: "none",
      label: "Knowledge Graph",
      value: kg?.node_count ?? null,
      unit: "nodes",
      missingKind: "waiting",
      missingReason: "The knowledge graph has not published a node count",
      explain: {
        explain:
          "Nodes the repository graph holds — files, functions, classes, tests and documents the ranker can reason over.",
        why: [],
        confidence: null,
        source: [
          {
            label: "Knowledge graph metrics",
            endpoint: "GET /api/knowledge/{run_id}/metrics",
            fieldPath: "node_count",
          },
        ],
      },
    },
    {
      id: "ranking",
      scale: "files",
      label: "Ranking",
      value: m?.files_ranked ?? null,
      unit: "files ranked",
      missingKind: "pending",
      missingReason: "A5.5 has not ranked any files yet",
      explain: {
        explain:
          "Files the ranker scored against the run's evidence. Every score is a weighted sum of named deterministic signals — A5.5 makes no LLM call.",
        why: [],
        confidence: null,
        source: [
          {
            label: "Context package",
            endpoint: "GET /api/runs/{run_id}/context",
            fieldPath: "metrics.files_ranked",
            agentId: "A5.5",
          },
        ],
      },
    },
    {
      id: "privacy",
      scale: "none",
      label: "Privacy",
      value: m?.privacy_redactions ?? null,
      unit: "redactions",
      missingKind: "pending",
      missingReason: "The privacy guard has not reported yet",
      blocking: pkg?.privacy_guard_status === "failed",
      explain: {
        explain:
          "Secrets the guard masked before any context left the process. Masking is structure-preserving, so the code still parses and the value never leaves.",
        why: [],
        confidence: null,
        source: [
          {
            label: "Context package",
            endpoint: "GET /api/runs/{run_id}/context",
            fieldPath: "metrics.privacy_redactions · privacy_guard_status",
            agentId: "A5.5",
          },
        ],
      },
    },
    {
      id: "firewall",
      scale: "none",
      label: "Firewall",
      // Blocked on G9. Never estimated from anything else.
      value: null,
      unit: "",
      missingKind: "unavailable",
      missingReason: G9,
      explain: {
        explain:
          "The prompt firewall gates every LLM call: `LLMGateway.complete()` requires an approved context with no bypass path. Its per-run verdict is not yet readable.",
        why: [],
        confidence: null,
        source: [
          {
            label: "Security timeline",
            endpoint: "GET /api/security/timeline?run_id=",
            fieldPath: "— blocked by G9",
          },
        ],
      },
    },
    {
      id: "package",
      scale: "files",
      label: "Package",
      value: m?.context_files ?? null,
      unit: "files packaged",
      missingKind: "pending",
      missingReason: "A5.5 has extracted no context yet",
      explain: {
        explain:
          "Files whose code survived extraction and the character budget — what the model will actually be shown. Line and function counts are on the package panel below.",
        why: [],
        confidence: null,
        source: [
          {
            label: "Context package",
            endpoint: "GET /api/runs/{run_id}/context",
            fieldPath: "metrics.context_lines · context_files · context_functions",
            agentId: "A5.5",
          },
        ],
      },
    },
    {
      id: "llm",
      scale: "tokens",
      label: "LLM",
      value: m?.estimated_prompt_tokens ?? null,
      unit: "tokens",
      missingKind: "pending",
      missingReason: "A5.5 published no prompt-token estimate",
      explain: {
        explain: "Tokens A5.5 estimates the assembled prompt will cost.",
        why: [],
        confidence: null,
        source: [
          {
            label: "Context package",
            endpoint: "GET /api/runs/{run_id}/context",
            fieldPath: "metrics.estimated_prompt_tokens",
            agentId: "A5.5",
          },
        ],
      },
    },
  ];
}

export function ContextFunnel() {
  const runId = useRunId();
  const context = useQuery(contextQuery(runId));
  const kg = useQuery(kgMetricsQuery(runId));

  const bands = useMemo(() => buildBands(context.data, kg.data), [context.data, kg.data]);

  /**
   * One peak per scale group. A band is drawn against the largest value of its
   * own unit and nothing else, so a bar always answers "how much of this kind
   * of thing survived" rather than an accidental cross-unit comparison.
   */
  const peaks = useMemo(() => {
    const members = new Map<ScaleGroup, number[]>();
    for (const band of bands) {
      if (band.scale === "none" || band.value === null) continue;
      if (!members.has(band.scale)) members.set(band.scale, []);
      members.get(band.scale)!.push(band.value);
    }

    const out = new Map<ScaleGroup, number>();
    for (const [group, values] of members) {
      // A group of one has nothing to compare against, so it gets no bar. A
      // lone band drawn at full width reads as "100% of something" when it is
      // simply the only measurement of its kind.
      if (values.length < 2) continue;
      out.set(group, Math.max(...values));
    }
    return out;
  }, [bands]);

  return (
    <ol className="flex flex-col gap-2">
      {bands.map((band, index) => (
        <Reveal key={band.id} class="event" token="narrative" index={index} as="li">
          <FunnelBand band={band} peak={peaks.get(band.scale) ?? null} index={index} />
        </Reveal>
      ))}
    </ol>
  );
}

function FunnelBand({ band, peak, index }: { band: Band; peak: number | null; index: number }) {
  const color = band.blocking
    ? "var(--status-failed)"
    : GRAPH_NODE_COLORS[GRAPH_NODE_ORDER[index % GRAPH_NODE_ORDER.length]].fg;

  // Drawn only when the band has a value *and* a comparable sibling.
  const comparable = band.scale !== "none" && peak !== null && peak > 0;
  const width = comparable && band.value !== null ? Math.max(2, (band.value / peak) * 100) : 0;

  return (
    <div
      className={cn(
        "rounded-card border px-4 py-3",
        band.blocking ? "border-status-failed" : "border-border",
      )}
      style={{ backgroundColor: band.blocking ? "var(--status-failed-bg)" : undefined }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5">
          <span className="type-label text-ink">{band.label}</span>
          <ExplainAffordance id={`funnel.${band.id}`} subject={band.label} spec={band.explain} />
        </span>

        {band.value === null ? (
          <DataState
            kind={band.missingKind}
            reason={band.missingReason}
            size="sm"
            variant="inline"
          />
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span className="type-mono tabular text-ink">{band.value.toLocaleString()}</span>
            <span className="type-caption text-ink-soft">{band.unit}</span>
          </span>
        )}
      </div>

      {/* The bar animates only as its real number arrives; an absent band is
          static and empty (§13 rule 5). A band with no comparable sibling gets
          no bar at all — a width would imply a comparison that does not exist. */}
      {comparable && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full"
            style={{
              width: `${width}%`,
              backgroundColor: color,
              transition: "width var(--motion-narrative) var(--ease-narrative)",
            }}
          />
        </div>
      )}

      {band.blocking && (
        <p className="type-caption mt-2 text-status-failed">
          The privacy guard failed. Context from this run must not be trusted as masked.
        </p>
      )}
    </div>
  );
}
