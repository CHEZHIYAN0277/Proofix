"""Build RetryBrief from validation failures and prior patch context."""

from __future__ import annotations

import difflib

from backend.models.validation import RetryBrief, ValidationFailure

DEFAULT_RETRY_INSTRUCTION = (
    "Generate a DIFFERENT implementation.\n"
    "Do not repeat the previous patch.\n"
    "Ensure the required semantic change is present."
)


def summarize_previous_patch(patch_bundle: dict | None, previous_patch: dict | None = None) -> str | None:
    patch = previous_patch
    if not patch and patch_bundle:
        patches = patch_bundle.get("patches") or []
        patch = patches[0] if patches else None
    if not patch:
        return None

    original = patch.get("original") or ""
    patched = patch.get("patched") or ""
    if not original or not patched:
        return None

    diff = difflib.unified_diff(
        original.splitlines(),
        patched.splitlines(),
        fromfile="original",
        tofile="previous_attempt",
        lineterm="",
    )
    diff_lines = list(diff)[:40]
    if not diff_lines:
        return "Previous patch made no semantic changes."
    return "```diff\n" + "\n".join(diff_lines) + "\n```"


def build_retry_brief(
    validation_failure: ValidationFailure,
    attempt: int,
    *,
    patch_bundle: dict | None = None,
    previous_patch: dict | None = None,
    reproduction: dict | None = None,
    violated_contract: str | None = None,
    security_constraint: str | None = None,
) -> RetryBrief:
    patch_summary = summarize_previous_patch(patch_bundle, previous_patch)
    expected = _format_expected(validation_failure, reproduction)
    actual = _format_actual(validation_failure)
    context_line = _failure_context(validation_failure, reproduction)
    instruction = _retry_instruction(validation_failure, context_line)

    assertion_failure = validation_failure.assertion_message
    if not assertion_failure and validation_failure.failing_test:
        assertion_failure = f"pytest {validation_failure.failing_test} failed"

    return RetryBrief(
        attempt=attempt,
        violated_contract=violated_contract,
        assertion_failure=assertion_failure,
        stack_trace=validation_failure.traceback,
        security_constraint=security_constraint,
        validation_failure=validation_failure,
        previous_patch_summary=patch_summary,
        expected_behaviour=expected,
        actual_behaviour=actual,
        retry_instruction=instruction,
    )


def retry_reason_from_brief(retry_brief: RetryBrief) -> str:
    vf = retry_brief.validation_failure
    if vf and vf.validation_stage == "security":
        constraint = retry_brief.security_constraint or "security_regression"
        return f"security:{constraint[:80]}"

    if vf and vf.mutation_result and vf.mutation_result.get("mutant_survived"):
        return "mutant_survived"

    if retry_brief.assertion_failure:
        return f"pytest:{retry_brief.assertion_failure[:120]}"

    if vf and vf.failing_test:
        return f"pytest:{vf.failing_test}"

    return "validation_failure"


def _format_expected(validation_failure: ValidationFailure, reproduction: dict | None) -> str | None:
    if validation_failure.expected_value:
        ev = validation_failure.expected_value
        if "validate_token" in ev:
            return ev.replace("(token)", "(expired_token)")
        failing_test = validation_failure.failing_test or ""
        if "token" in failing_test.lower():
            return f"validate_token(expired_token) == {ev}"
        return ev

    repro = reproduction or {}
    if repro.get("failing_test"):
        return f"pytest {repro['failing_test']} passes"
    return None


def _format_actual(validation_failure: ValidationFailure) -> str | None:
    return validation_failure.actual_value


def _failure_context(validation_failure: ValidationFailure, reproduction: dict | None) -> str:
    if validation_failure.validation_stage == "security":
        return "Previous patch introduced a new security finding."

    if validation_failure.mutation_result and validation_failure.mutation_result.get("mutant_survived"):
        return "Previous attempt did not kill the mutation — tests pass without validating the fix."

    repro = reproduction or {}
    if "expired" in (validation_failure.failing_test or "").lower() or "expired" in (repro.get("failing_test") or ""):
        return "Previous attempt still accepted expired JWT tokens."

    if validation_failure.failing_test:
        return f"Previous patch did not fix {validation_failure.failing_test}."

    return "Previous patch failed validation."


def _retry_instruction(validation_failure: ValidationFailure, context_line: str) -> str:
    parts = [context_line]
    if validation_failure.failing_test:
        parts.append(f"pytest `{validation_failure.failing_test}` failed.")
    if validation_failure.expected_value:
        parts.append(f"Expected: {validation_failure.expected_value}")
    if validation_failure.actual_value:
        parts.append(f"Actual: {validation_failure.actual_value}")
    parts.append(DEFAULT_RETRY_INSTRUCTION)
    return "\n".join(parts)
