from pathlib import Path

from backend.agents.base import AgentBase
from backend.models.validation import MutationValidationResult, ValidationFailure
from backend.services.mutation_parser import MutationOutcome, parse_mutation_output
from backend.services.retry_brief_builder import build_retry_brief
from backend.services.scoped_validation import run_scoped_validation
from backend.services.subprocess_runner import run_command
from backend.state.schema import RunStateModel

# Correctness rubric. Named so the merge threshold in `a10_routing` can be read
# against the values that feed it.
CORRECTNESS_TESTS_FAILED = 0.0
CORRECTNESS_MUTANT_SURVIVED = 40.0
CORRECTNESS_MUTATION_UNAVAILABLE = 70.0
CORRECTNESS_MUTATION_BASE = 60.0
CORRECTNESS_MUTATION_RANGE = 40.0

MUTANT_SURVIVED_ASSERTION = (
    "Mutant survived — test passes coincidentally without validating fix"
)


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

        failure_brief = None
        validation_failure = scoped.validation_failure
        mutmut_cmd = ""
        mutmut_timeout = self.settings.mutmut_timeout_seconds
        pytest_passed = scoped.pytest_passed
        patch_retry_required = scoped.patch_retry_required
        failure_brief_needed = scoped.failure_brief_needed

        outcome = MutationOutcome(status="not_run", unavailable_reason=None)
        correctness_score = 100.0 if pytest_passed else CORRECTNESS_TESTS_FAILED

        if pytest_passed:
            outcome, mutmut_cmd = await self._run_mutmut(repo, patch_bundle)

            if outcome.mutant_survived:
                correctness_score = CORRECTNESS_MUTANT_SURVIVED
                contract = contracts[0]["assertion"] if contracts else "unknown contract"
                validation_failure = ValidationFailure(
                    failing_test=target_test,
                    assertion_message=(
                        f"{MUTANT_SURVIVED_ASSERTION} "
                        f"({outcome.survived_mutants} of {outcome.total_mutants} mutants survived)"
                    ),
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
            elif outcome.status == "scored" and outcome.mutation_score is not None:
                correctness_score = min(
                    100.0,
                    CORRECTNESS_MUTATION_BASE + outcome.mutation_score * CORRECTNESS_MUTATION_RANGE,
                )
            else:
                # No mutation evidence. Score below the auto-merge threshold so
                # the absence of proof forces manual review rather than passing
                # on a substituted value.
                correctness_score = CORRECTNESS_MUTATION_UNAVAILABLE
        elif failure_brief_needed and validation_failure:
            failure_brief = build_retry_brief(
                validation_failure,
                state.retry_count + 1,
                patch_bundle=patch_bundle,
                reproduction=reproduction,
            )

        result = MutationValidationResult(
            pytest_passed=pytest_passed,
            mutation_score=outcome.mutation_score,
            mutant_survived=outcome.mutant_survived,
            mutation_status=outcome.status,
            mutation_unavailable_reason=outcome.unavailable_reason,
            killed_mutants=outcome.killed_mutants,
            survived_mutants=outcome.survived_mutants,
            total_mutants=outcome.total_mutants,
            inconclusive_mutants=outcome.inconclusive_mutants,
            mutants_by_status=outcome.by_status,
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
            # Per-attempt scores. `mutation_score` stays None when pytest failed,
            # because mutmut never ran — the UI must say "not scored" rather than
            # render a 0.00 that looks like a measurement. `mutation_status`
            # tells the UI which of those two cases it is.
            "mutation_score": outcome.mutation_score,
            "mutant_survived": outcome.mutant_survived,
            "mutation_status": outcome.status,
            "mutation_unavailable_reason": outcome.unavailable_reason,
            "killed_mutants": outcome.killed_mutants,
            "survived_mutants": outcome.survived_mutants,
            "total_mutants": outcome.total_mutants,
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
            f"pytest={'pass' if pytest_passed else 'fail'}, "
            f"mutation={outcome.status}, mutant_survived={outcome.mutant_survived}",
            payload,
        )
        return state

    async def _run_mutmut(self, repo: Path, patch_bundle: dict) -> tuple[MutationOutcome, str]:
        """Run mutmut and parse its real output. Never returns a substituted score."""
        patches = patch_bundle.get("patches", [])
        if not patches:
            return (
                MutationOutcome(
                    status="unavailable",
                    unavailable_reason="no patches to mutate",
                ),
                "",
            )

        patch_file = patches[0].get("file", "")
        if not patch_file:
            return (
                MutationOutcome(
                    status="unavailable",
                    unavailable_reason="patch bundle has no target file",
                ),
                "",
            )

        mutmut_cmd = (
            f"python -m mutmut run --paths-to-mutate {patch_file}"
            " && python -m mutmut results --all true"
        )

        run_code, run_stdout, run_stderr = await run_command(
            ["python", "-m", "mutmut", "run", "--paths-to-mutate", patch_file],
            cwd=repo,
            timeout=self.settings.mutmut_timeout_seconds,
        )

        results_code: int | None = None
        results_stdout = ""
        results_stderr = ""
        if run_code != -1:
            # `--all true` includes killed mutants, which the default listing
            # omits — without them there is no denominator to score against.
            results_code, results_stdout, results_stderr = await run_command(
                ["python", "-m", "mutmut", "results", "--all", "true"],
                cwd=repo,
                timeout=30,
            )

        outcome = parse_mutation_output(
            run_exit_code=run_code,
            run_stdout=run_stdout,
            run_stderr=run_stderr,
            results_exit_code=results_code,
            results_stdout=results_stdout,
            results_stderr=results_stderr,
        )
        return outcome, mutmut_cmd
