from typing import Literal

from pydantic import BaseModel, Field


CVEClassification = Literal["Critical", "Informational", "Unknown"]


class CVERecord(BaseModel):
    package: str
    cve_id: str
    severity: str
    affected_symbol: str | None = None
    reachable: bool | None = None
    reach_path: list[str] | None = None
    classification: CVEClassification = "Unknown"


class CVEReachabilityReport(BaseModel):
    findings: list[CVERecord] = Field(default_factory=list)
    critical_queue: list[str] = Field(default_factory=list)
