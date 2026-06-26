from typing import Literal

from backend.config import get_settings
from backend.orchestrator.trust_gating import (
    MAX_REINVESTIGATIONS,
    mutation_validation_failed,
    security_validation_failed,
)


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

    if mutation_validation_failed(mutation):
        if retry_count < max_retries:
            return "generate_code"
        return "route_pr"
    return "validate_security"


def after_security(state: dict) -> Literal["route_pr", "generate_code"]:
    security = state.get("security_result") or {}
    retry_count = state.get("retry_count", 0)
    max_retries = get_settings().max_retries

    if security_validation_failed(security):
        if retry_count < max_retries:
            return "generate_code"
    return "route_pr"
