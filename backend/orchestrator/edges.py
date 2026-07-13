import logging
from typing import Literal

from backend.config import get_settings
from backend.orchestrator.trust_gating import (
    MAX_REINVESTIGATIONS,
    mutation_validation_failed,
    security_validation_failed,
)

logger = logging.getLogger(__name__)


def should_reinvestigate(state: dict) -> Literal["investigate", "blast_scope"]:
    if state.get("reinvestigation_exhausted"):
        return "blast_scope"
    root_cause = state.get("root_cause") or {}
    if root_cause.get("evidence_incomplete"):
        return "blast_scope"
    count = root_cause.get("reinvestigation_count", 0)
    if root_cause.get("reinvestigation_required") and count <= MAX_REINVESTIGATIONS:
        return "investigate"
    return "blast_scope"


def after_mutation(state: dict) -> Literal["validate_security", "generate_code", "route_pr"]:
    mutation = state.get("mutation_result") or {}
    retry_count = state.get("retry_count", 0)
    max_retries = get_settings().max_retries

    if mutation.get("patch_retry_required"):
        if retry_count < max_retries:
            # Fix 7: Log retry decision
            logger.info(
                "RETRY DECISION | edge=after_mutation | run_id=%s"
                " | retry_count=%d | max_retries=%d"
                " | reason=patch_retry_required"
                " | validation_failure=%s"
                " | retry_brief_present=%s"
                " | routing_to=generate_code",
                state.get("run_id"),
                retry_count,
                max_retries,
                (state.get("validation_failure") or {}).get("assertion_message"),
                state.get("retry_brief") is not None,
            )
            return "generate_code"
        logger.info(
            "RETRY EXHAUSTED | edge=after_mutation | run_id=%s"
            " | retry_count=%d | max_retries=%d"
            " | reason=max_retries_reached | routing_to=route_pr",
            state.get("run_id"),
            retry_count,
            max_retries,
        )
        return "route_pr"

    if mutation_validation_failed(mutation):
        logger.info(
            "MUTATION FAILED (no retry) | edge=after_mutation | run_id=%s"
            " | retry_count=%d | pytest_passed=%s | regression_passed=%s"
            " | routing_to=route_pr",
            state.get("run_id"),
            retry_count,
            mutation.get("pytest_passed"),
            mutation.get("regression_tests_passed"),
        )
        return "route_pr"

    return "validate_security"


def after_security(state: dict) -> Literal["route_pr", "generate_code"]:
    security = state.get("security_result") or {}
    retry_count = state.get("retry_count", 0)
    max_retries = get_settings().max_retries

    if security_validation_failed(security):
        if retry_count < max_retries:
            # Fix 7: Log retry decision
            logger.info(
                "RETRY DECISION | edge=after_security | run_id=%s"
                " | retry_count=%d | max_retries=%d"
                " | reason=security_rejected"
                " | new_findings=%d"
                " | validation_failure=%s"
                " | retry_brief_present=%s"
                " | routing_to=generate_code",
                state.get("run_id"),
                retry_count,
                max_retries,
                len(security.get("new_findings") or []),
                (state.get("validation_failure") or {}).get("assertion_message"),
                state.get("retry_brief") is not None,
            )
            return "generate_code"
        logger.info(
            "RETRY EXHAUSTED | edge=after_security | run_id=%s"
            " | retry_count=%d | max_retries=%d"
            " | reason=max_retries_reached | routing_to=route_pr",
            state.get("run_id"),
            retry_count,
            max_retries,
        )

    return "route_pr"
