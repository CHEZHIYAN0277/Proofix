from enum import Enum

from pydantic import BaseModel, Field, model_validator


class ReproductionStatus(str, Enum):
    CONFIRMED = "CONFIRMED"
    UNCONFIRMED = "UNCONFIRMED"
    INFRA_ERROR = "INFRA_ERROR"
    NO_TESTS = "NO_TESTS"


class ReproductionResult(BaseModel):
    status: ReproductionStatus = ReproductionStatus.UNCONFIRMED
    reproduced: bool = False
    failing_test: str | None = None
    exception_type: str | None = None
    exception_message: str | None = None
    failing_file: str | None = None
    failing_line: int | None = None
    traceback: str | None = None
    stack_trace: str | None = None
    confidence: float = 0.0
    force_draft_pr: bool = False
    report_path: str | None = None
    infra_detail: str | None = None
    reexecution_command: str = ""
    reexecution_is_targeted: bool = False
    reexecution_timeout_seconds: int = 120
    pre_existing_failures: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def sync_legacy_fields(self) -> "ReproductionResult":
        if self.status == ReproductionStatus.CONFIRMED:
            self.reproduced = True
            self.force_draft_pr = False
        else:
            self.reproduced = False
            self.force_draft_pr = True

        if self.traceback and not self.stack_trace:
            self.stack_trace = self.traceback
        elif self.stack_trace and not self.traceback:
            self.traceback = self.stack_trace

        return self
