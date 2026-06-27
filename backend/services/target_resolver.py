"""Resolve runtime-confirmed failures to SIG-compatible application patch targets."""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from backend.models.sig import SemanticIntentGraph
from backend.services.repo_layout import is_production_file
from backend.state.schema import RunStateModel

STACK_FRAME_RE = re.compile(r'File "([^"]+)", line (\d+)')

SKIP_FRAME_PARTS = (
    "site-packages",
    ".venv",
    "venv",
    "pytest",
    "_pytest",
)

ResolutionSource = Literal[
    "stack_trace",
    "root_cause",
    "sig_lookup",
    "import_mapping",
    "fallback",
]


class TargetResolution(BaseModel):
    original_path: str
    normalized_path: str
    resolved_application_path: str | None
    resolution_source: ResolutionSource
    confidence: float


def normalize_repo_path(
    repo_path: Path,
    raw_path: str,
    sig: SemanticIntentGraph,
) -> str | None:
    """Normalize a filesystem path to a repository-relative path matching SIG keys."""
    if not raw_path or not str(raw_path).strip():
        return None

    text = str(raw_path).strip().replace("\\", "/")
    if text.startswith("./"):
        text = text[2:]

    repo = repo_path.resolve()
    path = Path(text)

    candidates: list[str] = []
    repo_relative: str | None = None

    try:
        repo_relative = str(path.resolve().relative_to(repo)).replace("\\", "/")
        candidates.append(repo_relative)
    except ValueError:
        pass

    parts = path.parts if path.is_absolute() else Path(text).parts
    for idx, part in enumerate(parts):
        if part in ("tests", "test", "testing", "vulnapi", "src", "app", "backend") or part.endswith(".py"):
            segment = str(Path(*parts[idx:])).replace("\\", "/")
            candidates.append(segment)
            if repo_relative is None:
                repo_relative = segment

    candidates.append(text.lstrip("/"))
    candidates.append(path.name)

    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        matched = _match_sig_path(candidate, sig)
        if matched:
            return matched

    return repo_relative


def resolve_patch_target(
    repo_path: Path,
    state: RunStateModel,
    sig: SemanticIntentGraph,
) -> TargetResolution:
    reproduction = state.reproduction or {}
    root_cause = state.root_cause or {}
    static = state.static_report or {}

    original = _pick_original_path(reproduction, root_cause)
    normalized = normalize_repo_path(repo_path, original, sig) if original else ""

    runtime_confirmed = reproduction.get("status") == "CONFIRMED"

    if runtime_confirmed:
        resolved = _resolve_runtime_confirmed(repo_path, state, sig, reproduction, root_cause, static)
        if resolved:
            path, source, confidence = resolved
            return TargetResolution(
                original_path=original,
                normalized_path=normalized or original,
                resolved_application_path=path,
                resolution_source=source,
                confidence=confidence,
            )

    resolved = _resolve_from_citations(repo_path, root_cause, sig)
    if resolved:
        path, source, confidence = resolved
        return TargetResolution(
            original_path=original,
            normalized_path=normalized or original,
            resolved_application_path=path,
            resolution_source=source,
            confidence=confidence,
        )

    fallback = _resolve_static_fallback(repo_path, static, sig)
    if fallback:
        return TargetResolution(
            original_path=original,
            normalized_path=normalized or original,
            resolved_application_path=fallback,
            resolution_source="fallback",
            confidence=0.5,
        )

    return TargetResolution(
        original_path=original,
        normalized_path=normalized or original,
        resolved_application_path=None,
        resolution_source="fallback",
        confidence=0.0,
    )


def pin_resolved_target(
    result,
    target: TargetResolution,
    runtime_confirmed: bool,
) -> None:
    """Ensure resolved application path is auto-patchable for A7."""
    path = target.resolved_application_path
    if not path or not runtime_confirmed:
        return

    result.auto_patch_scope = sorted(set(result.auto_patch_scope) | {path})

    if path not in result.origins:
        result.origins = list(result.origins) + [path]

    scope_paths = {s.path for s in result.scope}
    if path not in scope_paths:
        from backend.models.blast import ScopedFile

        result.scope = list(result.scope) + [
            ScopedFile(
                path=path,
                direction="forward",
                propagation_confidence=1.0,
                risk_score=0.0,
                hop_count=0,
                origin=path,
            )
        ]


def _pick_original_path(reproduction: dict, root_cause: dict) -> str:
    for key in ("failing_file",):
        value = reproduction.get(key)
        if value:
            return str(value)

    citations = root_cause.get("citations") or []
    if citations and citations[0].get("file"):
        return str(citations[0]["file"])

    return ""


def _resolve_runtime_confirmed(
    repo_path: Path,
    state: RunStateModel,
    sig: SemanticIntentGraph,
    reproduction: dict,
    root_cause: dict,
    static: dict,
) -> tuple[str, ResolutionSource, float] | None:
    stack = reproduction.get("traceback") or reproduction.get("stack_trace") or ""
    for frame_path in _parse_stack_frames(stack):
        if _is_skipped_frame(frame_path):
            continue
        normalized = normalize_repo_path(repo_path, frame_path, sig)
        if normalized and _is_application_sig_path(normalized, sig):
            return normalized, "stack_trace", 1.0

    from_root = _resolve_from_root_cause(repo_path, root_cause, sig)
    if from_root:
        return from_root, "root_cause", 0.9

    test_path = reproduction.get("failing_file") or ""
    normalized_test = normalize_repo_path(repo_path, test_path, sig) if test_path else None
    if normalized_test and not _is_application_sig_path(normalized_test, sig):
        mapped = _resolve_via_test_imports(repo_path, normalized_test, sig)
        if mapped:
            return mapped, "import_mapping", 0.85

    from_sig = _resolve_sig_lookup(repo_path, reproduction, root_cause, sig)
    if from_sig:
        return from_sig, "sig_lookup", 0.8

    fallback = _resolve_static_fallback(repo_path, static, sig)
    if fallback:
        return fallback, "fallback", 0.5

    return None


def _resolve_from_citations(
    repo_path: Path,
    root_cause: dict,
    sig: SemanticIntentGraph,
) -> tuple[str, ResolutionSource, float] | None:
    citations = root_cause.get("citations") or []
    verified = [c for c in citations if c.get("verified") and c.get("file")]
    ordered = verified + [c for c in citations if c.get("file") and c not in verified]

    for citation in ordered:
        matched = normalize_repo_path(repo_path, str(citation["file"]), sig)
        if matched and _is_application_sig_path(matched, sig):
            return matched, "root_cause", 0.9 if citation.get("verified") else 0.85

    return None


def _resolve_from_root_cause(
    repo_path: Path,
    root_cause: dict,
    sig: SemanticIntentGraph,
) -> str | None:
    from_citations = _resolve_from_citations(repo_path, root_cause, sig)
    if from_citations:
        return from_citations[0]

    for ref in root_cause.get("evidence_refs") or []:
        file = ref.get("file") if isinstance(ref, dict) else None
        if not file:
            continue
        matched = normalize_repo_path(repo_path, str(file), sig)
        if matched and _is_application_sig_path(matched, sig):
            return matched

    for text_key in ("root_cause", "summary"):
        text = root_cause.get(text_key) or ""
        matched = _match_text_to_sig(text, sig)
        if matched:
            return matched

    return None


def _resolve_via_test_imports(
    repo_path: Path,
    normalized_test_path: str,
    sig: SemanticIntentGraph,
) -> str | None:
    test_file = repo_path / normalized_test_path
    if not test_file.is_file():
        return None

    try:
        tree = ast.parse(test_file.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return None

    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                modules.append(node.module)

    for module in modules:
        matched = _module_to_sig_path(module, sig)
        if matched and _is_application_sig_path(matched, sig):
            return matched

    return None


def _resolve_sig_lookup(
    repo_path: Path,
    reproduction: dict,
    root_cause: dict,
    sig: SemanticIntentGraph,
) -> str | None:
    candidates: list[str] = []
    for source in (reproduction, root_cause):
        for key in ("failing_file",):
            value = source.get(key)
            if value:
                candidates.append(str(value))
        for citation in source.get("citations") or []:
            if citation.get("file"):
                candidates.append(str(citation["file"]))

    basename_matches: list[str] = []
    for raw in candidates:
        normalized = normalize_repo_path(repo_path, raw, sig)
        if normalized and _is_application_sig_path(normalized, sig):
            return normalized
        base = Path(raw.replace("\\", "/")).name
        for sig_path in sig.files:
            if sig_path.endswith(f"/{base}") or sig_path == base:
                basename_matches.append(sig_path)

    if len(set(basename_matches)) == 1:
        return basename_matches[0]

    auth_boundary = [p for p in basename_matches if sig.files[p].role == "auth-boundary"]
    if len(auth_boundary) == 1:
        return auth_boundary[0]

    return None


def _resolve_static_fallback(
    repo_path: Path,
    static: dict,
    sig: SemanticIntentGraph,
) -> str | None:
    findings = static.get("prioritized") or []
    if not findings:
        return None
    matched = normalize_repo_path(repo_path, str(findings[0].get("file", "")), sig)
    if matched and matched in sig.files:
        return matched
    return None


def _parse_stack_frames(stack: str) -> list[str]:
    return [match.group(1) for match in STACK_FRAME_RE.finditer(stack)]


def _is_skipped_frame(path: str) -> bool:
    normalized = path.replace("\\", "/").lower()
    if any(part in normalized for part in SKIP_FRAME_PARTS):
        return True
    parts = Path(normalized).parts
    return any(part in ("tests", "test", "testing") for part in parts)


def _is_application_sig_path(path: str, sig: SemanticIntentGraph) -> bool:
    if path not in sig.files:
        return False
    return is_production_file(path, sig.source_roots)


def _match_sig_path(candidate: str, sig: SemanticIntentGraph) -> str | None:
    norm = candidate.replace("\\", "/").lstrip("/")
    if norm in sig.files:
        return norm

    suffix_matches = [key for key in sig.files if key.endswith(f"/{norm}") or key == norm]
    if len(suffix_matches) == 1:
        return suffix_matches[0]

    base = Path(norm).name
    base_matches = [key for key in sig.files if key.endswith(f"/{base}") or key == base]
    if len(base_matches) == 1:
        return base_matches[0]

    return None


def _module_to_sig_path(module: str, sig: SemanticIntentGraph) -> str | None:
    dotted = module.replace("/", ".")
    for path in sig.files:
        stem = path.replace("/", ".").replace(".py", "")
        if dotted == stem or stem.endswith(f".{dotted}") or dotted.endswith(stem.split(".")[-1]):
            return path
        if module in path or path.endswith(f"{module.replace('.', '/')}.py"):
            return path
    return _match_sig_path(module.replace(".", "/") + ".py", sig)


def _match_text_to_sig(text: str, sig: SemanticIntentGraph) -> str | None:
    if not text:
        return None

    lowered = text.lower()
    matches: list[str] = []
    for path in sig.files:
        base = Path(path).name
        stem = base.replace(".py", "")
        if base in lowered or stem in lowered:
            matches.append(path)

    if len(matches) == 1:
        return matches[0]

    auth_matches = [p for p in matches if sig.files[p].role == "auth-boundary"]
    if len(auth_matches) == 1:
        return auth_matches[0]

    return None
