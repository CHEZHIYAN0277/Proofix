/**
 * `<DigitalTwinPreview>` — placeholder (blueprint §8, Phase 1).
 *
 * The twin engine (`lib/v2/twin`: model · layout · projection) and the shared
 * renderer are Phase 9. Reserving the slot now is what makes the later page a
 * re-mount rather than a rewrite.
 *
 * What it does *not* do is draw a decorative graph. A preview showing nodes
 * that no backend export produced would be the exact failure this product
 * exists to prevent — so it states what it is and what it is waiting for.
 */

import { Network } from "lucide-react";

import { DataState } from "@/design/states/DataState";

export function DigitalTwinPreview() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-border px-3 py-3">
      <div className="flex items-center gap-2">
        <Network aria-hidden className="size-4 shrink-0 text-ink-soft" strokeWidth={1.75} />
        <span className="type-label text-ink">Repository twin</span>
      </div>
      <DataState
        kind="unavailable"
        reason="The twin engine and renderer are built in Phase 9"
        size="sm"
      />
      <p className="type-caption text-ink-soft">
        Will render from{" "}
        <code className="type-mono-sm">/api/knowledge/{"{run_id}"}/export/repository</code>, with
        node lifecycle driven by frames.
      </p>
    </div>
  );
}
