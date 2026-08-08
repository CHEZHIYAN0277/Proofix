from typing import Literal

from pydantic import BaseModel

from backend.services.measurement import Score, measured_mean


class AxisScores(BaseModel):
    """The four merge axes.

    **`None` means the axis was never measured, and is not the same as `0.0`.**
    These previously defaulted to `0.0`, so an axis whose agent never ran was
    indistinguishable from one that ran and scored the worst possible result —
    and the fabricated zero was then averaged into the trust score and printed
    to the user as "security=0". A measured zero still means zero; an absent
    measurement now says so.
    """

    correctness: Score = None
    security: Score = None
    fidelity: Score = None
    scope_risk: Score = None

    def as_list(self) -> list[Score]:
        return [self.correctness, self.security, self.fidelity, self.scope_risk]

    @property
    def trust(self) -> Score:
        """Mean of the axes that were actually measured, or `None`.

        Never a fixed denominator: dividing by four when two axes were measured
        reported a run at half its true score.
        """
        return measured_mean(self.as_list())


class PRRoutingDecision(BaseModel):
    pr_type: Literal["auto_mergeable", "diff_only", "draft"] = "draft"
    axis_scores: AxisScores = AxisScores()
    pr_url: str | None = None
    description_why: str = ""
    description_what: str = ""
    review_note: str | None = None
    phantom_changes_detected: bool = False
