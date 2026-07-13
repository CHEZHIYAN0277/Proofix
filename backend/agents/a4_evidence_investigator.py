from pathlib import Path

from pydantic import BaseModel

from backend.agents.base import AgentBase
from backend.models.root_cause import Citation, RootCauseBrief
from backend.orchestrator.trust_gating import MAX_REINVESTIGATIONS
from backend.services.citation_validator import (
    coerce_llm_citations,
    validate_all_citations_with_metrics,
)
from backend.services.llm import LLMService
from backend.services.root_cause_builder import (
    build_runtime_snapshot,
    collect_evidence_refs,
    compute_confidence,
    synthesize_root_cause_summary,
)
from backend.state.schema import RunStateModel


class RootCauseLLMOutput(BaseModel):
    summary: str
    root_cause: str
    citations: list[dict]
    affected_modules: list[str]


class A4EvidenceInvestigatorAgent(AgentBase):
    agent_id = "A4"

    async def run(self, state: RunStateModel) -> RunStateModel:
        state.current_agent = self.agent_id
        await self.store.save_state(state)
        await self.emit_status(state, "started", "Investigating root cause with trace evidence")
        repo = Path(state.repo_clone_path or state.repo_path)
        reproduction = state.reproduction or {}
        static = state.static_report or {}
        cve_report = state.cve_report or {}
        stack = reproduction.get("traceback") or reproduction.get("stack_trace", "") or ""
        findings = static.get("prioritized", [])

        evidence_refs, cve_context, draft_citations = collect_evidence_refs(
            stack, findings, cve_report, reproduction, repo
        )
        runtime_snapshot = build_runtime_snapshot(reproduction)

        prior = state.root_cause or {}
        prior_count = int(prior.get("reinvestigation_count", 0))

        if self.settings.stub_mode or not self.settings.llm_configured():
            brief = self._stub_brief(
                stack, findings, repo, reproduction, evidence_refs, cve_context, draft_citations
            )
        else:
            brief = await self._llm_brief(
                stack, findings, cve_report, reproduction, evidence_refs, cve_context, repo
            )

        brief.reinvestigation_count = prior_count
        brief.evidence_refs = evidence_refs
        brief.runtime_evidence = runtime_snapshot
        brief.cve_context = cve_context

        validated, citation_metrics = validate_all_citations_with_metrics(
            repo,
            [c.model_dump() for c in brief.citations],
            sig=state.sig,
        )
        brief.citations = [Citation(**c) for c in validated]
        verified_count = sum(1 for c in brief.citations if c.verified)
        brief.confidence = compute_confidence(evidence_refs, verified_count, reproduction)

        unverified = [c for c in brief.citations if not c.verified]
        if unverified:
            if prior_count < MAX_REINVESTIGATIONS:
                brief.reinvestigation_required = True
                brief.reinvestigation_count = prior_count + 1
            else:
                brief.reinvestigation_required = False
                brief.evidence_incomplete = True
                state.reinvestigation_exhausted = True
                state.force_draft_pr = True
        else:
            brief.reinvestigation_required = False

        brief_dict = brief.model_dump(mode="json")
        state.root_cause = brief_dict
        await self.emit_status(
            state,
            "completed",
            brief.summary[:100],
            {
                "citations": len(brief.citations),
                "reinvestigation": brief.reinvestigation_required,
                "confidence": brief.confidence,
                "evidence_refs": len(brief.evidence_refs),
                "citation_metrics": citation_metrics,
            },
        )
        return state

    def _stub_brief(
        self,
        stack: str,
        findings: list,
        repo: Path,
        reproduction: dict,
        evidence_refs: list,
        cve_context: list[str],
        draft_citations: list[Citation],
    ) -> RootCauseBrief:
        summary, root_cause = synthesize_root_cause_summary(evidence_refs, cve_context, reproduction)
        citations = draft_citations or []
        if not citations and findings:
            f = findings[0]
            citations = [
                Citation(
                    file=f["file"],
                    line=f.get("line", 1),
                    claim=f.get("message", "issue"),
                    verified=False,
                )
            ]

        return RootCauseBrief(
            summary=summary,
            root_cause=root_cause,
            citations=citations,
            stack_evidence=stack[:2000],
            affected_modules=sorted({c.file for c in citations}),
        )

    async def _llm_brief(
        self,
        stack: str,
        findings: list,
        cve_report: dict,
        reproduction: dict,
        evidence_refs: list,
        cve_context: list[str],
        repo: Path,
    ) -> RootCauseBrief:
        llm = LLMService(self.settings)
        critical_cves = [
            f"{r.get('cve_id')} ({r.get('package')})"
            for r in cve_report.get("findings", [])
            if r.get("classification") == "Critical"
        ]
        prompt = f"""Analyze root cause using ALL evidence sources. Every claim must cite file:line.

Stack trace:
{stack[:3000]}

Static findings:
{findings[:8]}

Runtime reproduction:
{reproduction}

Critical CVEs:
{critical_cves[:10]}

Evidence references:
{[r.model_dump() for r in evidence_refs]}

CVE context IDs: {cve_context}

Return citations as JSON objects with non-null string "file", integer "line" (>=1), and string "claim".
Omit citations you cannot anchor to a concrete file and line.
"""
        output = await llm.structured(prompt, RootCauseLLMOutput)
        raw_citations = coerce_llm_citations(output.citations, evidence_refs)
        return RootCauseBrief(
            summary=output.summary,
            root_cause=output.root_cause,
            citations=[Citation(**c) for c in raw_citations],
            stack_evidence=stack[:2000],
            affected_modules=output.affected_modules,
        )
