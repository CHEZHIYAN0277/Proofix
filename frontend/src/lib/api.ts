/**
 * Centralized API configuration.
 *
 * Reads from Vite env so a single env change swaps every screen from the
 * bundled mock data source to a real backend. No hardcoded localhost URLs.
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export type DataSource = "mock" | "api";

export const DATA_SOURCE: DataSource =
  ((import.meta.env.VITE_DATA_SOURCE as string | undefined) ?? "mock") === "api"
    ? "api"
    : "mock";

/**
 * Endpoint registry. Keep every backend path in one place so swapping the
 * backend never requires hunting through component files.
 */
export const ENDPOINTS = {
  repositories: () => `/api/repositories`,
  repoValidate: () => `/api/repositories/validate`,
  runs: () => `/api/runs`,
  run: (runId: string) => `/api/runs/${encodeURIComponent(runId)}`,
  runEvents: (runId: string) => `/api/runs/${encodeURIComponent(runId)}/events`,
  runChat: (runId: string) => `/api/runs/${encodeURIComponent(runId)}/chat`,
  runReport: (runId: string) => `/api/runs/${encodeURIComponent(runId)}/report`,
  runAgents: (runId: string) => `/api/runs/${encodeURIComponent(runId)}/agents`,
  runSummary: (runId: string) => `/api/runs/${encodeURIComponent(runId)}/summary`,
  retryAttempts: (runId: string) =>
    `/api/runs/${encodeURIComponent(runId)}/attempts`,
} as const;

export interface FetcherOptions extends RequestInit {
  /** Optional path under API_BASE_URL. If `url` is absolute it is used as-is. */
  json?: unknown;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: FetcherOptions = {},
): Promise<T> {
  const { json, headers, ...rest } = options;
  const full = /^https?:/i.test(url) ? url : `${API_BASE_URL}${url}`;
  const response = await fetch(full, {
    ...rest,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}
