/**
 * Card (blueprint §3.6).
 *
 * header (eyebrow + title + actions) / body / footer.
 * Variants: `resting`, `active`, `peripheral`, `interactive`.
 *
 * The variant is an attention declaration, not a style choice (rule A1):
 * **only `active` may use accent color, elevation ≥ `shadow-md`, or motion.**
 * `peripheral` is flat, static, and capped at `body-sm` type (rule A2).
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { statusGlow } from "../tokens/elevation";
import type { StatusState } from "../types";
import { Eyebrow } from "../primitives/atoms";

export type CardVariant = "resting" | "active" | "peripheral" | "interactive";

const VARIANT_CLASS: Record<CardVariant, string> = {
  // Resting: the default card. One step of elevation, no accent.
  resting: "border-border bg-surface shadow-sm",
  // Active: the stage that owns 70–80% of attention.
  active: "border-primary/30 bg-surface shadow-md",
  // Peripheral: rail, Mission Control, stage history. Flat and quiet.
  peripheral: "border-border bg-surface-muted shadow-none",
  // Interactive: resting, plus a hover response to a real affordance.
  interactive:
    "border-border bg-surface shadow-sm hover:border-primary/30 hover:shadow-md cursor-pointer",
};

export interface CardProps {
  children: ReactNode;
  variant?: CardVariant;
  /** 16px instead of the standard 20px (§3.2). */
  compact?: boolean;
  /**
   * Adds the status ring. Permitted on the active stage only (rule A1);
   * ignored for every other variant.
   */
  status?: StatusState;
  /**
   * Rule A3: peripheral chrome renders at ≤72% ink while a stage is running,
   * returning to full contrast when the run reaches a terminal state.
   */
  dimmed?: boolean;
  as?: "div" | "article" | "section" | "li";
  className?: string;
  onClick?: () => void;
}

export function Card({
  children,
  variant = "resting",
  compact = false,
  status,
  dimmed = false,
  as: Tag = "div",
  className,
  onClick,
}: CardProps) {
  const glow = variant === "active" && status ? statusGlow(status) : undefined;

  return (
    <Tag
      onClick={onClick}
      className={cn(
        "rounded-card border transition-[box-shadow,border-color,opacity]",
        VARIANT_CLASS[variant],
        compact ? "p-4" : "p-5",
        className,
      )}
      style={{
        boxShadow: glow,
        opacity: dimmed ? "var(--peripheral-opacity)" : undefined,
        transitionDuration: "var(--motion-base)",
        transitionTimingFunction: "var(--ease-base)",
      }}
    >
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls — the `<ExplainAffordance>` belongs here. */
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ title, eyebrow, description, actions, className }: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
        <h3 className="type-title-3 truncate text-ink">{title}</h3>
        {description && <p className="type-body-sm mt-1 text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-4 flex items-center gap-2 border-t border-border pt-3", className)}>
      {children}
    </div>
  );
}
