// @vitest-environment jsdom
/**
 * The run report renders only what was measured.
 *
 * - **B-F02** — `report` used to default to `MOCK_RUN_REPORT`. Omitting the prop
 *   rendered a different repository's trust score, file list and PR decision as
 *   though they belonged to this run. The prop is now required, which makes the
 *   defect a compile error rather than a test; what is tested here is the
 *   behaviour that replaced it — an unmeasured report says so.
 * - **B-F05** — a blocked run's decision badge used to borrow the draft tone.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunReport } from "./RunReport";
import { EMPTY_RUN_REPORT } from "./emptyModels";

describe("RunReport trust score", () => {
  it("reports an unmeasured trust score as unmeasured, never as a number", () => {
    render(<RunReport done report={{ ...EMPTY_RUN_REPORT, trustScore: null }} />);

    expect(screen.getByText("Not measured")).toBeTruthy();
    // The threshold comparison is a verdict; a run with no measurement has not
    // reached one, so neither phrasing may appear.
    expect(screen.queryByText(/Confidence meets threshold/)).toBeNull();
    expect(screen.queryByText(/Confidence below threshold/)).toBeNull();
    expect(
      screen.getByText(/No axis was measured, so confidence could not be established/),
    ).toBeTruthy();
  });

  it("renders a real score against its threshold", () => {
    render(
      <RunReport done report={{ ...EMPTY_RUN_REPORT, trustScore: 0.91, trustThreshold: 0.9 }} />,
    );

    expect(screen.queryByText("Not measured")).toBeNull();
    expect(screen.getByText(/Confidence meets threshold/)).toBeTruthy();
  });

  it("renders a measured zero as a score, not as an absence", () => {
    render(<RunReport done report={{ ...EMPTY_RUN_REPORT, trustScore: 0, trustThreshold: 0.9 }} />);

    expect(screen.queryByText("Not measured")).toBeNull();
    expect(screen.getByText(/Confidence below threshold/)).toBeTruthy();
  });
});

describe("RunReport decision badge", () => {
  it("gives a blocked run its own badge rather than the draft one", () => {
    render(
      <RunReport
        done
        report={{
          ...EMPTY_RUN_REPORT,
          decision: "blocked",
          decisionLabel: "Environment not prepared",
        }}
      />,
    );

    const badge = screen.getByText("Environment not prepared");
    expect(badge.className).toContain("status-blocked");
    expect(badge.className).not.toContain("status-draft");
  });
});
