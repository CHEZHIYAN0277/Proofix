/**
 * Run service — single seam between UI and data source.
 *
 * Today every function returns the bundled mock fixture. To swap to a real
 * backend, set VITE_DATA_SOURCE=api in .env. No UI component should ever
 * need to change.
 */
import { DATA_SOURCE, ENDPOINTS, apiFetch, isStatus } from "./api";
import {
  createMockEventSource,
  type EventSourceFactory,
} from "@/components/proofix/mockEventStream";
import { createLiveEventSource } from "@/components/proofix/liveEventStream";
import {
  MOCK_REPOSITORIES,
  MOCK_RUN_REPORT,
  MOCK_WORKSPACE_HEADER,
  MOCK_EXECUTIVE_SUMMARY,
  MOCK_REPAIR_ATTEMPTS,
  AGENTS,
  type RunReportModel,
  type WorkspaceHeaderModel,
  type ExecutiveSummaryModel,
  type RepairAttemptsModel,
  type RepoMetadata,
  type ContextPackageModel,
  type PatchBundleModel,
} from "@/mocks";
import type { SidebarRepo } from "@/components/proofix/Sidebar";
import type { AgentEntry } from "@/components/proofix/data";

/** True when the UI is talking to a real backend rather than fixtures. */
export const isLive = DATA_SOURCE === "api";

/**
 * Start a pipeline run. Accepts a GitHub URL or a local repository path —
 * the backend resolves either.
 */
export async function createRun(target: string): Promise<string> {
  if (DATA_SOURCE === "api") {
    const { run_id } = await apiFetch<{ run_id: string }>(ENDPOINTS.runs(), {
      method: "POST",
      json: { url: target, repo_path: target },
    });
    return run_id;
  }
  return `run-${Date.now()}`;
}

/**
 * Event source for the execution journal: the backend WebSocket when live,
 * the bundled timing mock otherwise.
 */
export function eventSourceFor(runId: string): EventSourceFactory {
  return DATA_SOURCE === "api" ? createLiveEventSource(runId) : createMockEventSource;
}

/** Parse a GitHub URL into owner/name. Pure client-side gating only. */
export function parseGithubUrl(raw: string): { owner: string; name: string } | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (!u.hostname.includes("github.com")) return null;
    const [owner, repoRaw] = u.pathname.split("/").filter(Boolean);
    if (!owner || !repoRaw) return null;
    return { owner, name: repoRaw.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

export async function listRepositories(): Promise<SidebarRepo[]> {
  if (DATA_SOURCE === "api") {
    return apiFetch<SidebarRepo[]>(ENDPOINTS.repositories());
  }
  return MOCK_REPOSITORIES;
}

export async function getRunReport(runId: string): Promise<RunReportModel> {
  if (DATA_SOURCE === "api") {
    return apiFetch<RunReportModel>(ENDPOINTS.runReport(runId));
  }
  return MOCK_RUN_REPORT;
}

export async function getWorkspaceHeader(runId: string): Promise<WorkspaceHeaderModel> {
  if (DATA_SOURCE === "api") {
    return apiFetch<WorkspaceHeaderModel>(ENDPOINTS.run(runId));
  }
  return MOCK_WORKSPACE_HEADER;
}

export async function getExecutiveSummary(runId: string): Promise<ExecutiveSummaryModel> {
  if (DATA_SOURCE === "api") {
    return apiFetch<ExecutiveSummaryModel>(ENDPOINTS.runSummary(runId));
  }
  return MOCK_EXECUTIVE_SUMMARY;
}

export async function getRunAgents(runId: string): Promise<AgentEntry[]> {
  if (DATA_SOURCE === "api") {
    return apiFetch<AgentEntry[]>(ENDPOINTS.runAgents(runId));
  }
  return AGENTS;
}

export async function getRepairAttempts(runId: string): Promise<RepairAttemptsModel> {
  if (DATA_SOURCE === "api") {
    return apiFetch<RepairAttemptsModel>(ENDPOINTS.retryAttempts(runId));
  }
  return MOCK_REPAIR_ATTEMPTS;
}

/**
 * A5.5's context package, or `null` when the stage has not produced one.
 *
 * The endpoint 404s until A5.5 completes and resolves a target, and that 404 is
 * an answer, not a failure — "no package yet", which the caller renders as
 * absence. Every other status still rejects, so a real outage is still an
 * outage. Collapsing the two would put "Could not load. Retry" on screen for a
 * stage that simply had not run, which is the same class of lie as rendering a
 * failed fetch as an empty one (B-F01).
 *
 * Mock mode has no fixture: inventing a ranking and a redaction list would put
 * fabricated privacy evidence on screen, which is the one thing this card
 * exists to make trustworthy.
 */
export async function getRunContext(runId: string): Promise<ContextPackageModel | null> {
  if (DATA_SOURCE !== "api") return null;
  try {
    return await apiFetch<ContextPackageModel>(ENDPOINTS.runContext(runId));
  } catch (reason) {
    if (isStatus(reason, 404)) return null;
    throw reason;
  }
}

/**
 * A7's patch bundle, or `null` when it produced none.
 *
 * Same 404-is-an-answer contract as `getRunContext`. Unlike the context
 * package this is *not* write-once: A7 regenerates on every validation retry,
 * so the bundle genuinely changes while a run is in flight.
 */
export async function getRunPatch(runId: string): Promise<PatchBundleModel | null> {
  if (DATA_SOURCE !== "api") return null;
  try {
    return await apiFetch<PatchBundleModel>(ENDPOINTS.runPatch(runId));
  } catch (reason) {
    if (isStatus(reason, 404)) return null;
    throw reason;
  }
}

/**
 * Validate a repository URL. The frontend never talks to GitHub directly —
 * this goes through the ProoFix backend, which performs auth, rate-limiting
 * and metadata enrichment server-side.
 */
export async function validateRepository(url: string): Promise<RepoMetadata | null> {
  if (DATA_SOURCE === "api") {
    try {
      return await apiFetch<RepoMetadata>(ENDPOINTS.repoValidate(), {
        method: "POST",
        json: { url },
      });
    } catch {
      return null;
    }
  }
  // Mock: synthesise metadata from the URL without any network call.
  const parsed = parseGithubUrl(url);
  if (!parsed) return null;
  return {
    owner: parsed.owner,
    name: parsed.name,
    language: null,
    branch: "main",
    visibility: "Public",
    htmlUrl: `https://github.com/${parsed.owner}/${parsed.name}`,
  };
}

export async function askChat(runId: string, question: string): Promise<string> {
  if (DATA_SOURCE === "api") {
    const { answer } = await apiFetch<{ answer: string }>(ENDPOINTS.runChat(runId), {
      method: "POST",
      json: { question },
    });
    return answer;
  }
  const { mockAnswerer } = await import("@/mocks/chat");
  return mockAnswerer(question);
}
