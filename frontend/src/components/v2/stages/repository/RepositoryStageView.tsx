/**
 * Repository Intelligence — the stage visualization (blueprint Phase 2).
 *
 * Assembles the five surfaces the stage is responsible for: structure,
 * languages, DNA, framework detection, the knowledge-graph summary and static
 * analysis. Each fetches its own data and declares its own loading, empty and
 * unavailable states, so one slow or missing source never blanks the stage.
 *
 * Lazy-loaded by `StageContainer`, so none of this — nor the queries it pulls
 * in — reaches a viewer who never opens the stage (§14, route chunk budget).
 */

import { SectionHeader } from "@/design/primitives/atoms";
import { Reveal } from "@/design/primitives/Reveal";
import type { StageView } from "@/lib/v2/stages/machine";
import { FrameworkDetection } from "./FrameworkDetection";
import { KnowledgeGraphSummary } from "./KnowledgeGraphSummary";
import { LanguageBreakdown } from "./LanguageBreakdown";
import { RepositoryDna } from "./RepositoryDna";
import { RepositoryTree } from "./RepositoryTree";
import { StaticAnalysisPanel } from "./StaticAnalysisPanel";

const SECTIONS = [
  { id: "structure", title: "Structure", render: () => <RepositoryTree /> },
  { id: "languages", title: "Languages", render: () => <LanguageBreakdown /> },
  { id: "dna", title: "Repository DNA", render: () => <RepositoryDna /> },
  { id: "frameworks", title: "Frameworks", render: () => <FrameworkDetection /> },
  { id: "knowledge", title: "Knowledge Graph", render: () => <KnowledgeGraphSummary /> },
  { id: "static", title: "Static Analysis", render: () => <StaticAnalysisPanel /> },
] as const;

export default function RepositoryStageView({ stage }: { stage: StageView }) {
  void stage;

  return (
    <div className="flex flex-col" style={{ gap: "var(--pad-stage-section)" }}>
      {SECTIONS.map((section, index) => (
        <Reveal key={section.id} class="event" token="base" index={index} as="section">
          <SectionHeader level="card" title={section.title} className="mb-3" />
          {section.render()}
        </Reveal>
      ))}
    </div>
  );
}
