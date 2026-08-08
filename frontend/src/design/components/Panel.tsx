/**
 * Panel (blueprint §3.6).
 *
 * The persistent side surface: header, scrolling body, optional footer.
 * Mission Control, the Why Panel and the Chat Dock are all Panels.
 *
 * Panels are peripheral by default (rules A1–A3): flat, quiet, capped type,
 * and dimmed to `--peripheral-opacity` while a stage is running. Sections
 * within them are independently collapsible and **never animate while a stage
 * is running** — they update by value change, not by motion (rule A4).
 */

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { glass, type GlassSurface } from "../tokens/elevation";
import { Eyebrow } from "../primitives/atoms";

export interface PanelProps {
  children: ReactNode;
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /**
   * Glass is permitted on exactly four surfaces (§3.3). Passing one of them
   * opts in; anything else is a type error.
   */
  glassSurface?: GlassSurface;
  /** Rule A3 — dimmed while a stage is running. */
  dimmed?: boolean;
  className?: string;
  bodyClassName?: string;
}

export function Panel({
  children,
  title,
  eyebrow,
  actions,
  footer,
  glassSurface,
  dimmed = false,
  className,
  bodyClassName,
}: PanelProps) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-panel border",
        glassSurface ? glass(glassSurface) : "border-border bg-surface",
        className,
      )}
      style={{ opacity: dimmed ? "var(--peripheral-opacity)" : undefined }}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
            {title && <h2 className="type-title-2 truncate text-ink">{title}</h2>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}

      <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-4", bodyClassName)}>
        {children}
      </div>

      {footer && <footer className="border-t border-border px-6 py-3">{footer}</footer>}
    </section>
  );
}

/* -------------------------------------------------------------------------
   PanelSection — a collapsible block inside a Panel

   Collapse state is lifted by the consumer (Mission Control persists it), so
   the section itself stays a pure function of props.
   ---------------------------------------------------------------------- */

export interface PanelSectionProps {
  title: ReactNode;
  children: ReactNode;
  /** Right-aligned controls; the `<ExplainAffordance>` belongs here. */
  actions?: ReactNode;
  /** Controlled collapse. Omit both to use internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  className?: string;
}

export function PanelSection({
  title,
  children,
  actions,
  open,
  onOpenChange,
  defaultOpen = true,
  className,
}: PanelSectionProps) {
  const [internal, setInternal] = useState(defaultOpen);
  const isOpen = open ?? internal;

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInternal(next);
    onOpenChange?.(next);
  };

  return (
    <div className={cn("border-b border-border py-3 last:border-b-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className="type-label flex min-w-0 flex-1 items-center gap-1.5 text-left text-ink"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-ink-soft transition-transform",
              !isOpen && "-rotate-90",
            )}
            style={{
              transitionDuration: "var(--motion-fast)",
              transitionTimingFunction: "var(--ease-fast)",
            }}
            strokeWidth={2}
          />
          <span className="truncate">{title}</span>
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>

      {/* `content-visibility` keeps collapsed sections off the layout and paint
          path — required by the performance budget (§14). */}
      <div
        className={cn("mt-3", !isOpen && "hidden")}
        style={{ contentVisibility: isOpen ? "visible" : "auto" }}
      >
        {children}
      </div>
    </div>
  );
}
