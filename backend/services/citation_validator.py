from pathlib import Path
from typing import Any

from backend.services.citation_verifier import verify_all_citations_with_metrics


def _normalize_file_path(file: Any) -> str | None:
    if file is None:
        return None
    text = str(file).strip()
    return text.lstrip("/") if text else None


def _normalize_line(line: Any) -> int | None:
    if line is None:
        return None
    try:
        parsed = int(line)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 1 else None


def _ref_to_citation(ref: Any) -> dict | None:
    if hasattr(ref, "model_dump"):
        data = ref.model_dump()
    elif isinstance(ref, dict):
        data = ref
    else:
        return None

    file = _normalize_file_path(data.get("file"))
    line = _normalize_line(data.get("line"))
    claim = str(data.get("claim") or data.get("description") or "").strip()
    if not file or line is None or not claim:
        return None
    return {"file": file, "line": line, "claim": claim}


def coerce_llm_citations(
    citations: list[dict] | None,
    evidence_refs: list[Any] | None = None,
) -> list[dict]:
    """Drop or repair malformed LLM citations before Pydantic validation."""
    coerced: list[dict] = []
    seen: set[tuple[str, int, str]] = set()

    for raw in citations or []:
        if not isinstance(raw, dict):
            continue
        file = _normalize_file_path(raw.get("file"))
        line = _normalize_line(raw.get("line"))
        claim = str(raw.get("claim") or raw.get("description") or "").strip()
        if not file or line is None or not claim:
            continue
        key = (file, line, claim)
        if key in seen:
            continue
        seen.add(key)
        coerced.append({"file": file, "line": line, "claim": claim})

    if coerced:
        return coerced

    for ref in evidence_refs or []:
        citation = _ref_to_citation(ref)
        if citation is None:
            continue
        key = (citation["file"], citation["line"], citation["claim"])
        if key in seen:
            continue
        seen.add(key)
        coerced.append(citation)

    return coerced


def validate_citation(repo_path: Path, file: str, line: int, sig: dict | None = None) -> bool:
    validated, _metrics = verify_all_citations_with_metrics(
        repo_path,
        [{"file": file, "line": line, "claim": "line validation"}],
        sig=sig,
    )
    return bool(validated and validated[0].get("verified"))


def validate_all_citations(
    repo_path: Path,
    citations: list[dict],
    sig: dict | None = None,
) -> list[dict]:
    validated, _metrics = verify_all_citations_with_metrics(repo_path, citations, sig=sig)
    return validated


def validate_all_citations_with_metrics(
    repo_path: Path,
    citations: list[dict],
    sig: dict | None = None,
) -> tuple[list[dict], dict[str, int]]:
    return verify_all_citations_with_metrics(repo_path, citations, sig=sig)
