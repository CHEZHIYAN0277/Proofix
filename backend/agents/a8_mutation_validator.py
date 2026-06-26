from pathlib import Path

from backend.agents.base import AgentBase
from backend.models.validation import MutationValidationResult, RetryBrief
from backend.services.subprocess_runner import run_command
from backend.state.schema import RunStateModel


class A8MutationValidatorAgent(AgentBase):
    agent_id = "A8"

    async def run(self, state: RunStateModel) -> RunStateModel:
        await self.emit_status(state, "started", "Running mutation validation gauntlet")
        repo = Path(state.repo_clone_path or state.repo_path)
        patch_bundle = state.patch_bundle or {}
        contracts = patch_bundle.get("contracts", [])

        pytest_cmd = "python -m pytest -v --tb=short"
        code, stdout, stderr = await run_command(
            ["python", "-m", "pytest", "-v", "--tb=short"],
            cwd=repo,
            timeout=120,
        )
        pytest_passed = code == 0

        mutant_survived = False
        mutation_score = None
        failure_brief = None
        mutmut_cmd = ""
        mutmut_timeout = self.settings.mutmut_timeout_seconds
        correctness_score = 100.0 if pytest_passed else 0.0

        if pytest_passed:
            mutant_survived, mutation_score, mutmut_cmd = await self._run_mutmut(repo, patch_bundle)
            if mutant_survived:
                correctness_score = 40.0
                contract = contracts[0]["assertion"] if contracts else "unknown contract"
                failure_brief = RetryBrief(
                    attempt=state.retry_count + 1,
                    violated_contract=contract,
                    assertion_failure="Mutant survived — test passes coincidentally without validating fix",
                    stack_trace=stderr[:1000] if stderr else None,
                )
            elif mutation_score is not None:
                correctness_score = min(100.0, 60.0 + mutation_score * 40)
            else:
                correctness_score = 70.0  # mutmut skipped/timeout penalty
        else:
            failure_brief = RetryBrief(
                attempt=state.retry_count + 1,
                assertion_failure=stderr[:500] or stdout[:500],
                stack_trace=stderr[:1000],
            )

        result = MutationValidationResult(
            pytest_passed=pytest_passed,
            mutation_score=mutation_score,
            mutant_survived=mutant_survived,
            correctness_score=correctness_score,
            failure_brief=failure_brief,
            pytest_reexecution_command=pytest_cmd,
            reexecution_command=mutmut_cmd,
            reexecution_timeout_seconds=mutmut_timeout,
        )
        result_dict = result.model_dump(mode="json")
        state.mutation_result = result_dict
        if failure_brief and (not pytest_passed or mutant_survived):
            state.retry_brief = failure_brief.model_dump(mode="json")

        await self.emit_status(
            state,
            "completed",
            f"pytest={'pass' if pytest_passed else 'fail'}, mutant_survived={mutant_survived}",
            {"correctness_score": correctness_score},
        )
        return state

    async def _run_mutmut(self, repo: Path, patch_bundle: dict) -> tuple[bool, float | None, str]:
        patches = patch_bundle.get("patches", [])
        if not patches:
            return False, None, ""

        patch_file = patches[0].get("file", "")
        if not patch_file:
            return False, None, ""

        mutmut_cmd = f"python -m mutmut run --paths-to-mutate {patch_file} && python -m mutmut results"

        code, stdout, stderr = await run_command(
            ["python", "-m", "mutmut", "run", "--paths-to-mutate", patch_file],
            cwd=repo,
            timeout=self.settings.mutmut_timeout_seconds,
        )

        if code == -1:  # timeout
            return False, None, mutmut_cmd

        code2, results_out, _ = await run_command(
            ["python", "-m", "mutmut", "results"],
            cwd=repo,
            timeout=30,
        )
        survived = "survived" in (results_out + stderr).lower() or "not killed" in (results_out + stderr).lower()
        score = 0.5 if not survived else 0.0
        return survived, score, mutmut_cmd
