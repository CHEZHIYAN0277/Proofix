"""Repository layout detection — source root discovery for arbitrary Python repos."""

from __future__ import annotations

from pathlib import Path

from backend.state.schema import RunStateModel

EXCLUDED_DIR_NAMES = frozenset({
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "tests",
    "test",
    "testing",
    "docs",
    "scripts",
    ".pytest_cache",
    ".tox",
    "dist",
    "build",
    ".mypy_cache",
    ".ruff_cache",
})

CONTAINER_DIRS = ("src", "app", "backend", "lib")

TEST_PATH_PARTS = frozenset({"tests", "test", "testing"})


def _normalize_root(prefix: str) -> str:
    if not prefix:
        return ""
    return prefix.replace("\\", "/").rstrip("/") + "/"


def is_excluded_path(rel_path: str) -> bool:
    """Return True if a relative path should be skipped for indexing/scanning."""
    parts = Path(rel_path.replace("\\", "/")).parts
    return any(part in EXCLUDED_DIR_NAMES or part.startswith(".") for part in parts)


def _has_python_modules(directory: Path) -> bool:
    if not directory.is_dir():
        return False
    return any(directory.glob("*.py")) or any(
        child.is_dir() and (child / "__init__.py").exists() for child in directory.iterdir()
    )


def _is_python_package(directory: Path) -> bool:
    if not directory.is_dir() or directory.name in EXCLUDED_DIR_NAMES:
        return False
    if (directory / "__init__.py").exists():
        return True
    py_files = list(directory.glob("*.py"))
    return len(py_files) >= 1


def _package_dirs_under(container: Path) -> list[str]:
    packages: list[str] = []
    for child in sorted(container.iterdir()):
        if child.is_dir() and _is_python_package(child):
            packages.append(child.name)
    return packages


def discover_source_roots(repo_path: Path) -> list[str]:
    """
    Detect Python source roots relative to repo_path.

    Returns POSIX-style prefixes with trailing slash, except flat repo root uses "".
    """
    repo_path = repo_path.resolve()
    if not repo_path.is_dir():
        return [""]

    roots: list[str] = []

    for container in CONTAINER_DIRS:
        container_path = repo_path / container
        if not container_path.is_dir():
            continue
        subpackages = _package_dirs_under(container_path)
        if subpackages:
            for pkg in subpackages:
                roots.append(_normalize_root(f"{container}/{pkg}"))
        elif _has_python_modules(container_path):
            roots.append(_normalize_root(container))

    for child in sorted(repo_path.iterdir()):
        if not child.is_dir():
            continue
        if child.name in EXCLUDED_DIR_NAMES or child.name.startswith("."):
            continue
        if child.name in CONTAINER_DIRS:
            continue
        if _is_python_package(child):
            roots.append(_normalize_root(child.name))

    if not roots and list(repo_path.glob("*.py")):
        roots.append("")

    if not roots:
        roots.append("")

    return _dedupe_roots(roots)


def _dedupe_roots(roots: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for root in roots:
        norm = _normalize_root(root) if root else ""
        if norm not in seen:
            seen.add(norm)
            result.append(norm)
    return result


def resolve_scan_paths(repo_path: Path, source_roots: list[str]) -> list[Path]:
    """Convert relative source root prefixes to absolute scan paths."""
    repo_path = repo_path.resolve()
    if not source_roots:
        return [repo_path]
    paths: list[Path] = []
    for root in source_roots:
        if root == "":
            paths.append(repo_path)
        else:
            paths.append(repo_path / root.rstrip("/"))
    return paths


def is_production_file(rel_path: str, source_roots: list[str]) -> bool:
    """True if file is under a source root and not in a test directory."""
    norm = rel_path.replace("\\", "/")
    if is_excluded_path(norm):
        return False
    parts = Path(norm).parts
    if any(part in TEST_PATH_PARTS for part in parts):
        return False

    if not source_roots:
        return True

    for root in source_roots:
        root_norm = _normalize_root(root) if root else ""
        if root_norm == "":
            if not norm.startswith("tests/") and "/tests/" not in f"/{norm}/":
                return True
        elif norm.startswith(root_norm) or norm == root_norm.rstrip("/"):
            return True
    return False


def resolve_source_roots(
    repo: Path,
    state_source_roots: list[str] | None = None,
    sig_data: dict | None = None,
) -> list[str]:
    """Resolve source roots from state, SIG, or discovery (in priority order)."""
    if state_source_roots:
        return state_source_roots
    if sig_data and sig_data.get("source_roots"):
        return sig_data["source_roots"]
    return discover_source_roots(repo)


def get_scan_targets(
    state: RunStateModel,
    repo: Path,
    sig_data: dict | None = None,
) -> list[Path]:
    """Resolve absolute paths for static analysis tools."""
    roots = resolve_source_roots(repo, state.source_roots or None, sig_data)
    return resolve_scan_paths(repo, roots)


def iter_python_files(repo_path: Path, source_roots: list[str]) -> list[Path]:
    """List .py files under source roots, excluding test/excluded paths."""
    repo_path = repo_path.resolve()
    files: list[Path] = []
    for scan_path in resolve_scan_paths(repo_path, source_roots):
        if not scan_path.exists():
            continue
        if scan_path.is_file() and scan_path.suffix == ".py":
            rel = str(scan_path.relative_to(repo_path))
            if not is_excluded_path(rel) and is_production_file(rel, source_roots):
                files.append(scan_path)
            continue
        for py_file in scan_path.rglob("*.py"):
            rel = str(py_file.relative_to(repo_path))
            if is_excluded_path(rel):
                continue
            if is_production_file(rel, source_roots):
                files.append(py_file)
    return files
