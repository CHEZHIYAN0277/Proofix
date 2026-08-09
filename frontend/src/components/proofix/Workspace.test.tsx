// @vitest-environment jsdom
/**
 * Workspace rendering against the three terminal states, and against a backend
 * that is failing.
 *
 * The bugs these pin:
 *
 * - **B-F01** — every REST rejection was swallowed. A failed `/report` and a run
 *   that produced no report rendered identically: the empty model, silently. The
 *   user could not tell missing data from broken data, and once the run settled
 *   polling stopped, so there was no way back either. A failure must now name
 *   itself and offer a retry.
 * - **B-F02** — `RunReport` defaulted its `report` prop to `MOCK_RUN_REPORT`, so
 *   omitting it rendered another repository's trust scores as this run's.
 * - **B-F05** — `blocked` was not an `AgentStatus`, so a blocked run wore the
 *   draft badge: "a PR is waiting for review", about a run that produced no PR.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AgentEntry } from "./data";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

// The journal's animation choreography measures real layout; jsdom has none.
// The stream itself is covered by `liveEventStream.test.ts`.
vi.mock("@/components/proofix/AnalyzingSequence", () => ({
  AnalyzingSequence: () => null,
}));

const getRunAgents = vi.fn();
const getWorkspaceHeader = vi.fn();
const getExecutiveSummary = vi.fn();
const getRunReport = vi.fn();
const getRepairAttempts = vi.fn();
const listRepositories = vi.fn();

vi.mock("@/lib/runService", () => ({
  isLive: true,
  getRunAgents: (...a: unknown[]) => getRunAgents(...a),
  getWorkspaceHeader: (...a: unknown[]) => getWorkspaceHeader(...a),
  getExecutiveSummary: (...a: unknown[]) => getExecutiveSummary(...a),
  getRunReport: (...a: unknown[]) => getRunReport(...a),
  getRepairAttempts: (...a: unknown[]) => getRepairAttempts(...a),
  listRepositories: (...a: unknown[]) => listRepositories(...a),
  // No event source: the journal is driven by the agent list alone here.
  eventSourceFor: () => () => () => undefined,
  createRun: vi.fn(),
  askChat: vi.fn(),
}));

const { Workspace } = await import("./Workspace");
const { EMPTY_EXECUTIVE_SUMMARY, EMPTY_RUN_REPORT, EMPTY_REPAIR_ATTEMPTS } =
  await import("./emptyModels");

function agent(id: string, name: string): AgentEntry {
  return {
    id,
    index: 1,
    agent: name,
    purpose: "",
    handoff: "",
    status: "completed",
    duration: "1s",
    lines: ["line"],
    evidence: { title: "", subtitle: "", fields: [] },
  };
}

const AGENTS = [agent("environment", "Environment Precheck"), agent("merge", "Mergeability")];

function header(status: string, lifecycle: unknown[] = []) {
  return {
    repository: "vulnapi",
    branch: "main",
    status,
    lifecycle,
    shortRunId: "abc1234",
    retries: 0,
    executionTime: "12s",
    decisionLabel: status === "blocked" ? "Environment not prepared" : "Completed",
    environment: null,
  };
}

/** Every model resolves; the caller varies one of them. */
function backendReturns(over: Record<string, unknown> = {}) {
  getRunAgents.mockResolvedValue(over.agents ?? AGENTS);
  getWorkspaceHeader.mockResolvedValue(over.header ?? header("completed"));
  getExecutiveSummary.mockResolvedValue(over.summary ?? EMPTY_EXECUTIVE_SUMMARY);
  getRunReport.mockResolvedValue(over.report ?? EMPTY_RUN_REPORT);
  getRepairAttempts.mockResolvedValue(over.attempts ?? EMPTY_REPAIR_ATTEMPTS);
  listRepositories.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Workspace terminal states", () => {
  it("renders a blocked run as Blocked, not as a draft PR", async () => {
    backendReturns({
      header: header("blocked", [{ type: "run.blocked", reason: "pytest is not importable" }]),
      // A real blocked run's summary says so. The empty model's `"draft"`
      // default is a placeholder, not something the backend ever sends.
      summary: { ...EMPTY_EXECUTIVE_SUMMARY, decision: "blocked" },
    });

    render(<Workspace runId="run-blocked" />);

    expect(await screen.findByText(/Status · Blocked/)).toBeTruthy();
    // The draft badge's wording must not appear anywhere: a blocked run has no PR.
    expect(screen.queryByText(/Draft PR/)).toBeNull();
  });

  it("renders a failed run as Failed", async () => {
    backendReturns({ header: header("failed", [{ type: "run.failed", reason: "boom" }]) });

    render(<Workspace runId="run-failed" />);

    expect(await screen.findByText(/Status · Failed/)).toBeTruthy();
  });

  it("renders a completed run as Completed", async () => {
    backendReturns({ header: header("completed", [{ type: "run.completed" }]) });

    render(<Workspace runId="run-done" />);

    expect(await screen.findByText(/Status · Completed/)).toBeTruthy();
  });
});

describe("Workspace REST failures", () => {
  it("surfaces a failed model instead of rendering it as empty, with a retry", async () => {
    backendReturns();
    getExecutiveSummary.mockRejectedValue(new Error("API 500: Internal Server Error"));

    render(<Workspace runId="run-err" />);

    expect(await screen.findByText(/Could not load executive summary/)).toBeTruthy();
    expect(screen.getByText(/API 500/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
  });

  it("re-fetches when the retry control is used", async () => {
    backendReturns();
    getExecutiveSummary.mockRejectedValueOnce(new Error("API 503: Service Unavailable"));

    render(<Workspace runId="run-retry" />);

    const button = await screen.findByRole("button", { name: "Retry" });
    const before = getExecutiveSummary.mock.calls.length;
    button.click();

    await waitFor(() => expect(getExecutiveSummary.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByText(/Could not load/)).toBeNull());
  });

  it("one failing model does not blank the others", async () => {
    backendReturns({ header: header("completed") });
    getRunReport.mockRejectedValue(new Error("API 500: Internal Server Error"));

    render(<Workspace runId="run-partial" />);

    // The header came back fine and still renders.
    expect(await screen.findByText(/Status · Completed/)).toBeTruthy();
    expect(screen.getAllByText(/vulnapi/).length).toBeGreaterThan(0);
  });
});

describe("Repository identity", () => {
  it("renders the identity the backend has always published", async () => {
    backendReturns({
      header: {
        ...header("completed"),
        repositoryId: "repo-abc123def456",
        headSha: "9c2d1f4a8b7e6d5c",
        repositoryHash: "idx-77aa88bb99cc",
      },
    });

    render(<Workspace runId="run-identity" />);

    expect(await screen.findByText("Repository ID")).toBeTruthy();
    // Abbreviated for the strip; the full value is the element's title.
    expect(screen.getByText("repo-abc123d")).toBeTruthy();
    expect(screen.getByText("9c2d1f4")).toBeTruthy();
    expect(screen.getByTitle("9c2d1f4a8b7e6d5c")).toBeTruthy();
  });

  it("omits a commit the run never observed rather than dashing it", async () => {
    backendReturns({
      header: { ...header("completed"), repositoryId: "repo-abc123", headSha: null },
    });

    render(<Workspace runId="run-no-head" />);

    expect(await screen.findByText("Repository ID")).toBeTruthy();
    expect(screen.queryByText("HEAD")).toBeNull();
  });

  it("renders no identity strip when the backend knows nothing", async () => {
    backendReturns({ header: header("completed") });

    render(<Workspace runId="run-bare" />);

    await screen.findByText(/Status · Completed/);
    expect(screen.queryByText("Repository ID")).toBeNull();
    expect(screen.queryByText("Index hash")).toBeNull();
  });
});
