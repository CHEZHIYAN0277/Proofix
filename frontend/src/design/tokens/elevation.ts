/**
 * Radius, elevation and glass (blueprint §3.3).
 *
 * Elevation encodes attention (rule A1): only the active stage may sit at
 * `md` or carry a glow. Peripheral surfaces are flat.
 */

import type { StatusState } from "../types";

/* -------------------------------------------------------------------------
   Radius

   `rounded-sm|md|lg|xl` are derived from `--radius` in styles.css and are
   load-bearing for V1, so the design system adds surface-named tokens rather
   than redefining them.
   ---------------------------------------------------------------------- */

export const RADIUS = {
  xs: { px: 4, className: "rounded-xs", use: "Chips, dots, tight gutters" },
  card: { px: 10, className: "rounded-card", use: "Cards" },
  panel: { px: 14, className: "rounded-panel", use: "Panels" },
  overlay: { px: 20, className: "rounded-overlay", use: "Modals, palette, sheets" },
  full: { px: 9999, className: "rounded-full", use: "Pills" },
} as const;

export type RadiusToken = keyof typeof RADIUS;

/* -------------------------------------------------------------------------
   Elevation
   ---------------------------------------------------------------------- */

export const ELEVATION = {
  flat: {
    className: "shadow-none",
    use: "Peripheral surfaces — rail, Mission Control, stage history",
  },
  sm: { className: "shadow-sm", use: "Resting card" },
  md: { className: "shadow-md", use: "Active stage card" },
  lg: { className: "shadow-lg", use: "Overlays, palette, sheets" },
} as const;

export type ElevationToken = keyof typeof ELEVATION;

/**
 * Status glow — permitted on the active stage only (rule A1).
 * Three of the six statuses warrant one; the rest are quiet by design.
 */
export const STATUS_GLOW: Partial<Record<StatusState, string>> = {
  running: "var(--shadow-glow-running)",
  completed: "var(--shadow-glow-completed)",
  failed: "var(--shadow-glow-failed)",
};

export function statusGlow(status: StatusState): string | undefined {
  return STATUS_GLOW[status];
}

/* -------------------------------------------------------------------------
   Glass

   Permitted on exactly four surfaces. Enumerated so misuse is a type error,
   not a code review note — glass everywhere is how enterprise UI reads as a
   toy.
   ---------------------------------------------------------------------- */

export const GLASS_SURFACES = [
  "workspace-header",
  "command-palette",
  "chat-dock",
  "digital-twin-overlay",
] as const;

export type GlassSurface = (typeof GLASS_SURFACES)[number];

/** The single class that applies glass. Takes the surface for auditability. */
export function glass(_surface: GlassSurface): string {
  return "ds-glass border";
}
