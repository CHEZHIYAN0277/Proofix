// @vitest-environment jsdom
/**
 * A10's Mergeability Decision panel. Every assertion traces to a field on
 * `GET /api/runs/{runId}/decision` — the point of this suite is to catch the
 * panel inventing a merge probability, collapsing an unmeasured axis into a
 * zero, drawing a not-reached gate as passed, or presenting A8/A9's scores
 * as A10's own findings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMergeabilityDecision = vi.fn();

vi.mock("@/lib/runService", () => ({
  getMergeabilityDecision: (...a: unknown[]) => getMergeabilityDecision(...a),
}));

const { MergeabilityDecisionPanel } = await import("./MergeabilityDecisionPanel");
import type { HardGate, MergeabilityDecision } from "./mergeabilityTypes";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tenGates(overrides: Partial<Record<string, Partial<HardGate>>> = {}): HardGate[] {
  const base: HardGate[] = [
    {
      code: "validation_exhausted",
      label: "Validation not exhausted",
      checked: true,
      passed: true,
      detail: null,
    },
    {
      code: "patch_retry_required",
      label: "Target test did not require another patch attempt",
      checked: true,
      passed: true,
      detail: null,
    },
    {
      code: "target_test_failed",
      label: "Target reproduced test passes after patch",
      checked: true,
      passed: true,
      detail: null,
    },
    {
      code: "regression_failed",
      label: "No new test regressions",
      checked: true,
      passed: true,
      detail: null,
    },
    {
      code: "security_rejected",
      label: "Security re-scan accepted the patch",
      checked: true,
      passed: true,
      detail: null,
    },
    {
      code: "phantoms_detected",
      label: "PR description matches the diff",
      checked: true,
      passed: true,
      detail: null,
    },
    {
      code: "correctness_low",
      label: "Correctness ≥ 80",
      checked: true,
      passed: true,
      detail: null,
    },
    { code: "security_low", label: "Security ≥ 80", checked: true, passed: true, detail: null },
    {
      code: "axes_measured",
      label: "All four axes measured",
      checked: true,
      passed: true,
      detail: null,
    },
    {
      code: "reproduction_confirmed",
      label: "Bug reproduction confirmed",
      checked: true,
      passed: true,
      detail: null,
    },
  ];
  return base.map((g) => ({ ...g, ...(overrides[g.code] ?? {}) }));
}

const AUTO_MERGE: MergeabilityDecision = {
  prType: "auto_mergeable",
  decisionLabel: "Auto Merge",
  reviewNote: null,
  trust: 0.95,
  axes: [
    {
      name: "correctness",
      label: "Correctness",
      value: 92,
      measured: true,
      lowThreshold: 80,
      meetsLowThreshold: true,
    },
    {
      name: "security",
      label: "Security",
      value: 100,
      measured: true,
      lowThreshold: 80,
      meetsLowThreshold: true,
      autoMergeThreshold: 90,
      meetsAutoMergeThreshold: true,
    },
    {
      name: "fidelity",
      label: "Fidelity",
      value: 100,
      measured: true,
      lowThreshold: 80,
      meetsLowThreshold: true,
    },
    {
      name: "scope_risk",
      label: "Scope Safety",
      value: 90,
      measured: true,
      lowThreshold: 80,
      meetsLowThreshold: true,
    },
  ],
  hardGates: tenGates(),
  routingModifiers: {
    hardGatesClear: true,
    citationReviewNeeded: false,
    reproductionConfidence: "exact_test",
    securityMeetsAutoMergeThreshold: true,
  },
  phantomChangesDetected: false,
  prUrl: "https://github.com/acme/vulnapi/pull/42",
  descriptionWhy: "Token expiry not checked",
  descriptionWhat: "Adds an expiry comparison in validate_token.",
  proofBundle: {
    bundleHash: "deadbeef1234",
    reproductionConfidence: "exact_test",
    steps: [
      {
        name: "reproduction_before",
        command: "pytest tests/test_auth.py::test_expired",
        baseCommit: "abc123",
        patchCommit: "",
        expectedResult: "fails",
        timeoutSeconds: 60,
        isTargeted: true,
      },
    ],
  },
};

const DRAFT_UNMEASURED: MergeabilityDecision = {
  prType: "draft",
  decisionLabel: "Draft PR",
  reviewNote: "Not measured: security. Manual verification required before merge.",
  trust: 0.94,
  axes: [
    {
      name: "correctness",
      label: "Correctness",
      value: 92,
      measured: true,
      lowThreshold: 80,
      meetsLowThreshold: true,
    },
    {
      name: "security",
      label: "Security",
      value: null,
      measured: false,
      lowThreshold: 80,
      meetsLowThreshold: null,
      autoMergeThreshold: 90,
      meetsAutoMergeThreshold: null,
    },
    {
      name: "fidelity",
      label: "Fidelity",
      value: 100,
      measured: true,
      lowThreshold: 80,
      meetsLowThreshold: true,
    },
    {
      name: "scope_risk",
      label: "Scope Safety",
      value: 90,
      measured: true,
      lowThreshold: 80,
      meetsLowThreshold: true,
    },
  ],
  hardGates: tenGates({
    axes_measured: {
      passed: false,
      detail:
        "Not measured: security. The pipeline did not produce these scores, so merge readiness could not be established. Manual verification required before merge.",
    },
    reproduction_confirmed: { checked: false, passed: null },
  }),
  routingModifiers: {
    hardGatesClear: false,
    citationReviewNeeded: null,
    reproductionConfidence: null,
    securityMeetsAutoMergeThreshold: null,
  },
  phantomChangesDetected: false,
  prUrl: null,
  descriptionWhy: "",
  descriptionWhat: "",
  proofBundle: null,
};

beforeEach(() => {
  getMergeabilityDecision.mockReset();
});

describe("MergeabilityDecisionPanel", () => {
  it("shows the real auto-mergeable verdict with the real trust score", async () => {
    getMergeabilityDecision.mockResolvedValue(clone(AUTO_MERGE));
    render(<MergeabilityDecisionPanel runId="run-1" />);

    const band = await screen.findByRole("status");
    expect(within(band).getByText(/auto-mergeable/i)).toBeTruthy();
    expect(screen.getByText("0.95")).toBeTruthy();
  });

  it("never turns an unmeasured axis into a zero", async () => {
    getMergeabilityDecision.mockResolvedValue(clone(DRAFT_UNMEASURED));
    render(<MergeabilityDecisionPanel runId="run-1" />);

    await screen.findByRole("status");
    expect(screen.getByText("not measured")).toBeTruthy();
    expect(screen.queryByText(/^0$/)).toBeNull();
  });

  it("shows the security asymmetry: clears the low bar but not the stricter auto-merge bar", async () => {
    const asymmetric = clone(AUTO_MERGE);
    asymmetric.prType = "diff_only";
    asymmetric.axes[1] = {
      ...asymmetric.axes[1],
      value: 85,
      meetsAutoMergeThreshold: false,
    };
    getMergeabilityDecision.mockResolvedValue(asymmetric);
    render(<MergeabilityDecisionPanel runId="run-1" />);

    await screen.findByRole("status");
    const securityRow = screen.getByText("Security").closest("div")!.parentElement!;
    expect(within(securityRow).getByText(/≥ 90 for auto-merge ✕/)).toBeTruthy();
    expect(within(securityRow).getByText(/≥ 80 ✓/)).toBeTruthy();
  });

  it("renders a not-reached gate distinctly from a passed one", async () => {
    getMergeabilityDecision.mockResolvedValue(clone(DRAFT_UNMEASURED));
    render(<MergeabilityDecisionPanel runId="run-1" />);

    await screen.findByRole("status");
    expect(screen.getByText(/not reached/i)).toBeTruthy();
    expect(screen.getAllByText(/not measured: security/i).length).toBeGreaterThan(0);
  });

  it("shows routing modifiers only once every hard gate clears", async () => {
    getMergeabilityDecision.mockResolvedValue(clone(DRAFT_UNMEASURED));
    render(<MergeabilityDecisionPanel runId="run-1" />);

    await screen.findByText(/routing modifiers/i);
    expect(screen.getByText(/not applicable/i)).toBeTruthy();
    expect(screen.queryByText(/citation review needed/i)).toBeNull();
  });

  it("shows routing modifiers as real facts when hard gates are clear", async () => {
    getMergeabilityDecision.mockResolvedValue(clone(AUTO_MERGE));
    render(<MergeabilityDecisionPanel runId="run-1" />);

    await screen.findByText(/citation review needed/i);
    expect(screen.getByText(/reproduction confidence/i)).toBeTruthy();
    expect(screen.getByText("exact_test")).toBeTruthy();
  });

  it("exposes the PR link only behind progressive disclosure", async () => {
    getMergeabilityDecision.mockResolvedValue(clone(AUTO_MERGE));
    render(<MergeabilityDecisionPanel runId="run-1" />);

    await screen.findByRole("status");
    expect(screen.queryByText(/github\.com\/acme\/vulnapi/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /pr & proof-bundle detail/i }));
    expect(await screen.findByText(/github\.com\/acme\/vulnapi/i)).toBeTruthy();
  });

  it("says a PR was not published rather than inventing a link", async () => {
    getMergeabilityDecision.mockResolvedValue(clone(DRAFT_UNMEASURED));
    render(<MergeabilityDecisionPanel runId="run-1" />);

    const toggle = await screen.findByRole("button", { name: /pr & proof-bundle detail/i });
    await userEvent.click(toggle);
    expect(await screen.findByText(/not published/i)).toBeTruthy();
  });

  it("never presents a merge probability, only the real trust mean", async () => {
    getMergeabilityDecision.mockResolvedValue(clone(AUTO_MERGE));
    const { container } = render(<MergeabilityDecisionPanel runId="run-1" />);

    await screen.findByRole("status");
    expect(container.textContent).not.toMatch(/probability/i);
    expect(container.textContent).not.toMatch(/confidence score/i);
    expect(screen.getByText(/not itself the routing gate/i)).toBeTruthy();
  });

  it("distinguishes A10 pending from A10 running", async () => {
    getMergeabilityDecision.mockResolvedValue(null);
    const { unmount } = render(<MergeabilityDecisionPanel runId="run-1" />);
    expect(await screen.findByText(/mergeability decision pending/i)).toBeTruthy();
    unmount();

    getMergeabilityDecision.mockResolvedValue(null);
    render(<MergeabilityDecisionPanel runId="run-2" status="running" />);
    expect(await screen.findByText(/a10 is scoring/i)).toBeTruthy();
  });

  it("reports a load failure and retries on demand", async () => {
    getMergeabilityDecision.mockRejectedValueOnce(new Error("API 500: Internal Server Error"));
    getMergeabilityDecision.mockResolvedValueOnce(clone(AUTO_MERGE));
    render(<MergeabilityDecisionPanel runId="run-1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    const band = await screen.findByRole("status");
    expect(within(band).getByText(/auto-mergeable/i)).toBeTruthy();
  });
});
