/**
 * Server state (blueprint §12).
 *
 * One key factory, WS-invalidated, **no polling**. Terminal data goes
 * `staleTime: Infinity` — a finished run's report cannot change, so refetching
 * it is pure waste.
 *
 * The division of labour: a frame says *what changed*, REST says *what it is
 * now*. When a frame lands for an agent, the queries that agent feeds are
 * invalidated; state is never rebuilt client-side from a frame payload.
 */

import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { ApiError, V2_ENDPOINTS, v2Fetch, v2FetchText } from "./endpoints";
import type {
  AgentEntry,
  Capability,
  ChatResponse,
  ContextPackage,
  GraphExport,
  Hotspot,
  KnowledgeMetrics,
  PatchBundle,
  QueryResponse,
  RepairPlan,
  RiskEntry,
  RepairAttemptsResponse,
  RepositoryEntry,
  RunHeader,
  StagesResponse,
} from "./types";

/** Query key factory. Every V2 key starts with `v2` so it can be cleared wholesale. */
export const qk = {
  all: ["v2"] as const,
  run: (runId: string) => ["v2", "run", runId] as const,
  agents: (runId: string) => ["v2", "run", runId, "agents"] as const,
  stages: (runId: string) => ["v2", "run", runId, "stages"] as const,
  summary: (runId: string) => ["v2", "run", runId, "summary"] as const,
  report: (runId: string) => ["v2", "run", runId, "report"] as const,
  attempts: (runId: string) => ["v2", "run", runId, "attempts"] as const,
  context: (runId: string) => ["v2", "run", runId, "context"] as const,
  plan: (runId: string) => ["v2", "run", runId, "plan"] as const,
  patch: (runId: string) => ["v2", "run", runId, "patch"] as const,
  repositories: () => ["v2", "repositories"] as const,

  kgMetrics: (runId: string) => ["v2", "kg", runId, "metrics"] as const,
  kgView: (runId: string, view: string) => ["v2", "kg", runId, "view", view] as const,
  kgRisk: (runId: string) => ["v2", "kg", runId, "risk"] as const,
  kgHotspots: (runId: string) => ["v2", "kg", runId, "hotspots"] as const,
  kgCapabilities: (runId: string) => ["v2", "kg", runId, "capabilities"] as const,

  secTimeline: (runId: string) => ["v2", "security", runId, "timeline"] as const,
  secAudit: (runId: string) => ["v2", "security", runId, "audit"] as const,

  learnRepo: (repositoryId: string) => ["v2", "learning", "repo", repositoryId] as const,
} as const;

/* -------------------------------------------------------------------------
   Options
   ---------------------------------------------------------------------- */

/**
 * Live data is invalidated by frames, never polled. `staleTime: Infinity` plus
 * WS invalidation is strictly better than an interval: it updates sooner and
 * costs nothing while idle.
 */
const LIVE = { staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 } as const;

export function runQuery(runId: string) {
  return queryOptions({
    queryKey: qk.run(runId),
    queryFn: () => v2Fetch<RunHeader>(V2_ENDPOINTS.run(runId)),
    ...LIVE,
  });
}

export function agentsQuery(runId: string) {
  return queryOptions({
    queryKey: qk.agents(runId),
    queryFn: () => v2Fetch<AgentEntry[]>(V2_ENDPOINTS.runAgents(runId)),
    ...LIVE,
  });
}

export function stagesQuery(runId: string) {
  return queryOptions({
    queryKey: qk.stages(runId),
    queryFn: () => v2Fetch<StagesResponse>(V2_ENDPOINTS.runStages(runId)),
    ...LIVE,
  });
}

export function attemptsQuery(runId: string) {
  return queryOptions({
    queryKey: qk.attempts(runId),
    queryFn: () => v2Fetch<RepairAttemptsResponse>(V2_ENDPOINTS.runAttempts(runId)),
    ...LIVE,
  });
}

export function repositoriesQuery() {
  return queryOptions({
    queryKey: qk.repositories(),
    queryFn: () => v2Fetch<RepositoryEntry[]>(V2_ENDPOINTS.repositories()),
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * The context package. A 404 is a *fact* — A5.5 has not produced one — so it
 * resolves to `null` rather than throwing into an error state. Any other
 * failure is a real error and propagates.
 */
export function contextQuery(runId: string) {
  return queryOptions({
    queryKey: qk.context(runId),
    queryFn: async () => {
      try {
        return await v2Fetch<ContextPackage>(V2_ENDPOINTS.runContext(runId));
      } catch (error) {
        if (error instanceof ApiError && error.isNotFound) return null;
        throw error;
      }
    },
    ...LIVE,
  });
}

/**
 * The repair plan. Same contract as `contextQuery`: a 404 means A6 has not
 * planned yet — a fact the panels state — while anything else is a real error.
 */
export function planQuery(runId: string) {
  return queryOptions({
    queryKey: qk.plan(runId),
    queryFn: async () => {
      try {
        return await v2Fetch<RepairPlan>(V2_ENDPOINTS.runPlan(runId));
      } catch (error) {
        if (error instanceof ApiError && error.isNotFound) return null;
        throw error;
      }
    },
    ...LIVE,
  });
}

/**
 * The patch bundle. Same 404-is-a-fact contract as `contextQuery`.
 *
 * Note the `null` here means "A7 has not completed"; a bundle whose `patches`
 * array is empty is a *different* answer the panels state differently, so the
 * two must not be collapsed into one falsy check downstream.
 */
export function patchQuery(runId: string) {
  return queryOptions({
    queryKey: qk.patch(runId),
    queryFn: async () => {
      try {
        return await v2Fetch<PatchBundle>(V2_ENDPOINTS.runPatch(runId));
      } catch (error) {
        if (error instanceof ApiError && error.isNotFound) return null;
        throw error;
      }
    },
    ...LIVE,
  });
}

/* -------------------------------------------------------------------------
   Knowledge graph
   ---------------------------------------------------------------------- */

export function kgMetricsQuery(runId: string) {
  return queryOptions({
    queryKey: qk.kgMetrics(runId),
    queryFn: () => v2Fetch<KnowledgeMetrics>(V2_ENDPOINTS.kgMetrics(runId)),
    ...LIVE,
  });
}

export function kgRiskQuery(runId: string) {
  return queryOptions({
    queryKey: qk.kgRisk(runId),
    queryFn: () => v2Fetch<RiskEntry[]>(V2_ENDPOINTS.kgRisk(runId)),
    ...LIVE,
  });
}

export function kgHotspotsQuery(runId: string) {
  return queryOptions({
    queryKey: qk.kgHotspots(runId),
    queryFn: () => v2Fetch<Hotspot[]>(V2_ENDPOINTS.kgHotspots(runId)),
    ...LIVE,
  });
}

export function kgCapabilitiesQuery(runId: string) {
  return queryOptions({
    queryKey: qk.kgCapabilities(runId),
    queryFn: () => v2Fetch<Capability[]>(V2_ENDPOINTS.kgCapabilities(runId)),
    ...LIVE,
  });
}

/**
 * A graph view.
 *
 * The export route is declared `response_class=PlainTextResponse` (G3), so the
 * body is JSON served with a text content type and the client parses it. That
 * is a cosmetic backend wrinkle, handled once here rather than at every call
 * site.
 */
export function kgViewQuery(runId: string, view: string, maxNodes = 300) {
  return queryOptions({
    queryKey: qk.kgView(runId, view),
    queryFn: async () => {
      const text = await v2FetchText(V2_ENDPOINTS.kgExport(runId, view, maxNodes));
      return JSON.parse(text) as GraphExport;
    },
    ...LIVE,
  });
}

/**
 * One named graph query — server-side traversal through the existing engine.
 * The client never indexes the repository itself.
 */
export async function runNamedQuery(
  runId: string,
  name: string,
  params: { file?: string; qualname?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<QueryResponse> {
  const search = new URLSearchParams();
  if (params.file) search.set("file", params.file);
  if (params.qualname) search.set("qualname", params.qualname);
  if (params.limit) search.set("limit", String(params.limit));
  const suffix = search.toString();

  return v2Fetch<QueryResponse>(
    `${V2_ENDPOINTS.kgQuery(runId, name)}${suffix ? `?${suffix}` : ""}`,
    { signal },
  );
}

/* -------------------------------------------------------------------------
   Learning
   ---------------------------------------------------------------------- */

/**
 * The learned profile for a repository, or `null` when none exists yet.
 *
 * A 404 here is a fact the backend states plainly ("no profile learned for X
 * yet"), not a failure — the UI renders `Unavailable` with that reason rather
 * than an error.
 */
export function learnRepoQuery(repositoryId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.learnRepo(repositoryId ?? "none"),
    enabled: Boolean(repositoryId),
    queryFn: async () => {
      try {
        return await v2Fetch<Record<string, unknown>>(
          V2_ENDPOINTS.learnRepo(repositoryId as string),
        );
      } catch (error) {
        if (error instanceof ApiError && error.isNotFound) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: 1,
  });
}

export async function sendChat(runId: string, question: string): Promise<ChatResponse> {
  return v2Fetch<ChatResponse>(V2_ENDPOINTS.runChat(runId), {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

/* -------------------------------------------------------------------------
   Frame → query invalidation (blueprint §12, "the bridge")
   ---------------------------------------------------------------------- */

/**
 * Which queries a batch of agents' frames make stale.
 *
 * **Takes the whole batch, not one agent.** The previous signature took a
 * single `agentId` and callers looped over the pending set — but the run-scoped
 * invalidations here (header, agent list, stage roll-up) do not depend on which
 * agent reported, so a batch of twelve agents issued twelve identical
 * invalidations of the same three keys. Measured on one page load of a finished
 * run, that produced 153 requests each to `/agents` and `/stages`, 112 to
 * `/attempts` and 82 to `/context` — roughly 580 requests to render a run whose
 * data cannot change.
 *
 * Accepting the batch makes the correct behaviour the only expressible one:
 * run-scoped keys are invalidated once, agent-specific keys at most once each.
 */
export function invalidateForFrames(
  queryClient: QueryClient,
  runId: string,
  agentIds: Iterable<string>,
): void {
  const agents = new Set(agentIds);
  if (agents.size === 0) return;

  // Agent-independent: any frame changes these, so once per batch is right.
  void queryClient.invalidateQueries({ queryKey: qk.agents(runId) });
  void queryClient.invalidateQueries({ queryKey: qk.stages(runId) });
  void queryClient.invalidateQueries({ queryKey: qk.run(runId) });

  if (agents.has("A7") || agents.has("A8")) {
    void queryClient.invalidateQueries({ queryKey: qk.attempts(runId) });
  }
  if (agents.has("A7")) {
    void queryClient.invalidateQueries({ queryKey: qk.patch(runId) });
  }
  if (agents.has("A5.5")) {
    void queryClient.invalidateQueries({ queryKey: qk.context(runId) });
  }
  if (agents.has("A6")) {
    void queryClient.invalidateQueries({ queryKey: qk.plan(runId) });
  }
}

/** Everything a terminal run publishes settles at once. */
export function invalidateOnTerminal(queryClient: QueryClient, runId: string): void {
  void queryClient.invalidateQueries({ queryKey: qk.run(runId) });
  void queryClient.invalidateQueries({ queryKey: qk.agents(runId) });
  void queryClient.invalidateQueries({ queryKey: qk.stages(runId) });
  void queryClient.invalidateQueries({ queryKey: qk.attempts(runId) });
  void queryClient.invalidateQueries({ queryKey: qk.report(runId) });
  void queryClient.invalidateQueries({ queryKey: qk.summary(runId) });
}
