/**
 * Motion system (blueprint §3.4).
 *
 * Motion exists to explain work, never to fill time. Three tests every
 * animation must pass (§1.3):
 *
 *   1. Causality      — caused by a frame or a response? If not, delete it.
 *   2. Proportionality — does its duration reflect real duration?
 *   3. Termination    — does it stop the instant the work stops?
 *
 * There are no indeterminate progress bars. An elapsed counter is a fact; a
 * percentage nobody measured is a lie.
 *
 * Every value is consumed through `<Reveal>`. `prefers-reduced-motion`
 * collapses all tokens to 0ms at one gate (the media query in tokens.css,
 * mirrored in JS by `<Reveal>` for framer-motion).
 */

export const MOTION_TOKENS = ["instant", "fast", "base", "slow", "narrative", "pulse"] as const;

export type MotionToken = (typeof MOTION_TOKENS)[number];

export interface MotionSpec {
  token: MotionToken;
  /** Milliseconds. */
  duration: number;
  /** CSS easing. */
  easing: string;
  /** framer-motion cubic-bezier array, or `easeOut`/`easeInOut`. */
  ease: [number, number, number, number];
  cssVar: string;
  easeVar: string;
  use: string;
}

export const MOTION: Record<MotionToken, MotionSpec> = {
  instant: {
    token: "instant",
    duration: 80,
    easing: "cubic-bezier(0, 0, 0.2, 1)",
    ease: [0, 0, 0.2, 1],
    cssVar: "var(--motion-instant)",
    easeVar: "var(--ease-instant)",
    use: "Hover, focus",
  },
  fast: {
    token: "fast",
    duration: 120,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
    ease: [0.2, 0, 0, 1],
    cssVar: "var(--motion-fast)",
    easeVar: "var(--ease-fast)",
    use: "Toggles, tooltips",
  },
  base: {
    token: "base",
    duration: 200,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
    ease: [0.2, 0, 0, 1],
    cssVar: "var(--motion-base)",
    easeVar: "var(--ease-base)",
    use: "Card enter, panel open",
  },
  slow: {
    token: "slow",
    duration: 320,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    ease: [0.16, 1, 0.3, 1],
    cssVar: "var(--motion-slow)",
    easeVar: "var(--ease-slow)",
    use: "Stage transition",
  },
  narrative: {
    token: "narrative",
    duration: 500,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    ease: [0.16, 1, 0.3, 1],
    cssVar: "var(--motion-narrative)",
    easeVar: "var(--ease-narrative)",
    use: "Funnel bands, graph reveal",
  },
  pulse: {
    token: "pulse",
    duration: 1800,
    easing: "cubic-bezier(0.4, 0, 0.6, 1)",
    ease: [0.4, 0, 0.6, 1],
    cssVar: "var(--motion-pulse)",
    easeVar: "var(--ease-pulse)",
    use: "The single working pulse — rule A4",
  },
};

/**
 * Animation classes (§13). A `<Reveal>` declares which it is, and the class
 * decides whether reduced-motion removes it or merely shortens it.
 *
 *   event          — caused by a backend frame or a response. The default.
 *   presentational — caused by a user action (open, hover, expand).
 *   continuous     — runs while work runs. At most one on screen (rule A4).
 */
export const MOTION_CLASSES = ["event", "presentational", "continuous"] as const;

export type MotionClass = (typeof MOTION_CLASSES)[number];

/** Default token per class, when a `<Reveal>` does not name one. */
export const MOTION_CLASS_DEFAULT: Record<MotionClass, MotionToken> = {
  event: "base",
  presentational: "fast",
  continuous: "pulse",
};

/** CSS `transition` shorthand for a token. */
export function transition(token: MotionToken, properties: string = "opacity, transform"): string {
  const spec = MOTION[token];
  return properties
    .split(",")
    .map((p) => `${p.trim()} ${spec.cssVar} ${spec.easeVar}`)
    .join(", ");
}
