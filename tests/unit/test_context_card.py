"""A5.5's product card and A6's plan detail — Phase 4.

A5.5 builds the minimal repair context and is the pipeline's **privacy
boundary**: the only point where secrets are masked before an LLM call. It ran
on every run and published to the `v2` API surface alone, so the evidence that
nothing secret reached the model had no consumer.

The projections here are summaries, built from the agent's event payload so the
polled `/agents` response stays small. The full package — the ranking with its
per-signal breakdown, and the redaction ledger — is served once by
`/runs/{id}/context` and rendered by the workspace's context panel.
"""

from datetime import datetime, timedelta

import pytest

from backend.services.ui_projection import SURFACE_V1, SURFACE_V2, build_agent_entries
from backend.state.events import AgentStatusEvent
from backend.state.schema import RunStateModel

RUN_ID = "e8fac24c-13e5-415f-add4-a64b759e414a"

BUILT = {
    "target_file": "vulnapi/auth.py",
    "target_function": "validate_token",
    "files_ranked": 12,
    "context_files": 2,
    "context_functions": 4,
    "original_tokens": 8000,
    "reduced_tokens": 2000,
    "token_reduction": 0.75,
    "estimated_prompt_tokens": 2100,
    "privacy_redactions": 1,
    "privacy_guard_status": "masked",
    "degraded": False,
}


def _event(agent_id: str, status: str, message: str = "", offset: int = 0, payload=None):
    return AgentStatusEvent(
        run_id=RUN_ID,
        agent_id=agent_id,
        status=status,  # type: ignore[arg-type]
        timestamp=datetime(2026, 8, 9, 12, 0, 0) + timedelta(seconds=offset),
        message=message,
        payload=payload,
        sequence=offset,
    )


def _state(**overrides) -> RunStateModel:
    return RunStateModel(run_id=RUN_ID, repo_path="vulnapi", status="completed", **overrides)


def _events(published: dict | None) -> list[AgentStatusEvent]:
    return [
        _event("A5.5", "started", "Engineering minimal repair context", 0),
        _event(
            "A5.5",
            "completed",
            "Context: 4 function(s) from 2 file(s), 75% token reduction",
            2,
            {"context_engineering": published} if published is not None else None,
        ),
    ]


def _card(state: RunStateModel, events: list[AgentStatusEvent], card: str = "context") -> dict:
    entries = build_agent_entries(state, events, surface=SURFACE_V1)
    return next(e for e in entries if e["id"] == card)


class TestCardIsPublished:
    def test_the_product_surface_carries_the_card(self):
        cards = [e["id"] for e in build_agent_entries(_state(), _events(BUILT), surface=SURFACE_V1)]

        assert "context" in cards
        # Registry order: A5.5 runs between blast radius and the planner.
        assert cards.index("blast") < cards.index("context") < cards.index("planner")

    def test_both_surfaces_now_return_the_same_cards(self):
        """The v1/v2 split closed with this phase."""
        events = _events(BUILT)
        assert build_agent_entries(_state(), events, surface=SURFACE_V1) == build_agent_entries(
            _state(), events, surface=SURFACE_V2
        )


class TestVisualization:
    def test_reports_the_reduction_it_measured(self):
        viz = _card(_state(), _events(BUILT))["visualization"]

        assert viz["kind"] == "context"
        assert viz["data"]["targetFile"] == "vulnapi/auth.py"
        assert viz["data"]["targetFunction"] == "validate_token"
        assert viz["data"]["originalTokens"] == 8000
        assert viz["data"]["reducedTokens"] == 2000
        assert viz["data"]["tokenReduction"] == 0.75

    def test_an_unmeasured_reduction_is_null_not_zero(self):
        """A package that measured no reduction and one that never measured
        are different claims, and 0.0 says the first about the second."""
        viz = _card(_state(), _events({**BUILT, "token_reduction": None}))["visualization"]

        assert viz["data"]["tokenReduction"] is None

    @pytest.mark.parametrize("status", ["clean", "masked", "failed"])
    def test_the_guard_status_travels_verbatim(self, status):
        """`failed` must never be rounded to `clean`: it means the guard itself
        errored, so nothing may be assumed about what reached the model."""
        viz = _card(_state(), _events({**BUILT, "privacy_guard_status": status}))["visualization"]

        assert viz["data"]["privacyGuardStatus"] == status

    def test_redaction_count_is_carried(self):
        viz = _card(_state(), _events({**BUILT, "privacy_redactions": 3}))["visualization"]

        assert viz["data"]["redactions"] == 3

    def test_a_skipped_stage_claims_no_reduction(self):
        """A5.5 resolved no target and handed A7 nothing. Drawing a package
        would claim a reduction that never happened."""
        viz = _card(_state(), _events({"skipped": "no_target_file"}))["visualization"]

        assert viz["data"]["skipped"] == "no_target_file"
        assert viz["data"]["tokenReduction"] is None
        assert viz["data"]["originalTokens"] == 0

    def test_no_payload_means_no_visualization(self):
        assert "visualization" not in _card(_state(), _events(None))


class TestAbsenceIsNotZero:
    def test_a_stage_that_never_ran_renders_absence(self):
        card = _card(_state(), [])

        assert card["status"] == "skipped"
        assert "visualization" not in card
        assert [m["label"] for m in card["metrics"]] == ["Duration"]
        assert card["evidence"]["subtitle"] == "Not yet published by this run."


class TestPlannerReadsTheRealDAG:
    """A6 records *why* it drew each edge; only the count was published."""

    def _planner(self, dag: dict) -> dict:
        events = [
            _event("A6", "started", "Planning repair order", 0),
            _event("A6", "completed", "Planned 2 fixes", 1),
        ]
        return _card(_state(fix_dag=dag), events, card="planner")

    def test_edge_reasons_reach_the_card(self):
        card = self._planner(
            {
                "execution_order": ["fix-0", "fix-1"],
                "dependency_edges": [
                    {"from_issue": "fix-0", "to_issue": "fix-1", "reason": "same file"}
                ],
                "conflict_batches": [],
            }
        )
        values = [f["value"] for f in card["evidence"]["fields"]]

        assert any("fix-0 → fix-1: same file" in str(v) for v in values)

    def test_conflicting_fixes_are_named_not_counted(self):
        card = self._planner(
            {
                "execution_order": ["fix-0", "fix-1"],
                "dependency_edges": [],
                "conflict_batches": [["fix-0", "fix-1"]],
            }
        )
        fields = {f["label"]: f["value"] for f in card["evidence"]["fields"]}

        assert fields["Conflicting fixes"] == "fix-0, fix-1"

    def test_no_conflicts_says_none_rather_than_omitting_the_fact(self):
        card = self._planner(
            {"execution_order": ["fix-0"], "dependency_edges": [], "conflict_batches": []}
        )
        fields = {f["label"]: f["value"] for f in card["evidence"]["fields"]}

        assert fields["Conflicting fixes"] == "none"

    def test_an_edge_with_no_recorded_reason_is_not_invented(self):
        card = self._planner(
            {
                "execution_order": ["fix-0", "fix-1"],
                "dependency_edges": [{"from_issue": "fix-0", "to_issue": "fix-1", "reason": ""}],
                "conflict_batches": [],
            }
        )
        labels = [f["label"] for f in card["evidence"]["fields"]]

        assert "Ordering" not in labels
