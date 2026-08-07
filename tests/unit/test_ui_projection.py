"""Tests for the frontend view-model projection layer."""

from datetime import datetime, timedelta

import pytest

from backend.services.ui_projection import (
    AGENT_REGISTRY,
    STAGE_REGISTRY,
    SURFACE_V1,
    SURFACE_V2,
    agents_for_surface,
    build_agent_entries,
    build_executive_summary,
    build_repair_attempts,
    build_run_report,
    build_workspace_header,
    group_runs_by_repository,
    repo_display_name,
    run_decision,
    short_run_id,
    sidebar_status,
    total_attempts,
)
from backend.state.events import AgentStatusEvent
from backend.state.schema import RunStateModel

RUN_ID = "e8fac24c-13e5-415f-add4-a64b759e414a"


def _event(agent_id: str, status: str, message: str = "", offset: int = 0) -> AgentStatusEvent:
    return AgentStatusEvent(
        run_id=RUN_ID,
        agent_id=agent_id,
        status=status,  # type: ignore[arg-type]
        timestamp=datetime(2026, 8, 2, 12, 0, 0) + timedelta(seconds=offset),
        message=message,
        sequence=offset,
    )


def _completed_state(**overrides) -> RunStateModel:
    base = dict(
        run_id=RUN_ID,
        repo_path="vulnapi",
        status="completed",
        retry_count=3,
        reproduction={
            "status": "CONFIRMED",
            "failing_test": "tests/test_auth.py::test_expired_token_rejected",
            "exception_type": "AssertionError",
            "exception_message": "expired token accepted",
            "failing_file": "vulnapi/auth.py",
            "failing_line": 27,
            "confidence": 0.9,
        },
        root_cause={
            "summary": "Missing expiry check",
            "root_cause": "validate_token() never compares exp",
            "confidence": 0.95,
            "citations": [{"file": "vulnapi/auth.py", "line": 27, "claim": "no expiry", "verified": True}],
        },
        blast_graph={
            "scope": [{"path": "vulnapi/auth.py", "direction": "forward", "hop_count": 0}],
            "auto_patch_scope": ["vulnapi/auth.py"],
            "human_review_required": [],
            "origins": ["vulnapi/auth.py"],
        },
        mutation_result={"pytest_passed": True, "correctness_score": 92.0, "mutation_score": 0.9},
        security_result={"security_score": 100.0, "rejected": False, "new_findings": []},
        pr_decision={
            "pr_type": "auto_mergeable",
            "axis_scores": {
                "correctness": 92.0,
                "security": 100.0,
                "fidelity": 100.0,
                "scope_risk": 90.0,
            },
        },
    )
    base.update(overrides)
    return RunStateModel(**base)


def test_short_run_id_elides_middle():
    assert short_run_id(RUN_ID) == "e8fa…414a"
    assert short_run_id("abc") == "abc"


def test_repo_display_name_from_path():
    assert repo_display_name(RunStateModel(run_id="r", repo_path="/tmp/x/vulnapi")) == "vulnapi"
    assert repo_display_name(RunStateModel(run_id="r", repo_path="")) == "repository"


@pytest.mark.parametrize(
    "pr_type,expected_decision,expected_label",
    [
        ("auto_mergeable", "merge", "Auto Merge"),
        ("diff_only", "draft", "Diff Only"),
        ("draft", "draft", "Draft PR"),
    ],
)
def test_run_decision_maps_pr_types(pr_type, expected_decision, expected_label):
    state = _completed_state(pr_decision={"pr_type": pr_type})
    assert run_decision(state) == (expected_decision, expected_label)


def test_failed_run_decision_wins_over_pr_type():
    state = _completed_state(status="failed")
    assert run_decision(state)[0] == "failed"


def test_sidebar_status_reports_running_while_in_flight():
    assert sidebar_status(_completed_state(status="running")) == "running"
    assert sidebar_status(_completed_state()) == "completed"


@pytest.mark.parametrize("surface", [SURFACE_V1, SURFACE_V2])
def test_every_registry_agent_produces_a_card(surface):
    state = _completed_state()
    events = [_event("A1", "completed", "SIG built", 1)]
    entries = build_agent_entries(state, events, surface=surface)

    published = agents_for_surface(surface)
    assert len(entries) == len(published)
    assert [e["id"] for e in entries] == [a.card for a in published]
    # Every card must satisfy the frontend's AgentEntry contract.
    for entry in entries:
        assert entry["lines"], f"{entry['id']} has no narrative"
        assert entry["evidence"]["title"]
        assert isinstance(entry["metrics"], list)
        # Identity and stage travel with the card so no client rebuilds them.
        assert entry["agentId"]
        assert entry["stage"] in {s.id for s in STAGE_REGISTRY}
        assert entry["stageLabel"]


def test_agent_without_events_is_skipped_when_run_is_terminal():
    # A9 leaves no result behind when the pipeline routes around it.
    state = _completed_state(security_result=None)
    entries = {e["id"]: e for e in build_agent_entries(state, [])}
    assert entries["security"]["status"] == "skipped"
    assert "Skipped" in entries["security"]["lines"][0]


def test_agent_without_events_is_running_while_run_is_active():
    state = _completed_state(status="running")
    entries = {e["id"]: e for e in build_agent_entries(state, [])}
    assert entries["security"]["status"] == "running"


def test_mutation_card_reports_retry_when_patch_retry_required():
    state = _completed_state(
        mutation_result={"pytest_passed": False, "patch_retry_required": True, "correctness_score": 0.0}
    )
    entries = {e["id"]: e for e in build_agent_entries(state, [_event("A8", "completed", "done", 1)])}
    assert entries["mutation"]["status"] == "retry"


def test_workspace_header_shape():
    state = _completed_state()
    events = [_event("A1", "started", "go", 0), _event("A10", "completed", "done", 72)]
    header = build_workspace_header(state, events)

    assert header["repository"] == "vulnapi"
    assert header["shortRunId"] == "e8fa…414a"
    assert header["retries"] == 3
    assert header["executionTime"] == "1m 12s"
    assert header["decisionLabel"] == "Auto Merge"


def test_attempt_counts_agree_across_models():
    """Executive summary, report and retry sequence must not disagree."""
    state = _completed_state()
    summary = build_executive_summary(state, [])
    report = build_run_report(state, [])
    attempts = build_repair_attempts(state, [])

    assert summary["attempts"] == total_attempts(state) == 4
    assert report["rejection"]["attempts"] == 4
    assert len(attempts["attempts"]) == 4
    assert attempts["attempts"][-1]["n"] == 4


def _attempt_events() -> list[AgentStatusEvent]:
    """Two patch/validate cycles with genuinely different outcomes."""
    def _with_payload(agent_id: str, offset: int, payload: dict) -> AgentStatusEvent:
        event = _event(agent_id, "completed", offset=offset)
        event.payload = payload
        return event

    return [
        _with_payload("A7", 1, {"a7_patch_metrics": {"target_file": "app/db.py", "retry_number": 0}}),
        _with_payload(
            "A8",
            2,
            {
                "pytest_passed": False,
                "patch_retry_required": True,
                "correctness_score": 0.0,
                "mutation_score": None,
                "failing_test": "tests/test_db.py::test_query",
                "assertion_message": "expected parameterised query",
            },
        ),
        _with_payload(
            "A7",
            3,
            {"a7_patch_metrics": {"target_file": "app/db.py", "retry_number": 1,
                                  "retry_reason": "validation_failure"}},
        ),
        _with_payload(
            "A8",
            4,
            {
                "pytest_passed": True,
                "patch_retry_required": False,
                "correctness_score": 84.0,
                "mutation_score": 0.6,
            },
        ),
    ]


def test_repair_attempts_are_derived_per_attempt_not_from_final_state():
    """Each attempt reports its own outcome, not the last attempt's."""
    state = _completed_state()
    attempts = build_repair_attempts(state, _attempt_events())["attempts"]

    assert len(attempts) == 2
    assert attempts[0]["result"] == "Validation Failed"
    assert attempts[1]["result"] == "Validation Passed"
    # The rows must differ — the old projection made every row identical.
    assert attempts[0]["detail"] != attempts[1]["detail"]
    assert "expected parameterised query" in attempts[0]["detail"]


def test_unmeasured_attempt_is_not_reported_as_a_zero_score():
    """mutmut only runs once pytest passes; a failed attempt has no score."""
    attempts = build_repair_attempts(_completed_state(), _attempt_events())["attempts"]

    # Failed attempt: no mutation score exists, so it must not read as 0.00.
    assert attempts[0]["scoreLabel"] == "correctness 0.00"
    assert "mutation" not in attempts[0]["scoreLabel"]
    # Passed attempt: mutmut ran, so the real measurement is shown.
    assert attempts[1]["scoreLabel"] == "mutation 0.60"


def test_skipped_security_scan_is_not_reported_as_clean():
    state = _completed_state(security_result=None)
    report = build_run_report(state, [])
    flags = {e["text"]: e["ok"] for e in report["evidence"]}
    assert flags["Security re-scan not run"] is False
    assert "Security re-scan clean" not in flags


def test_clean_security_scan_is_reported_as_clean():
    report = build_run_report(_completed_state(), [])
    flags = {e["text"]: e["ok"] for e in report["evidence"]}
    assert flags["Security re-scan clean"] is True


def test_trust_score_is_mean_of_axes():
    report = build_run_report(_completed_state(), [])
    # (92 + 100 + 100 + 90) / 4 / 100 == 0.955
    assert report["trustScore"] == pytest.approx(0.955, abs=0.006)
    assert [t["label"] for t in report["trust"]] == [
        "Correctness",
        "Security",
        "Fidelity",
        # High is good on this axis, same as the other three — see the note in
        # build_run_report on why it is not labelled "Scope Risk".
        "Scope Safety",
    ]


def test_run_report_survives_an_empty_run():
    """A run that failed before any agent produced output must still project."""
    state = RunStateModel(run_id=RUN_ID, repo_path="vulnapi", status="failed")
    report = build_run_report(state, [])
    summary = build_executive_summary(state, [])

    assert report["decision"] == "failed"
    assert report["trustScore"] == 0.0
    assert report["proofBundle"] == "—"
    assert summary["repository"] == "vulnapi"


def test_group_runs_by_repository_buckets_by_repo():
    states = [
        _completed_state(),
        _completed_state(run_id="other", repo_path="llm-shield"),
        RunStateModel(run_id="third", repo_path="vulnapi", status="running"),
    ]
    grouped = {g["name"]: g["runs"] for g in group_runs_by_repository(states)}

    assert set(grouped) == {"vulnapi", "llm-shield"}
    assert len(grouped["vulnapi"]) == 2
