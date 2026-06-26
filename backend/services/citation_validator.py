from pathlib import Path


def validate_citation(repo_path: Path, file: str, line: int) -> bool:
    target = repo_path / file
    if not target.exists():
        return False
    try:
        content = target.read_text(encoding="utf-8")
        line_count = len(content.splitlines())
        return 1 <= line <= line_count
    except OSError:
        return False


def validate_all_citations(repo_path: Path, citations: list[dict]) -> list[dict]:
    validated = []
    for c in citations:
        verified = validate_citation(repo_path, c["file"], c["line"])
        validated.append({**c, "verified": verified})
    return validated
