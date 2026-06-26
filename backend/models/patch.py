from typing import Literal

from pydantic import BaseModel, Field


class BehavioralContract(BaseModel):
    assertion: str
    location: str


class PatchPlan(BaseModel):
    """Evidence-driven repair plan for a single file — input to LLM patch generation."""

    file: str
    root_cause: str
    required_behavior_change: str
    security_constraints: list[str] = Field(default_factory=list)
    validation_goals: list[str] = Field(default_factory=list)
    stack_evidence: str = ""
    blast_context: str = ""


class PatchCandidate(BaseModel):
    file: str
    original: str
    patched: str
    method: Literal["ast_validated_write", "libcst"] = "ast_validated_write"


class PatchBundle(BaseModel):
    issue_id: str = ""
    patches: list[PatchCandidate] = Field(default_factory=list)
    contracts: list[BehavioralContract] = Field(default_factory=list)
    style_exemplar_commit: str | None = None
    diff_text: str = ""
