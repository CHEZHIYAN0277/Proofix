"""Build multi-source evidence and confidence for A4 root-cause analysis."""

from __future__ import annotations

import re
from pathlib import Path

from backend.models.root_cause import Citation, EvidenceReference

RUNTIME_CONFIRMED_WEIGHT = 0.35
VERIFIED_CITATION_WEIGHT = 0.25
FINDING_WEIGHT = 0.15
CVE_CRITICAL_WEIGHT = 0.20
STACK_WEIGHT = 0.15
SOURCE_DIVERSITY_BONUS = 0.10


def build_runtime_snapshot(reproduction: dict) -> dict:
    return {
        k: reproduction.get(k)
        for k in (
            "status",
            "failing_test",
            "exception_type",
            "exception_message",
            "failing_file",
            "failing_line",
            "traceback",
        )
        if reproduction.get(k) is not None
    }


def collect_evidence_refs(
    stack: str,
    findings: list[dict],
    cve_report: dict,
    reproduction: dict,
    repo: Path | None = None,
) -> tuple[list[EvidenceReference], list[str], list[Citation]]:
    """Gather evidence references and draft citations from all intel sources."""
    refs: list[EvidenceReference] = []
    cve_context: list[str] = []
    citations: list[Citation] = []
    repo_str = str(repo.resolve()) if repo else ""

    status = reproduction.get("status", "")
    if status == "CONFIRMED" or reproduction.get("reproduced"):
        refs.append(
            EvidenceReference(
                source="runtime",
                ref_id=reproduction.get("failing_test") or "runtime-failure",
                file=reproduction.get("failing_file"),
                line=reproduction.get("failing_line"),
                claim=reproduction.get("exception_message")
                or reproduction.get("exception_type")
                or "runtime reproduction confirmed",
                weight=RUNTIME_CONFIRMED_WEIGHT,
            )
        )
        if reproduction.get("failing_file"):
            citations.append(
                Citation(
                    file=reproduction["failing_file"],
                    line=int(reproduction.get("failing_line") or 1),
                    claim=refs[-1].claim,
                    verified=False,
                )
            )

    for finding in findings[:8]:
        refs.append(
            EvidenceReference(
                source="finding",
                ref_id=finding.get("id", finding.get("file", "finding")),
                file=finding.get("file"),
                line=finding.get("line"),
                claim=finding.get("message", "static finding"),
                weight=FINDING_WEIGHT,
            )
        )
        if finding.get("file"):
            citations.append(
                Citation(
                    file=finding["file"],
                    line=int(finding.get("line") or 1),
                    claim=finding.get("message", "static finding"),
                    verified=False,
                )
            )

    for record in cve_report.get("findings") or []:
        if record.get("classification") != "Critical":
            continue
        cve_id = record.get("cve_id", "")
        if cve_id:
            cve_context.append(cve_id)
        refs.append(
            EvidenceReference(
                source="cve",
                ref_id=cve_id or record.get("package", "cve"),
                claim=f"Reachable CVE in {record.get('package', 'dependency')}",
                weight=CVE_CRITICAL_WEIGHT,
            )
        )

    if stack.strip():
        refs.append(
            EvidenceReference(
                source="stack_trace",
                ref_id="stack-trace",
                claim="Stack trace evidence",
                weight=STACK_WEIGHT,
            )
        )
        match = re.search(r'File "([^"]+)", line (\d+)', stack)
        if match:
            file_path = match.group(1)
            if repo_str and repo_str in file_path:
                file_path = file_path.replace(repo_str + "/", "").lstrip("/")
            citations.append(
                Citation(
                    file=file_path,
                    line=int(match.group(2)),
                    claim="stack trace origin",
                    verified=False,
                )
            )

    citations = _dedupe_citations(citations)
    return refs, cve_context, citations


def compute_confidence(
    evidence_refs: list[EvidenceReference],
    verified_count: int,
    reproduction: dict,
) -> float:
    score = sum(ref.weight for ref in evidence_refs)
    score += verified_count * VERIFIED_CITATION_WEIGHT

    sources = {ref.source for ref in evidence_refs}
    if len(sources) >= 3:
        score += SOURCE_DIVERSITY_BONUS

    if reproduction.get("status") == "CONFIRMED":
        score += 0.05

    return min(1.0, round(score, 3))


def synthesize_root_cause_summary(
    evidence_refs: list[EvidenceReference],
    cve_context: list[str],
    reproduction: dict,
) -> tuple[str, str]:
    runtime = next((r for r in evidence_refs if r.source == "runtime"), None)
    finding = next((r for r in evidence_refs if r.source == "finding"), None)
    cve = next((r for r in evidence_refs if r.source == "cve"), None)

    parts: list[str] = []
    if runtime and runtime.claim:
        parts.append(f"Runtime failure: {runtime.claim}")
    if finding and finding.claim:
        parts.append(f"Static finding: {finding.claim}")
    if cve:
        parts.append(cve.claim)
    if cve_context:
        parts.append(f"Critical CVEs: {', '.join(cve_context[:3])}")

    summary = ". ".join(parts) if parts else "Root cause synthesized from available evidence"
    root_cause = summary
    if reproduction.get("exception_type"):
        root_cause = (
            f"{reproduction['exception_type']} during {reproduction.get('failing_test', 'test execution')}. "
            f"{summary}"
        )
    return summary[:500], root_cause[:800]


def _dedupe_citations(citations: list[Citation]) -> list[Citation]:
    seen: set[tuple[str, int]] = set()
    unique: list[Citation] = []
    for citation in citations:
        key = (citation.file, citation.line)
        if key in seen:
            continue
        seen.add(key)
        unique.append(citation)
    return unique
