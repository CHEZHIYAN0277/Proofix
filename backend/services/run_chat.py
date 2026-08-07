"""Answer questions about a run using only evidence the pipeline captured.

Deterministic by default so the panel works with no API key and never
invents facts. When an LLM is configured, it is given the same evidence
digest and asked to answer strictly from it.
"""

from __future__ import annotations

from backend.config import Settings
from backend.services.llm import LLMService
from backend.services.ui_projection import run_decision
from backend.state.schema import RunStateModel

FALLBACK = (
    'I can answer from this run\'s evidence — try: "Why did validation fail?", '
    '"Show blast radius", "What was the root cause?", or "Why a draft PR?".'
)


def _validation_answer(state: RunStateModel) -> str:
    mutation = state.mutation_result or {}
    if not mutation:
        return "Validation has not run yet for this run."

    parts: list[str] = []
    if mutation.get("target_test_passed") is False:
        parts.append("The targeted reproduction test still failed after the patch was applied.")
    elif mutation.get("target_test_passed"):
        parts.append("The targeted reproduction test passed after the patch.")
    else:
        parts.append(
            "No single failing test was identified, so validation fell back to running "
            "the full suite and comparing against the pre-patch baseline."
        )

    if mutation.get("pytest_passed") is False and not mutation.get("new_failures"):
        parts.append("The suite did not reach a passing state after the patch.")
    if mutation.get("patch_retry_required"):
        parts.append("That triggered a patch retry.")

    new_failures = mutation.get("new_failures") or []
    if new_failures:
        parts.append(f"The patch introduced {len(new_failures)} new regression(s): {', '.join(new_failures[:3])}.")

    if mutation.get("mutant_survived"):
        parts.append(
            "Mutation testing found a surviving mutant — the test passes even with the fix mutated, "
            "so it does not actually validate the repair."
        )

    failure = mutation.get("validation_failure") or {}
    if failure.get("assertion_message"):
        parts.append(f"Assertion: {failure['assertion_message']}")

    parts.append(f"Correctness scored {mutation.get('correctness_score', 0):.0f}/100.")
    return " ".join(parts)


def _blast_answer(state: RunStateModel) -> str:
    blast = state.blast_graph or {}
    if not blast:
        return "Blast radius analysis has not run yet."
    scope = blast.get("auto_patch_scope") or []
    review = blast.get("human_review_required") or []
    origins = blast.get("origins") or []
    lines = [f"Origin: {', '.join(origins) or 'unresolved'}."]
    if scope:
        lines.append("Auto-patchable:\n• " + "\n• ".join(scope[:8]))
    if review:
        lines.append(f"{len(review)} file(s) fell below the propagation-confidence threshold and need human review.")
    return "\n\n".join(lines)


def _root_cause_answer(state: RunStateModel) -> str:
    root = state.root_cause or {}
    if not root:
        return "Root cause analysis has not run yet."
    citations = root.get("citations") or []
    verified = [c for c in citations if c.get("verified")]
    lines = [str(root.get("root_cause") or root.get("summary") or "No root cause recorded.")]
    if verified:
        anchor = verified[0]
        lines.append(f"Anchored at {anchor.get('file')}:{anchor.get('line')} — {anchor.get('claim')}")
    lines.append(
        f"{len(verified)}/{len(citations)} citations verified against source; "
        f"confidence {float(root.get('confidence') or 0) * 100:.0f}%."
    )
    return " ".join(lines)


def _decision_answer(state: RunStateModel) -> str:
    decision_data = state.pr_decision or {}
    if not decision_data:
        return "The run has not reached the mergeability stage yet."
    _decision, label = run_decision(state)
    axis = decision_data.get("axis_scores") or {}
    failing = [
        f"{name} {axis.get(key, 0):.0f}"
        for name, key in (
            ("correctness", "correctness"),
            ("security", "security"),
            ("fidelity", "fidelity"),
            ("scope risk", "scope_risk"),
        )
        if float(axis.get(key) or 0) < 80
    ]
    lines = [f"Routed as {label}."]
    if decision_data.get("review_note"):
        lines.append(str(decision_data["review_note"]))
    if failing:
        lines.append(f"Axes below the 80 threshold: {', '.join(failing)}.")
    if state.reproduction_confidence == "full_suite":
        lines.append(
            "Reproduction was full-suite rather than an exact failing test, which alone blocks auto-merge."
        )
    return " ".join(lines)


def _reproduction_answer(state: RunStateModel) -> str:
    repro = state.reproduction or {}
    if not repro:
        return "The reproduction gate has not run yet."
    status = repro.get("status")
    if status != "CONFIRMED":
        return (
            f"Reproduction was {status}. {repro.get('infra_detail') or ''} "
            "Without a confirmed reproduction the repair is routed for manual verification."
        ).strip()
    return (
        f"Confirmed via {repro.get('failing_test')} — "
        f"{repro.get('exception_type')}: {repro.get('exception_message')} "
        f"at {repro.get('failing_file')}:{repro.get('failing_line')}. "
        f"Re-run it with: {repro.get('reexecution_command')}"
    )


def _files_answer(state: RunStateModel) -> str:
    patches = (state.patch_bundle or {}).get("patches") or []
    if not patches:
        return "No patches were generated for this run."
    return "Files modified:\n• " + "\n• ".join(p.get("file", "?") for p in patches)


def _retry_answer(state: RunStateModel) -> str:
    if not state.retry_count:
        return "No retries were needed — the first patch attempt cleared validation."
    return (
        f"{state.retry_count} retry attempt(s) were made. "
        + ("The retry budget was exhausted and the run routed for manual review."
           if state.validation_exhausted
           else "Each retry fed the previous failure back into patch generation.")
    )


def _proof_answer(state: RunStateModel) -> str:
    proof = state.proof_bundle or {}
    if not proof:
        return "No proof bundle was produced for this run."
    steps = proof.get("steps") or []
    lines = [
        f"Proof bundle {proof.get('bundle_hash', '')[:16]}… ships with the PR and verifies with zero LLM calls.",
        f"It pins {len(steps)} step(s) to literal commit SHAs:",
    ]
    lines += [f"• {s.get('name')}: {s.get('command')}" for s in steps if s.get("command")]
    return "\n".join(lines)


def answer_from_state(state: RunStateModel, question: str) -> str:
    """Route a question to the evidence that answers it."""
    q = question.lower()

    if any(k in q for k in ("proof", "bundle", "verify")):
        return _proof_answer(state)
    if any(k in q for k in ("retry", "attempt")):
        return _retry_answer(state)
    if any(k in q for k in ("validation", "mutation", "fail")):
        return _validation_answer(state)
    if any(k in q for k in ("blast", "impact", "affect", "scope")):
        return _blast_answer(state)
    if any(k in q for k in ("reproduc", "runtime", "test")):
        return _reproduction_answer(state)
    if any(k in q for k in ("draft", "merge", "decision", "pr")):
        return _decision_answer(state)
    if any(k in q for k in ("root", "cause", "why")):
        return _root_cause_answer(state)
    if any(k in q for k in ("file", "change", "patch", "diff")):
        return _files_answer(state)
    return FALLBACK


def evidence_digest(state: RunStateModel) -> str:
    """Compact, LLM-safe summary of everything the pipeline established."""
    return "\n".join(
        [
            f"Repository: {state.repo_path}",
            f"Status: {state.status}, retries: {state.retry_count}",
            f"Reproduction: {_reproduction_answer(state)}",
            f"Root cause: {_root_cause_answer(state)}",
            f"Blast radius: {_blast_answer(state)}",
            f"Validation: {_validation_answer(state)}",
            f"Decision: {_decision_answer(state)}",
            f"Files: {_files_answer(state)}",
        ]
    )


async def answer_question(state: RunStateModel, question: str, settings: Settings) -> str:
    """Deterministic answer, upgraded by an LLM only when one is configured."""
    grounded = answer_from_state(state, question)

    if settings.stub_mode or not settings.llm_configured():
        return grounded

    try:
        llm = LLMService(settings, run_id=state.run_id, agent_id="chat")
        prompt = (
            "Answer the reviewer's question about this autonomous repair run using ONLY the "
            "evidence below. If the evidence does not contain the answer, say so plainly. "
            "Be concise and concrete.\n\n"
            f"## Evidence\n{evidence_digest(state)}\n\n"
            f"## Draft answer (already derived from the evidence)\n{grounded}\n\n"
            f"## Question\n{question}"
        )
        return await llm.text(
            prompt,
            system=(
                "You explain autonomous code-repair runs to a human reviewer. "
                "Never invent file names, line numbers, or results not present in the evidence."
            ),
        )
    except Exception:
        return grounded
