"""Unit tests for RetryBrief construction from validation failures."""

from backend.models.validation import ValidationFailure
from backend.services.retry_brief_builder import build_retry_brief, retry_reason_from_brief

AUTH_PATCH = {
    "file": "vulnapi/auth.py",
    "original": "def validate_token():\n    return True\n",
    "patched": "def validate_token():\n    return False\n",
}


def test_build_retry_brief_includes_validation_context():
    failure = ValidationFailure(
        failing_test="tests/test_auth.py::test_expired_token_rejected",
        assertion_message="AssertionError: assert True is False",
        expected_value="False",
        actual_value="True",
        validation_stage="mutation",
    )
    reproduction = {"failing_test": "tests/test_auth.py::test_expired_token_rejected"}

    brief = build_retry_brief(
        failure,
        attempt=1,
        patch_bundle={"patches": [AUTH_PATCH]},
        reproduction=reproduction,
    )

    assert brief.attempt == 1
    assert brief.previous_patch_summary is not None
    assert "validate_token(expired_token) == False" in (brief.expected_behaviour or "")
    assert brief.actual_behaviour == "True"
    assert "expired JWT tokens" in (brief.retry_instruction or "")
    assert "DIFFERENT implementation" in (brief.retry_instruction or "")
    assert brief.validation_failure is not None


def test_retry_reason_from_brief():
    brief = build_retry_brief(
        ValidationFailure(
            failing_test="tests/test_auth.py::test_expired_token_rejected",
            assertion_message="AssertionError: assert True is False",
            validation_stage="mutation",
        ),
        attempt=1,
    )

    reason = retry_reason_from_brief(brief)
    assert reason.startswith("pytest:")
    assert "assert True is False" in reason
