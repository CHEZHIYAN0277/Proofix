import logging

from backend.agents.a10_routing import (
    citation_review_needed,
    compute_fidelity_score,
    compute_scope_risk,
    hard_draft_reason,
    route_pr_decision,
    technical_validation_passed,
)
from backend.agents.base import AgentBase
from backend.models.pr import AxisScores, PRRoutingDecision
from backend.services.github_pr import GitHubPRService
from backend.services.mci_verifier import generate_description_from_diff, verify_mci
from backend.services.proof_bundle import build_verification_bundle
from backend.state.events import A10CompletedPayload
from backend.state.schema import RunStateModel

logger = logging.getLogger(__name__)


class A10MCIScorerAgent(AgentBase):
    agent_id = "A10"

    async def run(self, state: RunStateModel) -> RunStateModel:
        state.current_agent = self.agent_id
        await self.store.save_state(state)
        await self.emit_status(state, "started", "MCI verification and reviewability scoring")

        root_cause = state.root_cause or {}
        patch_bundle = state.patch_bundle or {}
        mutation = state.mutation_result or {}
        security = state.security_result or {}
        blast = state.blast_graph or {}

        description_why = root_cause.get("summary", "Security fix based on root cause analysis")
        diff_text = patch_bundle.get("diff_text", "")
        description_what = generate_description_from_diff(diff_text)

        fidelity_ok, phantoms = verify_mci(description_why + " " + description_what, diff_text)

        # Fix 5: Phantom change detection diagnostics
        logger.info(
            "A10 MCI_VERIFY | run_id=%s"
            " | description_why_len=%d | description_what_len=%d | diff_len=%d"
            " | fidelity_ok=%s | phantoms=%s | phantom_count=%d",
            state.run_id,
            len(description_why),
            len(description_what),
            len(diff_text),
            fidelity_ok,
            sorted(phantoms),
            len(phantoms),
        )

        correctness = mutation.get("correctness_score", 0.0)
        security_score = security.get("security_score", 0.0)
        fidelity = compute_fidelity_score(fidelity_ok, state)
        scope_risk = compute_scope_risk(blast, state)

        axis = AxisScores(
            correctness=correctness,
            security=security_score,
            fidelity=fidelity,
            scope_risk=scope_risk,
        )

        # Fix 6: Full routing decision log before route_pr_decision
        _mutation = state.mutation_result or {}
        _security = state.security_result or {}
        _tech_passed = technical_validation_passed(state, _mutation, _security, phantoms)
        _citation_needed = citation_review_needed(state)
        _hard, _hard_reason = hard_draft_reason(state, axis, phantoms)
        logger.info(
            "A10 ROUTING | run_id=%s"
            " | axis: correctness=%.1f | security=%.1f | fidelity=%.1f | scope_risk=%.1f"
            " | technical_validation_passed=%s"
            " | citation_review_needed=%s"
            " | phantom_changes_detected=%s (phantoms=%s)"
            " | hard_draft=%s | hard_draft_reason=%s"
            " | validation_exhausted=%s",
            state.run_id,
            correctness,
            security_score,
            fidelity,
            scope_risk,
            _tech_passed,
            _citation_needed,
            bool(phantoms),
            sorted(phantoms),
            _hard,
            _hard_reason,
            state.validation_exhausted,
        )

        pr_type, review_note = route_pr_decision(state, axis, phantoms)

        github = GitHubPRService(self.settings)
        title = f"[SENTINEL] {root_cause.get('root_cause', 'Security fix')[:60]}"
        review_section = review_note or ""

        branch = f"sentinel-fix-{state.run_id[:8]}"
        patch_files = {
            p["file"]: p["patched"]
            for p in patch_bundle.get("patches", [])
            if p.get("file") and p.get("patched") is not None
        }

        preliminary_bundle = build_verification_bundle(state, patch_commit=state.base_commit_sha or "")
        body = github.format_pr_body_with_proof(
            preliminary_bundle,
            description_why,
            description_what,
            review_section,
        )

        pr_url, final_bundle = github.publish_fix_with_proof(
            repo_path=state.repo_clone_path or state.repo_path,
            branch=branch,
            patch_files=patch_files,
            bundle=preliminary_bundle,
            commit_message=title,
            title=title,
            body=body,
            draft=(pr_type == "draft"),
        )

        if final_bundle.steps and final_bundle.steps[0].patch_commit != preliminary_bundle.steps[0].patch_commit:
            body = github.format_pr_body_with_proof(
                final_bundle, description_why, description_what, review_section
            )

        bundle_dict = final_bundle.model_dump(mode="json")
        state.proof_bundle = bundle_dict
        await self.store.set_json(state.run_id, f"proof:{final_bundle.issue_id}", bundle_dict)

        decision = PRRoutingDecision(
            pr_type=pr_type,  # type: ignore[arg-type]
            axis_scores=axis,
            pr_url=pr_url,
            description_why=description_why,
            description_what=description_what,
            review_note=review_note,
            phantom_changes_detected=bool(phantoms),
        )
        decision_dict = decision.model_dump(mode="json")
        state.pr_decision = decision_dict
        state.status = "completed"

        completed_payload = A10CompletedPayload(
            pr_type=pr_type,  # type: ignore[arg-type]
            axis_scores=axis,
            pr_url=pr_url,
            proof_bundle_hash=final_bundle.bundle_hash,
            reproduction_confidence=final_bundle.reproduction_confidence,
        )
        await self.emit_status(
            state,
            "completed",
            f"PR routed as {pr_type}",
            completed_payload.model_dump(mode="json"),
        )

        logger.info(
            "A10 EXIT | run_id=%s | status=%s | current_agent=%s"
            " | retry=%d | proof=%s | pr_type=%s | pr_url=%s",
            state.run_id,
            state.status,
            state.current_agent,
            state.retry_count,
            state.proof_bundle is not None,
            decision.pr_type,
            decision.pr_url,
        )
        return state
