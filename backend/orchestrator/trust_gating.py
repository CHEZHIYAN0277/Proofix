"""Trust gates applied before PR routing."""

from backend.config import Settings, get_settings
from backend.models.proof import ReproductionConfidence
from backend.state.schema import RunStateModel

MAX_REINVESTIGATIONS = 2


def derive_reproduction_confidence(reproduction: dict) -> ReproductionConfidence:
    if reproduction.get("reexecution_is_targeted"):
        return "exact_test"
    return "full_suite"


def full_suite_review_note() -> str:
    return (
        "Lower-confidence full-suite reproduction proof. "
        "Manual review required — not eligible for auto-merge."
    )


def mutation_validation_failed(mutation: dict) -> bool:
    if not mutation:
        return False
    return not mutation.get("pytest_passed") or bool(mutation.get("mutant_survived"))


def security_validation_failed(security: dict) -> bool:
    if not security:
        return False
    return bool(security.get("rejected"))


def apply_trust_gates_before_pr(
    model: RunStateModel,
    max_retries: int | None = None,
) -> RunStateModel:
    """Set exhaustion flags and force_draft_pr before A10 routes the PR."""
    if max_retries is None:
        max_retries = get_settings().max_retries

    model.reproduction_confidence = derive_reproduction_confidence(model.reproduction or {})

    mutation = model.mutation_result or {}
    security = model.security_result or {}

    if model.retry_count >= max_retries and (
        mutation_validation_failed(mutation) or security_validation_failed(security)
    ):
        model.validation_exhausted = True
        model.force_draft_pr = True

    root = model.root_cause or {}
    if root.get("evidence_incomplete") or model.reinvestigation_exhausted:
        model.reinvestigation_exhausted = True
        model.force_draft_pr = True

    return model


def trust_gates_block_auto_merge(model: RunStateModel) -> bool:
    return bool(
        model.force_draft_pr
        or model.validation_exhausted
        or model.reinvestigation_exhausted
        or model.reproduction_confidence == "full_suite"
    )
