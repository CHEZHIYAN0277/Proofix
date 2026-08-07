from pydantic import BaseModel

from backend.agents.a5_5_context_engineering import load_context_package
from backend.agents.base import AgentBase
from backend.models.cve import CVEReachabilityReport
from backend.models.fix_dag import FixDAGPlan
from backend.models.sig import SemanticIntentGraph
from backend.services.fix_dag_builder import (
    apply_dependencies,
    build_dependency_edges,
    build_fix_nodes,
    detect_conflict_batches,
    topological_execution_order,
)
from backend.services.llm import LLMService
from backend.state.schema import RunStateModel


class FixOrderLLM(BaseModel):
    nodes: list[dict]
    execution_order: list[str]


class A6FixDAGPlannerAgent(AgentBase):
    agent_id = "A6"

    async def run(self, state: RunStateModel) -> RunStateModel:
        await self.emit_status(state, "started", "Planning fix DAG with conflict detection")
        blast = state.blast_graph or {}
        static = state.static_report or {}
        cve_data = state.cve_report or {}
        sig_data = state.sig or await self.store.get_json(state.run_id, "sig")

        scope_files = await self._scope_files(state, blast)
        findings = static.get("prioritized", [])
        cve_report = CVEReachabilityReport.model_validate(cve_data) if cve_data else CVEReachabilityReport()
        sig = SemanticIntentGraph.model_validate(sig_data) if sig_data else None

        nodes = build_fix_nodes(findings, cve_report.findings, scope_files)
        dependency_edges = build_dependency_edges(nodes, sig, cve_report.findings)
        nodes = apply_dependencies(nodes, dependency_edges)

        if self.settings.stub_mode or not self.settings.llm_configured():
            execution_order = topological_execution_order(nodes, dependency_edges)
        else:
            llm_order = await self._llm_order(nodes, state)
            execution_order = llm_order or topological_execution_order(nodes, dependency_edges)

        conflict_batches = detect_conflict_batches(nodes)

        plan = FixDAGPlan(
            nodes=nodes,
            execution_order=execution_order,
            conflict_batches=conflict_batches,
            dependency_edges=dependency_edges,
        )
        plan_dict = plan.model_dump(mode="json")
        state.fix_dag = plan_dict
        await self.emit_status(
            state,
            "completed",
            f"Fix plan: {len(execution_order)} steps, {len(conflict_batches)} conflict batches, "
            f"{len(dependency_edges)} dependency edges",
            {"order": execution_order, "conflict_batches": conflict_batches},
        )
        return state

    async def _scope_files(self, state: RunStateModel, blast: dict) -> list[str]:
        """Files to plan fixes over, ordered by A5.5 relevance when available.

        The *set* is always exactly `auto_patch_scope` — A5.5 reorders, it never
        adds or removes, so fix-node membership is unchanged. Any ranked file
        outside the scope is ignored, and any scope file A5.5 did not rank keeps
        its original position at the end.
        """
        auto_scope = blast.get("auto_patch_scope", [])
        if not auto_scope:
            return auto_scope

        package = await load_context_package(self.store, state.run_id)
        if package is None:
            return auto_scope

        scope_set = set(auto_scope)
        ordered = [f for f in package.ranked_paths() if f in scope_set]
        ordered += [f for f in auto_scope if f not in ordered]
        return ordered

    async def _llm_order(self, nodes, state: RunStateModel) -> list[str]:
        llm = LLMService(
            self.settings,
            run_id=state.run_id,
            agent_id=self.agent_id,
            retry_count=state.retry_count,
        )
        prompt = (
            "Order these fixes respecting dependencies (dependency upgrades before dependent app code):\n"
            f"{[n.model_dump() for n in nodes]}"
        )
        try:
            result = await llm.structured(prompt, FixOrderLLM)
            return result.execution_order or []
        except Exception:
            return []
