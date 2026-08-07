# ProoFix Analysis Workspace — Redesign Specification

Design review document. **No implementation until approved.**
Scope: the workspace after repository submission. Landing page, auth, pricing, org
management are explicitly out of scope.

Grounded against the working tree as of 2026-08-06 — every panel below names the
backend field that feeds it, or is marked **GAP** with the backend work required.

---

## 0. The one thing that must be true

The product promise is: *you are watching an autonomous software engineer think.*

That fails in exactly one way — the user catches the UI inventing something. One fake
progress bar, one hardcoded "✓ Runtime Reproduced" on a run that reproduced nothing,
and the whole thing collapses into a demo. The current frontend does this today
(`Workspace.tsx:730-734` hardcodes the evidence badges). So the governing rule for
this redesign is stricter than "no hardcoded values":

> **Every pixel that asserts a fact traces to a backend field. Anything the backend
> did not send renders as absent — never as a default, never as a placeholder that
> reads like data.**

The existing `emptyModels.ts` already establishes this discipline. It gets extended,
not replaced.

---

## 1. Analysis of the current frontend

### 1.1 What exists

| Layer | File | Verdict |
|---|---|---|
| Data seam | `lib/runService.ts`, `lib/api.ts` | **Keep.** One module decides mock vs API; endpoint registry matches `api/routes/ui.py` 1:1. |
| Event transport | `liveEventStream.ts` | **Keep and extend.** Non-obvious, hard-won code (below). |
| Event reducer | `useExecutionRun.ts` | **Replace.** Right idea, wrong shape for 7 stages. |
| View models | `useRunData.ts` | **Replace with TanStack Query.** Hand-rolled 2.5s polling + `JSON.stringify` diffing. |
| Journal | `Workspace.tsx` (862 lines) | **Split.** Routing + view state + scroll choreography + two large presentational sections in one file. |
| Visualizations | `AgentVisualization.tsx` (1340 lines) | **Rewrite per stage**, keep the discriminated-union contract idea. |
| Primitives | `components/ui/*` (45 files) | **Keep entirely.** |
| Design tokens | `styles.css` | **Keep, extend.** oklch tokens, status colors, `--font-heading`/`sans`/`mono` triple. |

### 1.2 Code worth preserving verbatim

**The paced drain queue** (`liveEventStream.ts:104-190`). Backend frames arrive in
bursts — history replays dozens at once and one `completed` frame stands for a whole
card's narrative. Emitting straight through collapses into a single React render and
every reveal animation is skipped. The queue drains one event per tick at 460ms,
accelerating toward a 60ms floor when the backlog exceeds 6. This is the single most
important piece of the current frontend and the redesign is built on top of it.

**The two-level emit bookkeeping** (`emittedLines`/`emittedFinal` vs `queuedLines`/
`queuedFinal`). On dispose the queued level rolls back to emitted, so a subscription
torn down mid-queue does not skip lines the user never saw.

**No `onclose` handler, deliberately.** A dropped socket is not evidence a run
finished. Keep this. It is a correctness property, not an omission.

**`setIfChanged` + the `topology` subscription key** (`id:lines.length` joined) — stops
a poll that only moved a number from tearing down the WebSocket.

### 1.3 Bugs and debts the redesign must fix

| # | Issue | Location |
|---|---|---|
| F1 | Executive-summary evidence badges are hardcoded literals gated on `activeIndex` | `Workspace.tsx:730-734` |
| F2 | Reveal thresholds (`activeIndex >= 7`) assume a fixed agent count and order | `Workspace.tsx:704-733` |
| F3 | Completion detected as `agent_id === "A10" && completed` — never fires for a run that fails earlier | `liveEventStream.ts:222` |
| F4 | Agent icons keyed on the human-readable name string; a backend label change silently drops the icon | `AgentCard.tsx:17-27` |
| F5 | `MOCK_RUN_ID = "vulnapi-live"` duplicated as a literal in three files | Workspace, useRunData, liveEventStream |
| F6 | No `prefers-reduced-motion` handling anywhere | global |
| F7 | `QueryClientProvider` is mounted but no query is ever used | `__root.tsx` vs `useRunData.ts` |
| F8 | Mock is the *default* data source; live is opt-in | `lib/api.ts:11-14` |

### 1.4 The gap that matters most

`AGENT_REGISTRY` (`backend/services/ui_projection.py:25`) contains ten agents: A1–A10.

The pipeline actually runs **twelve**. `index_repository` (A0.5 Repository
Intelligence) and `engineer_context` (A5.5 Context Engineering) are nodes in
`orchestrator/graph.py:96,102`, both emit rich `emit_status` payloads — and neither
appears in the registry, so the UI has never rendered them.

**A5.5 is the flagship of this redesign and it is currently invisible.** Its payload
already carries every number the Context Engineering funnel needs
(`a5_5_context_engineering.py:493-518`).

---

## 2. What the backend can actually feed

This is the constraint that shapes everything. Verified field-by-field.

### 2.1 Real today — renderable with no backend change

| Vision element | Backend source |
|---|---|
| Repository tree, package layout, monorepo detection | `WorkspaceLayout.kind`, `.packages[]`, `.nested_repositories` |
| **Language breakdown** | `WorkspaceLayout.languages: dict[ext→count]`, `.primary_language` |
| **Repository DNA** stats | `RepositoryIntelligenceMetrics` — `repository_nodes/edges`, `call_graph_nodes/edges`, `ownership_entries`, `documentation_entries`, `repair_memory_entries`, `git_commits_indexed`, per-phase `*_ms`, `cache_hits/misses`, `full_rebuild`, `files_added/deleted/modified/renamed` |
| Knowledge-graph metrics, capabilities, risks, hotspots | `GET /knowledge/{run_id}/{metrics,capabilities,risk,hotspots}` |
| Graph explainability ("Why?") | `Evidence{signal, value, contribution, detail, provenance, edges[]}` + `Explanation` |
| Static analysis | `_visualization_for` `kind:"static"` — scanners, findings, severity, raw/deduped/prioritized |
| Runtime reproduction | `kind:"reproduce"` — command, tests, failure, assertion, expected/actual, stack |
| Root cause | `kind:"root"` + `root_cause.citations` with per-citation verification |
| Blast radius | `kind:"blast"` + `blast_graph.scope[]` with `propagation_confidence` |
| Repair DAG | `kind:"planner"` — nodes, edges, execution order |
| Patch | `kind:"patch"` + `patch_bundle` original/patched per file |
| Validation | `kind:"mutation"` — `score: float\|null`, `survived`, `pytestPassed`, `correctness`, `correctnessThreshold` |
| Mergeability | `kind:"merge"` — four axis metrics, weights, decision, review note |
| **Context Engineering funnel** | `ContextMetrics`: `original_tokens → reduced_tokens`, `files_ranked → files_extracted → context_files → context_functions → context_lines`, `token_reduction`, `estimated_saved_tokens`, `privacy_redactions`, `privacy_guard_status`, per-phase `*_ms`, `cache_hit`, `degraded` |
| Context ranking explainability | `RankedContextFile{file, score, reason, evidence[], confidence, signals: dict[str,float], is_target}` |
| Privacy filter | `Redaction{file, line, kind, detector, identifier}` |
| Prompt firewall / routing | `FirewallVerdict`, `RoutingDecision`, `SecurityMetrics.firewall_rejections`, `.rejected_requests`, `.provider_usage`, `.estimated_cost_usd` |
| **Framework detection** | `FrameworkProfile.frameworks: dict[name→confidence]`, `.primary_framework`, `.detected_from[]`, `.conventions[]` |
| Learning | `/learning/{dashboard,metrics,organization,templates,patterns,repairs,reviews,outcomes}` |
| Security posture | `/security/{dashboard,metrics,policies,routing,timeline,audit/*,compliance,encryption}` |

**The backend is far richer than the current UI exposes.** Most of this redesign is
surfacing work, not invention.

### 2.2 GAPs — backend work required before the UI can render honestly

| # | Gap | Why it blocks | Proposed fix |
|---|---|---|---|
| **B1** | A0.5 and A5.5 missing from `AGENT_REGISTRY` | Repository Intelligence and Context Engineering cannot appear in the journal | Add both entries; add a `stage` column to the tuple |
| **B2** | No graph adjacency endpoint | `KnowledgeGraphSummary` deliberately stores no adjacency ("rebuilt on demand"). React Flow needs nodes + edges. | `GET /knowledge/{run_id}/graph?focus=&depth=&types=` returning `{nodes: KGNode[], edges: KGEdge[]}`, server-capped |
| **B3** | Security + Learning APIs are **process-scoped, not run-scoped** | The right rail must show *this run's* security posture, not the process total | `GET /security/runs/{run_id}` and `GET /learning/runs/{run_id}` |
| **B4** | No `repository_id` on the run projection | Cannot join a run to its `FrameworkProfile` / `RepositoryProfile` | Add `repository_id` to `build_workspace_header` |
| **B5** | Context package not projected to the UI | Flagship stage has no view model | `GET /api/runs/{id}/context` + a `kind:"context"` visualization |
| **B6** | Completion signalled only via A10 | F3 above | Explicit `run.completed` / `run.failed` frame from `route_pr` and every terminal path |
| **B7** | No per-run event replay cursor | History replay refetches everything | `GET /runs/{id}/events?after=<sequence>` |
| **B8** | In-memory `WSBroadcaster` + `MemorySaver` | Two API replicas → clients miss events; no resume after restart | Finish the Redis pub/sub path already stubbed in `ws.py` |
| **B9** | `ui_projection.py` is 1406 lines and untyped at the UI boundary | Any payload change breaks the UI silently | Split per agent; generate TS types from the Pydantic models |

### 2.3 The one honesty conflict in the vision

The requested intro sequence ends with a **Context Engineering Preview** showing
`25000 → 6200 → 850 → 120 → 18` in the first 3–5 seconds.

Those numbers do not exist yet at that point. A5.5 runs *after* `blast_scope`
(`graph.py:120`) — after reproduction, investigation and blast analysis. At second
three the pipeline is still indexing.

Two options, both honest:

- **(A) Recommended.** Intro step 6 shows the funnel *architecture* with only the
  numbers that exist at t=3s — the real indexed file count and node/edge counts from
  A0.5 — with downstream stages rendered as unlit, labelled "pending". It reads as
  *"this is the machine you are about to watch run"*, not as a result. The full
  animated reduction is the A5.5 stage, where every number is real.
- **(B)** Drop step 6 from the intro entirely.

**A fabricated funnel in the first five seconds is the single fastest way to lose an
enterprise buyer's trust.** Recommending (A).

---

## 3. Information architecture

### 3.1 Stage model

Seven stages. Context Engineering is promoted out of Repair Planning to its own stage
because it is the flagship differentiator and burying it under "planning" undersells
it.

| Stage | Agents (real backend ids) | Graph node |
|---|---|---|
| **1 · Repository Understanding** | A0.5 Repository Intelligence, A1 Semantic Intent Graph, A2 Dependency Reachability, A3 Static Analysis | `index_repository`, `parallel_intel`, `layer1_fan_in` |
| **2 · Investigation** | A3.5 Runtime Reproduction, A4 Root Cause, A5 Blast Radius | `reproduction_gate`, `investigate`, `blast_scope` |
| **3 · Context Engineering** | A5.5 Context Engineering | `engineer_context` |
| **4 · Repair Planning** | A6 Repair Planner | `plan_fixes` |
| **5 · Repair Generation** | A7 Patch Generator | `generate_code` |
| **6 · Validation** | A8 Mutation Validation, A9 Security Re-scan, A10 Mergeability | `validate_mutation`, `validate_security`, `route_pr` |
| **7 · Learning** | Learning pipeline (post-run) | — |

Note the deviation from the brief's example: it listed "A2 Semantic Graph". In the
real backend A1 owns the Semantic Intent Graph and A2 is CVE reachability. The UI
follows the code.

**Retry loop.** `generate_code → validate_mutation → increment_retry → generate_code`
means stages 5–6 can repeat. The stage rail must render attempt N as a *branch*, not
overwrite attempt N−1. This is missing from the brief and is essential — the retry
story is one of the most convincing things ProoFix does.

### 3.2 Route hierarchy

```
/runs/$runId                      → intro sequence, then workspace (redirects to active stage)
/runs/$runId/$stageId             → a stage holds the center
/runs/$runId/$stageId/$agentId    → deep link into one agent inside the stage
   ?panel=dna|graph|security|learning|health|metrics   → right rail selection
   ?why=<nodeId>                                       → Why panel open
```

URL is the truth for *what is on screen*. Live progress is not in the URL. Deep links
are shareable and reload-safe — an enterprise requirement (a reviewer pastes a link to
exactly the evidence they are questioning).

### 3.3 Layout

```
┌──────────┬────────────────────────────────────────┬──────────────┐
│          │                                        │  ◆ Digital   │  ← twin, top-right
│  Stage   │        ACTIVE STAGE (center)           │     Twin     │
│   Rail   │                                        ├──────────────┤
│          │   history above ↑                      │  Repository  │
│  1 ✓     │   ┌──────────────────────────────┐     │     DNA      │
│  2 ✓     │   │                              │     │  Knowledge   │
│  3 ●     │   │      stage visualization      │     │   Security   │
│  4 ○     │   │                              │     │   Learning   │
│  5 ○     │   └──────────────────────────────┘     │    Health    │
│  6 ○     │   future below ↓                       │   Metrics    │
│  7 ○     │                                        │              │
├──────────┴────────────────────────────────────────┴──────────────┤
│  Persistent AI chat dock                                          │
└───────────────────────────────────────────────────────────────────┘
    260px              fluid, max 1100px                   360px
```

Completed stages collapse to a single summary row in the rail. The current stage is
expanded with its agents listed. Future stages are dimmed and non-interactive until
reached — clicking one is a lie about what is known.

---

## 4. Component hierarchy

```
routes/runs.$runId.tsx
└── RunProvider                          WS + REST + stage machine; the only stateful root
    ├── IntroSequence                    mounts only while stage 1 has not emitted
    │   ├── ConnectionBeat               GitHub → Repository
    │   ├── StructureBeat                tree grows from real index
    │   ├── FrameworkBeat                badges from FrameworkProfile
    │   ├── GraphBeat                    KG nodes/edges appear
    │   ├── DnaBeat                      Repository DNA card
    │   └── ContextArchitectureBeat      funnel shape, unlit (§2.3 option A)
    │
    └── WorkspaceShell
        ├── StageRail                    left, 260px
        │   └── StageGroup × 7
        │       └── AgentRow × n         status dot, name, duration
        ├── StageStage                   center — the theatre
        │   ├── StageHistory             collapsed completed stages, scroll up to expand
        │   ├── ActiveStage
        │   │   ├── StageHeader          title, agents, elapsed, WhyButton
        │   │   ├── <StageView/>         one of seven, code-split
        │   │   └── StageHandoff         evidence passed to the next stage
        │   └── StageFuture              dimmed upcoming
        ├── IntelligencePanel            right, 360px
        │   ├── DigitalTwin              persistent, top-right
        │   ├── RepositoryDnaCard
        │   ├── KnowledgeGraphMini
        │   ├── SecurityStatusCard
        │   ├── LearningStatusCard
        │   ├── RepositoryHealthCard
        │   └── RunMetricsCard
        ├── WhyPanel                     right-side sheet, evidence-only
        └── ChatDock                     bottom, persistent
```

### 4.1 Stage views

| View | Primary technique |
|---|---|
| `RepositoryUnderstandingView` | virtualized tree + Recharts language donut + DNA card + scanner cards + severity heatmap |
| `InvestigationView` | terminal replay (reproduction) → split call-stack / root-cause graph → blast graph |
| `ContextEngineeringView` | **the flagship** — D3 funnel, §5.3 |
| `RepairPlanningView` | React Flow DAG, topological reveal, per-node confidence |
| `RepairGenerationView` | streaming diff, acceptance criteria checklist, runtime evidence sidebar |
| `ValidationView` | pipeline rail + mutation gauge + security delta + trust axes |
| `LearningView` | Repair → Repository memory → Organization memory → Future repairs |

### 4.2 Reusable primitives (new, cross-stage)

These are what stop seven bespoke views becoming seven bespoke design languages:

- `<GraphCanvas>` — one React Flow wrapper. Node/edge types, hover-highlight of
  neighbours, focus-by-search, fit-to-view, pan/zoom limits, keyboard nav. Used by
  Semantic Graph, Blast Radius, Repair DAG, Root Cause, Digital Twin, KG mini.
- `<EvidenceList>` — renders `Evidence[]` (`signal / value / contribution / detail /
  provenance`) as weighted bars. Used by Why panel, root cause, context ranking,
  mergeability. **One component is the reason "Why?" feels consistent everywhere.**
- `<MetricTile>` / `<MetricGrid>` — label, value, delta, threshold, `null`-aware.
  Renders "—" and a tooltip for unmeasured, never 0.
- `<Gauge>` — threshold-aware arc (mutation score, trust, confidence). Must render an
  explicit "not measured" state for `score === null`.
- `<Funnel>` — the reduction visual, reused by intro and Context Engineering.
- `<TerminalReplay>` — paced monospace output with a real cursor.
- `<DiffView>` — Monaco diff, code-split and client-only.
- `<StatusDot>` / `<StatusBadge>` — extend the existing ones with `skipped`/`pending`.
- `<Reveal>` — Framer Motion wrapper honouring `prefers-reduced-motion` globally.
  Every animation in the app goes through this; that is how F6 gets fixed once.

---

## 5. Animation flow

### 5.1 Principle

Timing lives in exactly one place: the stream layer. Views are pure functions of
state. This is already the architecture (`mockEventStream.ts` header comment) and it
is the reason the redesign is affordable — no component learns where events come from
or how fast they arrive.

```
WS frame → normalize → paced drain queue → stage machine → React state → Framer Motion
```

### 5.2 Three animation classes

1. **Event-driven** — a node lights because a frame said so. Duration is the frame's,
   not a designer's. Everything factual is this class.
2. **Presentational** — enter/exit, layout shift, hover. Free to be designed; asserts
   nothing.
3. **Continuous** — the "thinking" pulse on an in-flight stage. Must stop the instant
   the terminal frame lands. A pulse that outlives the work is a lie about latency.

### 5.3 The Context Engineering funnel

Seven bands, each lighting as its real number arrives from the A5.5 payload:

```
Entire repository        files indexed              ← A0.5 metrics
   ↓
Knowledge graph          repository_nodes/edges     ← A0.5 metrics
   ↓
Context ranking          files_ranked → files_extracted   ← ContextMetrics
   ↓
Privacy filter           privacy_redactions, privacy_guard_status
   ↓
Prompt firewall          firewall verdict, provider routed to
   ↓
Minimal context package  context_files / context_functions / context_lines
   ↓
LLM                      original_tokens → reduced_tokens (token_reduction %)
```

The reduction is drawn as mass falling away, not as a bar chart — the emotional beat
is *"25,000 files became 18 functions and nothing secret left the building."* Hovering
any band opens its `Evidence[]` in the Why panel: which signals ranked this file, what
each contributed. That is the moment the product stops looking like a dashboard.

If `privacy_guard_status === "failed"` the band renders **red and blocking**, not
skipped. Fail-closed must be visible.

### 5.4 Intro pacing

The intro is event-gated, not timed. Beats advance on real frames and the sequence
cannot complete before `index_repository` emits `completed`. If the backend is faster
than the animation, beats compress (minimum 280ms each) rather than the UI waiting. If
the backend is slower, the last beat holds with a live elapsed counter — an honest
wait, not a fake progress bar. Hard ceiling ~5s, after which it hands off to the
workspace with stage 1 still running.

The intro is skippable and never replays for a run already completed.

---

## 6. WebSocket data flow

### 6.1 Today

One channel: `WS /ws/runs/{run_id}` carrying `AgentStatusEvent{run_id, agent_id,
status, timestamp, message, payload, sequence}`, plus `GET /runs/{id}/events` for
history replay and a 64-frame dedupe window in `ws.py`.

### 6.2 Proposed

Keep the single channel — multiplexing adds failure modes for no gain at this scale.
Extend the frame vocabulary instead:

```ts
type RunFrame =
  | { type: "agent.status"; agent_id; status; message; payload; sequence }
  | { type: "stage.entered";  stage_id; sequence }
  | { type: "run.completed";  decision; sequence }   // B6
  | { type: "run.failed";     reason; sequence }     // B6
  | { type: "attempt.started"; attempt; sequence }   // retry branching
  | { type: "ping" }
```

Flow:

1. **Mount** → `GET /runs/{id}/events` for history → replay through the drain queue at
   catch-up speed. Opening a finished run plays the same journal as watching it live.
2. **Attach** `WS /ws/runs/{id}`. Ordering by `sequence`; frames with `sequence <=`
   the highest replayed are dropped.
3. **Payload-bearing frames invalidate TanStack Query keys** rather than carrying view
   models. The WS says *what changed*; REST says *what it is now*. This kills the 2.5s
   poll (F7) and keeps the socket frames small.
4. **Reconnect** with exponential backoff (1s → 30s, jittered), resuming from
   `?after=<lastSequence>` (B7). Never treat a close as completion.
5. **Degraded mode** — if the socket cannot open at all, fall back to polling
   `events?after=` at 3s and show a discreet "reconnecting" indicator. Silent
   degradation is worse than a visible one.

### 6.3 Backpressure

A finished run replays hundreds of frames. The drain queue already handles this; the
new constraint is that heavy canvases (React Flow, Monaco) must not re-render per
frame. Solved by §7.

---

## 7. State management

Four distinct kinds of state, four mechanisms. Mixing them is what makes the current
`Workspace.tsx` hard to reason about.

| Kind | Mechanism | Notes |
|---|---|---|
| **Navigation** — run, stage, agent, panel, why | TanStack Router URL | Shareable, reload-safe, back/forward correct |
| **Server** — every view model | TanStack Query | Already a dependency, currently unused (F7). WS-driven invalidation, no polling |
| **Stream** — event log, per-stage progress, active stage | External store + `useSyncExternalStore` | **Critical.** A context provider re-renders every consumer on every frame; with seven stages and graph canvases that is unaffordable. Components subscribe to selectors and re-render only when *their* slice moves |
| **Local UI** — expanded, hovered, scroll intent | `useState` in the owning component | Never lifted |

### 7.1 The stream store

```ts
interface RunStore {
  frames: RunFrame[];                       // ordered, deduped by sequence
  stages: Record<StageId, StageState>;      // status, agents, timings, attempt
  activeStage: StageId | null;
  attempts: AttemptState[];                 // retry branching
  connection: "connecting" | "live" | "reconnecting" | "replaying" | "closed";
  subscribe(listener): () => void;
  getSnapshot(): Snapshot;
}
```

Selectors: `useStage(id)`, `useAgent(id)`, `useActiveStage()`, `useConnection()`.

**No Zustand/Redux.** The store is ~150 lines, has one writer (the stream), and
`useSyncExternalStore` is the correct primitive. Adding a dependency here buys nothing.

### 7.2 Follow mode

One piece of state deserves naming: `followMode: "auto" | "pinned"`. Auto tracks the
active stage. Any deliberate scroll up pins. A "Back to live" affordance returns. The
current code has this as `reviewIndex` and gets it right — keep the behaviour, name it
better.

---

## 8. Responsive behaviour

| Breakpoint | Layout |
|---|---|
| **≥1600px** | Three columns at full width. Digital twin at 320×220. Graphs get real canvas. |
| **1280–1600px** | Three columns; right rail 320px, cards single-column. |
| **1024–1280px** | **Two columns.** Right rail becomes a slide-over sheet on a toolbar button. Twin collapses to a 120px pill that expands on click. |
| **768–1024px** | **One column.** Stage rail becomes a horizontal scrolling stepper pinned under the header. Chat becomes a bottom sheet. |
| **<768px** | Read-only review mode. Stage list → stage detail as separate views. Graphs render as ranked lists with a "view graph" full-screen escape. |

Mobile is a *review* surface, not a *watch* surface — an engineer reviewing a
decision on a phone needs evidence and the verdict, not a 40-node force layout. Saying
this explicitly prevents months of fighting to shrink React Flow.

Non-negotiables at every size: the decision, the trust score, the "why", and the chat.

---

## 9. Improvements to make before/while implementing

### 9.1 Trust and correctness

1. **Kill every hardcoded assertion** (F1, F2). Evidence badges derive from
   `reproduction.status`, `root_cause.confidence`, `mutation_result`.
2. **Render `null` honestly.** `MutationPayload.score` is already `number | null` and
   `CLAUDE.md §2.4` documents that the mutation score is currently a fabricated
   constant. The gauge must show "not measured" for `null`, and the UI should surface
   the correctness threshold that gated the decision. **Do not draw a needle at 0.5
   and call it a score.**
3. **Explicit terminal frames** (B6) — F3 means a run that fails before A10 currently
   never completes in the UI.
4. **Stage-aware, not index-aware.** Replace every `activeIndex >= N` with a stage
   status check so adding A0.5/A5.5 does not silently shift six reveal thresholds.

### 9.2 Contract safety

5. **Generate TypeScript types from the Pydantic models.** `visualizationTypes.ts` and
   `ui_projection.py` are a hand-maintained duplicate pair across two repos — the
   frontend/backend equivalent of the `RunState`/`RunStateModel` duplication already
   flagged in `CLAUDE.md §2.2`. A generation step turns a silent breakage into a build
   failure.
6. **Split `ui_projection.py` per agent** (B9, `CLAUDE.md` T8) before adding two more
   agents to it.
7. **Version the event payload schema.** `schema_version` on each visualization
   payload; the UI degrades to a generic evidence view on an unknown version rather
   than crashing.

### 9.3 Product

8. **Make retries first-class.** Attempt 1 vs 2 side by side, with what changed
   between them. This is proof of autonomy — the system *learned within the run*.
9. **The Why panel should cite, not narrate.** `Evidence{signal, value, contribution}`
   is already structured for weighted bars. Never expose chain-of-thought; show the
   deterministic signals and their weights. This is the enterprise differentiator and
   the backend already models it correctly.
10. **Show cost and tokens.** `SecurityMetrics.estimated_cost_usd`, `provider_usage`,
    plus `ContextMetrics.estimated_saved_tokens`. "This run cost $0.34 and Context
    Engineering saved 82% of it" is a CFO-legible sentence no competitor can print.
11. **Surface the privacy guard prominently.** Redaction count and `privacy_guard_status`
    belong in the right rail permanently, not buried in a stage. It is the reason an
    enterprise can deploy this.
12. **Digital Twin as memory, not decoration.** It should *persist across runs* for the
    same repository — nodes carried from `RepairMemory` show the system remembers. A
    twin that resets every run is an animation; one that accumulates is a product.

### 9.4 Engineering

13. **Monaco is ~2MB.** Load it only on the Repair Generation stage, client-only,
    behind `React.lazy`. Consider Shiki for read-only diffs and reserve Monaco for
    when editing is added. Under TanStack Start SSR, Monaco, React Flow and D3 force
    layouts all need client-only guards.
14. **`prefers-reduced-motion`** (F6) — one `<Reveal>` wrapper, applied globally.
15. **Accessibility.** Every graph needs a tabular equivalent. Live regions for stage
    transitions. Focus management when the stage changes under the user.
16. **Delete the mock-first default** (F8). Fixtures move behind `?mock=1` for
    Playwright/Storybook. `api` becomes the default so a broken backend fails loudly.
17. **Redis-backed broadcaster** (B8) before any multi-replica deployment.

---

## 10. Implementation phases

Each phase independently shippable and revertible.

| Phase | Content | Depends on |
|---|---|---|
| **0 · Contract** | B1 (register A0.5, A5.5 + `stage` column), B4, B5, B6, TS type generation, `ui_projection` split | backend |
| **1 · Skeleton** | RunProvider, stream store, StageRail, StageStage, three-column shell, routes. Existing visualizations rendered unchanged inside the new frame. | Phase 0 |
| **2 · Flagship** | Context Engineering stage + funnel + Why panel + `<EvidenceList>` | B5 |
| **3 · Graphs** | `<GraphCanvas>`, Semantic Graph, Blast Radius, Repair DAG, Digital Twin | B2 |
| **4 · Intelligence rail** | DNA, KG mini, Security, Learning, Health, Metrics | B3 |
| **5 · Intro** | Event-gated cinematic sequence | Phases 1–4 |
| **6 · Depth** | Patch streaming/Monaco, validation pipeline, learning stage, retry branching | — |
| **7 · Polish** | Responsive, a11y, reduced motion, perf budget | — |

The intro is built **last**, deliberately. It is the most visible and least
load-bearing part, and building it first is how projects end up with a beautiful
opening for a workspace that has nothing behind it.

---

## 11. Open decisions for review

1. **Intro step 6** — §2.3 option A (architecture, unlit, real numbers only) or drop it?
2. **Stage count** — Context Engineering as its own stage (7) or nested inside Repair
   Planning (6, as briefed)?
3. **Backend gaps B1–B9** — who does them, and are B2/B3/B5 in scope now? Without B5
   the flagship stage cannot be built at all.
4. **Monaco vs Shiki** for the patch view.
5. **Rebuild vs evolve** — build the new shell alongside the current workspace behind a
   flag, or replace `Workspace.tsx` in place? Recommending alongside: the current UI
   stays demoable throughout.
6. **`frontend/.git`** — the frontend is still a separate embedded repo
   (`CLAUDE.md` T9). Decide submodule vs subdirectory before this volume of new code
   lands.
