/**
 * Gallery: typography, spacing & grid, radius, elevation, glass, motion.
 * Proves blueprint §3.1–§3.4.
 */

import { useState } from "react";

import { cn } from "@/lib/utils";
import { Card } from "../../components/Card";
import { Reveal } from "../../primitives/Reveal";
import { Button } from "../../components/Button";
import { ELEVATION, GLASS_SURFACES, RADIUS } from "../../tokens/elevation";
import { MOTION, MOTION_TOKENS } from "../../tokens/motion";
import { SPACING_SCALE, SURFACE_PADDING, WORKSPACE_GRID, space } from "../../tokens/spacing";
import { TYPOGRAPHY, TYPOGRAPHY_TOKENS, isPeripheralSafe } from "../../tokens/typography";
import { Specimen, SpecimenGrid } from "../GalleryShell";

/* ------------------------------------------------------------------ §3.1 */

export function TypographySection() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-surface">
        {TYPOGRAPHY_TOKENS.map((token) => {
          const spec = TYPOGRAPHY[token];
          return (
            <div
              key={token}
              className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-border px-4 py-3 last:border-b-0"
            >
              <span className="type-mono-sm w-24 shrink-0 text-ink-soft">{token}</span>
              <span className={cn(spec.className, "min-w-0 flex-1 text-ink")}>
                {spec.family === "mono" ? "sha 4f2a9c1 · 1,342 · 98.6%" : "The quick brown fox"}
              </span>
              <span className="type-mono-sm shrink-0 text-ink-soft">
                {spec.size}/{spec.lineHeight} · {spec.weight}
              </span>
              <span className="type-caption w-40 shrink-0 text-ink-soft">{spec.use}</span>
              {isPeripheralSafe(token) && (
                <span className="type-caption shrink-0 text-status-completed">A2 safe</span>
              )}
            </div>
          );
        })}
      </div>

      <SpecimenGrid columns={2}>
        <Specimen label="Tabular numerals" note="numbers never shift width as they tick">
          <div className="flex flex-col gap-1">
            <span className="type-mono">1,000,000 · 0.5 · 11:04:07</span>
            <span className="type-mono">1,111,111 · 0.8 · 23:59:59</span>
          </div>
        </Specimen>
        <Specimen label="Mono is mandatory" note="identifiers, paths, SHAs, scores">
          <div className="flex flex-col gap-1">
            <span className="type-mono text-ink">backend/services/example.py:214</span>
            <span className="type-mono text-ink">4f2a9c1e</span>
            <span className="type-mono text-ink">0.82</span>
          </div>
        </Specimen>
      </SpecimenGrid>
    </div>
  );
}

/* ------------------------------------------------------------------ §3.2 */

export function SpacingSection() {
  return (
    <div className="flex flex-col gap-5">
      <Specimen label="Scale" note="4px base">
        <div className="flex flex-wrap items-end gap-3">
          {SPACING_SCALE.map((step) => (
            <div key={step} className="flex flex-col items-center gap-1">
              <div
                className="rounded-xs bg-primary"
                style={{ width: space(step), height: space(step) }}
              />
              <span className="type-mono-sm text-ink-soft">{space(step)}</span>
            </div>
          ))}
        </div>
      </Specimen>

      <SpecimenGrid columns={2}>
        <Specimen label="Surface padding">
          <div className="flex flex-col gap-2">
            {Object.entries(SURFACE_PADDING).map(([kind, px]) => (
              <div key={kind} className="flex items-center gap-3">
                <span className="type-label w-28 shrink-0 text-ink-soft">{kind}</span>
                <div
                  className="rounded-xs border border-dashed border-primary/40"
                  style={{ padding: px }}
                >
                  <div className="h-3 w-16 rounded-xs bg-surface-muted" />
                </div>
                <span className="type-mono-sm text-ink-soft">{px}px</span>
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen label="Workspace grid" note="rule A5 — the center stays dominant">
          <div className="flex gap-2">
            <div
              className="type-caption flex h-24 shrink-0 items-center justify-center rounded-xs bg-surface-muted px-2 text-ink-soft"
              style={{ width: 52 }}
            >
              rail
            </div>
            <div className="type-caption flex h-24 flex-1 items-center justify-center rounded-xs border border-primary/40 bg-primary/5 text-ink">
              center
            </div>
            <div
              className="type-caption flex h-24 shrink-0 items-center justify-center rounded-xs bg-surface-muted px-2 text-ink-soft"
              style={{ width: 72 }}
            >
              mission
            </div>
          </div>
          <dl className="type-caption mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-ink-soft">
            <div className="flex justify-between">
              <dt>rail</dt>
              <dd className="type-mono-sm">{WORKSPACE_GRID.railWidth}px</dd>
            </div>
            <div className="flex justify-between">
              <dt>mission control</dt>
              <dd className="type-mono-sm">{WORKSPACE_GRID.missionControlWidth}px</dd>
            </div>
            <div className="flex justify-between">
              <dt>center max</dt>
              <dd className="type-mono-sm">{WORKSPACE_GRID.centerMaxWidth}px</dd>
            </div>
            <div className="flex justify-between">
              <dt>center min</dt>
              <dd className="type-mono-sm">{WORKSPACE_GRID.centerMinWidth}px</dd>
            </div>
            <div className="flex justify-between">
              <dt>gutter</dt>
              <dd className="type-mono-sm">{WORKSPACE_GRID.gutter}px</dd>
            </div>
            <div className="flex justify-between">
              <dt>min share ≥1280</dt>
              <dd className="type-mono-sm">
                {Math.round(WORKSPACE_GRID.centerMinViewportShare * 100)}%
              </dd>
            </div>
          </dl>
        </Specimen>
      </SpecimenGrid>
    </div>
  );
}

/* ------------------------------------------------------------------ §3.3 */

export function ElevationSection() {
  return (
    <div className="flex flex-col gap-5">
      <Specimen label="Radius">
        <div className="flex flex-wrap gap-4">
          {Object.entries(RADIUS).map(([token, spec]) => (
            <div key={token} className="flex flex-col items-center gap-1.5">
              <div
                className={cn("size-16 border border-border bg-surface-muted", spec.className)}
              />
              <span className="type-mono-sm text-ink-soft">{token}</span>
              <span className="type-caption text-ink-soft">{spec.px}px</span>
            </div>
          ))}
        </div>
      </Specimen>

      <Specimen label="Elevation" note="elevation encodes attention — rule A1">
        <div className="flex flex-wrap gap-5">
          {Object.entries(ELEVATION).map(([token, spec]) => (
            <div key={token} className="flex flex-col gap-1.5">
              <div
                className={cn(
                  "flex size-28 items-center justify-center rounded-card border border-border bg-surface",
                  spec.className,
                )}
              >
                <span className="type-mono-sm text-ink-soft">{token}</span>
              </div>
              <span className="type-caption w-28 text-ink-soft">{spec.use}</span>
            </div>
          ))}
        </div>
      </Specimen>

      <Specimen label="Status glow" note="the active stage only">
        <div className="flex flex-wrap gap-5">
          {(["running", "completed", "failed"] as const).map((status) => (
            <Card key={status} variant="active" status={status} className="w-44">
              <span className="type-label text-ink">shadow-glow-{status}</span>
            </Card>
          ))}
        </div>
      </Specimen>

      <Specimen label="Glass" note="permitted on exactly four surfaces — nowhere else">
        <div
          className="rounded-card p-4"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--surface-muted) 0 10px, var(--surface) 10px 20px)",
          }}
        >
          <div className="ds-glass rounded-card border p-4">
            <p className="type-label text-ink">backdrop-blur(12px) · 72% surface · hairline</p>
            <ul className="type-caption mt-2 flex flex-wrap gap-x-4 text-ink-soft">
              {GLASS_SURFACES.map((s) => (
                <li key={s} className="type-mono-sm">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Specimen>
    </div>
  );
}

/* ------------------------------------------------------------------ §3.4 */

export function MotionSection() {
  const [nonce, setNonce] = useState(0);
  const [working, setWorking] = useState(true);

  return (
    <div className="flex flex-col gap-5">
      <Specimen label="Tokens" note="every value consumed through <Reveal>">
        <div className="mb-4">
          <Button size="sm" variant="secondary" onClick={() => setNonce((n) => n + 1)}>
            Replay
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {MOTION_TOKENS.filter((t) => t !== "pulse").map((token, i) => {
            const spec = MOTION[token];
            return (
              <div key={token} className="flex items-center gap-4">
                <span className="type-mono-sm w-20 shrink-0 text-ink-soft">{token}</span>
                <Reveal key={`${token}-${nonce}`} class="event" token={token} from="right">
                  <div className="rounded-xs bg-primary" style={{ height: 8, width: 120 }} />
                </Reveal>
                <span className="type-mono-sm w-14 shrink-0 text-ink-soft">{spec.duration}ms</span>
                <span className="type-caption min-w-0 flex-1 truncate text-ink-soft">
                  {spec.use}
                </span>
              </div>
            );
          })}
        </div>
      </Specimen>

      <SpecimenGrid columns={2}>
        <Specimen label="The working pulse" note="rule A4 — exactly one on screen at a time">
          <div className="flex items-center gap-4">
            <Reveal class="continuous" when={working}>
              <span className="inline-block size-3 rounded-full bg-status-running" />
            </Reveal>
            <span className="type-body-sm text-ink-soft">{working ? "running" : "stopped"}</span>
            <Button size="sm" variant="ghost" onClick={() => setWorking((w) => !w)}>
              {working ? "Stop" : "Start"}
            </Button>
          </div>
          <p className="type-caption mt-3 text-ink-soft">
            Termination test: the animation stops the instant the work stops. There is no
            indeterminate progress bar anywhere in this system.
          </p>
        </Specimen>

        <Specimen label="Reduced motion" note="one gate, both CSS and JS">
          <p className="type-body-sm text-ink">
            <code className="type-mono">prefers-reduced-motion: reduce</code> collapses every
            duration token to <code className="type-mono">0ms</code> and stops the continuous
            animations outright.
          </p>
          <p className="type-caption mt-2 text-ink-soft">
            Enable it in the OS to verify: the specimens above resolve instantly, and the pulse
            holds still.
          </p>
        </Specimen>
      </SpecimenGrid>
    </div>
  );
}
