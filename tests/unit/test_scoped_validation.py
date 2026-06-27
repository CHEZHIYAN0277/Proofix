"""Unit tests for two-phase scoped A8 validation."""

from unittest.mock import AsyncMock, patch

import pytest

from backend.services.reproduction_parser import extract_failed_nodeids
from backend.services.scoped_validation import compare_new_failures, run_scoped_validation


def test_extract_failed_nodeids():
    report = {
        "tests": [
            {"nodeid": "tests/test_auth.py::test_ok", "outcome": "passed"},
            {"nodeid": "tests/test_auth.py::test_fail", "outcome": "failed"},
            {"nodeid": "tests/test_config.py::test_secret_from_env", "outcome": "failed"},
        ]
    }
    assert extract_failed_nodeids(report) == [
        "tests/test_auth.py::test_fail",
        "tests/test_config.py::test_secret_from_env",
    ]


def test_compare_new_failures_ignores_pre_existing():
    baseline = {
        "tests/test_auth.py::test_expired_token_rejected",
        "tests/test_config.py::test_secret_from_env",
    }
    current = {
        "tests/test_config.py::test_secret_from_env",
    }
    assert compare_new_failures(current, baseline) == []


def test_compare_new_failures_detects_regression():
    baseline = {"tests/test_auth.py::test_expired_token_rejected"}
    current = {
        "tests/test_auth.py::test_expired_token_rejected",
        "tests/test_api.py::test_new_break",
    }
    assert compare_new_failures(current, baseline) == ["tests/test_api.py::test_new_break"]


TARGET_FAIL_STDOUT = "FAILED tests/test_auth.py::test_expired_token_rejected"
TARGET_PASS_STDOUT = "passed"
REGRESSION_STDOUT = "FAILED tests/test_config.py::test_secret_from_env"


@pytest.mark.asyncio
async def test_target_failure_triggers_patch_retry(tmp_path):
    repo = tmp_path

    async def fake_run(cmd, cwd, timeout):
        joined = " ".join(cmd)
        if "test_expired_token_rejected" in joined:
            return 1, TARGET_FAIL_STDOUT, "E AssertionError: assert True is False"
        return 0, REGRESSION_STDOUT, ""

    with patch("backend.services.scoped_validation.run_command", AsyncMock(side_effect=fake_run)):
        with patch(
            "backend.services.scoped_validation.load_pytest_report",
            side_effect=[
                {
                    "tests": [
                        {
                            "nodeid": "tests/test_auth.py::test_expired_token_rejected",
                            "outcome": "failed",
                            "call": {
                                "crash": {"message": "AssertionError: assert True is False"},
                                "longrepr": "E AssertionError: assert True is False",
                            },
                        }
                    ]
                },
            ],
        ):
            outcome = await run_scoped_validation(
                repo,
                "run-1",
                target_test="tests/test_auth.py::test_expired_token_rejected",
                baseline_failures=[
                    "tests/test_auth.py::test_expired_token_rejected",
                    "tests/test_config.py::test_secret_from_env",
                ],
            )

    assert outcome.target_test_passed is False
    assert outcome.patch_retry_required is True
    assert outcome.failure_brief_needed is True
    assert outcome.validation_failure is not None
    assert outcome.validation_failure.failing_test == "tests/test_auth.py::test_expired_token_rejected"


@pytest.mark.asyncio
async def test_pre_existing_config_failure_does_not_trigger_patch_retry(tmp_path):
    repo = tmp_path
    call_count = {"n": 0}

    async def fake_run(cmd, cwd, timeout):
        call_count["n"] += 1
        joined = " ".join(cmd)
        if "test_expired_token_rejected" in joined:
            return 0, TARGET_PASS_STDOUT, ""
        return 1, REGRESSION_STDOUT, ""

    with patch("backend.services.scoped_validation.run_command", AsyncMock(side_effect=fake_run)):
        with patch(
            "backend.services.scoped_validation.load_pytest_report",
            side_effect=[
                {"tests": [{"nodeid": "tests/test_auth.py::test_expired_token_rejected", "outcome": "passed"}]},
                {
                    "tests": [
                        {"nodeid": "tests/test_config.py::test_secret_from_env", "outcome": "failed"},
                    ]
                },
            ],
        ):
            outcome = await run_scoped_validation(
                repo,
                "run-2",
                target_test="tests/test_auth.py::test_expired_token_rejected",
                baseline_failures=[
                    "tests/test_auth.py::test_expired_token_rejected",
                    "tests/test_config.py::test_secret_from_env",
                ],
            )

    assert outcome.target_test_passed is True
    assert outcome.regression_tests_passed is True
    assert outcome.pytest_passed is True
    assert outcome.patch_retry_required is False
    assert outcome.failure_brief_needed is False
    assert outcome.new_failures == []
    assert call_count["n"] == 2
