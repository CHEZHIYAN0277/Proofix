// @vitest-environment jsdom
/**
 * A3.5's Reproduction Evidence Console + Execution Trace panel. Every
 * assertion here traces back to a specific field on
 * `GET /api/runs/{runId}/reproduction` — the point of this suite is to catch
 * the panel inventing a verdict, a confidence score, or an execution stage
 * the backend never sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getReproductionEvidence = vi.fn();
const getKnowledgeMetrics = vi.fn();
const getSemanticGraph = vi.fn();
const getDependencyRisk = vi.fn();
const getStaticFindings = vi.fn();

vi.mock("@/lib/runService", () => ({
  getReproductionEvidence: (...a: unknown[]) => getReproductionEvidence(...a),
  getKnowledgeMetrics: (...a: unknown[]) => getKnowledgeMetrics(...a),
  getSemanticGraph: (...a: unknown[]) => getSemanticGraph(...a),
  getDependencyRisk: (...a: unknown[]) => getDependencyRisk(...a),
  getStaticFindings: (...a: unknown[]) => getStaticFindings(...a),
}));

const { ReproductionEvidencePanel } = await import("./ReproductionEvidencePanel");

const CONFIRMED = {
  status: "CONFIRMED",
  uiStatus: "reproduced",
  confidence: 0.9,
  evidenceSource: "pytest_report",
  failingTest: "tests/test_auth.py::test_expired_token_rejected",
  exceptionType: "AssertionError",
  exceptionMessage: "assert True is False",
  errorSignature: "AssertionError: assert True is False",
  failingFile: "vulnapi/tests/test_auth.py",
  failingLine: 27,
  traceback: "E   AssertionError: assert True is False",
  infraDetail: null,
  command: "python -m pytest --tb=long --json-report -v",
  exitCode: 1,
  timedOut: false,
  stdout: "collected 12 items",
  stderr: "",
  durationSeconds: 0.03,
  startedAt: "2026-08-13T17:30:37",
  finishedAt: "2026-08-13T17:30:38",
  testsCollected: 12,
  testsPassed: 8,
  testsFailed: 4,
  reexecutionCommand:
    "python -m pytest tests/test_auth.py::test_expired_token_rejected -v --tb=long",
  reexecutionIsTargeted: true,
  reexecutionTimeoutSeconds: 120,
  baselineFailures: ["tests/test_config.py::test_secret_from_env"],
  stages: [
    {
      id: "suite_executed",
      label: "Test suite executed",
      status: "done",
      detail: "pytest exited with code 1.",
    },
    {
      id: "tests_collected",
      label: "Tests collected",
      status: "done",
      detail: "12 test(s) collected.",
    },
    { id: "tests_run", label: "Tests executed", status: "done", detail: "8 passed, 4 failed." },
    {
      id: "failure_observed",
      label: "Failure observed",
      status: "done",
      detail: "tests/test_auth.py::test_expired_token_rejected failed with AssertionError.",
    },
    {
      id: "evidence_captured",
      label: "Evidence captured",
      status: "done",
      detail: "Exception and traceback captured from the structured pytest report.",
    },
  ],
};

const UNCONFIRMED = {
  ...CONFIRMED,
  status: "UNCONFIRMED",
  uiStatus: "not_reproduced",
  confidence: 0.0,
  evidenceSource: null,
  failingTest: null,
  exceptionType: null,
  exceptionMessage: null,
  errorSignature: null,
  failingFile: null,
  failingLine: null,
  traceback: null,
  testsFailed: 0,
  testsPassed: 12,
  baselineFailures: [],
  stages: [
    {
      id: "suite_executed",
      label: "Test suite executed",
      status: "done",
      detail: "pytest exited with code 0.",
    },
    {
      id: "tests_collected",
      label: "Tests collected",
      status: "done",
      detail: "12 test(s) collected.",
    },
    { id: "tests_run", label: "Tests executed", status: "done", detail: "12 passed, 0 failed." },
    {
      id: "failure_observed",
      label: "Failure observed",
      status: "not_triggered",
      detail: "No failure — every collected test passed.",
    },
    {
      id: "evidence_captured",
      label: "Evidence captured",
      status: "skipped",
      detail: "Not reached — no failure was observed.",
    },
  ],
};

const TIMEOUT = {
  ...CONFIRMED,
  status: "INFRA_ERROR",
  uiStatus: "error",
  confidence: 0.0,
  evidenceSource: null,
  failingTest: null,
  exceptionType: null,
  exceptionMessage: null,
  errorSignature: null,
  failingFile: null,
  failingLine: null,
  traceback: null,
  infraDetail: "timeout",
  exitCode: -1,
  timedOut: true,
  testsCollected: null,
  testsPassed: null,
  testsFailed: null,
  baselineFailures: [],
  stages: [
    {
      id: "suite_executed",
      label: "Test suite executed",
      status: "failed",
      detail: "The pytest subprocess exceeded its time limit and was terminated.",
    },
    {
      id: "tests_collected",
      label: "Tests collected",
      status: "skipped",
      detail: "Not reached — the suite never executed.",
    },
    {
      id: "tests_run",
      label: "Tests executed",
      status: "skipped",
      detail: "Not reached — no tests were collected.",
    },
    {
      id: "failure_observed",
      label: "Failure observed",
      status: "skipped",
      detail: "Not reached — the tests did not run to completion.",
    },
    {
      id: "evidence_captured",
      label: "Evidence captured",
      status: "skipped",
      detail: "Not reached — no failure was observed.",
    },
  ],
};

const NO_TESTS = {
  ...TIMEOUT,
  status: "NO_TESTS",
  uiStatus: "unavailable",
  infraDetail: "No tests collected by pytest",
  exitCode: 5,
  timedOut: false,
  testsCollected: 0,
  stages: [
    {
      id: "suite_executed",
      label: "Test suite executed",
      status: "done",
      detail: "pytest exited with code 5.",
    },
    {
      id: "tests_collected",
      label: "Tests collected",
      status: "failed",
      detail: "pytest collected zero tests.",
    },
    {
      id: "tests_run",
      label: "Tests executed",
      status: "skipped",
      detail: "Not reached — no tests were collected.",
    },
    {
      id: "failure_observed",
      label: "Failure observed",
      status: "skipped",
      detail: "Not reached — the tests did not run to completion.",
    },
    {
      id: "evidence_captured",
      label: "Evidence captured",
      status: "skipped",
      detail: "Not reached — no failure was observed.",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReproductionEvidencePanel", () => {
  it("shows a loading message before the backend responds", () => {
    getReproductionEvidence.mockReturnValue(new Promise(() => {}));
    render(<ReproductionEvidencePanel runId="r1" />);
    expect(screen.getByText("Loading reproduction evidence…")).toBeTruthy();
  });

  it("renders Pending when A3.5 has not completed (404)", async () => {
    getReproductionEvidence.mockResolvedValue(null);
    render(<ReproductionEvidencePanel runId="r1" />);
    expect(
      await screen.findByText(/Pending — A3\.5 has not completed for this run yet/),
    ).toBeTruthy();
  });

  it("shows a distinct running message rather than the generic pending one", async () => {
    getReproductionEvidence.mockResolvedValue(null);
    render(<ReproductionEvidencePanel runId="r1" status="running" />);
    expect(await screen.findByText(/RUNNING — A3\.5 is executing the test suite now/)).toBeTruthy();
  });

  it("surfaces a real API failure with a retry", async () => {
    getReproductionEvidence.mockRejectedValue(new Error("API 500: Internal Server Error"));
    render(<ReproductionEvidencePanel runId="r1" />);
    expect(await screen.findByText("API 500: Internal Server Error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("renders REPRODUCED with the real confidence value — never invented", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Failure Reproduction");
    expect(screen.getByText("REPRODUCED")).toBeTruthy();
    expect(screen.getByText("0.90")).toBeTruthy();
    expect(screen.getByText(CONFIRMED.failingTest)).toBeTruthy();
  });

  it("renders NOT REPRODUCED distinctly, with confidence 0.00 (real, not omitted)", async () => {
    getReproductionEvidence.mockResolvedValue(UNCONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Failure Reproduction");
    expect(screen.getByText("NOT REPRODUCED")).toBeTruthy();
    expect(screen.getByText("0.00")).toBeTruthy();
    expect(screen.getByText(/did not reproduce here/)).toBeTruthy();
  });

  it("renders EXECUTION ERROR and shows the real timed-out flag distinctly from a generic error", async () => {
    getReproductionEvidence.mockResolvedValue(TIMEOUT);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Failure Reproduction");
    expect(screen.getByText("EXECUTION ERROR")).toBeTruthy();
    const timedOutChip = screen.getByText("Timed out").closest("div");
    expect(within(timedOutChip!.parentElement!).getByText("Yes")).toBeTruthy();
  });

  it("renders UNAVAILABLE for no tests collected", async () => {
    getReproductionEvidence.mockResolvedValue(NO_TESTS);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Failure Reproduction");
    expect(screen.getByText("UNAVAILABLE")).toBeTruthy();
  });

  it("renders the five execution stages in order with real per-stage status", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Execution trace");
    const labels = screen.getAllByText(/^\d\. /).map((el) => el.textContent);
    expect(labels).toEqual([
      "1. Test suite executed",
      "2. Tests collected",
      "3. Tests executed",
      "4. Failure observed",
      "5. Evidence captured",
    ]);
  });

  it("marks downstream stages as 'not reached' when execution times out at the first stage", async () => {
    getReproductionEvidence.mockResolvedValue(TIMEOUT);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Execution trace");
    // Four stages skipped downstream of the failed first stage.
    expect(screen.getAllByText("not reached").length).toBe(4);
    expect(screen.getByText(/exceeded its time limit/)).toBeTruthy();
  });

  it("marks 'failure observed' as 'no failure' rather than 'failed' when the suite passed", async () => {
    getReproductionEvidence.mockResolvedValue(UNCONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Execution trace");
    expect(screen.getByText("no failure")).toBeTruthy();
    // "Evidence captured" is downstream and was not reached, not "failed".
    expect(screen.getByText("not reached")).toBeTruthy();
  });

  it("shows the actual command executed, distinct from the targeted re-execution command", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Reproduction strategy");
    expect(screen.getAllByText(CONFIRMED.command).length).toBeGreaterThan(0);
    expect(screen.getByText(CONFIRMED.reexecutionCommand)).toBeTruthy();
    expect(screen.getByText(/not run here/)).toBeTruthy();
  });

  it("shows 'Not measured' for environment info rather than fabricating it", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Environment");
    const envTerm = screen.getByText("Environment").closest("div")!;
    expect(within(envTerm).getByText("Not measured")).toBeTruthy();
  });

  it("execution console shows real stdout, stderr, and exit code, with stdout/stderr clearly distinguished", async () => {
    getReproductionEvidence.mockResolvedValue({
      ...CONFIRMED,
      stdout: "12 items collected",
      stderr: "DeprecationWarning: something",
    });
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Execution console");
    expect(screen.getByText("12 items collected")).toBeTruthy();
    expect(screen.getByText("DeprecationWarning: something")).toBeTruthy();
    expect(screen.getByText("stdout")).toBeTruthy();
    expect(screen.getByText("stderr")).toBeTruthy();
    expect(screen.getByText("Exit code: 1")).toBeTruthy();
  });

  it("collapses and expands the execution console", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    const user = userEvent.setup();
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Execution console");
    expect(screen.getByText("collected 12 items")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Execution console/ }));
    await waitFor(() => {
      expect(screen.queryByText("collected 12 items")).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: /Execution console/ }));
    await waitFor(() => {
      expect(screen.getByText("collected 12 items")).toBeTruthy();
    });
  });

  it("evidence card shows error signature, location, and evidence type for a reproduced failure", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Evidence collected");
    expect(screen.getByText("AssertionError: assert True is False")).toBeTruthy();
    expect(screen.getByText(/vulnapi\/tests\/test_auth\.py:27/)).toBeTruthy();
    expect(screen.getByText("Structured pytest JSON report")).toBeTruthy();
  });

  it("evidence card explains absence honestly for a not-reproduced result — never a fabricated signature", async () => {
    getReproductionEvidence.mockResolvedValue(UNCONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Evidence collected");
    expect(screen.getByText(/No evidence to collect/)).toBeTruthy();
    expect(screen.queryByText("Error signature")).toBeNull();
  });

  it("evidence card shows the real infra detail for an execution error", async () => {
    getReproductionEvidence.mockResolvedValue(TIMEOUT);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Evidence collected");
    expect(screen.getByText("timeout")).toBeTruthy();
  });

  it("shows other pre-existing baseline failures, excluding the target itself", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText(/Other pre-existing failures \(1\)/);
    expect(screen.getByText("tests/test_config.py::test_secret_from_env")).toBeTruthy();
    // The target itself must not be duplicated into this list.
    expect(
      screen.queryByText("tests/test_auth.py::test_expired_token_rejected", { selector: "li" }),
    ).toBeNull();
  });

  it("full traceback is available but collapsed by default", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Evidence collected");
    // Matched by a regex anchored on the traceback's own "E   " pytest prefix
    // (distinct from the "Error signature" field's plain "AssertionError: …"
    // text) rather than the literal string: testing-library's exact-string
    // matcher has a known quirk against `<pre>`-preserved runs of spaces.
    expect(screen.queryByText(/^E\s+AssertionError/)).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByText("Full traceback"));
    expect(await screen.findByText(/^E\s+AssertionError/)).toBeTruthy();
  });

  it("never calls A0.5's, A1's, A2's, or A3's endpoints — A3.5's evidence is its own", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Failure Reproduction");
    expect(getKnowledgeMetrics).not.toHaveBeenCalled();
    expect(getSemanticGraph).not.toHaveBeenCalled();
    expect(getDependencyRisk).not.toHaveBeenCalled();
    expect(getStaticFindings).not.toHaveBeenCalled();
  });

  it("carries the explainability source line for the reproduction endpoint", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Failure Reproduction");
    expect(screen.getByText(/\/reproduction/)).toBeTruthy();
  });

  it("never claims a link to a specific A3 finding", async () => {
    getReproductionEvidence.mockResolvedValue(CONFIRMED);
    render(<ReproductionEvidencePanel runId="r1" />);

    await screen.findByText("Failure Reproduction");
    expect(screen.getByText(/does not target a specific A3 finding/)).toBeTruthy();
  });
});
