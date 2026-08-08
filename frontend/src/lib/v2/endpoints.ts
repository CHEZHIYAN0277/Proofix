/**
 * Endpoint registry for Workspace V2 (blueprint §15).
 *
 * Every backend path the V2 surface touches lives here. V1's `lib/api.ts`
 * registry is left alone — this one carries the routes V1 never learned about
 * (`/stages`, `/context`, knowledge, security, learning) and the `surface=v2`
 * parameter that asks the backend for the full pipeline rather than the eleven
 * cards V1 has renderers for.
 */

import { API_BASE_URL } from "@/lib/api";

const enc = encodeURIComponent;

export const V2_ENDPOINTS = {
  /* --- run scope ------------------------------------------------------- */
  runs: () => `/api/runs`,
  run: (runId: string) => `/api/runs/${enc(runId)}`,
  /** `surface=v2` publishes A0.5 and A5.5 alongside A1–A10. */
  runAgents: (runId: string) => `/api/runs/${enc(runId)}/agents?surface=v2`,
  runStages: (runId: string) => `/api/runs/${enc(runId)}/stages?surface=v2`,
  runEvents: (runId: string) => `/api/runs/${enc(runId)}/events`,
  runSummary: (runId: string) => `/api/runs/${enc(runId)}/summary`,
  runReport: (runId: string) => `/api/runs/${enc(runId)}/report`,
  runAttempts: (runId: string) => `/api/runs/${enc(runId)}/attempts`,
  /** 404 until A5.5 emits — the UI renders `Pending`, never a substitute. */
  runContext: (runId: string) => `/api/runs/${enc(runId)}/context`,
  /** A6's full DAG. 404 until it completes, same contract as `/context`. */
  runPlan: (runId: string) => `/api/runs/${enc(runId)}/plan`,
  /** A7's full bundle — both sides of every file. 404 until it completes. */
  runPatch: (runId: string) => `/api/runs/${enc(runId)}/patch`,
  runChat: (runId: string) => `/api/runs/${enc(runId)}/chat`,

  /* --- repositories ---------------------------------------------------- */
  repositories: () => `/api/repositories`,

  /* --- knowledge graph (Phase 2+) -------------------------------------- */
  kgMetrics: (runId: string) => `/api/knowledge/${enc(runId)}/metrics`,
  kgExport: (runId: string, view: string, maxNodes = 300) =>
    `/api/knowledge/${enc(runId)}/export/${enc(view)}?fmt=json&max_nodes=${maxNodes}`,
  kgCapabilities: (runId: string) => `/api/knowledge/${enc(runId)}/capabilities`,
  kgRisk: (runId: string) => `/api/knowledge/${enc(runId)}/risk`,
  kgHotspots: (runId: string) => `/api/knowledge/${enc(runId)}/hotspots`,
  kgQuery: (runId: string, name: string) => `/api/knowledge/${enc(runId)}/query/${enc(name)}`,

  /* --- security (run scope blocked by G9) ------------------------------ */
  secTimeline: (runId: string) => `/api/security/timeline?run_id=${enc(runId)}`,
  secAudit: (runId: string) => `/api/security/audit/summary?run_id=${enc(runId)}`,

  /* --- learning (repository scope) ------------------------------------- */
  learnRepo: (repositoryId: string) => `/api/learning/repositories/${enc(repositoryId)}`,
} as const;

/**
 * WebSocket URL for a run's live timeline.
 *
 * Built from `API_BASE_URL` when one is configured, otherwise the page origin
 * so the Vite dev proxy carries it on a single origin and CORS never applies.
 */
export function runSocketUrl(runId: string): string {
  const base = API_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");
  const url = new URL(`/ws/runs/${enc(runId)}`, base || "http://127.0.0.1:8000");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** Raised when a request fails, carrying enough to render an honest error. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** A 404 is often a fact ("not produced yet"), not a failure. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Fetch a body the backend serves as text.
 *
 * `GET /knowledge/{id}/export/{view}` is declared `PlainTextResponse` even for
 * `fmt=json` (gap G3), so `response.json()` on it depends on the browser being
 * lenient about the content type. Reading text and parsing explicitly does not.
 */
export async function v2FetchText(endpoint: string, init?: RequestInit): Promise<string> {
  const url = /^https?:/i.test(endpoint) ? endpoint : `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new ApiError(`${response.status} ${response.statusText}`, response.status, endpoint);
  }
  return response.text();
}

export async function v2Fetch<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const url = /^https?:/i.test(endpoint) ? endpoint : `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new ApiError(`${response.status} ${response.statusText}`, response.status, endpoint);
  }

  return (await response.json()) as T;
}
