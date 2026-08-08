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
    # `None`, not 0.0. A run that failed before any agent produced output has no
    # measurements, and reporting 0.0 asserted it scored the worst possible
    # result on four axes nobody evaluated.
    assert report["trustScore"] is None
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


# -- the summary must not claim gates a run never reached ---------------------


def test_blocked_run_does_not_claim_trust_gates_were_satisfied():
    """"All trust gates satisfied" was the default for any run with no review
    note — including one that stopped at the environment precheck, before a
    single gate existed to satisfy."""
    state = RunStateModel(run_id=RUN_ID, repo_path="vulnapi", status="blocked")
    state.environment = {"status": "not_prepared", "reason": "pytest is not importable"}

    summary = build_executive_summary(state, [])

    assert summary["decision"] == "blocked"
    assert "All trust gates satisfied" not in summary["decisionReason"]
    assert summary["decisionReason"]


def test_auto_mergeable_run_may_still_say_gates_were_satisfied():
    """The sentence is true of exactly one outcome, and that one keeps it."""
    state = RunStateModel(run_id=RUN_ID, repo_path="vulnapi", status="completed")
    state.pr_decision = {"pr_type": "auto_mergeable", "axis_scores": {}}

    summary = build_executive_summary(state, [])

    # `run_decision` speaks the UI's vocabulary: `auto_mergeable` is "merge".
    assert summary["decision"] == "merge"
    assert summary["decisionReason"] == "All trust gates satisfied."


def test_confidence_is_not_measured_when_a4_never_ran():
    """`(confidence or 0) * 100` rendered "0.0%" for an investigation that never
    happened, which reads as a measured no-confidence verdict."""
    state = RunStateModel(run_id=RUN_ID, repo_path="vulnapi", status="blocked")

    assert build_executive_summary(state, [])["confidence"] == "not measured"


def test_a_real_zero_confidence_is_still_reported_as_a_number():
    state = RunStateModel(run_id=RUN_ID, repo_path="vulnapi", status="completed")
    state.root_cause = {"root_cause": "unclear", "confidence": 0.0}

    assert build_executive_summary(state, [])["confidence"] == "0.0%"


def test_pytest_unavailability_is_read_from_the_recorded_fact():
    """A8 decides this where pytest is invoked; the projection must not have to
    guess it from a traceback string it never saw."""
    from backend.services.ui_projection import _pytest_unavailable

    assert _pytest_unavailable({"pytest_available": False}) is True
    assert _pytest_unavailable({"pytest_available": True}) is False
    # Runs stored before the field existed still resolve through the old path.
    assert _pytest_unavailable(
        {"failure_brief": {"stack_trace": "No module named pytest"}}
    ) is True


# -- the environment precheck must be visible on the V1 surface ---------------
#
# A blocked run reaches exactly one agent: A0.7. Before it was in the registry,
# V1 published eleven cards none of which corresponded to the stage the run
# actually stopped at, so the boundary was invisible and the journal read as a
# pipeline still working through its first stage.


def _blocked_state() -> RunStateModel:
    state = RunStateModel(run_id=RUN_ID, repo_path="quant_med", status="blocked")
    state.environment = {
        "status": "blocked",
        "language": "python",
        "blocking": True,
        "test_runner": "pytest",
        "test_runner_available": False,
        "reason": "No dependency manifest found in the repository.",
        "suggested_command": "pip install -e .",
        "manifests": [],
    }
    return state


def _a07_events() -> list[AgentStatusEvent]:
    return [
        AgentStatusEvent(
            run_id=RUN_ID,
            agent_id="A0.7",
            status="started",
            message="Checking whether the test suite can run",
        ),
        AgentStatusEvent(
            run_id=RUN_ID,
            agent_id="A0.7",
            status="failed",
            message="No dependency manifest found in the repository.",
        ),
    ]


def test_v1_publishes_an_environment_card_for_a_blocked_run():
    entries = build_agent_entries(_blocked_state(), _a07_events(), surface=SURFACE_V1)
    card = next(e for e in entries if e["id"] == "environment")

    assert card["agentId"] == "A0.7"
    assert card["index"] == 1  # first stage the pipeline executes
    assert card["status"] == "failed"
    # The reason is the probe's own sentence, rendered verbatim.
    assert "No dependency manifest found in the repository." in card["lines"]


def test_blocked_run_does_not_fabricate_downstream_agents():
    entries = build_agent_entries(_blocked_state(), _a07_events(), surface=SURFACE_V1)
    downstream = [e for e in entries if e["id"] != "environment"]

    assert downstream, "the V1 rail still publishes the rest of the pipeline"
    # Nothing after the precheck ran, and nothing claims it did.
    assert {e["status"] for e in downstream} == {"skipped"}
    assert not any(e["status"] == "completed" for e in downstream)


def test_environment_card_reports_the_probe_verbatim():
    entries = build_agent_entries(_blocked_state(), _a07_events(), surface=SURFACE_V1)
    card = next(e for e in entries if e["id"] == "environment")

    metrics = {m["label"]: m["value"] for m in card["metrics"]}
    assert metrics["Environment"] == "blocked"
    assert metrics["Test Runner"] == "pytest"

    fields = {f["label"]: f["value"] for f in card["evidence"]["fields"]}
    assert fields["Reason"] == "No dependency manifest found in the repository."
    assert fields["Suggested command"] == "pip install -e ."


def test_environment_card_says_nothing_when_the_precheck_did_not_run():
    """Stub mode and a disabled precheck both leave `environment` empty. The
    card must report absence rather than invent a verdict."""
    state = RunStateModel(run_id=RUN_ID, repo_path="quant_med", status="completed")
    entries = build_agent_entries(state, [], surface=SURFACE_V1)
    card = next(e for e in entries if e["id"] == "environment")

    assert card["status"] == "skipped"
    assert card["evidence"]["fields"] == []


def test_blocked_header_carries_the_status_and_the_environment_report():
    """The client settles a blocked run from these two fields alone."""
    header = build_workspace_header(_blocked_state(), _a07_events())

    assert header["decisionLabel"] == "Environment not prepared"
    assert header["environment"]["reason"] == (
        "No dependency manifest found in the repository."
    )


def test_blocked_run_is_never_projected_as_running_or_completed():
    state = _blocked_state()
    assert sidebar_status(state) == "blocked"
    assert run_decision(state) == ("blocked", "Environment not prepared")
