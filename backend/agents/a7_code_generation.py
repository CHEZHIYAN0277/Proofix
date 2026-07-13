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
from backend.services.retry_brief_builder import retry_reason_from_brief
from backend.services.runtime_patch_prompt import (
    COMPLETE_FILE_RETRY_INSTRUCTION,
    build_retry_prompt_section,
    build_runtime_patch_prompt,
    extract_relevant_code,
    has_semantic_diff,
    uses_runtime_prompt,
    validate_patch_integrity,
)
from backend.state.schema import RunStateModel


class A7CodeGenerationAgent(AgentBase):
    agent_id = "A7"

    async def run(self, state: RunStateModel) -> RunStateModel:
        state.current_agent = self.agent_id
        await self.store.save_state(state)
        await self.emit_status(state, "started", "Generating validated patches")
        repo = Path(state.repo_clone_path or state.repo_path).resolve()
        acquired = await self.store.acquire_lock(state.run_id)

        metrics: list[dict] = []

        try:
            if not acquired:
                await self.emit_status(state, "failed", "Could not acquire patch lock")
                return state

            root_cause = self._parse_root_cause(state.root_cause or {})
            blast = self._parse_blast_graph(state.blast_graph or {})
            fix_dag = state.fix_dag or {}
            retry_brief = self._parse_retry_brief(state.retry_brief)

            scope_files = self._resolve_scope_files(blast, state)
            file_sources = self._load_file_sources(repo, scope_files, state)
            plans = build_patch_plans(
                scope_files,
                root_cause,
                blast,
                retry_brief,
                reproduction=state.reproduction,
                repo_path=repo,
                file_sources=file_sources,
            )

            patches: list[PatchCandidate] = []
            contracts: list[BehavioralContract] = []
            exemplar_commit = None

            for plan in plans[:3]:
                full = repo / plan.file
                if not full.exists():
                    continue

                original = self._resolve_original_baseline(full, plan.file, state)
                commit, exemplar = get_style_exemplar(repo, plan.file)
                if commit:
                    exemplar_commit = commit

                previous_patch = self._previous_patch_for_file(state, plan.file)
                llm_output, plan_metrics = await self._generate_from_plan(
                    plan,
                    original,
                    exemplar,
                    retry_brief,
                    state.mutation_result,
                    previous_patch,
                    repo,
                    state.retry_count,
                )
                metrics.append(plan_metrics)

                if llm_output is None:
                    await self.emit_status(
                        state,
                        "failed",
                        f"No semantic patch generated for {plan.file}",
                        {"a7_patch_metrics": plan_metrics},
                    )
                    continue

                ok, integrity_reason = validate_patch_integrity(original, llm_output.patched_content)
                if not ok:
                    plan_metrics["retry_reason"] = integrity_reason
                    plan_metrics["semantic_diff"] = False
                    await self.emit_status(
                        state,
                        "failed",
                        f"Patch integrity check failed for {plan.file}: {integrity_reason}",
                        {"a7_patch_metrics": plan_metrics},
                    )
                    continue

                if not self._validate_python(llm_output.patched_content):
                    await self.emit_status(state, "failed", f"Invalid Python in {plan.file}")
                    continue

                full.write_text(original, encoding="utf-8")
                full.write_text(llm_output.patched_content, encoding="utf-8")

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

            payload = {
                "files": [p.file for p in patches],
                "plan_count": len(plans),
            }
            if metrics:
                payload["a7_patch_metrics"] = metrics[0] if len(metrics) == 1 else metrics

            await self.emit_status(
                state,
                "completed",
                f"Generated {len(patches)} patches from {len(plans)} plans",
                payload,
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

    def _load_file_sources(
        self,
        repo: Path,
        scope_files: list[str],
        state: RunStateModel,
    ) -> dict[str, str]:
        sources: dict[str, str] = {}
        for file_path in scope_files:
            baseline = self._resolve_original_baseline(repo / file_path, file_path, state)
            if (repo / file_path).exists():
                sources[file_path] = baseline
        return sources

    def _resolve_original_baseline(
        self,
        full: Path,
        file_path: str,
        state: RunStateModel,
    ) -> str:
        if state.patch_bundle:
            for patch in state.patch_bundle.get("patches", []):
                if patch.get("file") == file_path and patch.get("original"):
                    return patch["original"]
        if full.exists():
            return full.read_text(encoding="utf-8")
        return ""

    def _previous_patch_for_file(self, state: RunStateModel, file_path: str) -> dict | None:
        if not state.patch_bundle:
            return None
        for patch in state.patch_bundle.get("patches", []):
            if patch.get("file") == file_path:
                return patch
        return None

    async def _generate_from_plan(
        self,
        plan: PatchPlan,
        original: str,
        style_exemplar: str,
        retry_brief: RetryBrief | None,
        mutation_result: dict | None,
        previous_patch: dict | None,
        repo: Path,
        retry_count: int,
    ) -> tuple[PatchLLMOutput | None, dict]:
        retry_number = retry_count
        metrics = {
            "target_file": plan.target_file or plan.file,
            "target_function": plan.target_function,
            "runtime_prompt": uses_runtime_prompt(plan),
            "semantic_diff": False,
            "retry_reason": None,
            "retry_number": retry_number,
        }

        if retry_brief and retry_count >= 1:
            metrics["retry_reason"] = retry_reason_from_brief(retry_brief)

        if self.settings.stub_mode or not self.settings.llm_configured():
            output = apply_stub_plan(plan, original)
            metrics["semantic_diff"] = has_semantic_diff(original, output.patched_content)
            return output, metrics

        llm = LLMService(self.settings)
        repo_context = str(repo)
        relevant_code = extract_relevant_code(original, plan.target_function)

        if uses_runtime_prompt(plan):
            prompt = build_runtime_patch_prompt(
                plan, relevant_code, style_exemplar, repo_context, complete_original=original
            )
        else:
            prompt = build_llm_prompt(plan, original, style_exemplar, repo_context)

        if retry_brief and retry_count >= 1:
            prompt += build_retry_prompt_section(
                retry_brief,
                mutation_result,
                previous_patch,
                retry_count,
            )

        system = (
            "You are a security-focused code repair assistant fixing a reproduced runtime bug. "
            "Apply the minimum code change required. Return valid Python only. "
            "Do not reformat unrelated code. Return the complete file."
        )

        try:
            output = await self._call_llm_with_integrity_guard(llm, prompt, system, original, metrics)
            if output is None:
                if not metrics.get("retry_reason"):
                    metrics["retry_reason"] = "integrity_failed"
                return None, metrics
            metrics["semantic_diff"] = True
            return output, metrics
        except Exception:
            metrics["retry_reason"] = "llm_error"
            return apply_stub_plan(plan, original), metrics

    async def _call_llm_with_integrity_guard(
        self,
        llm: LLMService,
        prompt: str,
        system: str,
        original: str,
        metrics: dict,
    ) -> PatchLLMOutput | None:
        preserved_reason = metrics.get("retry_reason")
        output = await llm.structured(prompt, PatchLLMOutput, system=system)
        ok, reason = validate_patch_integrity(original, output.patched_content)
        if ok:
            metrics["retry_reason"] = preserved_reason
            return output

        retry_lines = []
        if reason == "no_op":
            retry_lines.append(
                "No semantic changes were generated.\n"
                "Produce an actual code modification that fixes the root cause."
            )
        retry_lines.append(COMPLETE_FILE_RETRY_INSTRUCTION)

        retry_prompt = f"{prompt}\n\n" + "\n".join(retry_lines)
        output = await llm.structured(retry_prompt, PatchLLMOutput, system=system)
        ok, reason = validate_patch_integrity(original, output.patched_content)
        if ok:
            metrics["retry_reason"] = preserved_reason
            return output
        metrics["retry_reason"] = reason or "integrity_failed"
        return None

    def _validate_python(self, code: str) -> bool:
        try:
            ast.parse(code)
            return True
        except SyntaxError:
            return False
