/**
 * `<AgentAvatar>` — the deterministic mark for an agent (blueprint §5).
 *
 * Keyed on `agent_id`. Nothing about the mark comes from the display name, so
 * renaming an agent never changes its identity on screen.
 */

import { cn } from "@/lib/utils";
import { AVATAR_GRID, agentAvatarCells, agentColor, agentInitials } from "./avatarMark";

export interface AgentAvatarProps {
  /** The backend `agent_id`, e.g. `A5.5`. Never the display name. */
  agentId: string;
  /** Accessible name. Falls back to the id. */
  name?: string;
  size?: number;
  /** Below ~24px the grid is illegible; initials read better. */
  variant?: "mark" | "initials" | "auto";
  className?: string;
}

export function AgentAvatar({
  agentId,
  name,
  size = 28,
  variant = "auto",
  className,
}: AgentAvatarProps) {
  const color = agentColor(agentId);
  const resolved = variant === "auto" ? (size < 24 ? "initials" : "mark") : variant;
  const label = name ? `${name} (${agentId})` : agentId;

  if (resolved === "initials") {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn(
          "type-mono-sm inline-flex shrink-0 items-center justify-center rounded-xs font-medium",
          className,
        )}
        style={{
          width: size,
          height: size,
          color,
          backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
          fontSize: Math.max(9, Math.round(size * 0.38)),
        }}
      >
        {agentInitials(agentId)}
      </span>
    );
  }

  const cells = agentAvatarCells(agentId);
  const cell = size / AVATAR_GRID;

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${AVATAR_GRID} ${AVATAR_GRID}`}
      className={cn("shrink-0 rounded-xs", className)}
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {cells.map((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} rx={0.18} fill={color} />
          ) : null,
        ),
      )}
      {/* `cell` participates only in sizing decisions upstream; kept out of the
          path data so the mark scales purely through the viewBox. */}
      <desc>{`Deterministic mark for ${agentId} at ${cell.toFixed(2)}px per cell`}</desc>
    </svg>
  );
}
