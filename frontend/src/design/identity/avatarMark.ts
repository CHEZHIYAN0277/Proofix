/**
 * Deterministic agent marks (blueprint §5).
 *
 * An avatar is generated from the `agent_id` alone — never from the display
 * name. V1's F4 bug was keying presentation on the name, so a renamed agent
 * silently changed identity. The id is stable, so the mark is stable: the same
 * agent looks the same across runs, repositories and deployments.
 *
 * Pure functions, no React, no randomness, no persistence.
 */

import { GRAPH_NODE_COLORS, GRAPH_NODE_ORDER } from "../tokens/color";

/** FNV-1a. Small, stable across engines, good enough for bucket selection. */
export function hashAgentId(agentId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < agentId.length; i++) {
    h ^= agentId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The mark's hue, drawn from the graph palette so an agent's color is AA in
 * both themes and colorblind-separable against the others.
 */
export function agentColor(agentId: string): string {
  const type = GRAPH_NODE_ORDER[hashAgentId(agentId) % GRAPH_NODE_ORDER.length];
  return GRAPH_NODE_COLORS[type].fg;
}

export const AVATAR_GRID = 5;

/**
 * A vertically-mirrored dot grid — the identicon shape language.
 *
 * Only the left half plus the center column is generated; mirroring the rest
 * makes every mark symmetric, which reads as an emblem rather than as noise.
 */
export function agentAvatarCells(agentId: string): boolean[][] {
  const hash = hashAgentId(agentId);
  const halfWidth = Math.ceil(AVATAR_GRID / 2);
  const cells: boolean[][] = [];

  for (let y = 0; y < AVATAR_GRID; y++) {
    const row: boolean[] = new Array(AVATAR_GRID).fill(false);
    for (let x = 0; x < halfWidth; x++) {
      // Re-mix per cell so adjacent ids do not produce adjacent patterns.
      const bit = Math.imul(hash ^ (y * 31 + x * 7 + 1), 0x27220a95) >>> 0;
      const on = (bit >>> 13) % 100 < 48;
      row[x] = on;
      row[AVATAR_GRID - 1 - x] = on;
    }
    cells.push(row);
  }

  return cells;
}

/**
 * Fallback initials, for the compact sizes where the grid is illegible.
 * `A3.5` → `A3.5`; `a5_5_context` → `A5`.
 */
export function agentInitials(agentId: string): string {
  const compact = agentId.trim();
  if (/^[Aa]\d+(\.\d+)?$/.test(compact)) return compact.toUpperCase();

  const match = compact.match(/^([Aa])(\d+)/);
  if (match) return `${match[1].toUpperCase()}${match[2]}`;

  return compact.slice(0, 2).toUpperCase();
}
