/**
 * `<QueryBoundary>` — the missing half of the primary rule.
 *
 * `<DataBoundary>` answers "the backend published nothing here". It cannot
 * answer "the request to the backend *failed*", because by the time a value
 * reaches it a failed query and an empty one look identical: both are
 * `undefined`.
 *
 * That gap was systemic. Of the twenty-five V2 components calling `useQuery`,
 * three read the query's error and twenty-two did not — so most backend
 * failures (a 500, a dropped connection, a knowledge graph that was never
 * built) rendered as `Pending`. "Waiting for data" and "the server returned an
 * error" are opposite facts, and the product told the user the reassuring one.
 *
 * The three that did handle errors each did it differently, inline. This
 * replaces all of them: one mechanism, so the answer cannot drift per panel.
 *
 * This boundary makes the distinction structural rather than remembered:
 *
 *   loading  → skeleton, labelled with what is being fetched
 *   404      → `Unavailable`, because a 404 here is usually a *fact* ("A5.5
 *              produced no package") rather than a fault. Callers that mean
 *              something else pass `notFoundIsError`.
 *   error    → `<ErrorState>` naming the stage, the agent, the status, the
 *              endpoint, and offering retry. Never a dead end (§4).
 *   data     → `children(data)`
 *
 * It deliberately does **not** treat an empty array or object as missing —
 * that is `<DataBoundary>`'s judgement, and stacking the two keeps "the request
 * failed" and "the answer was empty" as separate sentences.
 */

import type { ReactNode } from "react";

import { ApiError } from "@/lib/v2/endpoints";
import { DataState } from "./DataState";
import { ErrorState } from "./ErrorState";
import { SkeletonText } from "./Skeleton";

/** The slice of TanStack Query's result this needs. Structural, so any
 *  `UseQueryResult` satisfies it without importing the generic. */
export interface QueryLike<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch?: () => unknown;
}

export interface QueryBoundaryProps<T> {
  query: QueryLike<T>;
  /**
   * What is being loaded, as a noun phrase: "the knowledge graph metrics".
   * Used verbatim in both the skeleton's screen-reader label and the error
   * copy, so the two always agree.
   */
  label: string;
  /** Which stage this data belongs to — §4 requires failures to name it. */
  stage?: string;
  /** Which agent produces it, e.g. `A5.5`. */
  agent?: string;
  /** What the user can do about it. Shown when the failure is actionable. */
  suggestion?: ReactNode;
  /**
   * Treat 404 as a failure rather than a fact. Off by default: most V2
   * endpoints 404 to mean "this stage has not produced its artifact", which is
   * `Unavailable`, not an error.
   */
  notFoundIsError?: boolean;
  /** Why a 404 means "nothing here", in the backend's terms. */
  notFoundReason?: string;
  skeletonLines?: number;
  size?: "sm" | "md";
  children: (data: T) => ReactNode;
}

/** Pull status + endpoint off an `ApiError`; degrade honestly for anything else. */
function describe(error: unknown): {
  status: number | null;
  endpoint: string | null;
  message: string;
} {
  if (error instanceof ApiError) {
    return { status: error.status, endpoint: error.endpoint, message: error.message };
  }
  if (error instanceof Error) {
    // A fetch that never reached the server (backend down, DNS, CORS) throws a
    // TypeError with a terse message. Say the useful thing instead.
    const offline = error.name === "TypeError";
    return {
      status: null,
      endpoint: null,
      message: offline ? "The request never reached the backend." : error.message,
    };
  }
  return { status: null, endpoint: null, message: String(error) };
}

export function QueryBoundary<T>({
  query,
  label,
  stage,
  agent,
  suggestion,
  notFoundIsError = false,
  notFoundReason,
  skeletonLines = 3,
  size = "sm",
  children,
}: QueryBoundaryProps<T>) {
  if (query.isLoading) {
    return <SkeletonText lines={skeletonLines} label={`Loading ${label}`} />;
  }

  if (query.isError) {
    const { status, endpoint, message } = describe(query.error);

    if (status === 404 && !notFoundIsError) {
      return (
        <DataState
          kind="unavailable"
          reason={notFoundReason ?? `The backend has not produced ${label} for this run.`}
          size={size}
        />
      );
    }

    // Who failed, in the pipeline's own vocabulary — so the message is
    // actionable rather than merely apologetic.
    const who = [stage, agent].filter(Boolean).join(" · ");
    const unreachable = status === null && endpoint === null;

    return (
      <ErrorState
        size={size}
        title={`Could not load ${label}`}
        detail={
          <span className="flex flex-col gap-1">
            <span>
              {who ? `${who} — ` : ""}
              {message}
            </span>
            {suggestion ? (
              <span>{suggestion}</span>
            ) : unreachable ? (
              <span>
                The backend may be restarting. This panel recovers on its own once it responds.
              </span>
            ) : null}
          </span>
        }
        source={endpoint ? `${status ?? ""} ${endpoint}`.trim() : undefined}
        onRetry={query.refetch ? () => void query.refetch?.() : undefined}
      />
    );
  }

  if (query.data === undefined) {
    // Not loading, not an error, no data: a disabled or idle query. That is an
    // absence, and absences are `DataBoundary`'s vocabulary, not an error's.
    return <DataState kind="waiting" reason={`Nothing has requested ${label} yet.`} size={size} />;
  }

  return <>{children(query.data)}</>;
}
