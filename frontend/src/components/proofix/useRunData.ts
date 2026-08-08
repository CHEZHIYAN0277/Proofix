/**
 * Fetches every view model for a run through the `runService` seam.
 *
 * In mock mode the service returns fixtures synchronously, so the workspace
 * renders identically with no backend running. In API mode the models are
 * polled while the run is live so header, summary and report stay current as
 * agents progress.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  getExecutiveSummary,
  getRepairAttempts,
  getRunAgents,
  getRunReport,
  getWorkspaceHeader,
  isLive,
  listRepositories,
} from "@/lib/runService";
import type { AgentEntry } from "./data";
import type { SidebarRepo } from "./Sidebar";
import {
  EMPTY_AGENTS,
  EMPTY_EXECUTIVE_SUMMARY,
  EMPTY_REPAIR_ATTEMPTS,
  EMPTY_RUN_REPORT,
  EMPTY_WORKSPACE_HEADER,
} from "./emptyModels";
import {
  AGENTS as MOCK_AGENTS,
  MOCK_EXECUTIVE_SUMMARY,
  MOCK_REPAIR_ATTEMPTS,
  MOCK_REPOSITORIES,
  MOCK_RUN_REPORT,
  MOCK_WORKSPACE_HEADER,
  type ExecutiveSummaryModel,
  type RepairAttemptsModel,
  type RunReportModel,
  type WorkspaceHeaderModel,
} from "@/mocks";

const POLL_INTERVAL_MS = 2500;

/** Fixture run id — requesting it from a real backend would always 404. */
const MOCK_RUN_ID = "vulnapi-live";

/**
 * Replace state only when the payload actually changed.
 *
 * Each poll deserialises a fresh object, so a plain `setAgents` would hand the
 * execution journal a new array identity every 2.5s. `useExecutionRun`
 * re-subscribes its event source whenever `agents` changes, which would tear
 * down and replay the live stream mid-animation. Comparing by value keeps the
 * identity stable across polls that returned identical data.
 */
function setIfChanged<T>(setter: Dispatch<SetStateAction<T>>, next: T) {
  setter((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
}

export interface RunData {
  agents: AgentEntry[];
  header: WorkspaceHeaderModel;
  summary: ExecutiveSummaryModel;
  report: RunReportModel;
  attempts: RepairAttemptsModel;
  repositories: SidebarRepo[];
  setRepositories: (next: SidebarRepo[] | ((prev: SidebarRepo[]) => SidebarRepo[])) => void;
  /** Re-fetch the sidebar from the backend, e.g. after starting a run. */
  refreshRepositories: () => void;
  loading: boolean;
}

export function useRunData(runId: string, done: boolean): RunData {
  // Live mode starts blank: every value on screen must have come from the
  // backend. Mock mode starts from the fixtures, which are the whole point.
  const [agents, setAgents] = useState<AgentEntry[]>(isLive ? EMPTY_AGENTS : MOCK_AGENTS);
  const [header, setHeader] = useState<WorkspaceHeaderModel>(
    isLive ? EMPTY_WORKSPACE_HEADER : MOCK_WORKSPACE_HEADER,
  );
  const [summary, setSummary] = useState<ExecutiveSummaryModel>(
    isLive ? EMPTY_EXECUTIVE_SUMMARY : MOCK_EXECUTIVE_SUMMARY,
  );
  const [report, setReport] = useState<RunReportModel>(isLive ? EMPTY_RUN_REPORT : MOCK_RUN_REPORT);
  const [attempts, setAttempts] = useState<RepairAttemptsModel>(
    isLive ? EMPTY_REPAIR_ATTEMPTS : MOCK_REPAIR_ATTEMPTS,
  );
  const [repositories, setRepositories] = useState<SidebarRepo[]>(isLive ? [] : MOCK_REPOSITORIES);
  const [loading, setLoading] = useState(isLive);

  const [repoRefreshToken, setRepoRefreshToken] = useState(0);
  const refreshRepositories = useCallback(() => setRepoRefreshToken((t) => t + 1), []);

  // Repository list — refreshed when a run finishes so statuses stay accurate.
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    listRepositories()
      .then((repos) => {
        // Set even when empty — a backend with no runs must render as none,
        // not as whatever the previous fetch happened to return.
        if (!cancelled) setIfChanged(setRepositories, repos);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [done, repoRefreshToken]);

  // Run-scoped models. Polled while the run is in flight, fetched once after.
  useEffect(() => {
    if (!isLive || !runId || runId === MOCK_RUN_ID) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      const results = await Promise.allSettled([
        getRunAgents(runId),
        getWorkspaceHeader(runId),
        getExecutiveSummary(runId),
        getRunReport(runId),
        getRepairAttempts(runId),
      ]);
      if (cancelled) return;

      const [agentsRes, headerRes, summaryRes, reportRes, attemptsRes] = results;
      if (agentsRes.status === "fulfilled" && agentsRes.value.length)
        setIfChanged(setAgents, agentsRes.value);
      if (headerRes.status === "fulfilled") setIfChanged(setHeader, headerRes.value);
      if (summaryRes.status === "fulfilled") setIfChanged(setSummary, summaryRes.value);
      if (reportRes.status === "fulfilled") setIfChanged(setReport, reportRes.value);
      if (attemptsRes.status === "fulfilled") setIfChanged(setAttempts, attemptsRes.value);
      setLoading(false);
    };

    void load();
    if (done)
      return () => {
        cancelled = true;
      };

    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, done]);

  return useMemo(
    () => ({
      agents,
      header,
      summary,
      report,
      attempts,
      repositories,
      setRepositories,
      refreshRepositories,
      loading,
    }),
    [agents, header, summary, report, attempts, repositories, refreshRepositories, loading],
  );
}
