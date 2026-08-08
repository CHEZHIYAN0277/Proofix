/**
 * Reading A6's plan — shared derivations for the Repair Planning stage.
 *
 * Everything here is a *rearrangement* of published fields: indexing the DAG by
 * step id, projecting it into the graph export shape, and checking the order
 * against the edges. Nothing is estimated, and nothing fills a gap A6 left.
 */

import type { DependencyEdge, FixNode, GraphExport, RepairPlan } from "@/lib/v2/types";

/** A step as the stage renders it: A6's node, plus its place in the order. */
export interface PlanStep {
  issueId: string;
  /** 1-based position in `execution_order`, or `null` when it is unscheduled. */
  position: number | null;
  files: string[];
  dependsOn: string[];
  /**
   * Prerequisites A6 scheduled *after* this step, or not at all.
   *
   * A6 may hand ordering to an LLM (`_llm_order`) and only falls back to the
   * topological sort when that returns nothing, so the published order is not
   * guaranteed to respect the published edges. Where they disagree, the stage
   * shows both rather than quietly re-sorting into agreement.
   */
  unsatisfied: string[];
}

/**
 * Every step in the plan, in execution order, with any node A6 built but never
 * scheduled appended after — an unscheduled node is a real fact about the plan
 * and dropping it would make the DAG look complete when it is not.
 */
export function planSteps(plan: RepairPlan): PlanStep[] {
  const order = plan.execution_order ?? [];
  const position = new Map(order.map((id, index) => [id, index]));
  const byId = new Map((plan.nodes ?? []).map((node) => [node.issue_id, node]));

  // Edges are a second source of dependencies alongside `node.depends_on`;
  // A6 writes both (`apply_dependencies`), so a step's prerequisites are the
  // union of the two.
  const prerequisites = new Map<string, Set<string>>();
  const add = (to: string, from: string) => {
    if (!prerequisites.has(to)) prerequisites.set(to, new Set());
    prerequisites.get(to)!.add(from);
  };
  for (const node of plan.nodes ?? []) {
    for (const dep of node.depends_on ?? []) add(node.issue_id, dep);
  }
  for (const edge of plan.dependency_edges ?? []) add(edge.to_issue, edge.from_issue);

  const ids = [
    ...order,
    ...(plan.nodes ?? []).map((n) => n.issue_id).filter((id) => !position.has(id)),
  ];

  return [...new Set(ids)].map((issueId) => {
    const node: FixNode | undefined = byId.get(issueId);
    const index = position.get(issueId);
    const deps = [...(prerequisites.get(issueId) ?? [])];

    return {
      issueId,
      position: index === undefined ? null : index + 1,
      files: node?.files ?? [],
      dependsOn: deps,
      unsatisfied: deps.filter((dep) => {
        const depIndex = position.get(dep);
        if (index === undefined) return false; // Unscheduled: nothing to compare.
        return depIndex === undefined || depIndex > index;
      }),
    };
  });
}

/** Steps that share at least one file with another step in the same batch. */
export function conflictedSteps(plan: RepairPlan): Set<string> {
  const conflicted = new Set<string>();
  for (const batch of plan.conflict_batches ?? []) {
    for (const id of batch) conflicted.add(id);
  }
  return conflicted;
}

/**
 * The DAG in the shape `<GraphCanvas>` consumes.
 *
 * Node `file` carries the first file the step edits — the canvas shows it in
 * the table equivalent and the search matches on it. Steps that edit nothing
 * carry an empty string, which the table renders as "—".
 */
export function planGraph(plan: RepairPlan): GraphExport {
  const steps = planSteps(plan);

  return {
    name: "Repair DAG",
    truncated: false,
    total_nodes: steps.length,
    nodes: steps.map((step) => ({
      id: step.issueId,
      type: "module",
      label: step.issueId,
      file: step.files[0] ?? "",
      qualname: step.files.join(", "),
    })),
    edges: (plan.dependency_edges ?? []).map((edge: DependencyEdge) => ({
      source: edge.from_issue,
      target: edge.to_issue,
      type: "DEPENDS_ON",
      reason: edge.reason,
    })),
  };
}
