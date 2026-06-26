import asyncio

from pathlib import Path

from backend.agents.a1_semantic_mapper import A1SemanticMapperAgent
from backend.agents.a2_dependency_analyzer import A2DependencyAnalyzerAgent
from backend.agents.a3_static_analysis import A3StaticAnalysisAgent
from backend.agents.a3_5_reproduction import A35ReproductionAgent
from backend.agents.a4_evidence_investigator import A4EvidenceInvestigatorAgent
from backend.agents.a5_blast_graph import A5BlastGraphAgent
from backend.agents.a6_fix_dag_planner import A6FixDAGPlannerAgent
from backend.agents.a7_code_generation import A7CodeGenerationAgent
from backend.agents.a8_mutation_validator import A8MutationValidatorAgent
from backend.agents.a9_security_rescan import A9SecurityRescanAgent
from backend.agents.a10_mci_scorer import A10MCIScorerAgent
from backend.config import Settings
from backend.services.git_service import clone_or_copy_repo, get_head_sha
from backend.services.repo_layout import discover_source_roots
from backend.services.sig_helpers import reclassify_cve_report
from backend.state.redis_store import RedisStore
from backend.state.schema import RunState, RunStateModel


class GraphNodes:
    def __init__(self, store: RedisStore, settings: Settings):
        self.store = store
        self.settings = settings
        self.a1 = A1SemanticMapperAgent(store, settings)
        self.a2 = A2DependencyAnalyzerAgent(store, settings)
        self.a3 = A3StaticAnalysisAgent(store, settings)
        self.a35 = A35ReproductionAgent(store, settings)
        self.a4 = A4EvidenceInvestigatorAgent(store, settings)
        self.a5 = A5BlastGraphAgent(store, settings)
        self.a6 = A6FixDAGPlannerAgent(store, settings)
        self.a7 = A7CodeGenerationAgent(store, settings)
        self.a8 = A8MutationValidatorAgent(store, settings)
        self.a9 = A9SecurityRescanAgent(store, settings)
        self.a10 = A10MCIScorerAgent(store, settings)

    async def prepare_repo(self, state: RunStateModel) -> RunStateModel:
        if not state.repo_clone_path:
            state.repo_clone_path = clone_or_copy_repo(state.repo_path)
        if not state.source_roots:
            state.source_roots = discover_source_roots(Path(state.repo_clone_path).resolve())
        if not state.base_commit_sha:
            state.base_commit_sha = get_head_sha(Path(state.repo_clone_path))
        await self.store.save_state(state)
        return state

    async def parallel_intel(self, state: RunStateModel) -> RunStateModel:
        state.current_agent = "A1+A2+A3"
        await self.store.save_state(state)

        async def run_a1() -> RunStateModel:
            s = await self.store.load_state(state.run_id)
            assert s
            return await self.a1.run(s)

        async def run_a2() -> RunStateModel:
            s = await self.store.load_state(state.run_id)
            assert s
            return await self.a2.run(s)

        async def run_a3() -> RunStateModel:
            s = await self.store.load_state(state.run_id)
            assert s
            return await self.a3.run(s)

        results = await asyncio.gather(run_a1(), run_a2(), run_a3())
        merged = await self.store.load_state(state.run_id) or state
        for r in results:
            if r.sig:
                merged.sig = r.sig
            if r.cve_report:
                merged.cve_report = r.cve_report
            if r.static_report:
                merged.static_report = r.static_report
            merged.ws_sequence = max(merged.ws_sequence, r.ws_sequence)
        await self.store.save_state(merged)
        return merged

    async def layer1_fan_in(self, state: RunStateModel) -> RunStateModel:
        state.current_agent = "fan-in"
        sig = state.sig or await self.store.get_json(state.run_id, "sig")
        cve = state.cve_report or await self.store.get_json(state.run_id, "cve")
        if cve:
            reclassified = reclassify_cve_report(sig, cve)
            state.cve_report = reclassified
            await self.store.set_json(state.run_id, "cve", reclassified)
        await self.store.save_state(state)
        return state

    async def reproduction_gate(self, state: RunStateModel) -> RunStateModel:
        return await self.a35.run(state)

    async def investigate(self, state: RunStateModel) -> RunStateModel:
        return await self.a4.run(state)

    async def blast_scope(self, state: RunStateModel) -> RunStateModel:
        return await self.a5.run(state)

    async def plan_fixes(self, state: RunStateModel) -> RunStateModel:
        return await self.a6.run(state)

    async def generate_code(self, state: RunStateModel) -> RunStateModel:
        return await self.a7.run(state)

    async def validate_mutation(self, state: RunStateModel) -> RunStateModel:
        return await self.a8.run(state)

    async def validate_security(self, state: RunStateModel) -> RunStateModel:
        return await self.a9.run(state)

    async def route_pr(self, state: RunStateModel) -> RunStateModel:
        return await self.a10.run(state)
