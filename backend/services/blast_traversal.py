"""Multi-origin blast graph traversal with hop-aware propagation confidence."""

from __future__ import annotations

from backend.models.blast import BlastGraphResult, ScopedFile
from backend.models.sig import SemanticIntentGraph

CONFIDENCE_THRESHOLD = 0.7
MAX_HOPS = 3
HOP_DECAY = 0.85


def resolve_origins(citations: list[dict]) -> list[str]:
    verified = [c["file"] for c in citations if c.get("verified") and c.get("file")]
    if verified:
        return list(dict.fromkeys(verified))
    fallback = [c["file"] for c in citations if c.get("file")]
    return list(dict.fromkeys(fallback))


def traverse_multi_origin(
    sig: SemanticIntentGraph,
    origins: list[str],
    max_hops: int = MAX_HOPS,
) -> BlastGraphResult:
    if not origins:
        return BlastGraphResult()

    merged: dict[str, ScopedFile] = {}
    auto_patch: set[str] = set()
    human_review: set[str] = set()

    for origin in origins:
        if origin not in sig.files:
            continue
        _bfs_from_origin(sig, origin, max_hops, merged, auto_patch, human_review)

    scope = sorted(merged.values(), key=lambda s: (s.hop_count, s.path))
    return BlastGraphResult(
        scope=scope,
        human_review_required=sorted(human_review),
        auto_patch_scope=sorted(auto_patch),
        origins=origins,
    )


def _bfs_from_origin(
    sig: SemanticIntentGraph,
    origin: str,
    max_hops: int,
    merged: dict[str, ScopedFile],
    auto_patch: set[str],
    human_review: set[str],
) -> None:
    queue: list[tuple[str, str, int]] = [(origin, "forward", 0), (origin, "backward", 0)]
    visited: set[tuple[str, str, int]] = set()

    while queue:
        path, direction, hops = queue.pop(0)
        key = (path, direction, hops)
        if key in visited or hops > max_hops:
            continue
        visited.add(key)

        node = sig.files.get(path)
        if not node:
            continue

        security_score = 0.8 if node.role in ("auth-boundary", "public-api") else 0.5
        risk = node.criticality * node.churn_weight * security_score
        base_confidence = min(1.0, node.criticality * 0.6 + node.churn_weight * 0.4)
        propagation = base_confidence * (HOP_DECAY**hops)

        scoped = ScopedFile(
            path=path,
            direction=direction,
            propagation_confidence=round(propagation, 4),
            risk_score=round(risk, 4),
            hop_count=hops,
            origin=origin,
        )
        existing = merged.get(path)
        if existing is None or scoped.propagation_confidence > existing.propagation_confidence:
            merged[path] = scoped
        elif existing and scoped.hop_count < existing.hop_count:
            merged[path] = scoped

        if propagation >= CONFIDENCE_THRESHOLD:
            auto_patch.add(path)
        else:
            human_review.add(path)

        if hops >= max_hops:
            continue

        if direction == "forward":
            for edge in sig.edges:
                if edge[0] == path:
                    target = _module_to_file(sig, edge[1])
                    if target:
                        queue.append((target, "forward", hops + 1))
        else:
            for other_path, other_node in sig.files.items():
                for imp in other_node.imports:
                    if _matches(path, imp):
                        queue.append((other_path, "backward", hops + 1))


def _module_to_file(sig: SemanticIntentGraph, module: str) -> str | None:
    for path in sig.files:
        if module in path or path.endswith(f"{module}.py"):
            return path
    return None


def _matches(path: str, imp: str) -> bool:
    stem = path.replace("/", ".").replace(".py", "")
    return imp in stem or stem.endswith(imp)
