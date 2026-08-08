/**
 * Gallery: the foundation primitives and the state components.
 * Proves blueprint §3.6 (states) and §3.7 (primitives).
 *
 * Every specimen that shows a value uses synthetic props from
 * `gallery/samples.ts`. The gallery renders no run data.
 */

import { useState } from "react";

import { Button } from "../../components/Button";
import { DataBoundary } from "../../primitives/DataBoundary";
import { EvidenceList } from "../../primitives/EvidenceList";
import { ExplainAffordance } from "../../primitives/ExplainAffordance";
import { Gauge } from "../../primitives/Gauge";
import { MetricTile } from "../../primitives/MetricTile";
import { StatusPill } from "../../primitives/StatusDot";
import { Eyebrow, KeyValue, SectionHeader, Timestamp } from "../../primitives/atoms";
import { EmptyState } from "../../states/EmptyState";
import { ErrorState } from "../../states/ErrorState";
import { LoadingState } from "../../states/LoadingState";
import { Skeleton, SkeletonCard, SkeletonRows, SkeletonText } from "../../states/Skeleton";
import { AgentAvatar } from "../../identity/AgentAvatar";
import { agentIcon } from "../../identity/icons";
import { SampleNote, Specimen, SpecimenGrid } from "../GalleryShell";
import {
  SAMPLE_AGENT_IDS,
  SAMPLE_EVIDENCE,
  SAMPLE_EXPLAIN,
  SAMPLE_EXPLAIN_NO_CONFIDENCE,
  SAMPLE_SOURCE,
} from "../samples";

/* ------------------------------------------------------- DataBoundary §3.7 */

export function DataBoundarySection() {
  const [value, setValue] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <Specimen
        label="The primary-rule enforcer"
        note="children(value) runs only when the value is genuinely present"
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={value === null ? "primary" : "secondary"}
            onClick={() => setValue(null)}
          >
            null
          </Button>
          <Button
            size="sm"
            variant={value === 0 ? "primary" : "secondary"}
            onClick={() => setValue(0)}
          >
            0
          </Button>
          <Button
            size="sm"
            variant={value === 42 ? "primary" : "secondary"}
            onClick={() => setValue(42)}
          >
            42
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {(["waiting", "pending", "unavailable"] as const).map((kind) => (
            <div key={kind}>
              <Eyebrow className="mb-2">whenMissing = {kind}</Eyebrow>
              <DataBoundary
                value={value}
                whenMissing={kind}
                reason={kind === "unavailable" ? "Producer publishes no value" : undefined}
              >
                {(v) => <span className="type-title-2 tabular text-ink">{v}</span>}
              </DataBoundary>
            </div>
          ))}
        </div>

        <p className="type-caption mt-4 text-ink-soft">
          <code className="type-mono">0</code> is present and renders as{" "}
          <code className="type-mono">0</code>. Only <code className="type-mono">null</code>,{" "}
          <code className="type-mono">undefined</code>, <code className="type-mono">NaN</code> and
          whitespace-only strings are missing — conflating a real zero with an absent value is the
          failure this component exists to prevent.
        </p>
      </Specimen>
    </div>
  );
}

/* -------------------------------------------------------- Metric & Gauge */

export function MetricSection() {
  return (
    <div className="flex flex-col gap-5">
      <SpecimenGrid columns={3}>
        <Specimen label="Present value" note={<SampleNote />}>
          <MetricTile
            label="Sample count"
            value={1342}
            unit="files"
            delta={{ value: 118, label: "vs. sample baseline", higherIsBetter: true }}
            source={SAMPLE_SOURCE}
            explain={SAMPLE_EXPLAIN}
          />
        </Specimen>

        <Specimen label="Absent value" note="renders “—”, never 0">
          <MetricTile
            label="Estimated cost"
            value={null}
            unit="USD"
            whenMissing="unavailable"
            reason="run_id never reaches the LLM gateway (G9)"
            source={[
              {
                label: "Security audit summary",
                endpoint: "GET /api/security/audit/summary?run_id=",
                fieldPath: "estimated_cost_usd",
              },
            ]}
          />
        </Specimen>

        <Specimen label="Threshold" note={<SampleNote />}>
          <MetricTile
            label="Sample score"
            value={64}
            unit="/100"
            threshold={{ value: 80, direction: "at-least" }}
            source={SAMPLE_SOURCE}
            explain={SAMPLE_EXPLAIN_NO_CONFIDENCE}
          />
        </Specimen>
      </SpecimenGrid>

      <SpecimenGrid columns={3}>
        <Specimen label="Gauge — measured" note={<SampleNote />}>
          <Gauge value={86} threshold={80} label="Sample metric" unit="%" />
        </Specimen>
        <Specimen label="Gauge — below threshold" note={<SampleNote />}>
          <Gauge value={62} threshold={80} label="Sample metric" unit="%" />
        </Specimen>
        <Specimen label="Gauge — not measured" note="the state that matters">
          <Gauge
            value={null}
            threshold={80}
            label="Mutation score"
            reason="Producer published score: null"
          />
        </Specimen>
      </SpecimenGrid>

      <p className="type-body-sm text-ink-soft">
        The “Not measured” branch is the reason <code className="type-mono">&lt;Gauge&gt;</code>{" "}
        exists. When the backend publishes <code className="type-mono">null</code> the component
        draws the track and the threshold tick — both facts — and no needle. A needle the backend
        did not produce is a fabricated measurement feeding a merge decision.
      </p>
    </div>
  );
}

/* ------------------------------------------------ Evidence & explainability */

export function ExplainabilitySection() {
  return (
    <SpecimenGrid columns={2}>
      <Specimen label="EvidenceList" note={<SampleNote />}>
        <EvidenceList evidence={SAMPLE_EVIDENCE} />
      </Specimen>

      <Specimen label="ExplainAffordance" note="Explain · Why · Confidence · Source">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="type-body-sm text-ink">With a published confidence</span>
            <ExplainAffordance
              id="gallery.explain.with-confidence"
              subject="Sample surface"
              spec={SAMPLE_EXPLAIN}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="type-body-sm text-ink">Without one</span>
            <ExplainAffordance
              id="gallery.explain.no-confidence"
              subject="Sample surface"
              spec={SAMPLE_EXPLAIN_NO_CONFIDENCE}
            />
          </div>
          <p className="type-caption text-ink-soft">
            Standalone it opens a popover. Under an{" "}
            <code className="type-mono">ExplainProvider</code> — which the Workspace mounts — the
            same control routes into the single Why Panel. Confidence is never synthesized: absent
            renders “Not published”.
          </p>
        </div>
      </Specimen>
    </SpecimenGrid>
  );
}

/* ---------------------------------------------------------------- Atoms */

export function AtomSection() {
  return (
    <SpecimenGrid columns={2}>
      <Specimen label="SectionHeader + Eyebrow">
        <SectionHeader
          level="panel"
          eyebrow="Section kicker"
          title="Panel title"
          description="Description in body-sm, capped for peripheral surfaces."
          actions={
            <ExplainAffordance
              id="gallery.atoms.header"
              subject="Section header"
              spec={SAMPLE_EXPLAIN}
            />
          }
        />
      </Specimen>

      <Specimen label="KeyValue + Timestamp" note={<SampleNote />}>
        <div className="flex flex-col gap-2">
          <KeyValue label="Identifier" value="sample-4f2a9c1" mono />
          <KeyValue label="Count" value="1,342" mono />
          <KeyValue label="Absent (waiting)" value={null} />
          <KeyValue
            label="Absent (unavailable)"
            value={null}
            whenMissing="unavailable"
            reason="Field not on the payload"
          />
          <KeyValue label="Recorded" value={<Timestamp value={Date.now()} format="time" />} />
          <KeyValue
            label="Relative"
            value={<Timestamp value={Date.now() - 185_000} format="relative" />}
          />
        </div>
      </Specimen>
    </SpecimenGrid>
  );
}

/* ---------------------------------------------------------------- States */

export function StatesSection() {
  const [retried, setRetried] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <SpecimenGrid columns={3}>
        <Specimen label="Loading" note="a request is genuinely open">
          <LoadingState label="Fetching" />
        </Specimen>
        <Specimen label="Loading with elapsed" note="a fact, not a percentage">
          <LoadingState label="Fetching" startedAt={Date.now() - 4000} />
        </Specimen>
        <Specimen label="Empty" note="it ran; there is nothing">
          <EmptyState
            title="No findings"
            description="The scan completed and reported nothing."
            size="sm"
          />
        </Specimen>
      </SpecimenGrid>

      <Specimen label="Error" note="names what failed; never falls back to fixtures">
        <ErrorState
          title="Could not load the sample payload"
          detail="502 Bad Gateway"
          source="GET /api/example/endpoint"
          onRetry={() => setRetried((n) => n + 1)}
        />
        {retried > 0 && (
          <p className="type-caption mt-2 text-ink-soft">
            Retry invoked {retried} time{retried === 1 ? "" : "s"} — the handler is real, the
            request is not.
          </p>
        )}
      </Specimen>

      <SpecimenGrid columns={3}>
        <Specimen label="Skeleton — text" note="shape-preserving">
          <SkeletonText lines={4} />
        </Specimen>
        <Specimen label="Skeleton — card">
          <SkeletonCard />
        </Specimen>
        <Specimen label="Skeleton — rows" note="36px table rows">
          <SkeletonRows rows={4} />
        </Specimen>
      </SpecimenGrid>

      <Specimen label="Skeleton — static variant" note="animated={false}">
        <div className="flex gap-3">
          <Skeleton className="h-10 w-10 rounded-full" animated={false} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-1/3" animated={false} />
            <Skeleton className="h-3 w-2/3" animated={false} />
          </div>
        </div>
        <p className="type-caption mt-3 text-ink-soft">
          Skeletons are for genuine in-flight fetches only, never to simulate work. One that
          outlives its request is an animation pretending to be a system.
        </p>
      </Specimen>
    </div>
  );
}

/* -------------------------------------------------------------- Identity */

export function IdentitySection() {
  return (
    <div className="flex flex-col gap-5">
      <Specimen label="Agent marks" note="deterministic from agent_id — never the display name">
        <div className="flex flex-wrap gap-5">
          {SAMPLE_AGENT_IDS.map((id) => {
            const Icon = agentIcon(id);
            return (
              <div key={id} className="flex w-16 flex-col items-center gap-1.5">
                <AgentAvatar agentId={id} size={40} />
                <Icon aria-hidden className="size-4 text-ink-soft" strokeWidth={1.75} />
                <span className="type-mono-sm text-ink-soft">{id}</span>
              </div>
            );
          })}
        </div>
        <p className="type-caption mt-4 text-ink-soft">
          The same id always produces the same mark and hue, across runs, repositories and
          deployments. Hues are drawn from the graph palette, so every mark is AA in both themes.
          The icon map carries no name, purpose or stage — those come from the backend registry.
        </p>
      </Specimen>

      <Specimen label="Sizes" note="below 24px the grid gives way to initials">
        <div className="flex items-end gap-4">
          {[16, 20, 24, 32, 40, 56].map((size) => (
            <div key={size} className="flex flex-col items-center gap-1.5">
              <AgentAvatar agentId="A5.5" size={size} />
              <span className="type-mono-sm text-ink-soft">{size}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-1.5">
            <AgentAvatar agentId="A5.5" size={40} variant="initials" />
            <span className="type-mono-sm text-ink-soft">forced</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <AgentAvatar agentId="UNREGISTERED" size={40} />
            <span className="type-mono-sm text-ink-soft">unknown</span>
          </div>
        </div>
      </Specimen>

      <Specimen label="Status pill sizes">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status="running" size="sm" pulse />
          <StatusPill status="completed" size="sm" />
          <StatusPill status="waiting" size="md" />
          <StatusPill status="failed" size="md" />
        </div>
      </Specimen>
    </div>
  );
}
