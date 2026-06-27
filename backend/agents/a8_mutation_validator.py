from pathlib import Path

from backend.agents.base import AgentBase
from backend.models.validation import MutationValidationResult, ValidationFailure
from backend.services.retry_brief_builder import build_retry_brief
from backend.services.scoped_validation import run_scoped_validation
from backend.services.subprocess_runner import run_command
from backend.state.schema import RunStateModel


class A8MutationValidatorAgent(AgentBase):
    agent_id = "A8"

    async def run(self, state: RunStateModel) -> RunStateModel:
        await self.emit_status(state, "started", "Running mutation validation gauntlet")
        repo = Path(state.repo_clone_path or state.repo_path)
        patch_bundle = state.patch_bundle or {}
        contracts = patch_bundle.get("contracts", [])
        reproduction = state.reproduction or {}
        target_test = reproduction.get("failing_test")
        baseline_failures = reproduction.get("pre_existing_failures") or []

        scoped = await run_scoped_validation(
            repo,
            state.run_id,
            target_test=target_test,
            baseline_failures=baseline_failures,
            timeout=120,
        )

        mutant_survived = False
        mutation_score = None
        failure_brief = None
        validation_failure = scoped.validation_failure
        mutmut_cmd = ""
        mutmut_timeout = self.settings.mutmut_timeout_seconds
        pytest_passed = scoped.pytest_passed
        patch_retry_required = scoped.patch_retry_required
        failure_brief_needed = scoped.failure_brief_needed
        correctness_score = 100.0 if pytest_passed else 0.0

        if pytest_passed:
            mutant_survived, mutation_score, mutmut_cmd = await self._run_mutmut(repo, patch_bundle)
            if mutant_survived:
                correctness_score = 40.0
                contract = contracts[0]["assertion"] if contracts else "unknown contract"
                validation_failure = ValidationFailure(
                    failing_test=target_test,
                    assertion_message="Mutant survived — test passes coincidentally without validating fix",
                    validation_stage="mutation",
                    target_test_passed=True,
                    regression_tests_passed=True,
                    pre_existing_failures=baseline_failures,
                )
                patch_retry_required = True
                failure_brief_needed = True
                pytest_passed = False
                failure_brief = build_retry_brief(
                    validation_failure,
                    state.retry_count + 1,
                    patch_bundle=patch_bundle,
                    reproduction=reproduction,
                    violated_contract=contract,
                )
            elif mutation_score is not None:
                correctness_score = min(100.0, 60.0 + mutation_score * 40)
            else:
                correctness_score = 70.0
        elif failure_brief_needed and validation_failure:
            failure_brief = build_retry_brief(
                validation_failure,
                state.retry_count + 1,
                patch_bundle=patch_bundle,
                reproduction=reproduction,
            )

        result = MutationValidationResult(
            pytest_passed=pytest_passed,
            mutation_score=mutation_score,
            mutant_survived=mutant_survived,
            correctness_score=correctness_score,
            failure_brief=failure_brief,
            validation_failure=validation_failure,
            pytest_reexecution_command=scoped.pytest_reexecution_command,
            reexecution_command=mutmut_cmd,
            reexecution_timeout_seconds=mutmut_timeout,
            target_test_passed=scoped.target_test_passed,
            regression_tests_passed=scoped.regression_tests_passed,
            new_failures=scoped.new_failures,
            pre_existing_failures=scoped.pre_existing_failures,
            patch_retry_required=patch_retry_required,
        )
        result_dict = result.model_dump(mode="json")
        if validation_failure:
            validation_failure = validation_failure.model_copy(
                update={"mutation_result": result_dict}
            )
            result.validation_failure = validation_failure
            result_dict = result.model_dump(mode="json")
            if failure_brief:
                failure_brief = failure_brief.model_copy(
                    update={"validation_failure": validation_failure}
                )
                result.failure_brief = failure_brief
                result_dict["failure_brief"] = failure_brief.model_dump(mode="json")

        state.mutation_result = result_dict
        if failure_brief and patch_retry_required:
            state.retry_brief = failure_brief.model_dump(mode="json")
        elif not patch_retry_required:
            state.retry_brief = None
        if validation_failure:
            state.validation_failure = validation_failure.model_dump(mode="json")

        payload = {
            "correctness_score": correctness_score,
            "pytest_passed": pytest_passed,
            "target_test_passed": scoped.target_test_passed,
            "regression_tests_passed": scoped.regression_tests_passed,
            "new_failures": scoped.new_failures,
            "pre_existing_failures": scoped.pre_existing_failures,
            "patch_retry_required": patch_retry_required,
        }
        if validation_failure and patch_retry_required:
            payload.update(
                {
                    "failing_test": validation_failure.failing_test,
                    "assertion_message": validation_failure.assertion_message,
                    "expected_value": validation_failure.expected_value,
                    "actual_value": validation_failure.actual_value,
                }
            )

        await self.emit_status(
            state,
            "completed",
            f"pytest={'pass' if pytest_passed else 'fail'}, mutant_survived={mutant_survived}",
            payload,
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

        if code == -1:
            return False, None, mutmut_cmd

        code2, results_out, _ = await run_command(
            ["python", "-m", "mutmut", "results"],
            cwd=repo,
            timeout=30,
        )
        survived = "survived" in (results_out + stderr).lower() or "not killed" in (results_out + stderr).lower()
        score = 0.5 if not survived else 0.0
        return survived, score, mutmut_cmd
