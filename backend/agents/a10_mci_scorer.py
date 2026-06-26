from backend.agents.base import AgentBase
from backend.models.pr import AxisScores, PRRoutingDecision
from backend.orchestrator.trust_gating import (
    full_suite_review_note,
    trust_gates_block_auto_merge,
)
from backend.services.github_pr import GitHubPRService
from backend.services.mci_verifier import generate_description_from_diff, verify_mci
from backend.services.proof_bundle import build_verification_bundle
from backend.state.events import A10CompletedPayload
from backend.state.schema import RunStateModel

SCORE_THRESHOLD = 80.0


class A10MCIScorerAgent(AgentBase):
    agent_id = "A10"

    async def run(self, state: RunStateModel) -> RunStateModel:
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

        correctness = mutation.get("correctness_score", 0.0)
        security_score = security.get("security_score", 0.0)
        fidelity = 100.0 if fidelity_ok else 50.0
        scope_risk = self._compute_scope_risk(blast, state)

        axis = AxisScores(
            correctness=correctness,
            security=security_score,
            fidelity=fidelity,
            scope_risk=scope_risk,
        )

        pr_type, review_note = self._route(state, axis, phantoms)

        if phantoms and pr_type != "draft" and not trust_gates_block_auto_merge(state):
            description_what = generate_description_from_diff(diff_text)
            pr_type = (
                "diff_only"
                if correctness >= SCORE_THRESHOLD and security_score >= SCORE_THRESHOLD
                else pr_type
            )

        github = GitHubPRService(self.settings)
        title = f"[SENTINEL] {root_cause.get('root_cause', 'Security fix')[:60]}"
        review_section = review_note or ""

        branch = f"sentinel-fix-{state.run_id[:8]}"
        patch_files = {
            p["file"]: p["patched"]
            for p in patch_bundle.get("patches", [])
            if p.get("file") and p.get("patched") is not None
        }

        # Layer 5: proof bundle uses base SHA; patch SHA filled at commit time
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

        # Re-format body with final patch SHA for dry-run (no amend in dry-run path)
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
        return state

    def _compute_scope_risk(self, blast: dict, state: RunStateModel) -> float:
        human = len(blast.get("human_review_required", []))
        if state.force_draft_pr:
            return 30.0
        if human == 0:
            return 90.0
        return max(20.0, 90.0 - human * 15)

    def _route(
        self,
        state: RunStateModel,
        axis: AxisScores,
        phantoms: set[str],
    ) -> tuple[str, str | None]:
        if state.validation_exhausted:
            return "draft", (
                "Validation retries exhausted. Manual verification required before merge."
            )

        if state.reinvestigation_exhausted:
            return "draft", (
                "Evidence reinvestigation limit reached with incomplete citations. "
                "Manual verification required before merge."
            )

        if state.force_draft_pr:
            root = state.root_cause or {}
            if root.get("evidence_incomplete"):
                return "draft", (
                    "Evidence incomplete after maximum reinvestigations. "
                    "Manual verification required before merge."
                )
            repro = state.reproduction or {}
            status = repro.get("status", "")
            if status == "UNCONFIRMED":
                return "draft", (
                    "A3.5 Reproduction Gate: bug could not be reproduced in test environment. "
                    "Manual verification required before merge."
                )
            if status == "INFRA_ERROR":
                detail = repro.get("infra_detail") or "pytest infrastructure failure"
                return "draft", (
                    f"A3.5 Reproduction Gate: infrastructure error during test run ({detail}). "
                    "Manual verification required before merge."
                )
            if status == "NO_TESTS":
                return "draft", (
                    "A3.5 Reproduction Gate: no tests available to confirm the vulnerability. "
                    "Manual verification required before merge."
                )
            return "draft", (
                "A3.5 Reproduction Gate: bug could not be reproduced in test environment. "
                "Manual verification required before merge."
            )

        scores = [axis.correctness, axis.security, axis.fidelity, axis.scope_risk]
        failing = []
        for name, val in [
            ("correctness", axis.correctness),
            ("security", axis.security),
            ("fidelity", axis.fidelity),
            ("scope_risk", axis.scope_risk),
        ]:
            if val < SCORE_THRESHOLD:
                failing.append(f"{name}={val:.0f}")

        if failing:
            return "draft", f"Low axis scores: {', '.join(failing)}. Manual review required."

        if phantoms:
            return "diff_only", None

        if trust_gates_block_auto_merge(state):
            return "diff_only", full_suite_review_note()

        return "auto_mergeable", None
