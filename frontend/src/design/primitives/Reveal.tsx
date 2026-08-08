/**
 * `<Reveal>` — the only motion entry point in the product (blueprint §3.7).
 *
 * Nothing else may animate. Components stay pure functions of state; timing
 * lives in the token layer and the frame queue, never in a component.
 *
 * The reduced-motion gate lives here (§13 rule 3): `prefers-reduced-motion`
 * collapses every duration to 0ms and stops the continuous class outright.
 * The CSS mirror in `tokens.css` covers class-driven animation.
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { MOTION, MOTION_CLASS_DEFAULT, type MotionClass, type MotionToken } from "../tokens/motion";

/* -------------------------------------------------------------------------
   Rule A4: exactly one continuous animation on screen at a time.

   Enforced in development by a mount registry — a second continuous Reveal is
   a design bug, and a warning at mount time is cheaper than noticing it in a
   screenshot.
   ---------------------------------------------------------------------- */

const continuousMounts = new Set<string>();

function useContinuousRegistration(id: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    continuousMounts.add(id);
    if (import.meta.env.DEV && continuousMounts.size > 1) {
      console.warn(
        `[design/Reveal] Rule A4 violated: ${continuousMounts.size} continuous ` +
          `animations are mounted at once. Only the active stage may run one.`,
        [...continuousMounts],
      );
    }
    return () => {
      continuousMounts.delete(id);
    };
  }, [id, enabled]);
}

/** Test/introspection hook — how many continuous animations are live. */
export function continuousAnimationCount(): number {
  return continuousMounts.size;
}

/* -------------------------------------------------------------------------
   Reveal
   ---------------------------------------------------------------------- */

/** How the reveal enters. Transform and opacity only — never layout (§14). */
export type RevealFrom = "fade" | "up" | "down" | "left" | "right" | "scale";

const OFFSETS: Record<RevealFrom, { opacity: number; y?: number; x?: number; scale?: number }> = {
  fade: { opacity: 0 },
  up: { opacity: 0, y: 8 },
  down: { opacity: 0, y: -8 },
  left: { opacity: 0, x: 12 },
  right: { opacity: 0, x: -12 },
  scale: { opacity: 0, scale: 0.985 },
};

export interface RevealProps {
  children: ReactNode;

  /**
   * The animation class (§13). Determines the default token and whether the
   * animation is permitted to run continuously.
   *
   *   event          — caused by a backend frame or a response (default)
   *   presentational — caused by a user action
   *   continuous     — runs while work runs; at most one on screen (rule A4)
   */
  class?: MotionClass;

  /** Motion token. Defaults to the class default. */
  token?: MotionToken;

  /**
   * The causing condition (§13 rule 1). When `false` the children are not
   * rendered; when it flips to `true` they animate in.
   *
   * Omit it only for a mount-driven reveal that is itself caused by data
   * arriving.
   */
  when?: boolean;

  from?: RevealFrom;

  /**
   * Stagger index. Multiplies a small per-item delay, capped so a long list
   * never turns into a queue the user waits on.
   */
  index?: number;

  /** Removes children on exit rather than leaving them mounted. */
  exit?: boolean;

  className?: string;

  /** Rendered element. Defaults to `div`. */
  as?: "div" | "span" | "li" | "section" | "article";
}

const STAGGER_STEP_MS = 28;
const STAGGER_MAX_MS = 240;

export function Reveal({
  children,
  class: motionClass = "event",
  token,
  when = true,
  from = "up",
  index = 0,
  exit = false,
  className,
  as = "div",
}: RevealProps) {
  const reduced = useReducedMotion();
  const id = useId();
  const isContinuous = motionClass === "continuous";

  useContinuousRegistration(id, isContinuous && when);

  const spec = MOTION[token ?? MOTION_CLASS_DEFAULT[motionClass]];

  // The gate. Reduced motion collapses duration to zero rather than removing
  // the reveal, so state still changes — it just changes instantly.
  const duration = reduced ? 0 : spec.duration / 1000;
  const delay = reduced ? 0 : Math.min(index * STAGGER_STEP_MS, STAGGER_MAX_MS) / 1000;

  if (isContinuous) {
    // Continuous motion is CSS-driven so it costs nothing per frame and stops
    // the instant `when` goes false (§1.3 termination).
    const Tag = as;
    return <Tag className={cn(when && !reduced && "ds-working-pulse", className)}>{children}</Tag>;
  }

  const MotionTag = motion[as];
  const initial = reduced ? { opacity: 0 } : OFFSETS[from];

  const node = when ? (
    <MotionTag
      key="reveal"
      className={className}
      initial={initial}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={exit ? initial : undefined}
      transition={{ duration, delay, ease: spec.ease }}
    >
      {children}
    </MotionTag>
  ) : null;

  return exit ? <AnimatePresence initial={false}>{node}</AnimatePresence> : node;
}

/**
 * The reduced-motion gate, exposed for the rare surface that must branch in
 * JS (canvas, imperative graph layout) rather than animate a DOM node.
 */
export function useMotionGate(): { reduced: boolean; duration: (t: MotionToken) => number } {
  const reduced = useReducedMotion() ?? false;
  return {
    reduced,
    duration: (t: MotionToken) => (reduced ? 0 : MOTION[t].duration),
  };
}
