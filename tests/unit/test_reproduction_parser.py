"""Unit tests for structured reproduction parsing."""

import json
from pathlib import Path

import pytest

from backend.models.reproduction import ReproductionResult, ReproductionStatus
from backend.services.reproduction_parser import (
    load_pytest_report,
    parse_pytest_report,
    pytest_report_path,
)


SAMPLE_FAILED_TEST = {
    "nodeid": "tests/test_auth.py::test_expired_token_rejected",
    "lineno": 23,
    "outcome": "failed",
    "call": {
        "outcome": "failed",
        "crash": {
            "path": "/repo/vulnapi/tests/test_auth.py",
            "lineno": 27,
            "message": "AssertionError: assert True is False",
        },
        "traceback": [{"path": "tests/test_auth.py", "lineno": 27, "message": "AssertionError"}],
        "longrepr": "E       AssertionError: assert True is False",
    },
}


def test_pytest_report_path_is_run_specific():
    path = pytest_report_path("abc-123-run")
    assert path.name == "pytest_abc-123-run.json"
    assert path.parent.name  # temp dir


def test_confirmed_reproduction_extracts_evidence(tmp_path):
    report = {
        "exitcode": 1,
        "summary": {"collected": 12, "failed": 1, "passed": 11},
        "tests": [SAMPLE_FAILED_TEST],
    }
    repo = tmp_path / "repo"
    result = parse_pytest_report(
        report,
        exit_code=1,
        stdout="",
        stderr="",
        report_path=tmp_path / "pytest_run.json",
        repo_root=repo,
    )
    assert result.status == ReproductionStatus.CONFIRMED
    assert result.reproduced is True
    assert result.force_draft_pr is False
    assert result.failing_test == "tests/test_auth.py::test_expired_token_rejected"
    assert result.exception_type == "AssertionError"
    assert "assert True is False" in (result.exception_message or "")
    assert result.failing_file == "tests/test_auth.py"
    assert result.failing_line == 27
    assert result.traceback is not None
    assert result.stack_trace == result.traceback
    assert result.confidence == 0.9


def test_unconfirmed_when_all_tests_pass(tmp_path):
    report = {
        "exitcode": 0,
        "summary": {"collected": 5, "passed": 5, "failed": 0},
        "tests": [{"nodeid": "tests/test_ok.py::test_ok", "outcome": "passed"}],
    }
    result = parse_pytest_report(
        report,
        exit_code=0,
        stdout="",
        stderr="",
        report_path=tmp_path / "pytest_run.json",
    )
    assert result.status == ReproductionStatus.UNCONFIRMED
    assert result.reproduced is False
    assert result.force_draft_pr is True


def test_no_tests_when_collection_empty(tmp_path):
    report = {"exitcode": 5, "summary": {"collected": 0}, "tests": []}
    result = parse_pytest_report(
        report,
        exit_code=5,
        stdout="",
        stderr="",
        report_path=tmp_path / "pytest_run.json",
    )
    assert result.status == ReproductionStatus.NO_TESTS
    assert result.force_draft_pr is True


def test_infra_error_on_subprocess_failure(tmp_path):
    result = parse_pytest_report(
        None,
        exit_code=-1,
        stdout="",
        stderr="command not found: python",
        report_path=tmp_path / "pytest_run.json",
    )
    assert result.status == ReproductionStatus.INFRA_ERROR
    assert "command not found" in (result.infra_detail or "")


def test_infra_error_when_report_missing(tmp_path):
    result = parse_pytest_report(
        None,
        exit_code=1,
        stdout="",
        stderr="plugin error",
        report_path=tmp_path / "pytest_run.json",
    )
    assert result.status == ReproductionStatus.INFRA_ERROR


def test_load_pytest_report_roundtrip(tmp_path):
    path = tmp_path / "pytest_x.json"
    path.write_text(json.dumps({"exitcode": 0, "tests": []}), encoding="utf-8")
    loaded = load_pytest_report(path)
    assert loaded is not None
    assert loaded["exitcode"] == 0


def test_reproduction_result_legacy_compat():
    result = ReproductionResult(status=ReproductionStatus.CONFIRMED, traceback="tb")
    assert result.reproduced is True
    assert result.stack_trace == "tb"
    assert result.force_draft_pr is False

    unconfirmed = ReproductionResult(status=ReproductionStatus.UNCONFIRMED)
    assert unconfirmed.reproduced is False
    assert unconfirmed.force_draft_pr is True


@pytest.mark.asyncio
async def test_a35_uses_run_specific_report_path(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    from backend.agents.a3_5_reproduction import A35ReproductionAgent
    from backend.config import Settings
    from backend.state.schema import RunStateModel

    captured: dict = {}

    async def fake_run_command(cmd, cwd=None, timeout=120, env=None):
        captured["report_arg"] = next(c for c in cmd if c.startswith("--json-report-file="))
        report_file = Path(captured["report_arg"].split("=", 1)[1])
        report_file.write_text(
            json.dumps(
                {
                    "exitcode": 0,
                    "summary": {"collected": 1, "passed": 1},
                    "tests": [{"nodeid": "tests/t.py::test_ok", "outcome": "passed"}],
                }
            ),
            encoding="utf-8",
        )
        return 0, "", ""

    monkeypatch.setattr("backend.agents.a3_5_reproduction.run_command", fake_run_command)

    store = MagicMock()
    store.append_event = AsyncMock()
    agent = A35ReproductionAgent(store, Settings())
    state = RunStateModel(run_id="run-xyz", repo_path=str(tmp_path))

    result = await agent.run(state)
    assert "pytest_run-xyz.json" in captured["report_arg"]
    assert result.reproduction["status"] == "UNCONFIRMED"
    assert result.reproduction["report_path"].endswith("pytest_run-xyz.json")
