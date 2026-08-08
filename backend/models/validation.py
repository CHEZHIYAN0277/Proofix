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
    #: Whether pytest executed at all. `pytest_passed=False` covers both "the
    #: suite ran and failed" and "pytest was never importable in the target
    #: repository"; only this field separates them, and the difference decides
    #: whether `correctness_score` is a measurement or an absence. Defaults True
    #: so states persisted before this existed keep their original meaning.
    pytest_available: bool = True
    mutation_score: float | None = None
    mutant_survived: bool = False
    #: `None` until scoped validation actually ran. A measured 0.0 means the
    #: patch scored zero; absent means nothing scored it.
    correctness_score: float | None = None

    # Real mutation evidence. All additive and defaulted, so states persisted
    # before mutation parsing existed still deserialize. `mutation_status`
    # distinguishes "measured" from "could not be measured" — consumers must not
    # read `mutation_score is None` as a score of zero.
    mutation_status: Literal["scored", "unavailable", "not_run"] = "not_run"
    mutation_unavailable_reason: str | None = None
    killed_mutants: int | None = None
    survived_mutants: int | None = None
    total_mutants: int | None = None
    inconclusive_mutants: int | None = None
    mutants_by_status: dict[str, int] = Field(default_factory=dict)
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
    #: `None` until the re-scan actually ran. A measured 0.0 means four or more
    #: new findings; absent means A9 was skipped and nothing was scanned.
    security_score: float | None = None
    failure_brief: RetryBrief | None = None
    validation_failure: ValidationFailure | None = None
    reexecution_command: str = ""
    reexecution_timeout_seconds: int = 150
