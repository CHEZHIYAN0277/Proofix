from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.models.pr import AxisScores


AgentStatus = Literal["started", "progress", "completed", "failed", "retry"]
PRType = Literal["auto_mergeable", "diff_only", "draft"]


class A10CompletedPayload(BaseModel):
    """Payload shape for A10 ``completed`` events (also persisted on ``AgentStatusEvent.payload``)."""

    pr_type: PRType
    axis_scores: AxisScores
    pr_url: str | None = None
    proof_bundle_hash: str | None = None
    reproduction_confidence: str | None = None


class AgentStatusEvent(BaseModel):
    run_id: str
    agent_id: str
    status: AgentStatus
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    message: str = ""
    payload: dict | None = None  # A10 completed: see ``A10CompletedPayload``
    sequence: int = 0
