/**
 * `<ExplainAffordance>` (blueprint §3.7, §9).
 *
 * The uniform `?` control that opens the explanation for any explainable
 * surface: **Explain · Why · Evidence · Confidence · Source.**
 *
 * Two presentations, one contract:
 *   - When an `ExplainProvider` is mounted (the Workspace mounts one so the
 *     `<WhyPanel>` sheet is the single presentation), the control delegates.
 *   - Standalone, it renders the same content in a popover, so any surface —
 *     Dashboard, Security, Learning, the gallery — is explainable without
 *     depending on the Workspace shell.
 *
 * Confidence is never synthesized. `null` renders "Not published".
 */

import { HelpCircle } from "lucide-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Explainable, ExplainSpec } from "../types";
import { EvidenceList } from "./EvidenceList";
import { Eyebrow } from "./atoms";

/* -------------------------------------------------------------------------
   Explain registry context

   Phase 1 mounts a provider that routes every affordance into the single
   `<WhyPanel>`. Until then the popover fallback keeps the contract usable.
   ---------------------------------------------------------------------- */

export interface ExplainContextValue {
  /**
   * Open the shared presentation for a surface.
   *
   * `subject` travels with the spec because the panel heads its content with
   * what is being explained — without it every explanation would be titled by
   * its own first sentence.
   */
  open: (id: string, spec: ExplainSpec, subject: string) => void;
}

const ExplainContext = createContext<ExplainContextValue | null>(null);

export function ExplainProvider({
  value,
  children,
}: {
  value: ExplainContextValue;
  children: ReactNode;
}) {
  return <ExplainContext.Provider value={value}>{children}</ExplainContext.Provider>;
}

export function useExplainContext(): ExplainContextValue | null {
  return useContext(ExplainContext);
}

/** Normalise an `Explainable` implementation into the plain spec. */
export function toExplainSpec(source: Explainable): ExplainSpec {
  return {
    explain: source.explain(),
    why: source.why(),
    confidence: source.confidence(),
    source: source.source(),
  };
}

/* -------------------------------------------------------------------------
   The affordance
   ---------------------------------------------------------------------- */

export interface ExplainAffordanceProps {
  /** Stable id for this surface, used by the registry and by `?why=`. */
  id: string;
  /** The explanation, as a spec or as an `Explainable` implementation. */
  spec: ExplainSpec | Explainable;
  /** What is being explained. Becomes the accessible name and the heading. */
  subject: string;
  size?: "sm" | "md";
  className?: string;
}

function isExplainable(v: ExplainSpec | Explainable): v is Explainable {
  return typeof (v as Explainable).explain === "function";
}

export function ExplainAffordance({
  id,
  spec,
  subject,
  size = "sm",
  className,
}: ExplainAffordanceProps) {
  const ctx = useExplainContext();
  const resolved = useMemo(() => (isExplainable(spec) ? toExplainSpec(spec) : spec), [spec]);

  const trigger = (
    <button
      type="button"
      aria-label={`Explain ${subject}`}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink",
        size === "sm" ? "size-5" : "size-6",
        className,
      )}
      onClick={ctx ? () => ctx.open(id, resolved, subject) : undefined}
    >
      <HelpCircle aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={2} />
    </button>
  );

  // Delegated presentation — the Workspace's Why Panel owns it.
  if (ctx) return trigger;

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-panel p-4">
        <ExplainContent subject={subject} spec={resolved} />
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------
   The content — shared by the popover fallback and by <WhyPanel> (Phase 1)
   ---------------------------------------------------------------------- */

export function ExplainContent({ subject, spec }: { subject: string; spec: ExplainSpec }) {
  const { explain, why = [], confidence, source = [] } = spec;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Eyebrow>Explain</Eyebrow>
        <p className="type-title-3 mt-1 text-ink">{subject}</p>
        <p className="type-body-sm mt-1 text-ink-soft">{explain}</p>
      </div>

      {why.length > 0 && (
        <div>
          <Eyebrow className="mb-2">Why</Eyebrow>
          <EvidenceList evidence={why} compact />
        </div>
      )}

      <div>
        <Eyebrow className="mb-1">Confidence</Eyebrow>
        {confidence === null || confidence === undefined ? (
          // Never synthesized. A producer that publishes none says so.
          <p className="type-body-sm text-ink-soft">Not published</p>
        ) : (
          <p className="type-mono text-ink">{Math.round(confidence * 100)}%</p>
        )}
      </div>

      {source.length > 0 && (
        <div>
          <Eyebrow className="mb-1.5">Source</Eyebrow>
          <ul className="flex flex-col gap-1.5">
            {source.map((s, i) => (
              <li key={i} className="min-w-0">
                <p className="type-label text-ink">{s.label}</p>
                {s.endpoint && <p className="type-mono-sm break-all text-ink-soft">{s.endpoint}</p>}
                {s.fieldPath && (
                  <p className="type-mono-sm break-all text-ink-soft">{s.fieldPath}</p>
                )}
                {s.agentId && <p className="type-mono-sm text-ink-soft">{s.agentId}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
