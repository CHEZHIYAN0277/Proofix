/**
 * `<StatusDot>` / `<StatusPill>` (blueprint §3.7).
 *
 * Six states, one shape language, `aria-label` derived from the state.
 *
 * The dot is the only status affordance permitted on peripheral surfaces. Its
 * pulse is the continuous class, so rule A4 applies: the rail shows state, not
 * activity — pass `pulse={false}` there and let the active stage own the one
 * animation on screen.
 */

import { cn } from "@/lib/utils";
import { STATUS_COLORS } from "../tokens/color";
import type { StatusState } from "../types";

export interface StatusDotProps {
  status: StatusState;

  /**
   * Whether an active state pulses. Only ever `true` for the active stage
   * (rule A4). Ignored for states that are not active.
   */
  pulse?: boolean;

  size?: "sm" | "md" | "lg";

  /** Overrides the accessible label. Defaults to the state's label. */
  label?: string;

  className?: string;
}

const DOT_SIZE = { sm: "size-1.5", md: "size-2", lg: "size-2.5" } as const;

export function StatusDot({
  status,
  pulse = false,
  size = "md",
  label,
  className,
}: StatusDotProps) {
  const spec = STATUS_COLORS[status];
  const animated = pulse && spec.active;

  return (
    <span
      role="img"
      aria-label={label ?? spec.label}
      className={cn("relative inline-flex shrink-0", DOT_SIZE[size], className)}
    >
      {animated && (
        <span
          aria-hidden
          className="ds-working-pulse absolute inset-0 rounded-full"
          style={{ backgroundColor: spec.fg, opacity: 0.35 }}
        />
      )}
      <span
        aria-hidden
        className="relative inline-block size-full rounded-full"
        style={{ backgroundColor: spec.fg }}
      />
    </span>
  );
}

export interface StatusPillProps extends StatusDotProps {
  /** Overrides the visible text. Defaults to the state's label. */
  children?: string;
  /** Hides the dot, leaving a bare tinted pill. */
  dot?: boolean;
}

export function StatusPill({
  status,
  pulse = false,
  size = "md",
  label,
  children,
  dot = true,
  className,
}: StatusPillProps) {
  const spec = STATUS_COLORS[status];
  const text = children ?? spec.label;

  return (
    <span
      className={cn(
        "type-caption inline-flex items-center gap-1.5 rounded-full border",
        size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1",
        className,
      )}
      style={{
        color: spec.fg,
        backgroundColor: spec.bg,
        borderColor: `color-mix(in srgb, ${spec.fg} 26%, transparent)`,
      }}
      aria-label={label ?? spec.label}
    >
      {dot && <StatusDot status={status} pulse={pulse} size="sm" label={label ?? spec.label} />}
      <span>{text}</span>
    </span>
  );
}
