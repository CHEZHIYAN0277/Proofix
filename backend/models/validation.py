from pydantic import BaseModel, Field


class RetryBrief(BaseModel):
    attempt: int = 0
    violated_contract: str | None = None
    assertion_failure: str | None = None
    stack_trace: str | None = None
    security_constraint: str | None = None


class MutationValidationResult(BaseModel):
    pytest_passed: bool = False
    mutation_score: float | None = None
    mutant_survived: bool = False
    correctness_score: float = 0.0
    failure_brief: RetryBrief | None = None
    pytest_reexecution_command: str = ""
    reexecution_command: str = ""
    reexecution_timeout_seconds: int = 60


class SecurityRescanResult(BaseModel):
    new_findings: list = Field(default_factory=list)
    rejected: bool = False
    security_score: float = 0.0
    failure_brief: RetryBrief | None = None
    reexecution_command: str = ""
    reexecution_timeout_seconds: int = 150
