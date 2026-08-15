// @vitest-environment jsdom
/**
 * A6's Repair Strategy Board. Every assertion traces to a specific field on
 * `GET /api/runs/{runId}/repair-plan` — the point of this suite is to catch
 * the panel inventing a confidence, hiding the fact that A7 does not execute
 * this plan's order, or dropping a step the LLM ordering omitted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getRepairPlan = vi.fn();

vi.mock("@/lib/runService", () => ({
  getRepairPlan: (...a: unknown[]) => getRepairPlan(...a),
}));

const { RepairPlanPanel } = await import("./RepairPlanPanel");
import type { RepairPlan } from "./repairPlanTypes";

const PLAN: RepairPlan = {
  steps: [
    {
      issueId: "cve-CVE-1",
      position: 1,
      ordered: true,
      files: ["vulnapi/auth.py"],
      dependsOn: [],
      incomingEdges: [],
      conflictsWith: [],
      why: {
        kind: "cve",
        package: "pyjwt",
        severity: "HIGH",
        installedVersion: "1.0.0",
        reachPath: ["vulnapi/auth.py"],
      },
      isHandoffTarget: true,
    },
    {
      issueId: "finding-0",
      position: 2,
      ordered: true,
      files: ["vulnapi/auth.py"],
      dependsOn: ["cve-CVE-1"],
      incomingEdges: [
        { fromIssue: "cve-CVE-1", reason: "cve_reachability:pyjwt->vulnapi/auth.py" },
      ],
      conflictsWith: ["finding-1"],
      why: {
        kind: "static_finding",
        message: "hardcoded secret",
        severity: 0.9,
        severityMeasured: true,
        tools: ["bandit"],
      },
      isHandoffTarget: false,
    },
    {
      issueId: "finding-1",
      position: 3,
      ordered: true,
      files: ["vulnapi/auth.py"],
      dependsOn: [],
      incomingEdges: [],
      conflictsWith: ["finding-0"],
      why: {
        kind: "static_finding",
        message: "weak comparison",
        severity: 0.4,
        severityMeasured: false,
        tools: ["ruff"],
      },
      isHandoffTarget: false,
    },
  ],
  conflictBatches: [["finding-0", "finding-1"]],
  orderingSource: "deterministic",
  orderingRationale: "",
  totalDependencyEdges: 1,
  executionAuthority: {
    consumedBy: "A7",
    field: "execution_order[0]",
    note: "A7 reads only the first step's identifier as a label for its patch bundle. It derives its actual patch targets from A5's blast scope and A4's root cause, not from this plan's order or dependencies.",
  },
  carriedForward: {
    acceptanceCriteria: ["reject tokens whose exp is in the past"],
    patchConstraints: ["Must not reintroduce: hardcoded secret"],
    targetFunction: "validate_token",
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

beforeEach(() => {
  getRepairPlan.mockReset();
});

describe("RepairPlanPanel", () => {
  it("renders the planned order with position and files", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    await screen.findAllByText("cve-CVE-1");
    expect(screen.getAllByText("finding-0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("vulnapi/auth.py").length).toBeGreaterThan(0);
  });

  it("always shows the execution-authority banner naming A7's real behavior", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    const banner = await screen.findByRole("note");
    expect(within(banner).getByText(/does not execute it/i)).toBeTruthy();
    expect(banner.textContent).toMatch(/reads only the first step/i);
  });

  it("joins a CVE step to A2's own record", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    // Real duplication, not accidental: the handoff step's "why" appears once
    // in the "Handed to A7" headline and once in its own timeline row.
    expect((await screen.findAllByText(/pyjwt \(HIGH\) 1\.0\.0/)).length).toBeGreaterThan(0);
  });

  it("joins a static-finding step to A3's own message and severity", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    expect(await screen.findByText(/hardcoded secret \(bandit\) — severity 0\.90/)).toBeTruthy();
  });

  it("shows unmeasured severity as text, never as a fabricated number", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    expect(
      await screen.findByText(/weak comparison \(ruff\) — severity severity not measured/),
    ).toBeTruthy();
  });

  it("shows the dependency backreference and its real reason", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    const finding0 = (await screen.findAllByText("finding-0"))[0].closest("li")!;
    expect(finding0.textContent).toMatch(
      /depends on cve-CVE-1 \(cve_reachability:pyjwt->vulnapi\/auth\.py\)/,
    );
  });

  it("shows the conflict warning as coordination, never as 'blocked'", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    const warnings = await screen.findAllByText(/cannot be applied independently/i);
    expect(warnings.length).toBeGreaterThan(0);
    expect(screen.queryByText(/\bblocked\b/i)).toBeNull();
  });

  it("flags a step the LLM ordering omitted rather than dropping it", async () => {
    const withOmission = clone(PLAN);
    withOmission.steps[2].ordered = false;
    withOmission.orderingSource = "llm";
    getRepairPlan.mockResolvedValue(withOmission);
    render(<RepairPlanPanel runId="run-1" />);

    expect(await screen.findByText(/not named in the model's order/i)).toBeTruthy();
    // still present in the timeline, not silently removed
    expect(screen.getAllByText("finding-1").length).toBeGreaterThan(0);
  });

  it("shows the ordering basis and an expandable rationale when the LLM gave one", async () => {
    const withRationale = clone(PLAN);
    withRationale.orderingSource = "llm";
    withRationale.orderingRationale = "Fix the reachable CVE before the app-level finding.";
    getRepairPlan.mockResolvedValue(withRationale);
    render(<RepairPlanPanel runId="run-1" />);

    const basis = await screen.findByRole("group", { name: /ordering basis/i });
    expect(within(basis).getByText("LLM-ordered")).toBeTruthy();

    const toggle = within(basis).getByRole("button", { name: /model's rationale/i });
    expect(within(basis).queryByText(/fix the reachable cve/i)).toBeNull();
    await userEvent.click(toggle);
    expect(within(basis).getByText(/fix the reachable cve/i)).toBeTruthy();
  });

  it("reports ordering basis as Not measured on a run predating the field", async () => {
    const legacy = clone(PLAN);
    legacy.orderingSource = null;
    getRepairPlan.mockResolvedValue(legacy);
    render(<RepairPlanPanel runId="run-1" />);

    const basis = await screen.findByRole("group", { name: /ordering basis/i });
    expect(within(basis).getByText("Not measured")).toBeTruthy();
  });

  it("shows A5.5's carried-forward evidence, attributed to A5.5", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    expect(await screen.findByText("reject tokens whose exp is in the past")).toBeTruthy();
    expect(screen.getByText("Must not reintroduce: hardcoded secret")).toBeTruthy();
    expect(screen.getByText(/acceptance criteria \(a5\.5\)/i)).toBeTruthy();
  });

  it("says carried-forward evidence is not measured when A5.5 never ran", async () => {
    const noContext = clone(PLAN);
    noContext.carriedForward = null;
    getRepairPlan.mockResolvedValue(noContext);
    render(<RepairPlanPanel runId="run-1" />);

    expect(await screen.findByText(/carried forward from a5\.5 — not measured/i)).toBeTruthy();
  });

  it("never shows a confidence figure anywhere on the panel", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    const { container } = render(<RepairPlanPanel runId="run-1" />);

    await screen.findAllByText("cve-CVE-1");
    expect(container.textContent).not.toMatch(/confidence/i);
  });

  it("renders the full ledger as a sortable-free table with every step", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    const ledger = await screen.findByText(/full ledger \(3\)/i);
    const table = ledger.parentElement!.querySelector("table")!;
    expect(within(table).getAllByRole("row").length).toBe(4); // header + 3 steps
  });

  it("renders an empty plan as a real answer, not pending", async () => {
    const empty: RepairPlan = {
      ...clone(PLAN),
      steps: [],
      conflictBatches: [],
      totalDependencyEdges: 0,
    };
    getRepairPlan.mockResolvedValue(empty);
    render(<RepairPlanPanel runId="run-1" />);

    expect(await screen.findByText(/no fixes planned/i)).toBeTruthy();
  });

  it("distinguishes A6 pending from A6 running", async () => {
    getRepairPlan.mockResolvedValue(null);
    const { unmount } = render(<RepairPlanPanel runId="run-1" />);
    expect(await screen.findByText(/a6 has not completed/i)).toBeTruthy();
    unmount();

    getRepairPlan.mockResolvedValue(null);
    render(<RepairPlanPanel runId="run-2" status="running" />);
    expect(await screen.findByText(/a6 is sequencing/i)).toBeTruthy();
  });

  it("reports a load failure and retries on demand", async () => {
    getRepairPlan.mockRejectedValueOnce(new Error("API 500: Internal Server Error"));
    getRepairPlan.mockResolvedValueOnce(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findAllByText("cve-CVE-1")).not.toHaveLength(0);
  });

  // -- "Handed to A7" -------------------------------------------------------

  it("shows the Handed to A7 card with the real handoff issue and files", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    const card = await screen.findByRole("group", { name: /handed to a7/i });
    expect(within(card).getByText("cve-CVE-1")).toBeTruthy();
    expect(within(card).getByText("vulnapi/auth.py")).toBeTruthy();
    // Only the handoff step's files/issue — not every step in the plan.
    expect(within(card).queryByText("finding-0")).toBeNull();
  });

  it("shows the real 'why' on the Handed to A7 card, attributed to A2/A3", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    const card = await screen.findByRole("group", { name: /handed to a7/i });
    expect(within(card).getByText(/pyjwt \(HIGH\) 1\.0\.0/)).toBeTruthy();
  });

  it("shows the real A5.5 target function on the handoff card, clearly attributed", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    const card = await screen.findByRole("group", { name: /handed to a7/i });
    expect(within(card).getByText("validate_token()")).toBeTruthy();
    expect(within(card).getByText(/A5\.5 context, not A6's own analysis/i)).toBeTruthy();
  });

  it("omits the target function on the handoff card when A5.5 never ran", async () => {
    const noContext = clone(PLAN);
    noContext.carriedForward = null;
    getRepairPlan.mockResolvedValue(noContext);
    render(<RepairPlanPanel runId="run-1" />);

    const card = await screen.findByRole("group", { name: /handed to a7/i });
    expect(within(card).queryByText(/target function/i)).toBeNull();
    expect(within(card).queryByText(/\(\)/)).toBeNull();
  });

  it("never invents a target function when A5.5 resolved none", async () => {
    const noTargetFn = clone(PLAN);
    noTargetFn.carriedForward!.targetFunction = null;
    getRepairPlan.mockResolvedValue(noTargetFn);
    render(<RepairPlanPanel runId="run-1" />);

    const card = await screen.findByRole("group", { name: /handed to a7/i });
    expect(within(card).queryByText(/target function/i)).toBeNull();
  });

  it("visually marks the same step in the timeline as the handoff target", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    await screen.findByRole("group", { name: /handed to a7/i });
    const badges = screen.getAllByText(/handed to a7/i);
    // The card's own label plus exactly one badge in the timeline — never on
    // more than one step.
    expect(badges.length).toBe(2);
  });

  it("does not mark a non-handoff step, and files/issue of other steps never appear on the card", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    await screen.findByText(/planned order/i);
    const items = screen.getAllByRole("listitem");
    const marked = items.filter((li) => within(li).queryByText(/handed to a7/i));
    expect(marked).toHaveLength(1);
    expect(within(marked[0]).getByText("cve-CVE-1")).toBeTruthy();
  });

  it("shows an honest empty state when no step is the handoff target", async () => {
    const noHandoff = clone(PLAN);
    noHandoff.steps = noHandoff.steps.map((s) => ({ ...s, isHandoffTarget: false }));
    getRepairPlan.mockResolvedValue(noHandoff);
    render(<RepairPlanPanel runId="run-1" />);

    const card = await screen.findByRole("group", { name: /handed to a7/i });
    expect(within(card).getByText(/not available/i)).toBeTruthy();
    expect(screen.queryByText(/handed to a7$/i, { selector: "li *" })).toBeNull();
  });

  it("shows an honest empty state when the plan has no steps at all", async () => {
    const empty: RepairPlan = {
      ...clone(PLAN),
      steps: [],
      conflictBatches: [],
      totalDependencyEdges: 0,
    };
    getRepairPlan.mockResolvedValue(empty);
    render(<RepairPlanPanel runId="run-1" />);

    const card = await screen.findByRole("group", { name: /handed to a7/i });
    expect(within(card).getByText(/not available/i)).toBeTruthy();
  });

  it("keeps the timeline, ordering basis, and ledger intact alongside the new card", async () => {
    getRepairPlan.mockResolvedValue(clone(PLAN));
    render(<RepairPlanPanel runId="run-1" />);

    expect(await screen.findByText(/planned order/i)).toBeTruthy();
    expect(await screen.findByRole("group", { name: /ordering basis/i })).toBeTruthy();
    expect(await screen.findByText(/full ledger/i)).toBeTruthy();
  });
});
