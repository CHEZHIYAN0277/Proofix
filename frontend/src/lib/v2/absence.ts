/**
 * Backend absence sentinels, normalised at the boundary.
 *
 * The projection layer formats for display before the client sees it, and it
 * spells "there is no value here" as an em dash: `repo_branch` returns `"—"`
 * when `.git/HEAD` cannot be read, `_agent_duration` returns `"—"` when it
 * measured no span, and several evidence fields do the same.
 *
 * To a `<DataBoundary>` that is a perfectly good string, so the em dash would
 * render as though it were data — the component would faithfully display the
 * backend's way of saying nothing, and the `Waiting` / `Unavailable` states
 * that exist for exactly this case would never fire.
 *
 * Normalising once, here, means every consumer sees `null` and the primary
 * rule works as designed. This belongs at the edge and nowhere else: a
 * component that special-cases `"—"` is a component that has to remember to.
 */

/** Values the backend uses to mean "no value". */
const SENTINELS = new Set(["—", "-", "–", "not measured", "not scored", "n/a"]);

/** `null` when the backend's string means absence, the string otherwise. */
export function orNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return SENTINELS.has(trimmed.toLowerCase()) ? null : value;
}
