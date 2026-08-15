// @vitest-environment jsdom
/**
 * A4's Evidence Investigation Board. Every assertion here traces to a specific
 * field on `GET /api/runs/{runId}/investigation` — the point of this suite is
 * to catch the board inventing a severity, a confidence, a stance or an
 * evidence item the backend never sent, and to pin the three distinctions the
 * layout exists to preserve:
 *
 *   ran-and-found-nothing ≠ could-not-run ≠ evidence against the finding.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getInvestigation = vi.fn();

vi.mock("@/lib/runService", () => ({
  getInvestigation: (...a: unknown[]) => getInvestigation(...a),
}));

import type { InvestigationReport } from "./investigationTypes";

const { EvidenceInvestigationBoard } = await import("./EvidenceInvestigationBoard");

const REPORT: InvestigationReport = {
  status: "partial",
  subjectKind: "runtime_failure",
  findingId: "tests/test_auth.py::test_expired",
  title: "AssertionError: expired token accepted",
  file: "vulnapi/auth.py",
  line: 42,
  severity: null,
  severityMeasured: false,
  reproductionStatus: "reproduced",
  rootCause: "validate_token never compares exp against the clock",
  summary: "Expired tokens are accepted",
  rootCauseSource: "deterministic",
  confidence: 0.6,
  confidenceBreakdown: [
    { component: "runtime evidence", points: 0.35, basis: "1 runtime reference(s) at 0.35 each" },
    { component: "verified citations", points: 0.25, basis: "1 citation(s) anchored to source" },
  ],
  evidence: [
    {
      id: "scanner:bandit",
      category: "scanner",
      source: "bandit",
      description: "Reported 1 finding(s) in the file under investigation.",
      status: "present",
      stance: "supporting",
      strength: 0.9,
      strengthBasis: "bandit's own severity for its finding in the file under investigation",
      detail: { scannerStatus: "ok", findings: 1, findingsAtSubject: 1, lines: [40] },
    },
    {
      id: "scanner:semgrep",
      category: "scanner",
      source: "semgrep",
      description: "Ran successfully and reported no findings.",
      status: "absent",
      stance: "neutral",
      strength: null,
      strengthBasis: null,
      detail: { scannerStatus: "ok_no_findings", findings: 0 },
    },
    {
      id: "scanner:ruff",
      category: "scanner",
      source: "ruff",
      description: "The scanner is not installed or could not be executed.",
      status: "unavailable",
      stance: "neutral",
      strength: null,
      strengthBasis: null,
      detail: { scannerStatus: "unavailable" },
    },
    {
      id: "reproduction",
      category: "reproduction",
      source: "pytest",
      description: "tests/test_auth.py::test_expired failed with AssertionError.",
      status: "present",
      stance: "supporting",
      strength: 0.9,
      strengthBasis: "A3.5's confidence in its own evidence source (pytest_report)",
      detail: { command: "pytest -q", exitCode: 1, testsCollected: 12 },
    },
    {
      id: "citation:0",
      category: "source",
      source: "vulnapi/auth.py:42",
      description: "no exp check",
      status: "present",
      stance: "supporting",
      strength: null,
      strengthBasis: null,
      detail: { file: "vulnapi/auth.py", line: 42, verified: true, sourceAvailable: false },
    },
    {
      id: "citation:1",
      category: "source",
      source: "vulnapi/ghost.py:9",
      description: "phantom claim",
      status: "absent",
      stance: "contradicting",
      strength: null,
      strengthBasis: null,
      detail: { file: "vulnapi/ghost.py", line: 9, verified: false, sourceAvailable: false },
    },
    {
      id: "dependency",
      category: "dependency",
      source: "OSV",
      description: "A2 has not run, so dependency reachability is unknown.",
      status: "unavailable",
      stance: "neutral",
      strength: null,
      strengthBasis: null,
      detail: {},
    },
  ],
  completeness: {
    measuredCategories: 3,
    totalCategories: 4,
    ratio: 0.75,
    categoryStatus: {
      scanner: "present",
      reproduction: "present",
      source: "present",
      dependency: "unavailable",
    },
  },
  unavailableSources: [
    { source: "ruff", reason: "The scanner is not installed or could not be executed." },
    { source: "A2 dependency analysis", reason: "A2 did not complete" },
  ],
  errors: [],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

beforeEach(() => {
  getInvestigation.mockReset();
});

describe("EvidenceInvestigationBoard", () => {
  it("renders the finding, its location and the reproduction verdict", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    await screen.findByText("AssertionError: expired token accepted");
    const finding = screen.getByRole("group", { name: /finding under investigation/i });
    expect(within(finding).getByText("tests/test_auth.py::test_expired")).toBeTruthy();
    expect(within(finding).getByText("vulnapi/auth.py:42")).toBeTruthy();
    expect(within(finding).getByText("REPRODUCED")).toBeTruthy();
    expect(screen.getByText("PARTIAL")).toBeTruthy();
  });

  it("shows the confidence the backend computed, not one of its own", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    await screen.findAllByText("60%");
    const bar = screen.getByRole("progressbar", { name: /evidence confidence/i });
    expect(bar.getAttribute("aria-valuenow")).toBe("60");
  });

  it("explains the confidence from the backend's own breakdown", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    const toggle = await screen.findByRole("button", { name: /how this was calculated/i });
    expect(screen.queryByText("runtime evidence")).toBeNull();
    await userEvent.click(toggle);

    expect(screen.getByText("runtime evidence")).toBeTruthy();
    expect(screen.getByText("+0.35")).toBeTruthy();
    expect(screen.getByText("1 citation(s) anchored to source")).toBeTruthy();
  });

  it("renders 'Not measured' for a severity no tool assigned", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    await screen.findByText("AssertionError: expired token accepted");
    expect(screen.getByText("Not measured")).toBeTruthy();
    expect(screen.queryByText(/HIGH|MEDIUM|LOW/)).toBeNull();
  });

  it("shows a measured severity as a band, and an unmeasured rank as neither", async () => {
    const measured = clone(REPORT);
    measured.subjectKind = "static_finding";
    measured.severity = 0.9;
    measured.severityMeasured = true;
    getInvestigation.mockResolvedValue(measured);
    const { unmount } = render(<EvidenceInvestigationBoard runId="run-1" />);
    expect(await screen.findByText("HIGH (0.90)")).toBeTruthy();
    unmount();

    const unmeasured = clone(REPORT);
    unmeasured.severity = 0.4;
    unmeasured.severityMeasured = false;
    getInvestigation.mockResolvedValue(unmeasured);
    render(<EvidenceInvestigationBoard runId="run-2" />);
    await screen.findByText(/no scanner assigned a severity/i);
    expect(screen.queryByText(/^LOW/)).toBeNull();
  });

  it("keeps ran-clean, could-not-run and contradicting visually distinct", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    const scanners = await screen.findByRole("group", { name: /scanners evidence/i });
    // semgrep ran and found nothing — a result, and not an argument either way.
    expect(within(scanners).getByText("Ran successfully and reported no findings.")).toBeTruthy();
    expect(within(scanners).getByText("nothing found")).toBeTruthy();
    // ruff could not run — reported as not measured, never as contradicting.
    expect(within(scanners).getByText("not measured")).toBeTruthy();

    const contradicting = screen.getByRole("group", { name: /contradicting evidence/i });
    expect(within(contradicting).getByText("vulnapi/ghost.py:9")).toBeTruthy();
    expect(within(contradicting).queryByText("ruff")).toBeNull();
    expect(within(contradicting).queryByText("semgrep")).toBeNull();
  });

  it("lists supporting evidence and the sources that were unavailable", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    const supporting = await screen.findByRole("group", { name: /supporting evidence/i });
    expect(within(supporting).getByText(/supporting evidence \(3\)/i)).toBeTruthy();
    expect(within(supporting).getByText("bandit")).toBeTruthy();
    expect(within(supporting).getByText("pytest")).toBeTruthy();

    expect(screen.getByText(/sources unavailable \(2\)/i)).toBeTruthy();
    expect(screen.getByText("A2 dependency analysis")).toBeTruthy();
  });

  it("reports category coverage without treating an unavailable source as a result", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    expect(await screen.findByText(/3\/4 evidence categories answered/)).toBeTruthy();
  });

  it("expands an evidence item to its real backend metadata", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    const reproduction = await screen.findByRole("group", { name: /reproduction evidence/i });
    const row = within(reproduction).getByRole("button", { name: /pytest/i });
    expect(screen.queryByText("pytest -q")).toBeNull();
    await userEvent.click(row);

    expect(screen.getByText("pytest -q")).toBeTruthy();
    expect(screen.getByText("exitCode")).toBeTruthy();
  });

  it("never offers a source viewer, because the clone is gone by then", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    await screen.findByRole("group", { name: /scanners evidence/i });
    expect(screen.queryByRole("button", { name: /view source/i })).toBeNull();
  });

  it("collapses and re-expands an evidence category", async () => {
    getInvestigation.mockResolvedValue(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    const scanners = await screen.findByRole("group", { name: /scanners evidence/i });
    const header = within(scanners).getByRole("button", { name: /scanners/i });
    expect(within(scanners).getByText("bandit")).toBeTruthy();
    await userEvent.click(header);
    expect(within(scanners).queryByText("bandit")).toBeNull();
    await userEvent.click(header);
    expect(within(scanners).getByText("bandit")).toBeTruthy();
  });

  it("says 'Not measured' rather than 0% when nothing was scored", async () => {
    const empty = clone(REPORT);
    empty.confidence = null;
    empty.confidenceBreakdown = [];
    getInvestigation.mockResolvedValue(empty);
    render(<EvidenceInvestigationBoard runId="run-1" />);

    await screen.findByText(/no evidence was available to score/i);
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByRole("progressbar", { name: /evidence confidence/i })).toBeNull();
  });

  it("renders a no-finding investigation as exactly that", async () => {
    const none = clone(REPORT);
    none.status = "no_finding";
    none.subjectKind = null;
    none.findingId = null;
    none.title = null;
    none.file = null;
    none.line = null;
    none.rootCause = null;
    none.reproductionStatus = null;
    getInvestigation.mockResolvedValue(none);
    render(<EvidenceInvestigationBoard runId="run-1" />);

    expect(await screen.findByText("NO FINDING")).toBeTruthy();
    expect(screen.getByText(/there was nothing for it to take as its subject/i)).toBeTruthy();
    expect(screen.getByText("Root cause — Not measured.")).toBeTruthy();
  });

  it("surfaces a degraded investigation instead of hiding it", async () => {
    const degraded = clone(REPORT);
    degraded.status = "error";
    degraded.errors = [
      "LLM investigation unavailable (TimeoutError); deterministic analysis used.",
    ];
    getInvestigation.mockResolvedValue(degraded);
    render(<EvidenceInvestigationBoard runId="run-1" />);

    expect(await screen.findByText("DEGRADED")).toBeTruthy();
    expect(screen.getByText(/LLM investigation unavailable/)).toBeTruthy();
    // Degraded, but the evidence it did gather is still shown.
    const scanners = screen.getByRole("group", { name: /scanners evidence/i });
    expect(within(scanners).getByText("bandit")).toBeTruthy();
  });

  it("shows an empty category as 'Not measured' rather than omitting it", async () => {
    const noScanners = clone(REPORT);
    noScanners.evidence = noScanners.evidence.filter((e) => e.category !== "scanner");
    noScanners.completeness.categoryStatus.scanner = "unavailable";
    getInvestigation.mockResolvedValue(noScanners);
    render(<EvidenceInvestigationBoard runId="run-1" />);

    expect(await screen.findByText("Scanner evidence — Not measured")).toBeTruthy();
  });

  it("says none measured when there is no contradicting evidence", async () => {
    const agreed = clone(REPORT);
    agreed.evidence = agreed.evidence.filter((e) => e.stance !== "contradicting");
    getInvestigation.mockResolvedValue(agreed);
    render(<EvidenceInvestigationBoard runId="run-1" />);

    expect(await screen.findByText("Contradicting evidence — None measured")).toBeTruthy();
  });

  it("distinguishes A4 pending from A4 running", async () => {
    getInvestigation.mockResolvedValue(null);
    const { unmount } = render(<EvidenceInvestigationBoard runId="run-1" />);
    expect(await screen.findByText(/A4 has not completed/i)).toBeTruthy();
    unmount();

    getInvestigation.mockResolvedValue(null);
    render(<EvidenceInvestigationBoard runId="run-2" status="running" />);
    expect(await screen.findByText(/A4 is correlating evidence now/i)).toBeTruthy();
  });

  it("reports a load failure and retries on demand", async () => {
    getInvestigation.mockRejectedValueOnce(new Error("API 500: Internal Server Error"));
    getInvestigation.mockResolvedValueOnce(clone(REPORT));
    render(<EvidenceInvestigationBoard runId="run-1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByText("AssertionError: expired token accepted")).toBeTruthy(),
    );
  });
});
