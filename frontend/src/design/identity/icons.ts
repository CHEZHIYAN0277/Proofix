/**
 * Icon set (blueprint §5).
 *
 * Keyed on `agent_id`, **not** on the display name — that is V1's F4 bug, and
 * keying on a name means a rename silently changes the icon.
 *
 * This map is presentation only. It carries no agent name, purpose, handoff or
 * stage: those come from the backend `AGENT_REGISTRY`, which is the single
 * source of truth and must never be duplicated here. An unknown id falls back
 * to a neutral mark rather than throwing, so a newly registered agent renders
 * correctly before this file learns about it.
 */

import {
  Binary,
  Bot,
  Boxes,
  Braces,
  Bug,
  FileSearch,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Layers,
  Network,
  Package,
  Radar,
  ScanLine,
  Shield,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** agent_id → icon. Presentation only. */
export const AGENT_ICONS: Record<string, LucideIcon> = {
  "A0.5": Boxes, // Repository Indexing
  A1: Network, // Repository Intelligence
  A2: Package, // Dependency Analyzer
  A3: ScanLine, // Static Analysis
  "A3.5": Bug, // Failure Reproduction
  A4: FileSearch, // Root Cause Analysis
  A5: Radar, // Blast Radius
  "A5.5": Layers, // Context Engineering
  A6: Waypoints, // Repair Planner
  A7: Wrench, // Patch Generator
  A8: TestTube2, // Mutation Validation
  A9: ShieldCheck, // Security Re-scan
  A10: GitPullRequest, // Mergeability Assessment
};

/** Neutral fallback for an agent this map has not learned yet. */
export const AGENT_ICON_FALLBACK: LucideIcon = Bot;

export function agentIcon(agentId: string): LucideIcon {
  return AGENT_ICONS[agentId] ?? AGENT_ICON_FALLBACK;
}

/**
 * Semantic icons the design system itself uses, named by meaning rather than
 * by glyph so a swap is one edit.
 */
export const DS_ICONS = {
  repository: GitBranch,
  graph: Network,
  code: Braces,
  metric: Binary,
  security: Shield,
  learning: Sparkles,
  merge: GitMerge,
} as const satisfies Record<string, LucideIcon>;

export type DsIconName = keyof typeof DS_ICONS;
