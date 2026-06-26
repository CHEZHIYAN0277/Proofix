from pydantic import BaseModel, Field


class Finding(BaseModel):
    id: str
    file: str
    line: int
    message: str = ""
    tools: list[str] = Field(default_factory=list)
    severity: float = 0.0
    blast_radius_score: float = 0.0
    consensus: bool = False


class StaticAnalysisReport(BaseModel):
    raw_count: int = 0
    prioritized: list[Finding] = Field(default_factory=list)
    baseline_json: dict = Field(default_factory=dict)
