from backend.models.root_cause import EvidenceReference
from backend.services.citation_validator import (
    coerce_llm_citations,
    validate_all_citations,
    validate_all_citations_with_metrics,
)


def test_coerce_llm_citations_drops_null_fields():
    result = coerce_llm_citations(
        [
            {"file": None, "line": None, "claim": "bad"},
            {"file": "vulnapi/auth.py", "line": 12, "claim": "missing check"},
        ]
    )
    assert result == [{"file": "vulnapi/auth.py", "line": 12, "claim": "missing check"}]


def test_coerce_llm_citations_falls_back_to_evidence_refs():
    refs = [
        EvidenceReference(
            source="finding",
            file="vulnapi/api.py",
            line=44,
            claim="SQL injection risk",
        )
    ]
    result = coerce_llm_citations([{"file": None, "line": None, "claim": "bad"}], refs)
    assert result == [{"file": "vulnapi/api.py", "line": 44, "claim": "SQL injection risk"}]


def test_validate_all_citations_resolves_basename(tmp_path):
    auth_dir = tmp_path / "vulnapi"
    auth_dir.mkdir(parents=True)
    (auth_dir / "auth.py").write_text("def validate_token():\n    return True\n", encoding="utf-8")
    sig = {"files": {"vulnapi/auth.py": {"path": "vulnapi/auth.py"}}}
    validated = validate_all_citations(
        tmp_path,
        [{"file": "auth.py", "line": 1, "claim": "validate_token() bug"}],
        sig=sig,
    )
    assert validated[0]["verified"] is True
    assert validated[0]["file"] == "vulnapi/auth.py"


def test_validate_all_citations_with_metrics_wrapper(tmp_path):
    auth_dir = tmp_path / "vulnapi"
    auth_dir.mkdir(parents=True)
    (auth_dir / "auth.py").write_text("def validate_token():\n    return True\n", encoding="utf-8")
    validated, metrics = validate_all_citations_with_metrics(
        tmp_path,
        [{"file": "auth.py", "line": 1, "claim": "validate_token() bug"}],
    )
    assert validated[0]["verified"] is True
    assert metrics["total_citations"] == 1
