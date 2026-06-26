from typing import Literal

from pydantic import BaseModel


class AxisScores(BaseModel):
    correctness: float = 0.0
    security: float = 0.0
    fidelity: float = 0.0
    scope_risk: float = 0.0


class PRRoutingDecision(BaseModel):
    pr_type: Literal["auto_mergeable", "diff_only", "draft"] = "draft"
    axis_scores: AxisScores = AxisScores()
    pr_url: str | None = None
    description_why: str = ""
    description_what: str = ""
    review_note: str | None = None
    phantom_changes_detected: bool = False
