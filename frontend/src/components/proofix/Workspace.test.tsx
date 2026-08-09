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
const getRunContext = vi.fn();
const listRepositories = vi.fn();

vi.mock("@/lib/runService", () => ({
  isLive: true,
  getRunAgents: (...a: unknown[]) => getRunAgents(...a),
  getWorkspaceHeader: (...a: unknown[]) => getWorkspaceHeader(...a),
  getExecutiveSummary: (...a: unknown[]) => getExecutiveSummary(...a),
  getRunReport: (...a: unknown[]) => getRunReport(...a),
  getRepairAttempts: (...a: unknown[]) => getRepairAttempts(...a),
  getRunContext: (...a: unknown[]) => getRunContext(...a),
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
  // `null` is the 404 case: A5.5 has not published a package. `runService`
  // absorbs that status so absence never arrives as a rejection.
  getRunContext.mockResolvedValue(over.context ?? null);
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

describe("Context package panel", () => {
  const CONTEXT_AGENTS = [agent("context", "Context Engineering"), agent("merge", "Mergeability")];

  const PACKAGE = {
    target_file: "vulnapi/auth.py",
    target_function: "validate_token",
    acceptance_criteria: ["Expired tokens must be rejected"],
    patch_constraints: [],
    prefer_focused: true,
    privacy_guard_status: "masked" as const,
    ranked_files: [
      {
        file: "vulnapi/auth.py",
        score: 2.4,
        reason: "contains the failing stack frame",
        confidence: 0.9,
        signals: { stack_frame: 1, verified_citation: 0.8, unused: 0 },
        is_target: true,
        evidence: [],
      },
      {
        file: "vulnapi/tokens.py",
        score: 0.6,
        reason: "called by the target",
        confidence: 0.4,
        signals: { direct_callee: 0.5 },
        is_target: false,
        evidence: [],
      },
    ],
    redactions: [
      {
        file: "vulnapi/config.py",
        line: 12,
        kind: "REDACTED_SECRET",
        detector: "structural",
        identifier: "SECRET_KEY",
      },
    ],
    metrics: {
      files_ranked: 12,
      context_files: 2,
      context_functions: 4,
      original_tokens: 8000,
      reduced_tokens: 2000,
      token_reduction: 0.75,
      privacy_redactions: 1,
      degraded: false,
    },
  };

  it("renders Pending when A5.5 has not published a package", async () => {
    // The endpoint 404s, which `runService` turns into null. That is absence,
    // not failure: no error, no retry, and above all no claim that the context
    // was checked and found clean.
    backendReturns({ agents: CONTEXT_AGENTS, context: null });

    render(<Workspace runId="run-ctx-pending" />);

    expect(await screen.findByText(/Pending — context engineering/)).toBeTruthy();
    expect(screen.queryByText(/Could not load the context package/)).toBeNull();
    expect(screen.queryByText(/No secrets detected/)).toBeNull();
  });

  it("lists the ranking with the signals behind each score", async () => {
    backendReturns({ agents: CONTEXT_AGENTS, context: PACKAGE });

    render(<Workspace runId="run-ctx" />);

    // The target file names itself twice on purpose: once as the package's
    // subject in the header, once as the top-ranked row.
    await waitFor(() => expect(screen.getAllByText("vulnapi/auth.py").length).toBe(2));
    expect(screen.getByText("vulnapi/tokens.py")).toBeTruthy();
    expect(screen.getByText("target")).toBeTruthy();
    expect(screen.getByText("2.40")).toBeTruthy();
    expect(screen.getByText("contains the failing stack frame")).toBeTruthy();
    // Zero-valued signals contribute nothing and are not drawn as if they did.
    expect(screen.getByText(/stack_frame \+1/)).toBeTruthy();
    expect(screen.queryByText(/unused/)).toBeNull();
  });

  it("lists every redaction so the masking is auditable", async () => {
    backendReturns({ agents: CONTEXT_AGENTS, context: PACKAGE });

    render(<Workspace runId="run-ctx-redactions" />);

    expect(await screen.findByText("vulnapi/config.py:12")).toBeTruthy();
    expect(screen.getByText("SECRET_KEY")).toBeTruthy();
    expect(screen.getByText(/masked by structural/)).toBeTruthy();
  });

  it("a failed guard is not reported as a clean one", async () => {
    backendReturns({
      agents: CONTEXT_AGENTS,
      context: { ...PACKAGE, privacy_guard_status: "failed", redactions: [] },
    });

    render(<Workspace runId="run-ctx-failed" />);

    expect(await screen.findByText(/The guard errored/)).toBeTruthy();
    // An empty redaction list under a failed guard means nothing was checked,
    // not that nothing was found.
    expect(screen.queryByText(/No secrets detected/)).toBeNull();
  });

  it("surfaces a real failure with a retry, unlike a 404", async () => {
    backendReturns({ agents: CONTEXT_AGENTS });
    getRunContext.mockRejectedValue(new Error("API 500: Internal Server Error"));

    render(<Workspace runId="run-ctx-err" />);

    expect(await screen.findByText(/Could not load the context package/)).toBeTruthy();
    expect(screen.queryByText(/Pending — context engineering/)).toBeNull();
  });

  it("is not shown before the pipeline reaches context engineering", async () => {
    backendReturns({ agents: AGENTS, context: PACKAGE });

    render(<Workspace runId="run-ctx-early" />);

    await screen.findByText(/Status · Completed/);
    expect(screen.queryByText("Context Package")).toBeNull();
  });
});
