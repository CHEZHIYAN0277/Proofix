/**
 * Typography scale (blueprint §3.1).
 *
 * Three families, already loaded by the root route: Geist (heading), Inter
 * (sans), JetBrains Mono (mono). The classes themselves live in
 * `tokens/tokens.css`; this module is the programmatic index used by the
 * gallery and by components that pick a token by name.
 *
 * Rules, enforced by convention and proved in `/design`:
 *   - numerals are always tabular;
 *   - identifiers, paths, SHAs and scores are always mono;
 *   - one `title-1` per screen.
 */

export const TYPOGRAPHY_TOKENS = [
  "display",
  "title-1",
  "title-2",
  "title-3",
  "body",
  "body-sm",
  "label",
  "caption",
  "eyebrow",
  "mono-sm",
  "mono",
] as const;

export type TypographyToken = (typeof TYPOGRAPHY_TOKENS)[number];

export interface TypographySpec {
  token: TypographyToken;
  /** The class that applies it. */
  className: string;
  size: number;
  lineHeight: number;
  weight: number;
  family: "heading" | "sans" | "mono";
  use: string;
}

export const TYPOGRAPHY: Record<TypographyToken, TypographySpec> = {
  display: {
    token: "display",
    className: "type-display",
    size: 40,
    lineHeight: 44,
    weight: 700,
    family: "heading",
    use: "Landing only",
  },
  "title-1": {
    token: "title-1",
    className: "type-title-1",
    size: 28,
    lineHeight: 34,
    weight: 650,
    family: "heading",
    use: "Stage title — one per screen",
  },
  "title-2": {
    token: "title-2",
    className: "type-title-2",
    size: 22,
    lineHeight: 28,
    weight: 600,
    family: "heading",
    use: "Panel title",
  },
  "title-3": {
    token: "title-3",
    className: "type-title-3",
    size: 17,
    lineHeight: 24,
    weight: 600,
    family: "heading",
    use: "Card title",
  },
  body: {
    token: "body",
    className: "type-body",
    size: 15,
    lineHeight: 23,
    weight: 400,
    family: "sans",
    use: "Prose",
  },
  "body-sm": {
    token: "body-sm",
    className: "type-body-sm",
    size: 14,
    lineHeight: 21,
    weight: 400,
    family: "sans",
    use: "Peripheral — the rail cap, rule A2",
  },
  label: {
    token: "label",
    className: "type-label",
    size: 13,
    lineHeight: 18,
    weight: 500,
    family: "sans",
    use: "Form and metric labels",
  },
  caption: {
    token: "caption",
    className: "type-caption",
    size: 12,
    lineHeight: 16,
    weight: 500,
    family: "sans",
    use: "Timestamps, meta",
  },
  eyebrow: {
    token: "eyebrow",
    className: "type-eyebrow",
    size: 11,
    lineHeight: 14,
    weight: 600,
    family: "sans",
    use: "Section kickers — 0.14em tracking, uppercase",
  },
  "mono-sm": {
    token: "mono-sm",
    className: "type-mono-sm",
    size: 12,
    lineHeight: 16,
    weight: 400,
    family: "mono",
    use: "Dense code, ids",
  },
  mono: {
    token: "mono",
    className: "type-mono",
    size: 13,
    lineHeight: 18,
    weight: 500,
    family: "mono",
    use: "Code, ids, paths, numbers",
  },
};

/** Resolve a typography token to its class. */
export function type(token: TypographyToken): string {
  return TYPOGRAPHY[token].className;
}

/**
 * Rule A2: peripheral surfaces cap at `body-sm` (14px). Anything above it
 * belongs to the active stage.
 */
export const PERIPHERAL_TYPE_CAP: TypographyToken = "body-sm";

export const PERIPHERAL_TOKENS: readonly TypographyToken[] = [
  "body-sm",
  "label",
  "caption",
  "eyebrow",
  "mono-sm",
];

/** Whether a token is permitted on a peripheral surface (rule A2). */
export function isPeripheralSafe(token: TypographyToken): boolean {
  return PERIPHERAL_TOKENS.includes(token);
}
