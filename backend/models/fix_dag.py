from pydantic import BaseModel, Field


class FixNode(BaseModel):
    issue_id: str
    files: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)


class DependencyEdge(BaseModel):
    from_issue: str
    to_issue: str
    reason: str = ""


class FixDAGPlan(BaseModel):
    nodes: list[FixNode] = Field(default_factory=list)
    execution_order: list[str] = Field(default_factory=list)
    conflict_batches: list[list[str]] = Field(default_factory=list)
    dependency_edges: list[DependencyEdge] = Field(default_factory=list)
