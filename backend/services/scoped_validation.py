"""Two-phase scoped pytest validation for A8."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from backend.models.validation import ValidationFailure
from backend.services.reproduction_commands import FULL_SUITE_COMMAND, build_targeted_reproduction_command
from backend.services.reproduction_parser import extract_failed_nodeids, load_pytest_report
from backend.services.subprocess_runner import run_command
from backend.services.validation_failure_parser import parse_validation_failure, validation_report_path


def validation_regression_report_path(run_id: str) -> Path:
    return validation_report_path(run_id).with_name(
        validation_report_path(run_id).name.replace(".json", "_regression.json")
    )


def compare_new_failures(current_failures: set[str], baseline_failures: set[str]) -> list[str]:
    return sorted(current_failures - baseline_failures)


@dataclass
class ScopedValidationOutcome:
    target_test_passed: bool | None
    regression_tests_passed: bool | None
    pytest_passed: bool
    patch_retry_required: bool
    new_failures: list[str]
    pre_existing_failures: list[str]
    validation_failure: ValidationFailure | None
    failure_brief_needed: bool
    pytest_reexecution_command: str
    target_stdout: str = ""
    target_stderr: str = ""
    regression_stdout: str = ""
    regression_stderr: str = ""


async def run_scoped_validation(
    repo: Path,
    run_id: str,
    *,
    target_test: str | None,
    baseline_failures: list[str],
    timeout: int = 120,
) -> ScopedValidationOutcome:
    baseline = set(baseline_failures)

    if not target_test:
        return await _run_full_suite_fallback(repo, run_id, baseline_failures, timeout)

    target_report_path = validation_report_path(run_id)
    if target_report_path.exists():
        target_report_path.unlink()

    target_cmd = build_targeted_reproduction_command(target_test)
    target_args = [
        "python",
        "-m",
        "pytest",
        target_test,
        "-v",
        "--tb=short",
        "--json-report",
        f"--json-report-file={target_report_path}",
    ]
    target_code, target_stdout, target_stderr = await run_command(target_args, cwd=repo, timeout=timeout)
    target_test_passed = target_code == 0

    if not target_test_passed:
        validation_failure = parse_validation_failure(
            exit_code=target_code,
            stdout=target_stdout,
            stderr=target_stderr,
            report_path=target_report_path,
            repo_root=repo,
            validation_stage="mutation",
            failing_test_hint=target_test,
        )
        validation_failure = validation_failure.model_copy(
            update={
                "target_test_passed": False,
                "regression_tests_passed": None,
                "new_failures": [],
                "pre_existing_failures": sorted(baseline),
            }
        )
        return ScopedValidationOutcome(
            target_test_passed=False,
            regression_tests_passed=None,
            pytest_passed=False,
            patch_retry_required=True,
            new_failures=[],
            pre_existing_failures=sorted(baseline),
            validation_failure=validation_failure,
            failure_brief_needed=True,
            pytest_reexecution_command=target_cmd,
            target_stdout=target_stdout,
            target_stderr=target_stderr,
        )

    regression_report_path = validation_regression_report_path(run_id)
    if regression_report_path.exists():
        regression_report_path.unlink()

    regression_args = [
        "python",
        "-m",
        "pytest",
        "-v",
        "--tb=short",
        "--json-report",
        f"--json-report-file={regression_report_path}",
    ]
    regression_code, regression_stdout, regression_stderr = await run_command(
        regression_args,
        cwd=repo,
        timeout=timeout,
    )
    regression_report = load_pytest_report(regression_report_path)
    current_failures = set(extract_failed_nodeids(regression_report))
    new_failures = compare_new_failures(current_failures, baseline)
    pre_existing_still_failing = sorted(current_failures & baseline)
    regression_tests_passed = len(new_failures) == 0
    pytest_passed = regression_tests_passed

    validation_failure = None
    failure_brief_needed = False
    if not regression_tests_passed:
        validation_failure = parse_validation_failure(
            exit_code=regression_code,
            stdout=regression_stdout,
            stderr=regression_stderr,
            report_path=regression_report_path,
            repo_root=repo,
            validation_stage="mutation",
            failing_test_hint=new_failures[0] if new_failures else None,
        )
        validation_failure = validation_failure.model_copy(
            update={
                "target_test_passed": True,
                "regression_tests_passed": False,
                "new_failures": new_failures,
                "pre_existing_failures": sorted(baseline),
            }
        )

    return ScopedValidationOutcome(
        target_test_passed=True,
        regression_tests_passed=regression_tests_passed,
        pytest_passed=pytest_passed,
        patch_retry_required=False,
        new_failures=new_failures,
        pre_existing_failures=pre_existing_still_failing,
        validation_failure=validation_failure,
        failure_brief_needed=False,
        pytest_reexecution_command=f"{target_cmd} && {FULL_SUITE_COMMAND}",
        target_stdout=target_stdout,
        target_stderr=target_stderr,
        regression_stdout=regression_stdout,
        regression_stderr=regression_stderr,
    )


async def _run_full_suite_fallback(
    repo: Path,
    run_id: str,
    baseline_failures: list[str],
    timeout: int,
) -> ScopedValidationOutcome:
    report_path = validation_report_path(run_id)
    if report_path.exists():
        report_path.unlink()

    code, stdout, stderr = await run_command(
        [
            "python",
            "-m",
            "pytest",
            "-v",
            "--tb=short",
            "--json-report",
            f"--json-report-file={report_path}",
        ],
        cwd=repo,
        timeout=timeout,
    )
    report = load_pytest_report(report_path)
    current_failures = set(extract_failed_nodeids(report))
    baseline = set(baseline_failures)
    new_failures = compare_new_failures(current_failures, baseline) if baseline else sorted(current_failures)
    pytest_passed = code == 0 if not baseline else len(new_failures) == 0

    validation_failure = None
    failure_brief_needed = False
    if not pytest_passed:
        validation_failure = parse_validation_failure(
            exit_code=code,
            stdout=stdout,
            stderr=stderr,
            report_path=report_path,
            repo_root=repo,
            validation_stage="mutation",
        )
        validation_failure = validation_failure.model_copy(
            update={
                "target_test_passed": None,
                "regression_tests_passed": pytest_passed,
                "new_failures": new_failures,
                "pre_existing_failures": sorted(baseline),
            }
        )
        failure_brief_needed = bool(new_failures or not baseline)

    return ScopedValidationOutcome(
        target_test_passed=None,
        regression_tests_passed=pytest_passed,
        pytest_passed=pytest_passed,
        patch_retry_required=failure_brief_needed,
        new_failures=new_failures,
        pre_existing_failures=sorted(current_failures & baseline) if baseline else [],
        validation_failure=validation_failure,
        failure_brief_needed=failure_brief_needed,
        pytest_reexecution_command=FULL_SUITE_COMMAND,
        regression_stdout=stdout,
        regression_stderr=stderr,
    )
