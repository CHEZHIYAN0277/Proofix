// @vitest-environment jsdom
/**
 * A9's Security Re-scan panel. Every assertion traces to a field on
 * `GET /api/runs/{runId}/security` — the point of this suite is to catch the
 * panel inventing a severity band, a resolved/unchanged/before-after count,
 * or a "safe" verdict for a scan that never measured anything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getSecurityRescan = vi.fn();

vi.mock("@/lib/runService", () => ({
  getSecurityRescan: (...a: unknown[]) => getSecurityRescan(...a),
}));

const { SecurityRescanPanel } = await import("./SecurityRescanPanel");
import type { SecurityRescanReport } from "./securityRescanTypes";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const CLEAN: SecurityRescanReport = {
  verdict: "clean",
  rejected: false,
  securityScore: 100,
  newFindings: [],
  scannersRun: ["bandit", "semgrep"],
  reexecutionCommand: "bandit -f json -q -r vulnapi",
  reexecutionTimeoutSeconds: 60,
  retryContext: null,
};

const REJECTED: SecurityRescanReport = {
  verdict: "new_findings",
  rejected: true,
  securityScore: 75,
  newFindings: [
    {
      id: "new-0",
      file: "vulnapi/auth.py",
      line: 42,
      message: "Possible hardcoded password: 'hunter2'",
      tools: ["bandit"],
    },
  ],
  scannersRun: ["bandit"],
  reexecutionCommand: "bandit -f json -q -r vulnapi",
  reexecutionTimeoutSeconds: 60,
  retryContext: {
    assertionMessage: "New security finding: Possible hardcoded password: 'hunter2'",
    securityConstraint:
      "must not introduce Possible hardcoded password: 'hunter2' near vulnapi/auth.py:42",
  },
};

const NOT_MEASURED: SecurityRescanReport = {
  verdict: "not_measured",
  rejected: false,
  securityScore: null,
  newFindings: [],
  scannersRun: [],
  reexecutionCommand: "bandit -f json -q -r vulnapi",
  reexecutionTimeoutSeconds: 60,
  retryContext: null,
};

beforeEach(() => {
  getSecurityRescan.mockReset();
});

describe("SecurityRescanPanel", () => {
  it("shows a neutral not-measured verdict when no scanner ran, never a pass", async () => {
    getSecurityRescan.mockResolvedValue(clone(NOT_MEASURED));
    render(<SecurityRescanPanel runId="run-1" />);

    const band = await screen.findByRole("status");
    expect(within(band).getByText(/not measured/i)).toBeTruthy();
    expect(within(band).getByText(/no scanner available/i)).toBeTruthy();
    expect(screen.queryByText(/^no new findings$/i)).toBeNull();
  });

  it("shows a clean verdict with the real security score when nothing new was found", async () => {
    getSecurityRescan.mockResolvedValue(clone(CLEAN));
    render(<SecurityRescanPanel runId="run-1" />);

    const band = await screen.findByRole("status");
    expect(within(band).getByText("No new findings")).toBeTruthy();
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
    expect(screen.getByText(/25 points deducted per new finding/i)).toBeTruthy();
  });

  it("shows the rejected verdict and the real new finding", async () => {
    getSecurityRescan.mockResolvedValue(clone(REJECTED));
    render(<SecurityRescanPanel runId="run-1" />);

    const band = await screen.findByRole("status");
    expect(within(band).getByText(/new finding introduced/i)).toBeTruthy();
    expect(screen.getByText("vulnapi/auth.py:42")).toBeTruthy();
    expect(screen.getByText(/hardcoded password/i)).toBeTruthy();
    expect(screen.getByText("bandit", { selector: "div" })).toBeTruthy();
  });

  it("renders scanner coverage from scannersRun, distinguishing measured from unavailable", async () => {
    getSecurityRescan.mockResolvedValue(clone(REJECTED));
    render(<SecurityRescanPanel runId="run-1" />);

    await screen.findByText(/scanner coverage/i);
    expect(screen.getByText("bandit", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("semgrep")).toBeTruthy();
    expect(screen.getByText("measured")).toBeTruthy();
    expect(screen.getByText("unavailable")).toBeTruthy();
  });

  it("shows the real security score, dash when unmeasured, never a fabricated number", async () => {
    getSecurityRescan.mockResolvedValue(clone(NOT_MEASURED));
    render(<SecurityRescanPanel runId="run-1" />);

    await screen.findByText(/security score/i);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText(/not measured — no scanner executed/i)).toBeTruthy();
  });

  it("says no scanner executed when scannersRun is empty", async () => {
    getSecurityRescan.mockResolvedValue(clone(NOT_MEASURED));
    render(<SecurityRescanPanel runId="run-1" />);

    expect(await screen.findByText(/no security scanner executed/i)).toBeTruthy();
    expect(screen.getByText(/security result not measured/i)).toBeTruthy();
  });

  it("reports a load failure and retries on demand", async () => {
    getSecurityRescan.mockRejectedValueOnce(new Error("API 500: Internal Server Error"));
    getSecurityRescan.mockResolvedValueOnce(clone(CLEAN));
    render(<SecurityRescanPanel runId="run-1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/could not load security re-scan/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    const band = await screen.findByRole("status");
    expect(within(band).getByText("No new findings")).toBeTruthy();
  });

  it("shows the A10 handoff as inputs only, never A10's own decision", async () => {
    getSecurityRescan.mockResolvedValue(clone(REJECTED));
    render(<SecurityRescanPanel runId="run-1" />);

    await screen.findByText(/a9 security re-scan/i);
    expect(screen.getByText(/a10 decision/i)).toBeTruthy();
    expect(screen.getByText(/security hard gate/i)).toBeTruthy();
    expect(screen.getByText(/blocks auto-merge/i)).toBeTruthy();
    expect(screen.queryByText(/draft pr/i)).toBeNull();
    expect(screen.queryByText(/auto.?mergeable/i)).toBeNull();
  });

  it("never renders a severity band or category the backend does not measure", async () => {
    getSecurityRescan.mockResolvedValue(clone(REJECTED));
    const { container } = render(<SecurityRescanPanel runId="run-1" />);

    await screen.findByText(/vulnapi\/auth\.py:42/i);
    expect(container.textContent).not.toMatch(/critical\s*\d/i);
    expect(container.textContent).not.toMatch(/\bhigh\s*\d/i);
    expect(container.textContent).not.toMatch(/\bmedium\s*\d/i);
    expect(container.textContent).not.toMatch(/\blow\s*\d/i);
    expect(container.textContent).not.toMatch(/cwe-/i);
  });

  it("never renders a resolved/unchanged/before-after board the backend does not compute", async () => {
    getSecurityRescan.mockResolvedValue(clone(CLEAN));
    const { container } = render(<SecurityRescanPanel runId="run-1" />);

    await screen.findByRole("status");
    expect(container.textContent).not.toMatch(/resolved/i);
    expect(container.textContent).not.toMatch(/unchanged/i);
    expect(container.textContent).not.toMatch(/before patch/i);
    expect(container.textContent).not.toMatch(/after patch/i);
  });

  it("distinguishes A9 pending from A9 running", async () => {
    getSecurityRescan.mockResolvedValue(null);
    const { unmount } = render(<SecurityRescanPanel runId="run-1" />);
    expect(await screen.findByText(/security rescan pending/i)).toBeTruthy();
    unmount();

    getSecurityRescan.mockResolvedValue(null);
    render(<SecurityRescanPanel runId="run-2" status="running" />);
    expect(await screen.findByText(/a9 is re-scanning/i)).toBeTruthy();
  });

  it("exposes retry/security failure detail only behind progressive disclosure", async () => {
    getSecurityRescan.mockResolvedValue(clone(REJECTED));
    render(<SecurityRescanPanel runId="run-1" />);

    await screen.findByText(/new finding introduced/i);
    expect(screen.queryByText(/must not introduce possible hardcoded/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /re-execution & retry detail/i }));
    expect(await screen.findByText(/must not introduce possible hardcoded/i)).toBeTruthy();
    expect(screen.getByText("bandit -f json -q -r vulnapi")).toBeTruthy();
  });
});
