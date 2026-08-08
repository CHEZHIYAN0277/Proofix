/**
 * `<WhyPanel>` — the uniform presentation of the explainability contract
 * (blueprint §4, §9).
 *
 * Every `<ExplainAffordance>` in the workspace routes here through
 * `ExplainProvider`, so "why does it say that?" always opens the same surface
 * with the same four parts: **Explain · Why · Confidence · Source**.
 *
 * The panel is evidence-only. It never explains the model's reasoning, because
 * there is none to show — what it shows are deterministic signals with weights
 * and provenance, and the literal endpoint and field path each came from. That
 * is what makes an assertion checkable rather than merely confident.
 *
 * The open surface is reflected in `?why=`, so an explanation is linkable: a
 * reviewer can send the exact claim they are questioning.
 */

import { X } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/design/components/Button";
import { ExplainContent, ExplainProvider } from "@/design/primitives/ExplainAffordance";
import { glass } from "@/design/tokens/elevation";
import type { ExplainSpec } from "@/design/types";
import { cn } from "@/lib/utils";

interface OpenExplanation {
  id: string;
  spec: ExplainSpec;
  subject: string;
}

export interface WhyPanelHostProps {
  children: ReactNode;
  /** Current `?why=` value, so an explanation can be linked to. */
  why?: string;
  onWhyChange?: (why: string | undefined) => void;
}

/**
 * Mounts the provider and the sheet. Wrapping the workspace means every
 * affordance inside it delegates instead of opening its own popover.
 */
export function WhyPanelHost({ children, why, onWhyChange }: WhyPanelHostProps) {
  const [open, setOpen] = useState<OpenExplanation | null>(null);

  const explain = useMemo(
    () => ({
      open: (id: string, spec: ExplainSpec, subject: string) => {
        setOpen({ id, spec, subject });
        onWhyChange?.(id);
      },
    }),
    [onWhyChange],
  );

  const close = useCallback(() => {
    setOpen(null);
    onWhyChange?.(undefined);
  }, [onWhyChange]);

  // `why` in the URL without a matching open panel means the link was pasted
  // before the surface registered. The panel stays closed rather than
  // fabricating an explanation for an id it has no spec for.
  void why;

  return (
    <ExplainProvider value={explain}>
      {children}
      {open && <WhySheet subject={open.subject} spec={open.spec} onClose={close} />}
    </ExplainProvider>
  );
}

function WhySheet({
  subject,
  spec,
  onClose,
}: {
  subject: string;
  spec: ExplainSpec;
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close explanation"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <aside
        role="dialog"
        aria-modal="false"
        aria-label="Why"
        className={cn(
          glass("digital-twin-overlay"),
          "fixed right-0 top-0 z-50 flex h-screen w-[380px] flex-col rounded-none border-y-0 border-r-0 shadow-lg",
        )}
        style={{
          animation: "why-panel-in var(--motion-base) var(--ease-base) both",
        }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <span className="type-title-3 text-ink">Why</span>
          <Button
            size="sm"
            variant="ghost"
            icon={<X />}
            aria-label="Close explanation"
            onClick={onClose}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ExplainContent subject={subject} spec={spec} />
        </div>
      </aside>
    </>
  );
}
