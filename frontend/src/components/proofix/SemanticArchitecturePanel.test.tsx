// @vitest-environment jsdom
/**
 * A1's Semantic Architecture Map panel. Every assertion here traces back to a
 * specific field on `GET /api/runs/{runId}/semantic-graph` — the point of
 * this suite is to catch the panel inventing a role, a count, or a
 * connection the backend never sent, and to prove it never reads A0.5's
 * knowledge-graph endpoints as a semantic source.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getSemanticGraph = vi.fn();
const getKnowledgeMetrics = vi.fn();
const getKnowledgeGraph = vi.fn();
const getKnowledgeCapabilities = vi.fn();
const getKnowledgeHotspots = vi.fn();
const getKnowledgeQuery = vi.fn();

vi.mock("@/lib/runService", () => ({
  getSemanticGraph: (...a: unknown[]) => getSemanticGraph(...a),
  getKnowledgeMetrics: (...a: unknown[]) => getKnowledgeMetrics(...a),
  getKnowledgeGraph: (...a: unknown[]) => getKnowledgeGraph(...a),
  getKnowledgeCapabilities: (...a: unknown[]) => getKnowledgeCapabilities(...a),
  getKnowledgeHotspots: (...a: unknown[]) => getKnowledgeHotspots(...a),
  getKnowledgeQuery: (...a: unknown[]) => getKnowledgeQuery(...a),
}));

const { SemanticArchitecturePanel } = await import("./SemanticArchitecturePanel");

const GRAPH = {
  generatedAt: "2026-08-13T00:00:00",
  sourceRoots: ["vulnapi"],
  files: [
    {
      path: "vulnapi/auth.py",
      role: "auth-boundary",
      imports: [],
      importedBy: ["vulnapi/routes.py"],
      churnWeight: 0.3,
      criticality: 0.92,
    },
    {
      path: "vulnapi/routes.py",
      role: "public-api",
      imports: ["vulnapi/auth.py"],
      importedBy: [],
      churnWeight: 0.5,
      criticality: 0.55,
    },
    {
      path: "vulnapi/utils.py",
      role: "internal-util",
      imports: [],
      importedBy: [],
      churnWeight: 0.1,
      criticality: 0.2,
    },
  ],
  edges: [["vulnapi/routes.py", "vulnapi/auth.py"]],
  roleCounts: {
    "auth-boundary": 1,
    "data-access": 0,
    "public-api": 1,
    "config-surface": 0,
    "test-only": 0,
    "internal-util": 1,
  },
  totalFiles: 3,
  totalEdges: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SemanticArchitecturePanel", () => {
  it("shows Loading before the backend responds", () => {
    getSemanticGraph.mockReturnValue(new Promise(() => {}));
    render(<SemanticArchitecturePanel runId="r1" />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders Pending when A1 has not published a semantic graph for this run", async () => {
    getSemanticGraph.mockResolvedValue(null);
    render(<SemanticArchitecturePanel runId="r1" />);
    expect(
      await screen.findByText(/A1 has not published a semantic graph for this run yet/),
    ).toBeTruthy();
  });

  it("shows a distinct running message rather than the generic pending one", async () => {
    getSemanticGraph.mockResolvedValue(null);
    render(<SemanticArchitecturePanel runId="r1" status="running" />);
    expect(await screen.findByText(/A1 is classifying files now/)).toBeTruthy();
  });

  it("surfaces a real failure with a retry", async () => {
    getSemanticGraph.mockRejectedValue(new Error("API 500: Internal Server Error"));
    render(<SemanticArchitecturePanel runId="r1" />);
    expect(await screen.findByText("API 500: Internal Server Error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("renders an explicit empty message when A1 classified zero files", async () => {
    getSemanticGraph.mockResolvedValue({ ...GRAPH, files: [], totalFiles: 0 });
    render(<SemanticArchitecturePanel runId="r1" />);
    expect(await screen.findByText(/classified no production files/)).toBeTruthy();
  });

  it("renders only the roles the backend actually sent, none invented", async () => {
    getSemanticGraph.mockResolvedValue(GRAPH);
    render(<SemanticArchitecturePanel runId="r1" />);

    await screen.findByText("Semantic Architecture Map");
    // Present roles render in both the distribution list and the architecture
    // tree, so at least one instance is expected in each case.
    expect(screen.getAllByText("Auth Boundary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Public API").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Internal Utility").length).toBeGreaterThan(0);
    // Zero-count roles are reported, not hidden: the distribution must show
    // every one of the six real roles from `roleCounts`, including absent ones.
    // Absent roles never reach the tree, so exactly one instance is expected.
    expect(screen.getByText("Data Access")).toBeTruthy();
    expect(screen.getByText("Config Surface")).toBeTruthy();
    expect(screen.getByText("Test Only")).toBeTruthy();
    // No fabricated category outside the six the backend can send.
    expect(screen.queryByText(/SERVICES/)).toBeNull();
    expect(screen.queryByText(/^DATA$/)).toBeNull();
  });

  it("explanation checklist only lists roles A1 actually detected", async () => {
    getSemanticGraph.mockResolvedValue(GRAPH);
    render(<SemanticArchitecturePanel runId="r1" />);

    await screen.findByText("What A1 discovered");
    expect(screen.getByText(/Authentication \/ authorization logic identified/)).toBeTruthy();
    expect(screen.getByText(/Public API entrypoints identified/)).toBeTruthy();
    // data-access has zero files in this fixture — must not appear as detected.
    expect(screen.queryByText(/Data access \/ persistence layer identified/)).toBeNull();
  });

  it("hotspots show the real criticality score alongside its derived band", async () => {
    getSemanticGraph.mockResolvedValue(GRAPH);
    render(<SemanticArchitecturePanel runId="r1" />);

    await screen.findByText("Semantic hotspots");
    expect(screen.getByText("0.92")).toBeTruthy();
    expect(screen.getByText("HIGH")).toBeTruthy();
    expect(screen.getByText("0.20")).toBeTruthy();
    expect(screen.getByText("LOW")).toBeTruthy();
  });

  it("selecting a file opens the module inspector with real fields and 'Not measured' for what A1 never computes", async () => {
    getSemanticGraph.mockResolvedValue(GRAPH);
    const user = userEvent.setup();
    render(<SemanticArchitecturePanel runId="r1" />);

    await screen.findByText("Semantic Architecture Map");
    await user.click(screen.getByText("auth.py"));

    const inspector = await screen.findByRole("complementary", { name: "Module inspector" });
    within(inspector).getByText("vulnapi/auth.py");
    expect(within(inspector).getByText("0.92")).toBeTruthy();
    // A1 has no function/test-level data — the inspector must say so, never 0.
    expect(within(inspector).getAllByText("Not measured").length).toBeGreaterThan(0);
  });

  it("searches by path and by role label", async () => {
    getSemanticGraph.mockResolvedValue(GRAPH);
    const user = userEvent.setup();
    render(<SemanticArchitecturePanel runId="r1" />);

    await screen.findByText("Semantic Architecture Map");
    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = (await screen.findByRole("table")).closest("div")!;
    within(table).getByText("vulnapi/auth.py");

    await user.type(screen.getByPlaceholderText("Search files or roles…"), "routes");
    await waitFor(() => {
      expect(within(table).queryByText("vulnapi/auth.py")).toBeNull();
      expect(within(table).getByText("vulnapi/routes.py")).toBeTruthy();
    });
  });

  it("the table view is a complete fallback for every file, sortable by the same real fields", async () => {
    getSemanticGraph.mockResolvedValue(GRAPH);
    const user = userEvent.setup();
    render(<SemanticArchitecturePanel runId="r1" />);

    await screen.findByText("Semantic Architecture Map");
    await user.click(screen.getByRole("button", { name: "Table" }));

    const table = await screen.findByRole("table");
    expect(within(table).getByText("vulnapi/auth.py")).toBeTruthy();
    expect(within(table).getByText("vulnapi/routes.py")).toBeTruthy();
    expect(within(table).getByText("vulnapi/utils.py")).toBeTruthy();
  });

  it("never calls A0.5's knowledge-graph endpoints — A1's semantic truth is its own", async () => {
    getSemanticGraph.mockResolvedValue(GRAPH);
    render(<SemanticArchitecturePanel runId="r1" />);

    await screen.findByText("Semantic Architecture Map");
    expect(getKnowledgeMetrics).not.toHaveBeenCalled();
    expect(getKnowledgeGraph).not.toHaveBeenCalled();
    expect(getKnowledgeCapabilities).not.toHaveBeenCalled();
    expect(getKnowledgeHotspots).not.toHaveBeenCalled();
    expect(getKnowledgeQuery).not.toHaveBeenCalled();
  });

  it("carries the explainability source line for the semantic graph endpoint", async () => {
    getSemanticGraph.mockResolvedValue(GRAPH);
    render(<SemanticArchitecturePanel runId="r1" />);

    await screen.findByText("Semantic Architecture Map");
    expect(screen.getByText(/semantic-graph/)).toBeTruthy();
  });
});
