/**
 * `<MissionControl>` — RIGHT column, 360px (blueprint §4.1).
 *
 * Renamed from "Intelligence Rail": it is the persistent operational center —
 * the state of the machine, not a sidebar of widgets.
 *
 * Behaviour this phase establishes:
 *   - sections are independently collapsible, and the state persists;
 *   - each declares its own loading / empty / unavailable state;
 *   - **no section animates while a stage is running** (rule A4) — they update
 *     by value change, not by motion;
 *   - section order is fixed, so muscle memory holds across runs.
 *
 * Phase 1 ships the scaffold with the two sections whose data exists today.
 * The remaining cards are declared with the gap that blocks each of them, so
 * the panel is honest about what it cannot yet show rather than silently
 * shorter.
 */

import { useCallback, useEffect, useState } from "react";

import { Panel, PanelSection } from "@/design/components/Panel";
import { DataState } from "@/design/states/DataState";
import { cn } from "@/lib/utils";
import { LiveActivityFeed } from "../activity/LiveActivityFeed";
import { RepositoryHealthCard } from "../mission/RepositoryHealthCard";
import { RunMetricsCard } from "../mission/RunMetricsCard";
import { KnowledgeGraphSummary } from "../stages/repository/KnowledgeGraphSummary";
import { RepositoryDna } from "../stages/repository/RepositoryDna";
import { RunTimeline } from "../activity/RunTimeline";
import { useTerminal } from "../RunProvider";
import { DigitalTwinPreview } from "../twin/DigitalTwinPreview";

const STORAGE_KEY = "proofix.v2.mission-control.collapsed";

/**
 * Sections that exist but have no data path yet. Naming the blocking gap is
 * more useful than hiding the card — it tells a reader what is missing and
 * why, and it keeps the panel's order stable once the gap closes.
 */
const PENDING_SECTIONS: { id: string; title: string; reason: string }[] = [
  {
    id: "security",
    title: "Security",
    reason: "run_id never reaches LLMGateway (G9) — audit events carry no run scope",
  },
  {
    id: "learning",
    title: "Learning",
    reason: "Learning is repository-scoped and not published on the run",
  },
];

function readCollapsed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function MissionControl({ onJumpToStage }: { onJumpToStage?: (stageId: string) => void }) {
  const terminal = useTerminal();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Read after mount: `localStorage` is a client concern and reading it during
  // the server render would produce a hydration mismatch.
  useEffect(() => setCollapsed(readCollapsed()), []);

  const toggle = useCallback((id: string, open: boolean) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !open };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage can be blocked; the session still works */
      }
      return next;
    });
  }, []);

  const isOpen = (id: string) => collapsed[id] !== true;

  return (
    <aside
      aria-label="Mission Control"
      className={cn("h-full min-h-0 shrink-0 border-l border-border")}
      style={{
        width: "var(--mission-control-width)",
        // Rule A3 — peripheral chrome dims while the story is still running.
        opacity: terminal === null ? "var(--peripheral-opacity)" : 1,
        transition: "opacity var(--motion-slow) var(--ease-slow)",
      }}
    >
      <Panel
        title="Mission Control"
        eyebrow="Run state"
        className="h-full rounded-none border-0"
        bodyClassName="px-4 py-2"
      >
        <PanelSection
          title="Digital Twin"
          open={isOpen("twin")}
          onOpenChange={(open) => toggle("twin", open)}
        >
          <DigitalTwinPreview />
        </PanelSection>

        <PanelSection
          title="Run Timeline"
          open={isOpen("timeline")}
          onOpenChange={(open) => toggle("timeline", open)}
        >
          <RunTimeline onSelect={onJumpToStage} />
        </PanelSection>

        <PanelSection
          title="Live Activity"
          open={isOpen("activity")}
          onOpenChange={(open) => toggle("activity", open)}
        >
          <LiveActivityFeed onJumpToStage={onJumpToStage} />
        </PanelSection>

        <PanelSection
          title="Repository DNA"
          open={isOpen("dna")}
          onOpenChange={(open) => toggle("dna", open)}
        >
          <RepositoryDna compact />
        </PanelSection>

        <PanelSection
          title="Repository Health"
          open={isOpen("health")}
          onOpenChange={(open) => toggle("health", open)}
        >
          <RepositoryHealthCard />
        </PanelSection>

        <PanelSection
          title="Knowledge Graph"
          open={isOpen("knowledge")}
          onOpenChange={(open) => toggle("knowledge", open)}
        >
          <KnowledgeGraphSummary />
        </PanelSection>

        <PanelSection
          title="Run Metrics"
          open={isOpen("metrics")}
          onOpenChange={(open) => toggle("metrics", open)}
        >
          <RunMetricsCard />
        </PanelSection>

        {PENDING_SECTIONS.map((section) => (
          <PanelSection
            key={section.id}
            title={section.title}
            open={isOpen(section.id)}
            onOpenChange={(open) => toggle(section.id, open)}
          >
            <DataState kind="unavailable" reason={section.reason} size="sm" />
          </PanelSection>
        ))}
      </Panel>
    </aside>
  );
}
