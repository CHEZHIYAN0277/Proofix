/**
 * Framework detection — from the learned repository profile.
 *
 * Source: `GET /api/learning/repositories/{repository_id}` → `framework_profile`.
 *
 * This is the blueprint's designated demonstration of honest absence. Learning
 * is repository-scoped and opt-in, and the backend answers a repository it has
 * never learned with a 404 whose body says so outright: *"no profile learned
 * for X yet"*. That string is carried straight through to the reader.
 *
 * The two absences are kept distinct, because they mean different things:
 *   - no `repository_id` on the run → the run cannot be tied to a profile;
 *   - a `repository_id` with no profile → learning has not run for it yet.
 */

import { useQuery } from "@tanstack/react-query";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { DataState } from "@/design/states/DataState";
import { SkeletonText } from "@/design/states/Skeleton";
import { learnRepoQuery, runQuery } from "@/lib/v2/queries";
import { useRunId } from "../../RunProvider";

interface FrameworkProfile {
  frameworks?: unknown;
  [key: string]: unknown;
}

export function FrameworkDetection() {
  const runId = useRunId();
  const run = useQuery(runQuery(runId));
  const repositoryId = run.data?.repositoryId ?? null;
  const profile = useQuery(learnRepoQuery(repositoryId));

  if (run.isLoading) return <SkeletonText lines={2} label="Loading framework profile" />;

  if (!repositoryId) {
    return (
      <DataState
        kind="unavailable"
        reason="This run publishes no repository_id, so no learned profile can be resolved"
        size="sm"
      />
    );
  }

  if (profile.isLoading) return <SkeletonText lines={2} label="Loading framework profile" />;

  // `null` is the resolved 404: the endpoint answered, and its answer is that
  // nothing has been learned. That is a fact, not a failure.
  if (profile.data === null) {
    return (
      <DataState
        kind="unavailable"
        reason={`No profile learned for ${repositoryId} yet — framework detection requires a completed learning pass`}
        size="sm"
      />
    );
  }

  const frameworks = readFrameworks((profile.data ?? {}) as FrameworkProfile);

  return (
    <DataBoundary
      value={frameworks.length > 0 ? frameworks : null}
      whenMissing="unavailable"
      emptyIsMissing
      reason="The learned profile records no frameworks for this repository"
    >
      {(names) => (
        <ul className="flex flex-wrap gap-1.5">
          {names.map((name) => (
            <li
              key={name}
              className="type-mono-sm rounded-full border border-border bg-surface-muted px-2 py-0.5 text-ink"
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </DataBoundary>
  );
}

/**
 * The profile's shape is not pinned by a published schema yet, so the frameworks
 * are read defensively — a list of strings, a list of objects with a `name`, or
 * a map of name → detail. An unrecognised shape yields nothing rather than a
 * guess rendered as a detection.
 */
function readFrameworks(profile: FrameworkProfile): string[] {
  const raw =
    (profile.framework_profile as { frameworks?: unknown } | undefined)?.frameworks ??
    profile.frameworks;

  if (Array.isArray(raw)) {
    return raw
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : typeof entry === "object" && entry !== null
            ? String((entry as { name?: unknown }).name ?? "")
            : "",
      )
      .filter(Boolean);
  }

  if (raw && typeof raw === "object") return Object.keys(raw as Record<string, unknown>);

  return [];
}
