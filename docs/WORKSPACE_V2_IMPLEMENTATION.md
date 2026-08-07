# ProoFix Workspace V2 — Implementation Blueprint

Definitive implementation guide. Companion to `WORKSPACE_REDESIGN.md` (architecture).

**Status: planning. No code written. No backend modified.**

Constraints in force:
- `Workspace.tsx` and everything it imports is **untouched**.
- All new work lives behind `FEATURE_WORKSPACE_V2`.
- Every visual element traces to a backend field, or renders `Waiting` / `Pending` /
  `Unavailable`.
- Phase N does not begin until Phase N−1 is complete and compiles.

---

## 1. Design philosophy

### 1.1 What this product is

ProoFix is not a dashboard. A dashboard reports state. ProoFix shows **an autonomous
senior engineer working** — reasoning, finding evidence, changing its mind, proving
itself, and remembering what it learned.

The difference is not decoration. It is *narrative*: a dashboard has no beginning or
end, while a run does. The workspace must read as a story with an arc.

```
Repository → Understanding → Investigation → Context Engineering
           → Planning → Generation → Validation → Learning → Decision
```

### 1.2 The attention budget

**The active stage owns 70–80% of visual attention.** Mission Control, Stage Rail,
Digital Twin, Chat, Timeline and Activity Feed *support* it and must never compete.

That is a measurable constraint, not a mood. Enforced by five rules:

| # | Rule |
|---|---|
| **A1** | Only the active stage may use accent color (`--primary`), elevation ≥ `--shadow-md`, or motion of any class. Peripheral surfaces are `--surface`/`--ink-soft`, flat, static. |
| **A2** | Peripheral type is capped at `text-sm` (14px). The active stage owns everything above it. |
| **A3** | Peripheral chrome renders at ≤ 72% of full ink contrast while a stage is running; it returns to full contrast when the run reaches a terminal state and the story is over. |
| **A4** | Exactly one continuous "working" animation exists on screen at a time — the active stage's. The rail shows state, not activity. |
| **A5** | The center column is optically dominant at every breakpoint: center min 58% of viewport width ≥1280px; rails collapse before the center narrows below 720px. |

### 1.3 Aliveness comes from the backend

Motion exists to **explain work**, never to fill time. Three tests every animation must
pass:

1. **Causality** — is it caused by a frame or a response? If not, delete it.
2. **Proportionality** — does its duration reflect real duration, or a designer's taste?
3. **Termination** — does it stop the instant the work stops?

There are no indeterminate progress bars in Workspace V2. An in-flight stage shows an
**elapsed counter**, which is a fact. A percentage nobody measured is a lie.

### 1.4 Explainability is a platform principle

Every non-trivial visualization must be able to answer: **Explain · Why · Evidence ·
Confidence · Source.** This is formalized as a contract in §9 and is the single reason
an enterprise buyer trusts an autonomous system. Never chain-of-thought — only
deterministic signals with weights and provenance.

---

## 2. Corrections and verified findings

Findings from reading the backend that change the plan. Listed because a blueprint
built on an assumption is worse than no blueprint.

| Assumption at review | Verified reality |
|---|---|
| "No graph adjacency endpoint" (B2) | **Exists.** `GET /api/knowledge/{run_id}/export/{view}?fmt=json&max_nodes=N` returns node-link JSON; `graph_export.to_json` is documented as "the format a JS graph library consumes directly". Views: `repository`, `dependency`, `call`, `ownership`, `repair_history`, `architecture`, `hotspots`. Returns `PlainTextResponse`, so the client parses. |
| "Security is process-scoped only" (B3) | **Half true.** `GET /api/security/timeline?run_id=` and `/audit/summary?run_id=` accept `run_id`, and `AuditEvent` carries `run_id`, `decision`, `violations`, `secret_count`, `estimated_cost_usd`, `latency_ms`. |
| **"Run-scoped security data is available"** (my last message) | **Wrong — corrected here.** `LLMService.structured/text` never pass `run_id` to `LLMGateway.complete()`, and no agent passes one either. Every `AuditEvent.run_id` is therefore `""`, so `?run_id=` filters return **empty**. The endpoints are run-scoped by signature, not by data. This is **G9** and it blocks the Workspace Header's cost/provider fields and the funnel's firewall band. |
| "Per-agent telemetry exists" | **It does not.** `operation` defaults to `"structured"`/`"text"`; no agent identifies itself. There is no per-agent token, cost, or confidence attribution, and **no memory-usage metric exists anywhere in the backend**. |

Confirmed positives: `LLMGateway.complete()` requires an `ApprovedContext` with no bypass
path, so the prompt firewall genuinely gates every LLM call. `AGENT_REGISTRY` already
carries `purpose` and `handoff` — which means the stage narrative structure (§8) is
**already backed by real data** for Mission and Passed To.

---

## 3. Phase 0 — Design System Foundation

The visual language every future surface inherits: Landing, Workspace, Dashboard,
Security, Learning, Organization, Settings, Digital Twin. **No page may introduce a UI
pattern that does not exist here.**

Lives at `src/design/`, consumed by V1 and V2 alike. Extends the existing `styles.css`
token block rather than replacing it — the oklch palette, status colors and
Geist/Inter/JetBrains Mono triple are already correct.

### 3.1 Typography

Three families, already loaded: `--font-heading` (Geist), `--font-sans` (Inter),
`--font-mono` (JetBrains Mono).

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `display` | 40 / 44 | 700 | Landing only |
| `title-1` | 28 / 34 | 650 | Stage title |
| `title-2` | 22 / 28 | 600 | Panel title |
| `title-3` | 17 / 24 | 600 | Card title |
| `body` | 15 / 23 | 400 | Prose |
| `body-sm` | 14 / 21 | 400 | Peripheral (rail cap, rule A2) |
| `label` | 13 / 18 | 500 | Form + metric labels |
| `caption` | 12 / 16 | 500 | Timestamps, meta |
| `eyebrow` | 11 / 14 | 600, `0.14em` tracking, uppercase | Section kickers |
| `mono-sm` / `mono` | 12 / 13 | 400–500 | Code, ids, paths, numbers |

Rules: numerals always `tabular-nums`; identifiers, paths, SHAs, scores always mono;
one `title-1` per screen.

### 3.2 Spacing & grid

4px base. Scale: `0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24` (×4px).

| Surface | Padding |
|---|---|
| Card | 20px (compact 16px) |
| Panel | 24px |
| Stage section | 28px |
| Rail card | 16px |

Workspace grid: `[rail 260px] [center 1fr, max 1100px] [mission-control 360px]`,
24px gutters, 20px vertical rhythm between stage sections.

### 3.3 Radius, elevation, glass

Radius extends the existing `--radius: 0.625rem`: `xs 4 · sm 6 · md 10 · lg 14 · xl 20 ·
full 9999`. Cards `md`, panels `lg`, modals/palette `xl`, pills `full`.

Elevation — **elevation encodes attention, per rule A1**:

| Token | Use |
|---|---|
| `shadow-flat` | none — peripheral surfaces |
| `shadow-sm` | resting card |
| `shadow-md` | active stage card |
| `shadow-lg` | overlays, palette, sheets |
| `shadow-glow-{running,completed,failed}` | status ring on the active stage only |

Glass (`backdrop-blur(12px)` + 72% surface + hairline border) is permitted on exactly
four surfaces: Workspace Header, Command Palette, Chat Dock, Digital Twin overlay.
Nowhere else — glass everywhere is how enterprise UI reads as a toy.

### 3.4 Motion system

| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion-instant` | 80ms | `ease-out` | Hover, focus |
| `motion-fast` | 120ms | `cubic-bezier(.2,0,0,1)` | Toggles, tooltips |
| `motion-base` | 200ms | `cubic-bezier(.2,0,0,1)` | Card enter, panel open |
| `motion-slow` | 320ms | `cubic-bezier(.16,1,.3,1)` | Stage transition |
| `motion-narrative` | 500ms | `cubic-bezier(.16,1,.3,1)` | Funnel bands, graph reveal |
| `motion-pulse` | 1800ms | `ease-in-out` | The single working pulse (rule A4) |

Every value is consumed through `<Reveal>`. `prefers-reduced-motion` collapses all
tokens to `0ms` at one gate.

### 3.5 Color

**Semantic** (existing, kept): `background`, `surface`, `surface-muted`, `card`, `ink`,
`ink-soft`, `border`, `primary`, `destructive`.

**Status** (existing `--status-*`, extended to six): `running` (blue), `completed`
(green), `retry` (amber), `failed` (red), `draft` (violet), **`waiting`** (neutral —
new). Each with a `-bg` companion.

**Data-state** — the visual grammar of the primary rule, new:

| State | Treatment |
|---|---|
| `Waiting` | Neutral, dashed hairline border, `ink-soft`. The backend has not reached this yet. |
| `Pending` | Neutral + a single quiet shimmer. In flight now. |
| `Unavailable` | Muted, strikethrough-free, **always carries a reason string**. Capability is off or unsupported. |

These three are never colored as errors. Absence of data is not failure, and rendering
it as red trains users to distrust the product.

**Graph palette**: node types (module, file, function, class, test, capability, memory)
each get a fixed hue, WCAG-AA against both themes, colorblind-safe ordering. Edge types
(imports, calls, owns, tests, part_of, repaired) differ by dash and weight, never by
hue alone.

Both themes are first-class. The existing `.dark` variant strategy is kept; every new
token is defined in both.

### 3.6 Component systems

Each specified once here, inherited everywhere.

- **Card** — header (eyebrow + title + actions) / body / footer. Variants: `resting`,
  `active`, `peripheral`, `interactive`.
- **Button** — `primary`, `secondary`, `ghost`, `danger`; sizes `sm/md/lg`; icon-only
  requires `aria-label`; loading state disables and swaps to a spinner (real pending
  operations only).
- **Input** — text, search, select, textarea, combobox. Label above, hint below, error
  replaces hint. Focus ring uses `--ring`, never removed.
- **Panel** — persistent side surface: header, scroll body, optional footer. Mission
  Control, Why Panel and Chat Dock are all Panels.
- **Table** — dense enterprise: 36px rows, sticky header, mono numerics, right-aligned
  numbers, zebra off, hover tint only. **Every graph ships a Table equivalent** (a11y +
  the escape hatch on mobile).
- **Graph** — `<GraphCanvas>` chrome: toolbar (fit, zoom, search, layout), legend,
  minimap ≥1280px, hover-neighbour highlight, selection, empty state.
- **Code block** — Shiki, both themes, line numbers optional, copy button, wrap toggle,
  diff variant with add/remove gutters. Never a text dump.
- **Skeletons** — shape-preserving, one shimmer token. **Only for genuine in-flight
  fetches, never to simulate work.**
- **Empty / Loading / Error states** — every list, panel and graph declares all three.
  Error states name what failed and offer retry; they never silently fall back to
  fixture data.

### 3.7 Foundation primitives (built in Phase 0)

| Primitive | Contract |
|---|---|
| `<DataBoundary>` | **The primary-rule enforcer.** `{ value, children, whenMissing: "waiting" \| "pending" \| "unavailable", reason }`. Renders `children(value)` only when the value is genuinely present; otherwise the state chip. Every fact in the product is wrapped in one — you cannot render an invented value without deleting the component. |
| `<Reveal>` | The only motion entry point. Props: `class` (`event` \| `presentational` \| `continuous`), `token`, `when`. Reduced-motion gate lives here. |
| `<StatusDot>` / `<StatusPill>` | Six states, one shape language, `aria-label` from the state. |
| `<MetricTile>` | `{label, value: T \| null, unit, delta?, threshold?, source, explain?}`. `null` renders "—" plus a source tooltip. Never `0`. |
| `<Gauge>` | Threshold arc. Explicit "Not measured" state for `null`. |
| `<EvidenceList>` | Renders `Evidence[]` as weighted contribution bars. |
| `<ExplainAffordance>` | The `?` control that opens the Why Panel for any explainable surface (§9). |
| `<Eyebrow>`, `<SectionHeader>`, `<KeyValue>`, `<Timestamp>` | Layout atoms. |

**Deliverable of Phase 0:** a Storybook-equivalent token & component gallery route
(`/design`, flag-gated) proving every token, state and primitive in both themes. It
renders no run data.

---

## 4. Component hierarchy

```
routes/v2.runs.$runId.$stageId.tsx
│
└── <WorkspaceV2Root>                     flag gate
    └── <RunProvider runId>                RunStore + WS + Query scope
        ├── <CommandPalette>               ⌘K — global, mounted above everything
        │
        ├── <IntroSequence>                only when the run has no terminal frame
        │   ├── <IntroBeat kind="connected">
        │   ├── <IntroBeat kind="structure">
        │   ├── <IntroBeat kind="frameworks">
        │   ├── <IntroBeat kind="graph">
        │   └── <IntroBeat kind="dna">
        │   ·  no Context Engineering beat — reviewed decision
        │
        └── <WorkspaceShell>
            ├── <WorkspaceHeader>          TOP · persistent · 56px · glass
            │   ├── <RepoIdentity>         repository · branch · commit
            │   ├── <RunStatusCluster>     status · current stage · elapsed · retries
            │   ├── <PlatformCluster>      LLM provider · est. cost
            │   └── <PostureCluster>       security · learning
            │
            ├── <StageRail>                LEFT · 260px
            │   └── <StageGroup> × 7
            │       ├── <StageGroupHeader>
            │       └── <AgentRow> × n     → <AgentIdentityCard> on hover/expand
            │
            ├── <StageContainer>           CENTER · dominant
            │   ├── <StageHistory>         completed stages collapse upward
            │   ├── <ActiveStagePanel>
            │   │   ├── <StageHeader>      title · agents · elapsed · <ExplainAffordance>
            │   │   ├── <AttemptSwitcher>  retry branches; hidden when attempts ≤ 1
            │   │   ├── <StageNarrative>   Mission · Input · Thinking · Evidence · Output · Passed To
            │   │   └── <StageView>        ← one of seven, React.lazy
            │   ├── <StageHandoff>
            │   └── <StageFuture>          dimmed, non-interactive
            │
            ├── <MissionControl>           RIGHT · 360px  (was "Intelligence Rail")
            │   ├── <DigitalTwinPreview>   → links to future /twin
            │   ├── <RunTimelineCard>
            │   ├── <LiveActivityFeed>
            │   ├── <RepositoryDnaCard>
            │   ├── <RepositoryHealthCard>
            │   ├── <KnowledgeGraphCard>
            │   ├── <SecurityStatusCard>
            │   ├── <LearningStatusCard>
            │   └── <RunMetricsCard>
            │
            ├── <WhyPanel>                 Sheet · evidence-only
            └── <ChatDock>                 BOTTOM · persistent
```

### 4.1 Mission Control

Renamed from "Intelligence Rail" — it is the persistent operational center: the state
of the machine, not a sidebar of widgets.

Behaviour: sections are independently collapsible with persisted state; each declares
its own loading/empty/unavailable state; **no section may animate while a stage is
running** (rule A4) — they update by value change, not by motion. Section order is fixed
so muscle memory holds across runs.

### 4.2 Workspace Header

Persistent, 56px, glass, above all three columns. Cursor's top bar as the reference.

| Field | Source | Status |
|---|---|---|
| Repository | `GET /runs/{id}` → `repository` | ✅ |
| Branch | → `branch` | ✅ |
| **Commit** | `head_sha` | ⛔ **G4** |
| Run status | `status` + terminal frame | ⛔ **G5** for terminal fidelity |
| Elapsed | `elapsed_seconds` + live tick | ✅ |
| Current stage | RunStore `activeStage` | ✅ |
| Retry count | → `retries` | ✅ |
| **LLM provider** | `security/audit/summary?run_id=` → `provider` | ⛔ **G9** |
| **Estimated cost** | → `estimated_cost_usd` | ⛔ **G9** |
| Security status | audit summary `decision`/`violations` | ⛔ **G9** |
| Learning status | `learning/repositories/{repository_id}` | ⛔ **G4** |

Until G4/G9 land these fields render `Unavailable` with a reason — visible, honest, and
a standing reminder of what to wire.

### 4.3 Live Activity Feed

A chronological, backend-only feed of what happened — distinct from chat (which is
asked) and from the Timeline (which is milestones).

Source: every `AgentStatusEvent.message` + `timestamp` + `agent_id`, already emitted by
`AgentBase.emit_status`. Rendered as `[hh:mm:ss] [agent] message`. Newest first, capped
at 200 rows, virtualized, filterable by stage/agent, click-to-jump.

**No client-authored entries.** If the backend never said it, the feed never shows it.

### 4.4 Run Timeline

Milestone view, distinct from the feed's granularity: first `started` and last terminal
frame per stage, plus the decision. Horizontal at ≥1280px, vertical in Mission Control
below.

Source: event timestamps, entirely derived. Each entry links to its stage route; during
replay (Phase 11) it doubles as the scrub track.

---

## 5. Agent identity

An `<AgentRow>` today shows status, name, duration. The target is that a user glances
and knows *what this AI is doing right now*.

| Field | Source | Status |
|---|---|---|
| Icon | Client map keyed on **`agent_id`**, not the display name (fixes V1's F4) | ✅ client |
| Avatar | Deterministic mark generated from `agent_id` | ✅ client |
| Role | `AGENT_REGISTRY` name | ✅ |
| Mission | `AGENT_REGISTRY` purpose | ✅ |
| Current task | Latest `AgentStatusEvent.message` for that agent | ✅ |
| Elapsed | First `started` → now, or to terminal frame | ✅ |
| Status | Derived: completed/running/retrying/waiting/failed/skipped | ✅ |
| **Confidence** | Only A4 (`root_cause.confidence`) and A6 publish one | ⚠️ **Partial** — agents without a confidence render `Unavailable("agent publishes no confidence")`. Fabricating one per agent is precisely the failure this product exists to prevent. |
| **Token usage** | — | ⛔ **G9** |
| **Cost** | — | ⛔ **G9** |
| **Memory usage** | — | ⛔ **G10** — *no such metric exists anywhere in the backend.* Renders `Unavailable` indefinitely unless G10 is scoped. Recommendation: replace with **cache efficiency** (`cache_hits`/`cache_misses`, real for A0.5/A1/A5.5), which is more meaningful to a user than RSS. |

`<AgentIdentityCard>` (hover/expand from a row) shows the full set. Presentation is
uniform; **content degrades honestly per agent.**

---

## 6. Stage narrative contract

Every stage renders the same six-part story. Consistency is what turns eleven agents
into one engineer.

```
MISSION      what this stage is for
INPUT        what it received, and from whom
THINKING     what it is doing right now
EVIDENCE     what it found, with citations
OUTPUT       what it produced
PASSED TO    who receives it next
```

Backing — **five of six already exist**:

| Part | Source | Status |
|---|---|---|
| Mission | `AGENT_REGISTRY.purpose` | ✅ |
| Input | Previous stage's `handoff` + resolved inputs | ✅ |
| Thinking | Live `AgentStatusEvent.message`; frozen to the final message when settled | ✅ |
| Evidence | `_evidence_for(card, state)` — title, subtitle, fields, pills, bars | ✅ |
| Output | Stage visualization payload + `handoff` label | ✅ |
| Passed To | Next stage's name from the registry | ✅ |

Example, fully backed:

```
Repository Understanding
  MISSION    Understand repository structure before any repair
  INPUT      Repository @ <branch> · <commit>
  THINKING   Building semantic intent graph…
  EVIDENCE   1,342 files indexed · 8,204 edges · 7 semantic roles
  OUTPUT     Knowledge Graph
  PASSED TO  Investigation
```

`<StageNarrative>` is one component, identical across all seven stages. Any part without
data renders its `DataBoundary` state — a stage that produced no evidence says so.

---

## 7. Command Palette

⌘K / Ctrl+K, global, mounted at `RunProvider` level so it is available on every route.
Built on the existing `cmdk` dependency + Radix Dialog.

### 7.1 Architecture

A **provider registry**, not a switch statement. Each provider declares
`{ id, title, icon, scope, search(query) → Action[], keywords }`; the palette composes
them, ranks by (exact prefix → recency → provider priority → fuzzy), and executes an
`Action` = navigate | command | toggle. New surfaces register a provider instead of
editing the palette.

### 7.2 Providers

| Provider | Backing | Status |
|---|---|---|
| Open Repository | `GET /api/repositories` | ✅ |
| Jump to Stage | `STAGE_REGISTRY` (client) | ✅ |
| Search Agent | `GET /runs/{id}/agents` | ✅ |
| Search Evidence | agent entries' evidence + citations | ✅ |
| Open Why Panel | explainable registry (§9) | ✅ |
| Replay Run | Phase 11 | ✅ (Phase 11) |
| Repository Health | `/knowledge/{id}/risk`, `/hotspots` | ✅ |
| Security | `/security/*` | ⚠️ **G9** for run scope |
| Learning | `/learning/*` | ⚠️ **G4** for run scope |
| Settings · Theme | client | ✅ |
| **Search Graph** | `/knowledge/{id}/export/{view}?fmt=json` node index | ✅ |
| **Search File** | `functions_in_file`, `owners_of`, `co_changed_files` via `/knowledge/{id}/query/{name}` | ✅ |
| **Search Function / Symbol** | `api_surface`, `callers_of`, `functions_called_by` | ✅ |

All symbol search is **server-side traversal** through the existing named-query engine —
the client never indexes the repository itself.

Behaviour: opens empty with recent + suggested actions; ≥2 chars queries providers
(debounce 120ms, `AbortController` per keystroke); results grouped by provider; `↑↓`
navigate, `⏎` execute, `⌘⏎` open in a new tab where the action is a route; `Esc`
closes and restores focus. Fully keyboard-operable and screen-reader labelled.

---

## 8. Digital Twin

Not a sidebar card — a first-class product surface, architected now, one page shipped
later.

### 8.1 Three consumers, one engine

```
lib/v2/twin/
  model.ts      TwinModel: nodes, edges, per-node lifecycle state
  layout.ts     deterministic layout, memoized per data version
  projection.ts frames + stage outputs → node state transitions
  index.ts      public API

components/v2/twin/
  TwinRenderer.tsx     shared renderer, size/density aware
  DigitalTwinPreview   Mission Control (Phase 9)
  DigitalTwinFull      /twin route  (FUTURE — architected, not built)
  DigitalTwinOverlay   ⌘K focus mode (FUTURE)
```

The preview and the future page are **the same engine at different densities**. Building
the page later is a re-mount, not a rewrite. That is the whole reason to specify it now.

### 8.2 Model

Nodes: Repository → Modules → Files → Functions → Dependencies → Security → Learning.
Source: `/knowledge/{id}/export/repository|dependency|call` plus learning memory nodes
from `RepairMemory`.

Node lifecycle, each driven by a real frame or payload: `unknown → indexed → focused →
implicated → targeted → patched → validated → learned`.

Layout is computed once per data version and memoized; **frames change node state only,
never geometry.** A graph that re-lays-out under the user is unreadable and expensive.

### 8.3 Persistence

Keyed by `repository_id` (**G4**). A twin that resets every run is an animation; one
that accumulates across runs is a product — it is the visible proof that the system
remembers.

### 8.4 Planned route

`/twin/$repositoryId` — **architected, not implemented.** Blueprint reserves the route,
the data layer and the renderer contract. No Phase in this document builds it.

---

## 9. Explainability contract

Platform-wide. Any surface asserting something non-trivial implements:

```ts
interface Explainable {
  explain(): string;                  // one sentence, plain language
  why(): Evidence[];                  // weighted deterministic signals
  confidence(): number | null;        // null when the producer publishes none
  source(): SourceRef[];              // endpoint / payload / agent / field path
}
```

- **Explain** — what this shows.
- **Why** — `Evidence[]` (`signal`, `value`, `contribution`, `detail`, `provenance`),
  already modelled by `models/knowledge_graph.py`, rendered by `<EvidenceList>`.
- **Confidence** — never synthesized. `null` renders "Not published".
- **Source** — the literal endpoint and field path. **A user can always ask "where did
  this number come from?" and get a checkable answer.** This is the feature that makes
  the product auditable rather than merely impressive.

Registered surfaces (Phase ≥2): every stage, every graph node, every metric tile, every
funnel band, every trust axis, every ranked file, every citation.

`<ExplainAffordance>` is the uniform entry point; `<WhyPanel>` the uniform presentation.
Never chain-of-thought.

---

## 10. Folder structure

Additive. Nothing existing moves.

```
frontend/src/
├── design/                         ← PHASE 0, shared by V1 + V2 + all future pages
│   ├── tokens/                     typography, spacing, radius, elevation, motion, color
│   ├── primitives/                 DataBoundary, Reveal, StatusDot, MetricTile, Gauge,
│   │                               EvidenceList, ExplainAffordance, Eyebrow, KeyValue…
│   ├── states/                     Skeleton, Empty, Loading, Error, Waiting/Pending/Unavailable
│   └── gallery/                    /design route (flag-gated)
├── components/
│   ├── proofix/                    ← V1. UNTOUCHED.
│   ├── ui/                         shared shadcn primitives
│   └── v2/
│       ├── shell/                  WorkspaceShell, WorkspaceHeader, StageRail,
│       │                           StageContainer, MissionControl, WhyPanel, ChatDock
│       ├── palette/                CommandPalette + providers
│       ├── intro/                  IntroSequence, IntroBeat
│       ├── narrative/              StageNarrative, StageHandoff, AttemptSwitcher
│       ├── agents/                 AgentRow, AgentIdentityCard
│       ├── activity/               LiveActivityFeed, RunTimeline
│       ├── stages/                 repository/ investigation/ context/ planning/
│       │                           patch/ validation/ learning/
│       ├── twin/                   TwinRenderer, DigitalTwinPreview
│       ├── mission/                the seven Mission Control cards
│       ├── graph/                  GraphCanvas + node/edge types
│       └── replay/                 Phase 11
├── lib/v2/
│   ├── flag.ts
│   ├── endpoints.ts
│   ├── queries.ts
│   ├── stream/                     connection · queue · frames · store
│   ├── stages/                     registry · machine · narrative binding
│   ├── twin/                       model · layout · projection
│   ├── explain/                    registry + Explainable helpers
│   └── types/generated/            ← generated from Pydantic; do not edit
└── routes/
    ├── design.tsx                          (flag-gated gallery)
    └── v2.runs.$runId.$stageId.tsx (+ index / $agentId)
```

---

## 11. Route hierarchy

```
/design                                    Phase 0 gallery (flag-gated)
/v2/runs/$runId                            resolves active stage → redirect
/v2/runs/$runId/$stageId                   stage holds the center
/v2/runs/$runId/$stageId/$agentId          deep link to one agent
/twin/$repositoryId                        RESERVED — architected, not built
```

Search params: `panel`, `why`, `attempt`, `replay`, `t`, `q` (palette prefill).

`$stageId` ∈ `repository | investigation | context | planning | patch | validation |
learning`.

**Flag:** `FEATURE_WORKSPACE_V2` from `VITE_FEATURE_WORKSPACE_V2`, overridable with
`?v2=1|0` persisted to `localStorage`. Off ⇒ `/v2/*` and `/design` render not-found.
V1 `/runs/$runId` is never redirected before Phase 11.

---

## 12. State architecture

Four kinds, four mechanisms, no overlap.

**Navigation — TanStack Router.** Run, stage, agent, panel, why, attempt, replay
position. The URL is the truth for *what is on screen*; live progress never enters it.

**Server — TanStack Query.** One key factory, WS-invalidated, **no polling**,
`staleTime: Infinity` for terminal data.

```
qk.run · agents · summary · report · attempts · context
qk.kgMetrics · kgView(view) · kgRisk · kgHotspots · kgCapabilities
qk.secTimeline · secAudit
qk.learnRepo · learnOrg · learnTemplates · learnPatterns
```

**Live — `RunStore` + `useSyncExternalStore`.** One writer (the stream), selector-scoped
readers. A context provider would re-render every consumer on every frame; with seven
stages of graph canvases that is unaffordable.

```ts
interface RunStoreSnapshot {
  frames: RunFrame[];              // ordered, deduped by sequence
  lastSequence: number;
  stages: Record<StageId, {
    status: "waiting"|"running"|"retrying"|"completed"|"failed"|"skipped";
    agents: Record<AgentId, AgentRuntimeState>;   // §5
    startedAt: number | null; endedAt: number | null;
  }>;
  activeStage: StageId | null;
  attempts: { index: number; startedAt: number; frames: number[] }[];
  activity: ActivityEntry[];       // §4.3, capped 200
  timeline: TimelineEntry[];       // §4.4
  twin: TwinNodeStates;            // §8
  connection: "idle"|"replaying"|"live"|"reconnecting"|"closed";
  terminal: { kind: "completed"|"failed"; decision?: string } | null;
}
```

Selectors: `useStage`, `useAgent`, `useActiveStage`, `useConnection`, `useAttempts`,
`useActivity`, `useTimeline`, `useTwinState`, `useTerminal`.

No Zustand/Redux — ~200 lines, single writer, `useSyncExternalStore` is the correct
primitive.

**Local UI — `useState`**, owned by the component, never lifted.

**The bridge:**

```
WS frame → normalize → dedupe by sequence → RunStore.apply()
                                          └→ queryClient.invalidateQueries(keys[agent_id])
```

A frame says *what changed*; REST says *what it is now*. State is never rebuilt
client-side from payloads.

---

## 13. Animation architecture

Three classes (§1.3), one pipeline:

```
WS/history frame → frames.ts → queue.ts (paced drain) → store.ts → <Reveal>
```

`queue.ts` — ported from V1's `liveEventStream`, the hardest-won code in the codebase:
460ms cadence, 60ms floor, accelerates when backlog > 6. **Timing lives here and nowhere
else.** Components stay pure functions of state.

Rules:
1. No animation without a causing frame or response.
2. No `setTimeout`-driven progress; elapsed counters only.
3. `prefers-reduced-motion` collapses everything at the `<Reveal>` gate.
4. Graph layouts memoized per data version; frames change node *state* only.
5. Funnel bands animate only as their real number arrives; absent ⇒ `Pending`, static.
6. Exactly one continuous animation on screen (rule A4).

---

## 14. Performance budget

Non-functional requirement. Regression on any target blocks the phase.

| Metric | Target | Enforcement |
|---|---|---|
| Frame rate during a live run | **60 FPS** sustained | Selector-scoped subscriptions; no per-frame re-render above the subscribing component |
| Interaction latency | **<100ms** | No synchronous work in handlers; palette search debounced 120ms + abortable |
| Animation response | **<50ms** to first paint | Transform/opacity only; never animate layout |
| Graph render | **<500ms** for ≤300 nodes | Memoized layout per data version; server-capped `max_nodes`; canvas rendering above 150 nodes |
| Workspace load (LCP) | **<1s** on a warm cache | Route-level code splitting; header + rail + active stage first; Mission Control hydrates after |
| Route chunk | **<180KB** gzip per stage | `React.lazy` per stage view |
| Initial JS | **<250KB** gzip | Shiki over Monaco; d3 submodules only; React Flow in Phase 3's chunk |

Techniques, mandatory: lazy load every stage view, virtualize every list >50 rows
(activity feed, tree, ranked files, tables), memoize every graph layout, render
backend-first (no client-side derivation of anything the backend already computed),
`content-visibility: auto` on collapsed stage history.

Each phase ships with a measurement against these numbers on a real run. "Feels fast"
is not a result.

---

## 15. Backend dependency map

`✅` real today · `⚠️` partial · `⛔` blocked.

### 15.1 Shell and chrome

| Surface | Source | Status |
|---|---|---|
| Header identity / status / elapsed / retries | `GET /api/runs/{id}` | ✅ |
| Header commit | `head_sha` | ⛔ G4 |
| Header provider / cost / security | `/security/audit/summary?run_id=` | ⛔ G9 |
| Header learning | `/learning/repositories/{repository_id}` | ⛔ G4 |
| Stage + agent status, durations, narrative | `GET /runs/{id}/agents` | ✅ A1–A10 · ⛔ G1 for A0.5, A5.5 |
| Stage narrative Mission / Passed To | `AGENT_REGISTRY` purpose + handoff | ✅ |
| Live progression | `WS /ws/runs/{id}` | ✅ |
| History replay | `GET /runs/{id}/events` (cap 500) | ✅ · G6 for cursor |
| Terminal state | — | ⛔ G5 |
| Activity feed | event `message` + `timestamp` | ✅ |
| Run timeline | event timestamps | ✅ |
| Attempts / retry branches | `GET /runs/{id}/attempts` | ✅ |
| Chat | `POST /runs/{id}/chat` | ✅ |

### 15.2 Mission Control

| Card | Source | Status |
|---|---|---|
| Digital Twin preview | `/knowledge/{id}/export/repository` + frames | ✅ |
| Repository DNA | A0.5 payload → `RepositoryIntelligenceMetrics` | ✅ |
| Repository Health | `/knowledge/{id}/risk`, `/hotspots` | ✅ |
| Knowledge Graph | `/knowledge/{id}/metrics` (+ `workspace.*`) | ✅ |
| Security | `/security/audit/summary?run_id=` | ⛔ G9 |
| Learning | `/learning/repositories/{repository_id}` | ⛔ G4 |
| Run Metrics | header + audit summary | ⚠️ cost fields ⛔ G9 |

### 15.3 Stages

| Surface | Source | Status |
|---|---|---|
| Repository tree / packages / monorepo | `knowledge/{id}/metrics.workspace` | ✅ |
| Language breakdown | `workspace.languages` | ✅ |
| Framework detection | `learning/repositories/{id}.framework_profile` | ⛔ G4 |
| Semantic / dependency / call graphs | `knowledge/{id}/export/{view}?fmt=json` | ✅ (G3 cosmetic) |
| Static analysis | `kind:"static"` | ✅ |
| Runtime reproduction | `kind:"reproduce"` | ✅ |
| Root cause + citations | `kind:"root"` | ✅ |
| Blast radius | `kind:"blast"` | ✅ |
| **Context Engineering** | `ContextPackage` in Redis key `context` — `ranked_files[]` with `signals`/`evidence`/`confidence`, `redactions[]`, `privacy_guard_status`, `ContextMetrics` | ⛔ **G2** |
| Funnel · firewall band | `security/timeline?run_id=` | ⛔ G9 |
| Repair DAG | `kind:"planner"` + `fix_dag` | ✅ |
| Patch + diff | `kind:"patch"` + `patch_bundle` | ✅ |
| Validation + mutation | `kind:"mutation"` (`score: number\|null`) | ✅ |
| Trust axes + decision | `kind:"merge"` + `/runs/{id}/report` | ✅ |
| Learning stage | `/learning/*` | ⚠️ repo scope ⛔ G4 |
| Command palette symbol search | `/knowledge/{id}/query/{name}` | ✅ |

### 15.4 Gap list

| # | Gap | Blocks | Size | Fix |
|---|---|---|---|---|
| **G1** | A0.5 + A5.5 absent from `AGENT_REGISTRY`; no `stage` column | Phase 1 | S | Two tuples + a 6th column |
| **G2** | `ContextPackage` unreachable over HTTP | **Phase 4 (flagship)** | XS | `GET /api/runs/{run_id}/context` → `load_context_package()` already exists at `a5_5_context_engineering.py:520`; 404 ⇒ UI renders `Pending` |
| **G5** | No explicit terminal frame | Phase 1 correctness | S | Emit `run.completed{decision}` / `run.failed{reason}` from every terminal path |
| **G9** | `run_id` and agent identity never reach `LLMGateway`; `AuditEvent.run_id` is always `""` | Header cost/provider/security, funnel firewall band, per-agent tokens/cost | M | Thread `run_id` + `agent_id` through `LLMService` → `complete(run_id=, operation=)`; use `operation` as the agent tag |
| **G4** | `repository_id` / `head_sha` not on the run | Header commit, framework detection, Phase 8, twin persistence | XS | Add both to `build_workspace_header` |
| **G10** | No memory-usage metric exists | Agent identity field | — | **Recommend dropping**; substitute cache efficiency (real) |
| **G3** | Graph export returns `PlainTextResponse` | none | XS | Optional typed JSON alias |
| **G6** | `/events` has no `after=` cursor; cap 500 | Phase 11 fidelity | S | `?after=&limit=` |
| **G7** | In-memory broadcaster + `MemorySaver` | multi-replica deploy | M | Redis pub/sub path already stubbed in `ws.py` |
| **G8** | `ui_projection.py` 1406 lines, untyped boundary | maintenance | M | Split per agent; JSON Schema → generated TS |

**Blocking the phase order: G1, G5 (before Phase 1), G2 (before Phase 4).**
G9 and G4 degrade gracefully to `Unavailable` — they gate *completeness*, not progress.

### 15.5 New frontend dependencies

| Package | Phase | Note |
|---|---|---|
| `framer-motion` | 0 | all motion, behind `<Reveal>` |
| `@xyflow/react` | 3 | React Flow v12; client-only under SSR |
| `d3-hierarchy`, `d3-shape`, `d3-scale`, `d3-force` | 2/4/9 | submodules only |
| `shiki` | 6 | read-only diff highlighting |
| `json-schema-to-typescript` (dev) | Track B | backend type generation |

`cmdk`, `recharts`, `lucide-react`, Radix, `@tanstack/react-query` already installed.
**Monaco deferred** — ~2MB for a read-only diff; revisit only if in-browser editing is
scoped.

---

## 16. Phase checklist

Every phase: compiles, lints, ships behind the flag, is independently reviewable, meets
the performance budget, and adds **zero** hardcoded values.

### Track B · Backend unblock *(parallel to Phase 0; must land before Phase 1)*
- [ ] G1 — register A0.5 + A5.5, add `stage` column
- [ ] G5 — `run.completed` / `run.failed` frames
- [ ] G4 — `repository_id` + `head_sha` on the run header
- [ ] G2 — `GET /api/runs/{run_id}/context`
- [ ] G9 — thread `run_id` + agent tag into `LLMGateway`
- [ ] Type generation → `lib/v2/types/generated`
- [ ] Tests per route/frame

### Phase 0 · Design System Foundation
- [ ] Token layers: typography, spacing, grid, radius, elevation, motion, color (both themes)
- [ ] Status + semantic + data-state + graph palettes, contrast-audited
- [ ] Component systems: Card, Button, Input, Panel, Table, Graph chrome, Code block, Glass
- [ ] States: Skeleton, Empty, Loading, Error, Waiting/Pending/Unavailable
- [ ] Primitives: `DataBoundary`, `Reveal`, `StatusDot`, `MetricTile`, `Gauge`, `EvidenceList`, `ExplainAffordance`, atoms
- [ ] Icon set + agent avatar generator (keyed on `agent_id`)
- [ ] `/design` gallery route proving every token/state in both themes
- [ ] **Gate:** V1 still builds; no run data touched

### Phase 1 · Workspace Foundation
- [ ] `flag.ts`; `/v2/runs/$runId/$stageId?` routes; V1 untouched
- [ ] `stream/`: frames · queue (ported) · connection (replay → WS → backoff) · store
- [ ] `stages/registry.ts` + `machine.ts` — 7 stages, real agent ids
- [ ] `RunProvider` + selector hooks
- [ ] `<WorkspaceHeader>` (unavailable fields render honestly)
- [ ] `<StageRail>` + `<AgentRow>`; `<StageContainer>`; `<MissionControl>` scaffold
- [ ] `<StageNarrative>` (six-part contract) wired to registry + events
- [ ] `<LiveActivityFeed>`, `<RunTimeline>`
- [ ] `<CommandPalette>` + providers: Stage, Agent, Theme, Settings
- [ ] `<ChatDock>` wired to `/chat`; `<DigitalTwinPreview>` placeholder
- [ ] Auto-scroll on stage change; follow/pin
- [ ] **Gate:** a live run drives header, rail, narrative, feed and timeline end-to-end with no stage visualizations

### Phase 2 · Repository Intelligence Stage
- [ ] Virtualized repository tree from `workspace.packages`
- [ ] Language breakdown from `workspace.languages`
- [ ] Repository DNA from `RepositoryIntelligenceMetrics`
- [ ] Framework detection; `Unavailable` when learning is off
- [ ] Knowledge-graph summary; static analysis (scanners, severity, affected files)
- [ ] Mission Control: DNA, Health, Knowledge Graph, Metrics go live
- [ ] Palette providers: Search File, Search Graph

### Phase 3 · Investigation Stage
- [ ] `<GraphCanvas>` (React Flow, table fallback, legend, search)
- [ ] Runtime reproduction: terminal replay, failing test, stack
- [ ] Root cause: split stack/graph, citations with verification state, `<EvidenceList>`
- [ ] Blast radius: hop distance, propagation confidence
- [ ] Explainability registered on every node
- [ ] Palette providers: Search Function, Search Symbol, Search Evidence

### Phase 4 · Context Engineering Stage *(flagship)*
- [ ] Consume `GET /runs/{id}/context`; `Pending` until A5.5 emits
- [ ] `<Funnel>`: Repository → Knowledge Graph → Ranking → Privacy → Firewall → Package → LLM
- [ ] Every band from a real field; absent ⇒ `Pending`, never estimated
- [ ] Ranking explorer: `ranked_files[]` with per-signal contributions
- [ ] Privacy: `redactions[]` by detector; `privacy_guard_status="failed"` renders **red and blocking**
- [ ] Firewall band from security timeline, or `Unavailable` until G9
- [ ] Token reduction from `original_tokens`/`reduced_tokens` only
- [ ] Why panel on every band

### Phase 5 · Repair Planning
- [ ] DAG via `<GraphCanvas>`, topological reveal
- [ ] Execution order, dependency edges, conflict batches, planning confidence

### Phase 6 · Patch Generation
- [ ] `<DiffView>` (Shiki, lazy, client-only)
- [ ] Streaming reveal paced by frames — never a synthetic typewriter
- [ ] Acceptance criteria from `ContextPackage.acceptance_criteria`
- [ ] Contracts, integrity badges (only those A7 actually stamped), patch bundle

### Phase 7 · Validation
- [ ] Pipeline rail: Target → Regression → Mutation → Security → Decision
- [ ] Mutation `<Gauge>` — **`score: null` renders "Not measured"**, never a needle
- [ ] Correctness vs threshold; security delta; four trust axes; decision + review note

### Phase 8 · Learning
- [ ] Repair → Repository memory → Organization memory → Future repairs
- [ ] Templates with honest track record; patterns; maturity
- [ ] `Unavailable` when learning is disabled

### Phase 9 · Digital Twin
- [ ] `lib/v2/twin` engine: model · layout · projection
- [ ] `<TwinRenderer>` + Mission Control preview
- [ ] Frame-driven lifecycle states; layout memoized per data version
- [ ] Persistence by `repository_id`; `/twin` route reserved, not built

### Phase 10 · Persistent Chat
- [ ] Full dock: history, run-derived suggestions, citations back into stages
- [ ] Deep-link answers to `?why=` / stage routes
- [ ] Backend-only answers; a failed call says so and never substitutes a guess

### Phase 11 · Replay
- [ ] Replay run / stage / agent from stored events (`?replay=`, `?t=`)
- [ ] Transport, scrub (timeline doubles as track), speed — same queue, no re-created animations
- [ ] G6 cursor for runs beyond the 500-event cap
- [ ] Optional flag-gated redirect of `/runs/$runId` → V2

### Cross-cutting (verified every phase)
- [ ] No hardcoded/estimated/inferred value — `DataBoundary` everywhere
- [ ] Attention rules A1–A5 hold
- [ ] Explainability registered for every new assertive surface
- [ ] Performance budget measured on a real run
- [ ] `prefers-reduced-motion` honored; every graph has a table equivalent
- [ ] V1 still builds and runs unchanged

---

## 17. Confirmations needed before Phase 0

1. **Backend edits (Track B)** — G1/G2/G4/G5/G9 are backend Python. Do I make them, or
   do you? Nothing in Phase 0 depends on them; Phase 1 does.
2. **Agent "memory usage"** (G10) — no such metric exists in the backend. Confirm
   dropping it in favour of cache efficiency, or confirm you want it added backend-side.
3. **Per-agent confidence** — only A4 and A6 publish one. Confirm the rest render
   "Not published" rather than receiving a synthesized number.
4. **Shiki over Monaco** for Phase 6 (~2MB for a read-only diff).
5. **Route prefix `/v2/runs/...`** and the reserved `/twin/$repositoryId`.
