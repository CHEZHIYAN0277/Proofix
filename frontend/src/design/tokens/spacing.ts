/**
 * Spacing, grid and surface padding (blueprint §3.2).
 *
 * 4px base. Tailwind's numeric scale already resolves every step, so these
 * constants exist for the gallery, for inline styles, and for canvas/graph
 * code that cannot use a class.
 */

/** The permitted steps, in multiples of the 4px base. */
export const SPACING_SCALE = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24] as const;

export type SpacingStep = (typeof SPACING_SCALE)[number];

export const SPACE_BASE = 4;

/** Resolve a scale step to pixels. */
export function space(step: SpacingStep): number {
  return step * SPACE_BASE;
}

/** Surface padding — one value per surface kind, never ad hoc. */
export const SURFACE_PADDING = {
  card: 20,
  cardCompact: 16,
  panel: 24,
  stageSection: 28,
  railCard: 16,
} as const;

export type SurfaceKind = keyof typeof SURFACE_PADDING;

/**
 * Workspace grid (§3.2) and its attention constraints (rule A5).
 *
 * The center column stays optically dominant at every breakpoint: it holds at
 * least `centerMinWidthPx`, and the rails collapse before it narrows further.
 */
export const WORKSPACE_GRID = {
  railWidth: 260,
  missionControlWidth: 360,
  centerMaxWidth: 1100,
  /** Rule A5: rails collapse before the center drops below this. */
  centerMinWidth: 720,
  /** Rule A5: center holds ≥58% of viewport width at ≥1280px. */
  centerMinViewportShare: 0.58,
  gutter: 24,
  /** Vertical rhythm between stage sections. */
  stageRhythm: 20,
  headerHeight: 56,
  /** Below this the three-column layout is not attempted. */
  threeColumnBreakpoint: 1280,
} as const;

/** The grid template the Workspace shell uses at full width. */
export const WORKSPACE_GRID_TEMPLATE = `${WORKSPACE_GRID.railWidth}px minmax(${WORKSPACE_GRID.centerMinWidth}px, ${WORKSPACE_GRID.centerMaxWidth}px) ${WORKSPACE_GRID.missionControlWidth}px`;
