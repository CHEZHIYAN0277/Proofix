/**
 * The `/design` gallery (blueprint §3.7).
 *
 * **Deliverable of Phase 0:** a Storybook-equivalent token & component gallery
 * proving every token, state and primitive in both themes. It renders no run
 * data.
 */

import { GalleryShell, type GallerySectionDef } from "./GalleryShell";
import { ColorSection } from "./sections/ColorSection";
import {
  ButtonSection,
  CardSection,
  CodeSection,
  GraphSection,
  InputSection,
  PanelSectionDemo,
  TableSection,
} from "./sections/ComponentSections";
import {
  ElevationSection,
  MotionSection,
  SpacingSection,
  TypographySection,
} from "./sections/FoundationSections";
import {
  AtomSection,
  DataBoundarySection,
  ExplainabilitySection,
  IdentitySection,
  MetricSection,
  StatesSection,
} from "./sections/PrimitiveSections";

const SECTIONS: GallerySectionDef[] = [
  {
    id: "typography",
    title: "Typography",
    reference: "§3.1",
    summary:
      "Eleven tokens across three families. Numerals are always tabular; identifiers, paths, SHAs and scores are always mono.",
    render: () => <TypographySection />,
  },
  {
    id: "spacing",
    title: "Spacing & grid",
    reference: "§3.2",
    summary:
      "4px base, one padding value per surface kind, and the Workspace grid that keeps the center column optically dominant.",
    render: () => <SpacingSection />,
  },
  {
    id: "elevation",
    title: "Radius, elevation, glass",
    reference: "§3.3",
    summary:
      "Elevation encodes attention: only the active stage may sit at shadow-md or carry a glow. Glass is permitted on exactly four surfaces.",
    render: () => <ElevationSection />,
  },
  {
    id: "motion",
    title: "Motion",
    reference: "§3.4",
    summary:
      "Six duration tokens, consumed only through <Reveal>. Motion explains work; it never fills time, and prefers-reduced-motion collapses everything at one gate.",
    render: () => <MotionSection />,
  },
  {
    id: "color",
    title: "Color",
    reference: "§3.5",
    summary:
      "Semantic, status (six states), data-state and the graph palette — with a live contrast audit that re-measures when you flip the theme.",
    render: () => <ColorSection />,
  },
  {
    id: "data-boundary",
    title: "DataBoundary",
    reference: "§3.7",
    summary:
      "The primary-rule enforcer. Every fact in the product is wrapped in one, so an invented value cannot be rendered without deleting a component.",
    render: () => <DataBoundarySection />,
  },
  {
    id: "metrics",
    title: "MetricTile & Gauge",
    reference: "§3.7",
    summary:
      "A metric with no value renders “—” and its source, never 0. A gauge with no measurement renders “Not measured”, never a needle.",
    render: () => <MetricSection />,
  },
  {
    id: "explainability",
    title: "Explainability",
    reference: "§9",
    summary:
      "Explain · Why · Confidence · Source. Weighted deterministic signals with provenance — never chain-of-thought, and confidence is never synthesized.",
    render: () => <ExplainabilitySection />,
  },
  {
    id: "atoms",
    title: "Layout atoms",
    reference: "§3.7",
    summary:
      "Eyebrow, SectionHeader, KeyValue and Timestamp — the shared anatomy of every surface.",
    render: () => <AtomSection />,
  },
  {
    id: "states",
    title: "States",
    reference: "§3.6",
    summary:
      "Loading, Empty, Error and the skeletons. Error states name what failed and offer retry; they never fall back to fixture data.",
    render: () => <StatesSection />,
  },
  {
    id: "identity",
    title: "Agent identity",
    reference: "§5",
    summary:
      "Deterministic marks and icons keyed on agent_id, never the display name. The same agent looks the same everywhere.",
    render: () => <IdentitySection />,
  },
  {
    id: "card",
    title: "Card",
    reference: "§3.6",
    summary:
      "Header / body / footer, with four variants that are attention declarations rather than style choices.",
    render: () => <CardSection />,
  },
  {
    id: "button",
    title: "Button",
    reference: "§3.6",
    summary:
      "Four variants, three sizes. Icon-only requires aria-label; loading is bound to real pending operations only.",
    render: () => <ButtonSection />,
  },
  {
    id: "input",
    title: "Input",
    reference: "§3.6",
    summary: "Label above, hint below, error replaces hint. The focus ring is never removed.",
    render: () => <InputSection />,
  },
  {
    id: "panel",
    title: "Panel",
    reference: "§3.6",
    summary: "The persistent side surface, with independently collapsible sections.",
    render: () => <PanelSectionDemo />,
  },
  {
    id: "table",
    title: "Table",
    reference: "§3.6",
    summary:
      "36px rows, sticky header, mono numerics, right-aligned numbers, zebra off, hover tint only.",
    render: () => <TableSection />,
  },
  {
    id: "graph",
    title: "Graph chrome",
    reference: "§3.6",
    summary: "Toolbar, legend, minimap and the table equivalent every graph is required to ship.",
    render: () => <GraphSection />,
  },
  {
    id: "code",
    title: "Code block",
    reference: "§3.6",
    summary: "Line numbers, copy, wrap toggle and a diff variant. Never a text dump.",
    render: () => <CodeSection />,
  },
];

export function DesignGallery() {
  return <GalleryShell sections={SECTIONS} />;
}

export { GalleryShell } from "./GalleryShell";
export type { GallerySectionDef } from "./GalleryShell";
