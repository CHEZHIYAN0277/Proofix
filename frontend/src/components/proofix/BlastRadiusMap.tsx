/**
 * A5 — Blast Radius corridor map.
 *
 * The signature element for this panel, sitting alongside `EvidenceInvestigationBoard`'s
 * convergence map as A5's answer to the same question A4 asks with beams: don't summarise
 * the graph into a stat, draw the actual traversal. A4's beams flow IN toward one point
 * because root-cause is about things agreeing; A5's flow OUT from one point in two opposite,
 * non-interchangeable directions, because blast radius is about consequence, not agreement —
 * "upstream" (backward — code the origin reads, i.e. possible cause) and "downstream"
 * (forward — code that reads the origin, i.e. possible fallout) are never the same kind of
 * fact and must never share one visual bucket.
 *
 * Every edge drawn is a real `BlastEdge`-derived fact: `file.reachedVia` → `file.path`, styled
 * by `file.edgeBasis` — solid for `resolved_suffix` (the import string names the end of a real
 * path), dashed for `name_contains` (plain substring containment, the exact branch that lets
 * `import os` reach `services/oslo.py`). Nothing here draws an edge stronger than the backend's
 * own account of how sure it is.
 *
 * The containment line is `blast_traversal.CONFIDENCE_THRESHOLD` (0.7) made geometric: at
 * `HOP_DECAY = 0.85`, hop 2 (0.7225) clears it and hop 3 (0.614125) does not, so the line falls
 * between those two columns on both sides. A file past the line and still auto-patchable only
 * got there because A5 pinned it — drawn with a pin bracket, never silently moved.
 *
 * Adaptive by construction, not by breakpoint: node position is index-based —
 * `(i + 0.5) / slots` of a fixed column — exactly `ConvergenceMap`'s technique, so a 3-file
 * run and a 300-file run both lay out correctly with zero measurement. Density is bounded by
 * capping each column at `MAX_VISIBLE_PER_COLUMN` individually-drawn nodes; anything past that
 * collapses into one density chip sized by count, and every edge that would have pointed at a
 * collapsed file points at that chip instead — so the picture never lies about where a path
 * went, it just stops naming every file on a large one.
 */
import { useMemo, useState } from "react";
import { Pin } from "lucide-react";
import type { BlastEdge, BlastImpact, BlastScopeFile } from "./blastTypes";

const MAX_VISIBLE_PER_COLUMN = 5;

// Column x-positions, fixed regardless of which hops are actually populated — hop 1 is always
// adjacent to the origin and hop 3 is always at the edge, so distance-from-origin is legible at
// a glance instead of being relative to whatever this particular run happened to reach.
const HOP_X: Record<"backward" | "forward", Record<number, number>> = {
  backward: { 1: 38, 2: 24, 3: 10 },
  forward: { 1: 62, 2: 76, 3: 90 },
};
const ORIGIN_XY = { x: 50, y: 50 };
const BAND_TOP = 10;
const BAND_HEIGHT = 80;

// Midpoint between the hop-2 and hop-3 columns — see module doc for the decay math this marks.
const CONTAINMENT_X = {
  backward: (HOP_X.backward[2] + HOP_X.backward[3]) / 2,
  forward: (HOP_X.forward[2] + HOP_X.forward[3]) / 2,
};

const REAL_EDGE = "var(--color-status-completed)";
const RISKY_EDGE = "var(--color-status-retry)";
const ORIGIN_COLOR = "var(--color-status-running)";
const REVIEW_COLOR = "var(--color-status-blocked)";

interface Placed {
  file: BlastScopeFile;
  x: number;
  y: number;
  collapsed: boolean;
}

interface ColumnGroup {
  direction: "backward" | "forward";
  hop: number;
  x: number;
  files: BlastScopeFile[];
}

/**
 * `BlastScopeFile` only carries every direction a file was reached from
 * (`directions`), not which one its winning hop/confidence belongs to — that
 * pairing exists only in `BlastEdge` (`to` + `hopCount` + `direction`). A file
 * reached one way has an unambiguous column; a file reached both ways is
 * placed under whichever direction actually produced its recorded hop count,
 * looked up from the real edge rather than guessed from array order.
 */
function primaryDirection(
  file: BlastScopeFile,
  edgeByDestinationAndHop: Map<string, "backward" | "forward">,
): "backward" | "forward" | null {
  if (file.directions.length === 1) return file.directions[0];
  if (file.directions.length === 0) return null;
  const viaEdge = edgeByDestinationAndHop.get(`${file.path}:${file.hopCount}`);
  return viaEdge ?? file.directions[0];
}

function buildColumns(scope: BlastScopeFile[], edges: BlastEdge[]): ColumnGroup[] {
  const edgeByDestinationAndHop = new Map<string, "backward" | "forward">();
  for (const e of edges) edgeByDestinationAndHop.set(`${e.to}:${e.hopCount}`, e.direction);

  const groups = new Map<string, ColumnGroup>();
  for (const f of scope) {
    if (f.hopCount === null || f.hopCount < 1 || f.hopCount > 3) continue;
    const direction = primaryDirection(f, edgeByDestinationAndHop);
    if (direction === null) continue;
    const x = HOP_X[direction][f.hopCount];
    if (x === undefined) continue;
    const key = `${direction}:${f.hopCount}`;
    const existing = groups.get(key);
    if (existing) {
      existing.files.push(f);
    } else {
      groups.set(key, { direction, hop: f.hopCount, x, files: [f] });
    }
  }
  return [...groups.values()];
}

/** Index-based placement within a column, `ConvergenceMap`-style: the first
 * `MAX_VISIBLE_PER_COLUMN - 1` files get their own evenly-spaced slot; everything after that
 * shares the final slot, which is where the density chip is drawn. */
function placeColumn(group: ColumnGroup): Placed[] {
  const files = [...group.files].sort(
    (a, b) => (b.propagationConfidence ?? -1) - (a.propagationConfidence ?? -1),
  );
  const slots = Math.min(files.length, MAX_VISIBLE_PER_COLUMN);
  return files.map((file, i) => {
    const slot = Math.min(i, slots - 1);
    const y = BAND_TOP + ((slot + 0.5) / slots) * BAND_HEIGHT;
    return {
      file,
      x: group.x,
      y,
      collapsed: i >= MAX_VISIBLE_PER_COLUMN - 1 && files.length > MAX_VISIBLE_PER_COLUMN,
    };
  });
}

function directionLabel(direction: "backward" | "forward"): string {
  return direction === "backward"
    ? "upstream — the origin reads this"
    : "downstream — reads the origin";
}

export function BlastRadiusMap({
  impact,
  onSelect,
}: {
  impact: BlastImpact;
  onSelect: (file: BlastScopeFile) => void;
}) {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const { placedByPath, columns, hasBackward, hasForward } = useMemo(() => {
    const columns = buildColumns(impact.scope, impact.edges);
    const placedByPath = new Map<string, Placed>();
    for (const col of columns) {
      for (const p of placeColumn(col)) {
        // A collapsed file still needs a position so edges reaching *through* it land on the
        // density chip rather than pointing nowhere — but only the first placement per column
        // slot should be treated as "the" position for downstream edge lookups.
        if (!placedByPath.has(p.file.path)) placedByPath.set(p.file.path, p);
      }
    }
    return {
      placedByPath,
      columns,
      hasBackward: columns.some((c) => c.direction === "backward"),
      hasForward: columns.some((c) => c.direction === "forward"),
    };
  }, [impact.scope]);

  const visibleNodes = useMemo(
    () => [...placedByPath.values()].filter((p) => !p.collapsed),
    [placedByPath],
  );

  const densityChips = useMemo(() => {
    return columns
      .map((col) => {
        const overflow = col.files.length - (MAX_VISIBLE_PER_COLUMN - 1);
        if (overflow <= 1) return null;
        const last = placeColumn(col).find((p) => p.collapsed);
        if (!last) return null;
        return { key: `${col.direction}:${col.hop}`, x: col.x, y: last.y, count: overflow };
      })
      .filter((c): c is { key: string; x: number; y: number; count: number } => c !== null);
  }, [columns]);

  if (!hasBackward && !hasForward) return null;

  const edges = [...placedByPath.values()].filter(
    (p) => !p.collapsed && p.file.reachedVia && placedByPath.has(p.file.reachedVia),
  );

  return (
    <div
      role="group"
      aria-label="Blast radius corridor map"
      className="rounded-xl border border-border bg-surface-muted/20 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[9px] uppercase tracking-wider text-ink-soft">
          <span className="flex items-center gap-1.5">
            <span
              className="h-[2px] w-3 rounded-full"
              style={{ backgroundColor: REAL_EDGE }}
              aria-hidden
            />
            precise import edge
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-[2px] w-3 rounded-full"
              style={{
                backgroundImage: `repeating-linear-gradient(90deg, ${RISKY_EDGE} 0 3px, transparent 3px 6px)`,
              }}
              aria-hidden
            />
            name-matched, could be false
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full border"
              style={{ borderColor: REVIEW_COLOR, backgroundColor: "transparent" }}
              aria-hidden
            />
            past containment line
          </span>
        </div>
      </div>

      <div className="relative min-h-[13rem] lg:min-h-[15rem]">
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {/* containment line — see module doc for the 0.85^hop math this marks */}
          {hasBackward && (
            <line
              x1={CONTAINMENT_X.backward}
              x2={CONTAINMENT_X.backward}
              y1={BAND_TOP - 4}
              y2={BAND_TOP + BAND_HEIGHT + 4}
              stroke="var(--color-border)"
              strokeWidth={0.6}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {hasForward && (
            <line
              x1={CONTAINMENT_X.forward}
              x2={CONTAINMENT_X.forward}
              y1={BAND_TOP - 4}
              y2={BAND_TOP + BAND_HEIGHT + 4}
              stroke="var(--color-border)"
              strokeWidth={0.6}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* propagation edges: origin → hop 1 → hop 2 → hop 3, exactly the recorded path */}
          {edges.map((p) => {
            const parent =
              p.file.reachedVia === impact.origin?.resolvedPath ||
              p.file.reachedVia === impact.origin?.normalizedPath
                ? ORIGIN_XY
                : ((p.file.reachedVia ? placedByPath.get(p.file.reachedVia) : undefined) ??
                  ORIGIN_XY);
            const dimmed =
              hoveredPath !== null &&
              hoveredPath !== p.file.path &&
              hoveredPath !== p.file.reachedVia;
            const risky = p.file.edgeBasis === "name_contains";
            return (
              <path
                key={p.file.path}
                d={`M${parent.x},${parent.y} C ${(parent.x + p.x) / 2},${parent.y} ${(parent.x + p.x) / 2},${p.y} ${p.x},${p.y}`}
                fill="none"
                stroke={risky ? RISKY_EDGE : REAL_EDGE}
                strokeWidth={0.5}
                strokeDasharray={risky ? "2 1.5" : undefined}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ opacity: dimmed ? 0.15 : 0.7, transition: "opacity 150ms ease-out" }}
              />
            );
          })}

          {/* origin, radial beams to every hop-1 node it directly reaches */}
          {visibleNodes
            .filter((p) => p.file.hopCount === 1 && !p.file.reachedVia)
            .map((p) => (
              <path
                key={`origin-${p.file.path}`}
                d={`M${ORIGIN_XY.x},${ORIGIN_XY.y} C ${(ORIGIN_XY.x + p.x) / 2},${ORIGIN_XY.y} ${(ORIGIN_XY.x + p.x) / 2},${p.y} ${p.x},${p.y}`}
                fill="none"
                stroke={p.file.edgeBasis === "name_contains" ? RISKY_EDGE : REAL_EDGE}
                strokeWidth={0.5}
                strokeDasharray={p.file.edgeBasis === "name_contains" ? "2 1.5" : undefined}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ opacity: 0.7 }}
              />
            ))}
        </svg>

        {/* column headers */}
        {columns.map((col) => (
          <div
            key={`${col.direction}:${col.hop}`}
            className="absolute -translate-x-1/2 text-center text-[8px] font-medium uppercase tracking-wider text-ink-soft"
            style={{ left: `${col.x}%`, top: 0 }}
          >
            hop {col.hop}
          </div>
        ))}
        {hasBackward && (
          <div className="absolute left-[10%] top-3 -translate-x-1/2 text-[8px] uppercase tracking-widest text-ink-soft/70">
            ← upstream
          </div>
        )}
        {hasForward && (
          <div className="absolute right-[10%] top-3 translate-x-1/2 text-[8px] uppercase tracking-widest text-ink-soft/70">
            downstream →
          </div>
        )}

        {/* origin node */}
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1 shadow-sm"
          style={{
            left: `${ORIGIN_XY.x}%`,
            top: `${ORIGIN_XY.y}%`,
            borderColor: ORIGIN_COLOR,
            backgroundColor: "var(--color-surface)",
          }}
        >
          <div
            className="whitespace-nowrap text-center text-[8px] font-semibold uppercase tracking-wider"
            style={{ color: ORIGIN_COLOR }}
          >
            origin
          </div>
          <div
            className="max-w-[7rem] truncate font-mono text-[9px] font-semibold text-ink"
            title={impact.origin?.resolvedPath ?? ""}
          >
            {(impact.origin?.resolvedPath ?? impact.origin?.normalizedPath ?? "").split("/").pop()}
          </div>
        </div>

        {/* file nodes */}
        {visibleNodes.map((p) => {
          // Placement is the source of truth for which side a node reads as: a node's x is
          // only ever set from `HOP_X[direction][hop]`, so comparing against the origin's x is
          // equivalent to re-deriving direction and never disagrees with the column it's drawn in.
          const direction: "backward" | "forward" = p.x < ORIGIN_XY.x ? "backward" : "forward";
          const beyond =
            (direction === "backward" && p.x < CONTAINMENT_X.backward) ||
            (direction === "forward" && p.x > CONTAINMENT_X.forward);
          const pinned = impact.patchAuthorityOverlap.includes(p.file.path);
          const dimmed = hoveredPath !== null && hoveredPath !== p.file.path;
          return (
            <button
              key={p.file.path}
              type="button"
              onClick={() => onSelect(p.file)}
              onMouseEnter={() => setHoveredPath(p.file.path)}
              onMouseLeave={() => setHoveredPath(null)}
              onFocus={() => setHoveredPath(p.file.path)}
              onBlur={() => setHoveredPath(null)}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md border bg-surface px-1.5 py-0.5 text-left transition-[opacity,transform] duration-150 ease-out hover:z-10 hover:-translate-y-[calc(50%+1px)]"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                borderColor: beyond ? REVIEW_COLOR : "var(--color-border)",
                borderStyle: beyond && !p.file.autoPatchable ? "dashed" : "solid",
                opacity: dimmed ? 0.35 : 1,
              }}
              aria-label={`${p.file.path}, hop ${p.file.hopCount}, ${directionLabel(direction)}, ${
                p.file.propagationConfidence !== null
                  ? `${Math.round(p.file.propagationConfidence * 100)}% confidence`
                  : "confidence not measured"
              }${pinned ? ", pinned into auto-patch scope" : ""}`}
            >
              <span className="flex items-center gap-1">
                {pinned && (
                  <Pin
                    className="h-2.5 w-2.5 shrink-0"
                    style={{ color: "var(--color-status-retry)" }}
                    aria-hidden
                  />
                )}
                <span className="max-w-[6rem] truncate font-mono text-[9px] text-ink">
                  {p.file.path.split("/").pop()}
                </span>
              </span>
            </button>
          );
        })}

        {/* density chips — collapsed tail of an oversized column */}
        {densityChips.map((chip) => (
          <div
            key={chip.key}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed px-1.5 py-0.5 text-center"
            style={{
              left: `${chip.x}%`,
              top: `${chip.y}%`,
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-surface-muted)",
            }}
            title={`${chip.count} more file${chip.count === 1 ? "" : "s"} at this hop — see the scope ledger below`}
          >
            <span className="font-mono text-[9px] text-ink-soft">+{chip.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
