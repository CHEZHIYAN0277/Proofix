/**
 * Gallery: the component systems (blueprint §3.6).
 * Card · Button · Input · Panel · Table · Graph chrome · Code block.
 */

import { Filter, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../components/Card";
import { CodeBlock } from "../../components/CodeBlock";
import { DiffView } from "../../components/DiffView";
import { GraphChrome } from "../../components/GraphChrome";
import { Field, SearchInput, SelectInput, TextInput, TextareaInput } from "../../components/Input";
import { Panel, PanelSection } from "../../components/Panel";
import { DataTable, type TableColumn } from "../../components/Table";
import { StatusPill } from "../../primitives/StatusDot";
import { KeyValue } from "../../primitives/atoms";
import { EmptyState } from "../../states/EmptyState";
import { SampleNote, Specimen, SpecimenGrid } from "../GalleryShell";
import {
  SAMPLE_CODE,
  SAMPLE_DIFF,
  SAMPLE_DIFF_LINES,
  SAMPLE_DIFF_ORIGINAL,
  SAMPLE_DIFF_PATCHED,
  SAMPLE_ROWS,
  type SampleRow,
} from "../samples";

/* ----------------------------------------------------------------- Card */

export function CardSection() {
  return (
    <div className="flex flex-col gap-5">
      <SpecimenGrid columns={2}>
        {(["resting", "active", "peripheral", "interactive"] as const).map((variant) => (
          <Specimen
            key={variant}
            label={variant}
            note={
              variant === "active"
                ? "the only variant permitted accent, shadow-md and motion"
                : variant === "peripheral"
                  ? "flat, quiet, body-sm cap"
                  : undefined
            }
          >
            <Card variant={variant} status={variant === "active" ? "running" : undefined}>
              <CardHeader
                eyebrow="Section kicker"
                title="Card title"
                description="Header / body / footer is the whole anatomy."
                actions={<StatusPill status="running" size="sm" pulse={variant === "active"} />}
              />
              <CardBody>
                <p className="type-body-sm text-ink-soft">
                  Body content sits at 20px padding, 16px when compact.
                </p>
              </CardBody>
              <CardFooter>
                <Button size="sm" variant="ghost">
                  Action
                </Button>
              </CardFooter>
            </Card>
          </Specimen>
        ))}
      </SpecimenGrid>

      <Specimen label="Rule A3 — dimmed peripheral chrome">
        <div className="flex gap-4">
          <Card variant="peripheral" compact className="flex-1">
            <span className="type-body-sm text-ink">Full contrast (run is terminal)</span>
          </Card>
          <Card variant="peripheral" compact dimmed className="flex-1">
            <span className="type-body-sm text-ink">Dimmed to 72% (a stage is running)</span>
          </Card>
        </div>
      </Specimen>
    </div>
  );
}

/* --------------------------------------------------------------- Button */

export function ButtonSection() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <Specimen label="Variants and sizes">
        <div className="flex flex-col gap-4">
          {(["sm", "md", "lg"] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-2">
              <span className="type-mono-sm w-6 shrink-0 text-ink-soft">{size}</span>
              <Button size={size} variant="primary">
                Primary
              </Button>
              <Button size={size} variant="secondary">
                Secondary
              </Button>
              <Button size={size} variant="ghost">
                Ghost
              </Button>
              <Button size={size} variant="danger" icon={<Trash2 />}>
                Danger
              </Button>
              <Button size={size} variant="secondary" icon={<Plus />} aria-label="Add item" />
            </div>
          ))}
        </div>
      </Specimen>

      <SpecimenGrid columns={2}>
        <Specimen label="Loading" note="bound to real pending operations only">
          <div className="flex items-center gap-3">
            <Button variant="primary" loading={loading}>
              Submit
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setLoading(true);
                window.setTimeout(() => setLoading(false), 1200);
              }}
            >
              Simulate a request
            </Button>
          </div>
          <p className="type-caption mt-3 text-ink-soft">
            The loading state disables the button and swaps to a spinner. It is never bound to a
            timer in the product — the toggle above exists so the state can be inspected.
          </p>
        </Specimen>

        <Specimen label="Disabled and focus">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <Button variant="secondary" icon={<Filter />} aria-label="Filter" />
          </div>
          <p className="type-caption mt-3 text-ink-soft">
            Tab to any control: the <code className="type-mono">--ring</code> focus ring is a
            design-system guarantee and is never removed. An icon-only button without{" "}
            <code className="type-mono">aria-label</code> is a type error.
          </p>
        </Specimen>
      </SpecimenGrid>
    </div>
  );
}

/* ---------------------------------------------------------------- Input */

export function InputSection() {
  return (
    <SpecimenGrid columns={2}>
      <Specimen label="Anatomy" note="label above · hint below · error replaces hint">
        <div className="flex flex-col gap-4">
          <Field label="Text" hint="Hint sits below the control.">
            {({ inputId, describedBy }) => (
              <TextInput id={inputId} aria-describedby={describedBy} placeholder="Placeholder" />
            )}
          </Field>

          <Field label="Required with error" required error="This field is required.">
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                invalid
                placeholder="Placeholder"
              />
            )}
          </Field>

          <Field label="Select" hint="Native select, design-system chrome.">
            {({ inputId, describedBy }) => (
              <SelectInput id={inputId} aria-describedby={describedBy} defaultValue="a">
                <option value="a">Option A</option>
                <option value="b">Option B</option>
              </SelectInput>
            )}
          </Field>
        </div>
      </Specimen>

      <Specimen label="Search and textarea">
        <div className="flex flex-col gap-4">
          <Field label="Search">
            {({ inputId, describedBy }) => (
              <SearchInput id={inputId} aria-describedby={describedBy} placeholder="Search" />
            )}
          </Field>
          <Field label="Textarea" hint="Resizes vertically only.">
            {({ inputId, describedBy }) => (
              <TextareaInput
                id={inputId}
                aria-describedby={describedBy}
                placeholder="Placeholder"
              />
            )}
          </Field>
        </div>
      </Specimen>
    </SpecimenGrid>
  );
}

/* ---------------------------------------------------------------- Panel */

export function PanelSectionDemo() {
  return (
    <SpecimenGrid columns={2}>
      <Specimen label="Panel" note="Mission Control, Why Panel and Chat Dock are all Panels">
        <Panel title="Panel title" eyebrow="Persistent surface" className="h-72">
          <PanelSection title="Collapsible section">
            <div className="flex flex-col gap-2">
              <KeyValue label="Sample key" value="sample value" />
              <KeyValue label="Absent" value={null} />
            </div>
          </PanelSection>
          <PanelSection title="Second section" defaultOpen={false}>
            <EmptyState title="Nothing here" size="sm" />
          </PanelSection>
          <PanelSection title="Third section">
            <p className="type-body-sm text-ink-soft">
              Sections never animate while a stage is running — they update by value change, not by
              motion.
            </p>
          </PanelSection>
        </Panel>
      </Specimen>

      <Specimen label="Glass panel" note="one of the four permitted surfaces">
        <div
          className="rounded-card p-4"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--surface-muted) 0 10px, var(--surface) 10px 20px)",
          }}
        >
          <Panel title="Chat Dock" glassSurface="chat-dock" className="h-56">
            <p className="type-body-sm text-ink">
              Glass is opt-in by naming one of four surfaces. Anything else is a type error.
            </p>
          </Panel>
        </div>
      </Specimen>
    </SpecimenGrid>
  );
}

/* ---------------------------------------------------------------- Table */

const SAMPLE_COLUMNS: TableColumn<SampleRow>[] = [
  { key: "path", header: "Path", cell: (r) => r.path, mono: true },
  { key: "score", header: "Score", cell: (r) => r.score.toFixed(2), numeric: true, width: "88px" },
  { key: "hops", header: "Hops", cell: (r) => r.hops, numeric: true, width: "72px" },
];

export function TableSection() {
  return (
    <div className="flex flex-col gap-5">
      <Specimen
        label="Dense enterprise table"
        note={<SampleNote>36px rows · sticky header · zebra off</SampleNote>}
      >
        <DataTable
          columns={SAMPLE_COLUMNS}
          rows={SAMPLE_ROWS}
          rowKey={(r) => r.id}
          caption="Sample rows demonstrating the dense table"
          maxHeight={200}
        />
      </Specimen>

      <Specimen label="Empty" note="the table ran and found nothing">
        <DataTable
          columns={SAMPLE_COLUMNS}
          rows={[]}
          rowKey={(r) => r.id}
          emptyTitle="No rows"
          emptyDescription="The query returned an empty set."
        />
      </Specimen>
    </div>
  );
}

/* --------------------------------------------------------- Graph chrome */

export function GraphSection() {
  return (
    <div className="flex flex-col gap-5">
      <Specimen
        label="Graph chrome"
        note="toolbar · legend · minimap ≥1280px · mandatory table equivalent"
      >
        <GraphChrome
          title="Sample view"
          nodeCount={SAMPLE_ROWS.length}
          nodeTypes={["module", "file", "function"]}
          edgeTypes={["imports", "calls"]}
          height={220}
          controls={{
            fit: () => {},
            zoomIn: () => {},
            zoomOut: () => {},
            cycleLayout: () => {},
            layoutLabel: "hierarchical",
            onSearch: () => {},
          }}
          minimap={
            <div className="type-caption rounded-xs border border-border bg-surface-muted px-2 py-1 text-ink-soft">
              minimap slot
            </div>
          }
          tableView={
            <DataTable
              columns={SAMPLE_COLUMNS}
              rows={SAMPLE_ROWS}
              rowKey={(r) => r.id}
              caption="Table equivalent of the sample graph"
            />
          }
        >
          <div className="flex h-[220px] items-center justify-center">
            <p className="type-body-sm max-w-sm text-center text-ink-soft">
              Renderer slot. React Flow mounts here in Phase 3 — the chrome carries no graph
              library, so it stays in the base bundle.
            </p>
          </div>
        </GraphChrome>
        <p className="type-caption mt-3 text-ink-soft">
          Toggle the table icon: every graph ships a table equivalent, which is both the
          accessibility contract and the escape hatch on mobile.
        </p>
      </Specimen>

      <Specimen label="Empty graph">
        <GraphChrome
          title="Sample view"
          nodeCount={0}
          height={160}
          emptyTitle="No graph data"
          emptyDescription="The export returned no nodes for this view."
        />
      </Specimen>
    </div>
  );
}

/* ----------------------------------------------------------- Code block */

export function CodeSection() {
  return (
    <SpecimenGrid columns={2}>
      <Specimen label="Code" note={<SampleNote />}>
        <CodeBlock
          code={SAMPLE_CODE}
          language="python"
          filename="sample/module/example.py"
          maxHeight={200}
        />
      </Specimen>

      <Specimen label="Diff variant" note="add / remove gutters">
        <CodeBlock
          lines={SAMPLE_DIFF}
          diff
          language="python"
          filename="sample/module/example.py"
          maxHeight={200}
        />
      </Specimen>

      <Specimen
        label="DiffView"
        note="Shiki, loaded lazily — plain until the grammar arrives"
        className="lg:col-span-2"
      >
        <DiffView
          lines={SAMPLE_DIFF_LINES}
          original={SAMPLE_DIFF_ORIGINAL}
          patched={SAMPLE_DIFF_PATCHED}
          filename="sample/module/example.py"
          maxHeight={220}
        />
      </Specimen>
    </SpecimenGrid>
  );
}
