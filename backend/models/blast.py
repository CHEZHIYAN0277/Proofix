from typing import Literal

from pydantic import BaseModel, Field


class ScopedFile(BaseModel):
    path: str
    direction: Literal["forward", "backward"]
    propagation_confidence: float = 0.0
    risk_score: float = 0.0
    hop_count: int = 0
    origin: str = ""


class BlastGraphResult(BaseModel):
    scope: list[ScopedFile] = Field(default_factory=list)
    human_review_required: list[str] = Field(default_factory=list)
    auto_patch_scope: list[str] = Field(default_factory=list)
    origins: list[str] = Field(default_factory=list)
