/**
 * `<Gauge>` (blueprint §3.7).
 *
 * A threshold arc with an explicit **"Not measured"** state for `null`.
 *
 * That state is the entire point of the component. The mutation score is the
 * motivating case: when the backend publishes `score: null`, the gauge shows
 * an empty track and says so — it never draws a needle at zero, at the
 * threshold, or anywhere else. A needle the backend did not produce is a
 * fabricated measurement feeding a merge decision.
 */

import { cn } from "@/lib/utils";
import { MOTION } from "../tokens/motion";
import type { StatusState } from "../types";

export interface GaugeProps {
  /** The measured value. `null`/`undefined` renders "Not measured". */
  value: number | null | undefined;

  /** Domain. Defaults to 0–100. */
  min?: number;
  max?: number;

  /** The value that must be reached. Rendered as a tick on the track. */
  threshold?: number | null;

  /** `at-least` passes when value ≥ threshold; `at-most` when ≤. */
  direction?: "at-least" | "at-most";

  label?: string;
  unit?: string;

  /** Why it was not measured. Shown under "Not measured". */
  reason?: string;

  size?: number;
  className?: string;
}

const ARC_DEGREES = 240;
const START_ANGLE = 150; // degrees, clockwise from 3 o'clock

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, sweepDeg: number) {
  const from = polar(cx, cy, r, fromDeg);
  const to = polar(cx, cy, r, fromDeg + sweepDeg);
  const largeArc = Math.abs(sweepDeg) > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${r} ${r} 0 ${largeArc} 1 ${to.x} ${to.y}`;
}

export function Gauge({
  value,
  min = 0,
  max = 100,
  threshold = null,
  direction = "at-least",
  label,
  unit,
  reason,
  size = 132,
  className,
}: GaugeProps) {
  const measured = value !== null && value !== undefined && Number.isFinite(value);

  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(6, Math.round(size * 0.075));
  const r = cx - stroke / 2 - 2;

  const span = max - min || 1;
  const fraction = measured ? Math.min(1, Math.max(0, (value - min) / span)) : 0;

  const passed =
    measured && threshold !== null && threshold !== undefined
      ? direction === "at-least"
        ? value >= threshold
        : value <= threshold
      : null;

  const status: StatusState = passed === null ? "waiting" : passed ? "completed" : "failed";
  const arcColor =
    passed === null ? "var(--primary)" : `var(--status-${passed ? "completed" : "failed"})`;

  const thresholdFraction =
    threshold !== null && threshold !== undefined
      ? Math.min(1, Math.max(0, (threshold - min) / span))
      : null;

  const accessibleValue = measured
    ? `${value}${unit ?? ""}`
    : `Not measured${reason ? `: ${reason}` : ""}`;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg
        width={size}
        height={size * 0.72}
        viewBox={`0 0 ${size} ${size * 0.72}`}
        role="img"
        aria-label={`${label ?? "Gauge"}: ${accessibleValue}`}
        className="overflow-visible"
      >
        {/* Track — always drawn, so an unmeasured gauge still reads as a gauge */}
        <path
          d={arcPath(cx, cy, r, START_ANGLE, ARC_DEGREES)}
          fill="none"
          stroke="var(--surface-muted)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />

        {/* Progress. Drawn as the full arc with `pathLength={1}`, revealed by
            dash length — so the sweep animates on a value change without the
            path geometry being recomputed, and without a wrapper element
            (nothing but SVG content is valid inside an `<svg>`). */}
        {measured && (
          <path
            d={arcPath(cx, cy, r, START_ANGLE, ARC_DEGREES)}
            fill="none"
            stroke={arcColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={`${fraction} 1`}
            style={{
              transition: `stroke-dasharray ${MOTION.narrative.cssVar} ${MOTION.narrative.easeVar}`,
            }}
          />
        )}

        {/* Threshold tick — drawn even when unmeasured: the bar to clear is a
            fact independent of whether anything cleared it. */}
        {thresholdFraction !== null &&
          (() => {
            const angle = START_ANGLE + ARC_DEGREES * thresholdFraction;
            const inner = polar(cx, cy, r - stroke / 2 - 1, angle);
            const outer = polar(cx, cy, r + stroke / 2 + 1, angle);
            return (
              <line
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="var(--ink-soft)"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            );
          })()}

        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          className={measured ? "type-title-2" : "type-body-sm"}
          fill={measured ? "var(--ink)" : "var(--data-unavailable)"}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {measured ? `${value}${unit ?? ""}` : "Not measured"}
        </text>

        {label && (
          <text
            x={cx}
            y={cy + 22}
            textAnchor="middle"
            className="type-caption"
            fill="var(--ink-soft)"
          >
            {label}
          </text>
        )}
      </svg>

      {!measured && reason && (
        <p className="type-caption mt-1 max-w-[22ch] text-center text-ink-soft">{reason}</p>
      )}

      {measured && threshold !== null && threshold !== undefined && (
        <p className="type-caption mt-1 text-ink-soft">
          {direction === "at-least" ? "Threshold ≥" : "Threshold ≤"} {threshold}
          <span className="ml-1.5" style={{ color: `var(--status-${status})` }}>
            {passed ? "met" : "not met"}
          </span>
        </p>
      )}
    </div>
  );
}
