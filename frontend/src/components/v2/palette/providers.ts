/**
 * Command palette provider registry (blueprint §7.1).
 *
 * A **provider registry, not a switch statement.** Each provider declares
 * `{ id, title, icon, scope, search(query) → Action[], keywords }`; the palette
 * composes them and ranks the results. A new surface registers a provider
 * instead of editing the palette.
 *
 * Phase 1 ships the four providers whose data needs no new endpoint: Stage,
 * Agent, Theme and Settings. Search File / Function / Graph / Evidence arrive
 * in Phases 2–3 against the named-query engine — all symbol search is
 * server-side traversal; the client never indexes the repository itself.
 */

import type { LucideIcon } from "lucide-react";

export type ActionKind = "navigate" | "command" | "toggle";

export interface PaletteAction {
  id: string;
  kind: ActionKind;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** Extra text matched against the query but not displayed. */
  keywords?: string;
  /** Route for `navigate` actions — enables ⌘⏎ "open in new tab". */
  href?: string;
  perform: () => void;
}

export interface PaletteProvider {
  id: string;
  title: string;
  icon?: LucideIcon;
  scope: "run" | "global";
  /** Lower sorts first when scores tie. */
  priority: number;
  keywords?: string;
  search: (query: string) => PaletteAction[] | Promise<PaletteAction[]>;
}

export interface RankedGroup {
  provider: PaletteProvider;
  actions: PaletteAction[];
}

/**
 * Ranking: exact prefix → recency → provider priority → fuzzy (blueprint §7.2).
 *
 * Scores are compared within one list so a strong match from a low-priority
 * provider still outranks a weak match from a high-priority one.
 */
export function scoreAction(
  action: PaletteAction,
  query: string,
  provider: PaletteProvider,
  recency: string[],
): number | null {
  const q = query.trim().toLowerCase();
  const haystack =
    `${action.title} ${action.subtitle ?? ""} ${action.keywords ?? ""}`.toLowerCase();
  const title = action.title.toLowerCase();

  // `null` means "no match", which is a different thing from a low score.
  // Conflating the two dropped every provider with a non-zero priority: with
  // no query typed, the priority penalty alone pushed its actions below the
  // cutoff, so the palette opened showing one group instead of four.
  if (q && !fuzzyMatch(haystack, q)) return null;

  let score = 0;
  if (q) {
    if (title === q) score += 1000;
    else if (title.startsWith(q)) score += 600;
    else if (title.includes(q)) score += 300;
    else if (haystack.includes(q)) score += 150;
    else score += 50; // fuzzy only
  }

  const recentIndex = recency.indexOf(action.id);
  if (recentIndex >= 0) score += Math.max(0, 120 - recentIndex * 20);

  score -= provider.priority * 10;
  return score;
}

/** Subsequence match — every query character appears in order. */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

const RECENCY_KEY = "proofix.v2.palette.recent";
const RECENCY_CAP = 8;

export function readRecency(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENCY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function recordRecency(actionId: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = [actionId, ...readRecency().filter((id) => id !== actionId)].slice(0, RECENCY_CAP);
    window.localStorage.setItem(RECENCY_KEY, JSON.stringify(next));
  } catch {
    /* storage can be blocked; ranking simply loses its recency term */
  }
}
