// @vitest-environment jsdom
/**
 * A3's Findings Funnel + Prioritization Ledger panel. Every assertion here
 * traces back to a specific field on `GET /api/runs/{runId}/static-findings`
 * — the point of this suite is to catch the panel inventing a severity band,
 * a scanner status, or a cluster count the backend never sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getStaticFindings = vi.fn();
const getKnowledgeMetrics = vi.fn();
const getSemanticGraph = vi.fn();
const getDependencyRisk = vi.fn();

vi.mock("@/lib/runService", () => ({
  getStaticFindings: (...a: unknown[]) => getStaticFindings(...a),
  getKnowledgeMetrics: (...a: unknown[]) => getKnowledgeMetrics(...a),
  getSemanticGraph: (...a: unknown[]) => getSemanticGraph(...a),
  getDependencyRisk: (...a: unknown[]) => getDependencyRisk(...a),
}));

const { StaticFindingsPanel } = await import("./StaticFindingsPanel");

const REPORT = {
  scannerStatus: {
    bandit: "unavailable",
    semgrep: "unavailable",
    ruff: "ok",
  },
  rawCount: 2,
  prioritizedCount: 2,
  findings: [
    {
      id: "finding-0",
      rank: 1,
      file: "vulnapi/auth.py",
      line: 12,
      message: "pickle usage",
      tools: ["bandit", "ruff"],
      severity: 0.9,
      severityMeasured: true,
      consensus: true,
      blastRadiusScore: 0.62,
      criticality: 0.81,
      churnWeight: 0.37,
    },
    {
      id: "finding-1",
      rank: 2,
      file: "vulnapi/routes.py",
      line: 3,
      message: "`time` imported but unused",
      tools: ["ruff"],
      severity: 0.4,
      severityMeasured: false,
      consensus: false,
      blastRadiusScore: 0.184,
      criticality: 0.55,
      churnWeight: 0.1,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StaticFindingsPanel", () => {
  it("shows the loading message before the backend responds", () => {
    getStaticFindings.mockReturnValue(new Promise(() => {}));
    render(<StaticFindingsPanel runId="r1" />);
    expect(screen.getByText("Static analysis loading…")).toBeTruthy();
  });

  it("renders Pending when A3 has not completed for this run (404)", async () => {
    getStaticFindings.mockResolvedValue(null);
    render(<StaticFindingsPanel runId="r1" />);
    expect(await screen.findByText(/Pending — A3 has not completed yet/)).toBeTruthy();
  });

  it("shows a distinct running message rather than the generic pending one", async () => {
    getStaticFindings.mockResolvedValue(null);
    render(<StaticFindingsPanel runId="r1" status="running" />);
    expect(await screen.findByText(/RUNNING — A3 is scanning now/)).toBeTruthy();
  });

  it("surfaces a real API failure with a retry — never disguised as a clean repository", async () => {
    getStaticFindings.mockRejectedValue(new Error("API 500: Internal Server Error"));
    render(<StaticFindingsPanel runId="r1" />);
    expect(await screen.findByText("API 500: Internal Server Error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // The error state must never say "no findings" — that reads as a clean scan.
    expect(screen.queryByText(/No prioritized findings were reported/)).toBeNull();
  });

  it("renders '200 + empty' as a completed scan with no findings — never confused with 404", async () => {
    getStaticFindings.mockResolvedValue({
      scannerStatus: {
        bandit: "ok_no_findings",
        semgrep: "ok_no_findings",
        ruff: "ok_no_findings",
      },
      rawCount: 0,
      prioritizedCount: 0,
      findings: [],
    });
    render(<StaticFindingsPanel runId="r1" />);

    expect(await screen.findByText("Static analysis completed")).toBeTruthy();
    expect(screen.getByText("No prioritized findings were reported.")).toBeTruthy();
    expect(screen.queryByText(/Pending/)).toBeNull();
  });

  it("renders each scanner's real status independently, including unavailable ones", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Scanner analysis");
    // bandit and semgrep are unavailable — they must still be listed, not hidden.
    const unavailable = screen.getAllByText("unavailable");
    expect(unavailable.length).toBe(2);
    expect(screen.getByText("completed")).toBeTruthy(); // ruff, ok
  });

  it("never derives scanner status from which tools appear on findings", async () => {
    // bandit contributes to a finding's tools, yet its own scanner status is
    // "unavailable" — the funnel must show the backend's real status, not
    // infer "ran" from the presence of the tool name in a finding.
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Scanner analysis");
    // The scanner list is the <ul> immediately following the "Scanner
    // analysis" heading — scope to it so "bandit" resolves to the funnel row,
    // not the (also present) filter chip of the same name.
    const scannerList = screen.getByText("Scanner analysis").nextElementSibling as HTMLElement;
    const banditRow = within(scannerList).getByText("bandit").closest("li")!;
    expect(within(banditRow).getByText("unavailable")).toBeTruthy();
  });

  it("renders the raw and prioritized counts from the backend", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    // "Raw findings" labels both the stat chip and the funnel row — take the chip.
    const rawChip = screen.getAllByText("Raw findings")[0].closest("div");
    expect(within(rawChip!.parentElement!).getByText("2")).toBeTruthy();
  });

  it("renders findings in the backend's own ranked order, never re-sorted", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    const rows = screen.getAllByText(/vulnapi\/(auth|routes)\.py:/);
    expect(rows[0].textContent).toContain("auth.py");
    expect(rows[1].textContent).toContain("routes.py");
  });

  it("shows severity as a real number when measured", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    expect(screen.getAllByText("0.90").length).toBeGreaterThan(0);
  });

  it("shows 'Not measured' rather than a fabricated severity for an unmeasured finding", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    expect(screen.getAllByText("Not measured").length).toBeGreaterThan(0);
    // Never converted to a severity band.
    expect(screen.queryByText("LOW")).toBeNull();
    expect(screen.queryByText("MEDIUM")).toBeNull();
    expect(screen.queryByText("HIGH")).toBeNull();
  });

  it("shows Consensus for a multi-tool finding and 'Single-tool finding' for the other — never implying single-tool is bad", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    expect(screen.getAllByText("Consensus").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Single-tool finding").length).toBeGreaterThan(0);
  });

  it("selecting a finding opens the detail panel with the score decomposition and 'Not measured' for what A3 never computes", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    const user = userEvent.setup();
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    await user.click(screen.getByRole("button", { name: /auth\.py/ }));

    const detail = await screen.findByRole("complementary", { name: "Finding detail" });
    // Criticality and churn weight each appear twice: once in the field list,
    // once in the "Why #N?" decomposition.
    expect(within(detail).getAllByText("0.81").length).toBeGreaterThan(0); // criticality
    expect(within(detail).getAllByText("0.37").length).toBeGreaterThan(0); // churn weight
    expect(within(detail).getByText("0.6200")).toBeTruthy(); // blast radius (4 decimals)
    expect(within(detail).getAllByText("Not measured").length).toBeGreaterThanOrEqual(4); // column/confidence/category/remediation/rule
  });

  it("the score decomposition never recomputes blast_radius_score — it renders the backend's own value", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    const user = userEvent.setup();
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    await user.click(screen.getByRole("button", { name: /auth\.py/ }));

    const detail = await screen.findByRole("complementary", { name: "Finding detail" });
    expect(within(detail).getByText(/Blast-radius score 0\.6200/)).toBeTruthy();
  });

  it("filters by scanner", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    const user = userEvent.setup();
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = await screen.findByRole("table");
    within(table).getByText("vulnapi/auth.py");
    within(table).getByText("vulnapi/routes.py");

    // Filtering is inclusive per-tool: a finding shows if any of its tools is
    // active. routes.py's only tool is ruff, so deselecting ruff removes it
    // while auth.py (bandit + ruff) still matches on bandit.
    await user.click(screen.getByRole("button", { name: "ruff" }));
    await waitFor(() => {
      expect(within(table).queryByText("vulnapi/routes.py")).toBeNull();
      expect(within(table).getByText("vulnapi/auth.py")).toBeTruthy();
    });
  });

  it("filters by severity-measured", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    const user = userEvent.setup();
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Severity not measured" }));
    await waitFor(() => {
      expect(within(table).queryByText("vulnapi/routes.py")).toBeNull();
      expect(within(table).getByText("vulnapi/auth.py")).toBeTruthy();
    });
  });

  it("filters by consensus", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    const user = userEvent.setup();
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = await screen.findByRole("table");

    // Deselecting "Single-tool" leaves only the consensus bucket active,
    // which excludes routes.py (single-tool) and keeps auth.py (consensus).
    await user.click(screen.getByRole("button", { name: "Single-tool" }));
    await waitFor(() => {
      expect(within(table).queryByText("vulnapi/routes.py")).toBeNull();
      expect(within(table).getByText("vulnapi/auth.py")).toBeTruthy();
    });
  });

  it("searches by file and by message", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    const user = userEvent.setup();
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = await screen.findByRole("table");

    await user.type(screen.getByPlaceholderText("Search file or message…"), "unused");
    await waitFor(() => {
      expect(within(table).queryByText("vulnapi/auth.py")).toBeNull();
      expect(within(table).getByText("vulnapi/routes.py")).toBeTruthy();
    });
  });

  it("the table view is a complete, accessible fallback with real headers", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    const user = userEvent.setup();
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    await user.click(screen.getByRole("button", { name: "Table" }));

    const table = await screen.findByRole("table");
    const headerRow = within(table).getAllByRole("columnheader");
    const headerText = headerRow.map((h) => h.textContent);
    for (const header of [
      "Rank",
      "File",
      "Line",
      "Message",
      "Tools",
      "Severity",
      "Consensus",
      "Blast radius",
    ]) {
      expect(headerText).toContain(header);
    }
    expect(within(table).getByText("vulnapi/auth.py")).toBeTruthy();
    expect(within(table).getByText("vulnapi/routes.py")).toBeTruthy();
  });

  it("never calls A0.5's, A1's, or A2's endpoints — A3's findings are its own", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    expect(getKnowledgeMetrics).not.toHaveBeenCalled();
    expect(getSemanticGraph).not.toHaveBeenCalled();
    expect(getDependencyRisk).not.toHaveBeenCalled();
  });

  it("carries the explainability source line for the static-findings endpoint", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Static Analysis");
    expect(screen.getByText(/static-findings/)).toBeTruthy();
  });

  it("does not fabricate a 'clustered' count — the funnel describes the transformation instead", async () => {
    getStaticFindings.mockResolvedValue(REPORT);
    render(<StaticFindingsPanel runId="r1" />);

    await screen.findByText("Scanner analysis");
    expect(screen.getByText(/clustered by file and nearby line/)).toBeTruthy();
    expect(screen.queryByText(/^Clustered$/)).toBeNull();
  });
});
