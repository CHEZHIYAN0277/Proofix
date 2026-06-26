import ast
from pathlib import Path

from backend.agents.a7_patch_engine import (
    PatchLLMOutput,
    apply_stub_plan,
    build_llm_prompt,
    build_patch_plans,
    contract_from_plan,
)
from backend.agents.base import AgentBase
from backend.models.blast import BlastGraphResult
from backend.models.patch import BehavioralContract, PatchBundle, PatchCandidate, PatchPlan
from backend.models.root_cause import RootCauseBrief
from backend.models.validation import RetryBrief
from backend.services.git_service import get_style_exemplar
from backend.services.llm import LLMService
from backend.services.mci_verifier import generate_diff_from_patches
from backend.state.schema import RunStateModel


class A7CodeGenerationAgent(AgentBase):
    agent_id = "A7"

    async def run(self, state: RunStateModel) -> RunStateModel:
        await self.emit_status(state, "started", "Generating validated patches")
        repo = Path(state.repo_clone_path or state.repo_path).resolve()
        acquired = await self.store.acquire_lock(state.run_id)

        try:
            if not acquired:
                await self.emit_status(state, "failed", "Could not acquire patch lock")
                return state

            root_cause = self._parse_root_cause(state.root_cause or {})
            blast = self._parse_blast_graph(state.blast_graph or {})
            fix_dag = state.fix_dag or {}
            retry_brief = self._parse_retry_brief(state.retry_brief)

            scope_files = self._resolve_scope_files(blast, state)
            plans = build_patch_plans(scope_files, root_cause, blast, retry_brief)

            patches: list[PatchCandidate] = []
            contracts: list[BehavioralContract] = []
            exemplar_commit = None

            for plan in plans[:3]:
                full = repo / plan.file
                if not full.exists():
                    continue

                original = full.read_text(encoding="utf-8")
                commit, exemplar = get_style_exemplar(repo, plan.file)
                if commit:
                    exemplar_commit = commit

                llm_output = await self._generate_from_plan(plan, original, exemplar, retry_brief)
                if not self._validate_python(llm_output.patched_content):
                    await self.emit_status(state, "failed", f"Invalid Python in {plan.file}")
                    continue

                patches.append(
                    PatchCandidate(
                        file=plan.file,
                        original=original,
                        patched=llm_output.patched_content,
                        method="ast_validated_write",
                    )
                )
                contracts.append(
                    BehavioralContract(
                        assertion=llm_output.contract_assertion,
                        location=llm_output.contract_location or plan.file,
                    )
                )
                full.write_text(llm_output.patched_content, encoding="utf-8")

            issue_id = (fix_dag.get("execution_order") or ["fix-0"])[0]
            diff_text = generate_diff_from_patches([p.model_dump() for p in patches])
            bundle = PatchBundle(
                issue_id=issue_id,
                patches=patches,
                contracts=contracts,
                style_exemplar_commit=exemplar_commit,
                diff_text=diff_text,
            )
            bundle_dict = bundle.model_dump(mode="json")
            await self.store.set_json(state.run_id, "patches", bundle_dict)
            state.patch_bundle = bundle_dict
            await self.emit_status(
                state,
                "completed",
                f"Generated {len(patches)} patches from {len(plans)} plans",
                {"files": [p.file for p in patches], "plan_count": len(plans)},
            )
        finally:
            await self.store.release_lock(state.run_id)
        return state

    def _parse_root_cause(self, data: dict) -> RootCauseBrief:
        return RootCauseBrief.model_validate(data) if data else RootCauseBrief()

    def _parse_blast_graph(self, data: dict) -> BlastGraphResult:
        return BlastGraphResult.model_validate(data) if data else BlastGraphResult()

    def _parse_retry_brief(self, data: dict | None) -> RetryBrief | None:
        if not data:
            return None
        return RetryBrief.model_validate(data)

    def _resolve_scope_files(self, blast: BlastGraphResult, state: RunStateModel) -> list[str]:
        if blast.auto_patch_scope:
            return blast.auto_patch_scope
        static = state.static_report or {}
        findings = static.get("prioritized", [])
        return [f["file"] for f in findings[:1]]

    async def _generate_from_plan(
        self,
        plan: PatchPlan,
        original: str,
        style_exemplar: str,
        retry_brief: RetryBrief | None,
    ) -> PatchLLMOutput:
        if self.settings.stub_mode or not self.settings.llm_configured():
            return apply_stub_plan(plan, original)

        llm = LLMService(self.settings)
        prompt = build_llm_prompt(plan, original, style_exemplar)
        if retry_brief:
            prompt += f"\n\n## Retry brief\n{retry_brief.model_dump_json()}"

        try:
            return await llm.structured(
                prompt,
                PatchLLMOutput,
                system=(
                    "You are a security-focused code repair assistant. "
                    "Apply the patch plan to the original file. "
                    "Return valid Python only. Do not use filename heuristics — "
                    "base all changes on the root cause, blast context, and constraints."
                ),
            )
        except Exception:
            return apply_stub_plan(plan, original)

    def _validate_python(self, code: str) -> bool:
        try:
            ast.parse(code)
            return True
        except SyntaxError:
            return False
