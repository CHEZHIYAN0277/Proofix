"""A10 PR routing helpers and decision logic."""

from __future__ import annotations

from backend.models.pr import AxisScores
from backend.orchestrator.trust_gating import full_suite_review_note
from backend.state.schema import RunStateModel

SCORE_THRESHOLD = 80.0
SECURITY_TECHNICAL_THRESHOLD = 90.0
CITATION_REVIEW_FIDELITY = 70.0
CITATION_REVIEW_NOTE = (
    "Citation verification incomplete after maximum reinvestigations. "
    "Manual citation review recommended before merge."
)


def citation_review_needed(state: RunStateModel) -> bool:
    root = state.root_cause or {}
    return bool(state.reinvestigation_exhausted or root.get("evidence_incomplete"))


def technical_validation_passed(
    state: RunStateModel,
    mutation: dict,
    security: dict,
    phantoms: set[str],
) -> bool:
    repro = state.reproduction or {}
    if repro.get("status") != "CONFIRMED":
        return False
    if state.validation_exhausted:
        return False
    if mutation.get("patch_retry_required"):
        return False
    if mutation.get("target_test_passed") is False:
        return False
    if mutation.get("regression_tests_passed") is False:
        return False
    if mutation.get("pytest_passed") is False:
        return False
    if security.get("rejected"):
        return False
    if (security.get("security_score") or 0.0) < SECURITY_TECHNICAL_THRESHOLD:
        return False
    if (mutation.get("correctness_score") or 0.0) < SCORE_THRESHOLD:
        return False
    if phantoms:
        return False
    return True


def reproduction_gate_failed(state: RunStateModel) -> tuple[bool, str | None]:
    if not state.force_draft_pr:
        return False, None

    repro = state.reproduction or {}
    status = repro.get("status", "")
    if status == "CONFIRMED":
        return False, None

    if status == "UNCONFIRMED":
        return True, (
            "A3.5 Reproduction Gate: bug could not be reproduced in test environment. "
            "Manual verification required before merge."
        )
    if status == "INFRA_ERROR":
        detail = repro.get("infra_detail") or "pytest infrastructure failure"
        return True, (
            f"A3.5 Reproduction Gate: infrastructure error during test run ({detail}). "
            "Manual verification required before merge."
        )
    if status == "NO_TESTS":
        return True, (
            "A3.5 Reproduction Gate: no tests available to confirm the vulnerability. "
            "Manual verification required before merge."
        )
    return True, (
        "A3.5 Reproduction Gate: bug could not be reproduced in test environment. "
        "Manual verification required before merge."
    )


def hard_draft_reason(
    state: RunStateModel,
    axis: AxisScores,
    phantoms: set[str],
) -> tuple[bool, str | None]:
    mutation = state.mutation_result or {}
    security = state.security_result or {}

    if state.validation_exhausted:
        return True, "Validation retries exhausted. Manual verification required before merge."

    if mutation.get("patch_retry_required"):
        return True, "Target test validation failed after patch. Manual verification required before merge."

    if mutation.get("target_test_passed") is False:
        return True, "Target reproduced test still failing after patch. Manual verification required before merge."

    if mutation.get("regression_tests_passed") is False:
        return True, "Patch introduced new test regressions. Manual verification required before merge."

    if security.get("rejected"):
        return True, "Security re-scan rejected the patch. Manual verification required before merge."

    if phantoms:
        return True, (
            "Phantom changes detected between PR description and diff. "
            "Manual verification required before merge."
        )

    if axis.correctness < SCORE_THRESHOLD:
        return True, f"Low axis scores: correctness={axis.correctness:.0f}. Manual review required."

    if axis.security < SCORE_THRESHOLD:
        return True, f"Low axis scores: security={axis.security:.0f}. Manual review required."

    repro_failed, repro_note = reproduction_gate_failed(state)
    if repro_failed:
        return True, repro_note

    return False, None


def route_pr_decision(
    state: RunStateModel,
    axis: AxisScores,
    phantoms: set[str],
) -> tuple[str, str | None]:
    mutation = state.mutation_result or {}
    security = state.security_result or {}

    hard, note = hard_draft_reason(state, axis, phantoms)
    if hard:
        return "draft", note

    if technical_validation_passed(state, mutation, security, phantoms):
        if citation_review_needed(state):
            return "diff_only", CITATION_REVIEW_NOTE
        if state.reproduction_confidence == "full_suite":
            return "diff_only", full_suite_review_note()
        return "auto_mergeable", None

    failing = []
    for name, val in [
        ("correctness", axis.correctness),
        ("security", axis.security),
        ("fidelity", axis.fidelity),
        ("scope_risk", axis.scope_risk),
    ]:
        if val < SCORE_THRESHOLD:
            failing.append(f"{name}={val:.0f}")

    if failing:
        return "draft", f"Low axis scores: {', '.join(failing)}. Manual review required."

    return "diff_only", full_suite_review_note()


def compute_fidelity_score(fidelity_ok: bool, state: RunStateModel) -> float:
    fidelity = 100.0 if fidelity_ok else 50.0
    if citation_review_needed(state):
        fidelity = min(fidelity, CITATION_REVIEW_FIDELITY)
    return fidelity


def compute_scope_risk(blast: dict, state: RunStateModel) -> float:
    human = len(blast.get("human_review_required", []))
    if human == 0:
        return 90.0
    return max(20.0, 90.0 - human * 15)
