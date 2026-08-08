# ProoFix Design System — Phase 0

The visual language every surface inherits: Landing, Workspace, Dashboard, Security,
Learning, Organization, Settings, Digital Twin. **No page may introduce a UI pattern that
does not exist here.**

Implements §3 of `docs/WORKSPACE_V2_IMPLEMENTATION.md`. Consumed by V1 and V2 alike.
Phase 0 builds the system only — no Workspace V2 screens, no stage implementations.

## Layout

```
design/
├── tokens/       typography · spacing · radius · elevation · motion · color
│   └── tokens.css   the CSS layer, imported once by src/styles.css
├── primitives/   DataBoundary · Reveal · StatusDot · MetricTile · Gauge ·
│                 EvidenceList · ExplainAffordance · Eyebrow/SectionHeader/KeyValue/Timestamp
├── states/       DataState (Waiting/Pending/Unavailable) · Skeleton · Empty · Loading · Error
├── components/   Card · Button · Input · Panel · Table · GraphChrome · CodeBlock
├── identity/     deterministic agent marks + icon set, keyed on `agent_id`
└── gallery/      the /design route
```

Import from the barrel: `import { DataBoundary, MetricTile } from "@/design"`.

## The three rules that shape everything

1. **Every visual element traces to a backend field, or renders `Waiting` / `Pending` /
   `Unavailable`.** `<DataBoundary>` makes this structural: `children` is a function of the
   present value, so there is no code path that reaches a render body with a missing value.
   `0` and `false` are present; only `null`, `undefined`, `NaN` and whitespace-only strings
   are missing.

2. **Motion explains work, never fills time.** Every animation goes through `<Reveal>`.
   No indeterminate progress bars exist — an elapsed counter is a fact, a percentage nobody
   measured is a lie. `prefers-reduced-motion` collapses every duration at one gate.

3. **Nothing is synthesized.** Confidence renders "Not published" when a producer publishes
   none. `<Gauge value={null}>` renders "Not measured" and draws no needle. `<MetricTile>`
   requires a `source` prop, so every number can answer "where did this come from?".

## Running the gallery

```
VITE_FEATURE_WORKSPACE_V2=1 npm run dev   # then open /design
```

Or override per-browser without touching the env: `/design?v2=1` (persisted to
`localStorage`; `?v2=0` clears it). With the flag off, `/design` renders not-found.

The gallery proves every token, state and primitive in both themes and **renders no run
data**. Its contrast audit measures the *resolved* value of each token in the browser, so
flipping the theme re-measures — all 19 audited pairs pass AA (≥4.5) in both themes.

Specimens that need a value use synthetic props from `gallery/samples.ts`, labelled as such
in the UI. Nothing outside `design/gallery/` may import that file.

## Deliberate deviations from the blueprint

- **Radius.** The blueprint's `md 10 · lg 14 · xl 20` collides with `--radius-sm|md|lg|xl`,
  which `styles.css` already derives from `--radius` and which V1 renders with. Redefining
  them would change V1's appearance, so the design system adds *surface-named* tokens
  instead: `rounded-card` (10) · `rounded-panel` (14) · `rounded-overlay` (20), plus
  `rounded-xs` (4). Same scale, no collision, and the names say what they are for.

- **Elevation.** `--shadow-sm|md|lg` already exist and already carry the resting / active /
  overlay meaning, so they are reused. Phase 0 adds only `--shadow-flat` and the three
  `--shadow-glow-*` status rings.

- **Code highlighting.** Shiki is a Phase 6 dependency. `<CodeBlock>` ships the full chrome
  — line numbers, copy, wrap toggle, diff gutters — and takes an optional `renderLine`.
  Phase 6 supplies a Shiki-backed renderer; nothing else about the component changes.

- **Graph rendering.** React Flow is a Phase 3 dependency. `<GraphChrome>` ships the
  toolbar, legend, minimap slot, empty state and the mandatory table equivalent, with the
  renderer as a `children` slot — so no graph library enters the base bundle.

## Bundle impact

`framer-motion` is the only new dependency and is reachable only from `<Reveal>`, which
today only the `/design` route mounts. It lands entirely in the `design` chunk; the V1
entry chunk is unchanged.

## Conventions for anything built on top of this

- Pick a typography token, never a raw size. Numerals are tabular; identifiers, paths, SHAs
  and scores are mono. One `title-1` per screen.
- Attention rules A1–A5: only the active stage may use accent color, elevation ≥ `shadow-md`,
  or motion. Peripheral surfaces cap at `body-sm`, sit flat, and dim to
  `--peripheral-opacity` while a stage runs. Exactly one continuous animation on screen —
  `<Reveal class="continuous">` warns in development when a second one mounts.
- Glass is permitted on exactly four surfaces; `glass()` takes a `GlassSurface`, so anything
  else is a type error.
- Every list, panel and graph declares Loading, Empty and Error. Error states name what
  failed and offer retry; they never fall back to fixture data.
- Every graph ships a table equivalent, built from the same column definitions.
- Icon-only buttons require `aria-label` — enforced by the prop types.
