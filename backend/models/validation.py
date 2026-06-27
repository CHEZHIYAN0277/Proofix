from typing import Literal

from pydantic import BaseModel, Field


class ValidationFailure(BaseModel):
    failing_test: str | None = None
    assertion_message: str | None = None
    expected_value: str | None = None
    actual_value: str | None = None
    traceback: str | None = None
    pytest_stdout: str = ""
    pytest_stderr: str = ""
    validation_stage: Literal["mutation", "security"] = "mutation"
    mutation_result: dict | None = None
    security_result: dict | None = None
    target_test_passed: bool | None = None
    regression_tests_passed: bool | None = None
    new_failures: list[str] = Field(default_factory=list)
    pre_existing_failures: list[str] = Field(default_factory=list)


class RetryBrief(BaseModel):
    attempt: int = 0
    violated_contract: str | None = None
    assertion_failure: str | None = None
    stack_trace: str | None = None
    security_constraint: str | None = None
    validation_failure: ValidationFailure | None = None
    previous_patch_summary: str | None = None
    expected_behaviour: str | None = None
    actual_behaviour: str | None = None
    retry_instruction: str | None = None


class MutationValidationResult(BaseModel):
    pytest_passed: bool = False
    mutation_score: float | None = None
    mutant_survived: bool = False
    correctness_score: float = 0.0
    failure_brief: RetryBrief | None = None
    validation_failure: ValidationFailure | None = None
    pytest_reexecution_command: str = ""
    reexecution_command: str = ""
    reexecution_timeout_seconds: int = 60
    target_test_passed: bool | None = None
    regression_tests_passed: bool | None = None
    new_failures: list[str] = Field(default_factory=list)
    pre_existing_failures: list[str] = Field(default_factory=list)
    patch_retry_required: bool = False


class SecurityRescanResult(BaseModel):
    new_findings: list = Field(default_factory=list)
    rejected: bool = False
    security_score: float = 0.0
    failure_brief: RetryBrief | None = None
    validation_failure: ValidationFailure | None = None
    reexecution_command: str = ""
    reexecution_timeout_seconds: int = 150
