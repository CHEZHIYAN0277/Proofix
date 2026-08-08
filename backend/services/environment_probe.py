"""Can this repository's tests actually run here?

Deterministic, no LLM call, no network. See `docs/ENVIRONMENT_PRECHECK_DESIGN.md`
for the reasoning; the short version:

A manifest tells you what a project *declares*, not whether the environment can
*run* it. Every GitHub repository that fails today has a perfectly good
`pyproject.toml` — what it lacks is an installed `pytest`. So detection answers
"what kind of project is this", and the probe answers the operative question:
"will the test runner start".

**This module never installs anything.** `suggested_command` is a string for a
human to run. Installing dependencies from an arbitrary cloned repository
executes that repository's build hooks on the host, and the pipeline's
subprocesses are not yet sandboxed.
"""

from __future__ import annotations

import re
from pathlib import Path

from backend.models.environment import DetectedManifest, EnvironmentReport
from backend.services.subprocess_runner import run_command

# Manifest → (language, priority). Lower priority wins when several are present:
# `pyproject.toml` describes the project better than a bare `requirements.txt`.
_MANIFESTS: list[tuple[str, str, int]] = [
    ("pyproject.toml", "python", 0),
    ("setup.py", "python", 1),
    ("Pipfile", "python", 1),
    ("requirements.txt", "python", 2),
    ("requirements-dev.txt", "python", 3),
    ("uv.lock", "python", 3),
    ("poetry.lock", "python", 3),
    ("package.json", "node", 0),
    ("Cargo.toml", "rust", 0),
    ("go.mod", "go", 0),
    ("Gemfile", "ruby", 0),
    ("pom.xml", "jvm", 0),
    ("build.gradle", "jvm", 0),
    ("build.gradle.kts", "jvm", 0),
]

# The only language the pipeline can actually repair: every agent is `ast`-bound
# end to end (CLAUDE.md §8, P4).
_SUPPORTED_LANGUAGE = "python"

_SKIP_DIRS = {
    ".git", ".venv", "venv", "node_modules", "__pycache__", ".tox",
    "build", "dist", ".mypy_cache", ".pytest_cache", ".ruff_cache",
}


def detect_manifests(repo: Path) -> list[DetectedManifest]:
    """Manifests at the repository root and one level down.

    One level down catches the common monorepo layout (`packages/*/pyproject.toml`)
    without walking a large tree.
    """
    found: list[DetectedManifest] = []

    def scan(directory: Path, prefix: str) -> None:
        for name, language, _priority in _MANIFESTS:
            candidate = directory / name
            if candidate.is_file():
                found.append(
                    DetectedManifest(
                        path=f"{prefix}{name}",
                        kind=name,
                        language=language,
                    )
                )

    scan(repo, "")
    try:
        for child in sorted(repo.iterdir()):
            if not child.is_dir() or child.name in _SKIP_DIRS or child.name.startswith("."):
                continue
            scan(child, f"{child.name}/")
    except OSError:
        # An unreadable repository root is a real condition, not a crash. The
        # caller reports what was found, which may be nothing.
        pass

    return found


def primary_language(manifests: list[DetectedManifest]) -> str | None:
    """The language of the highest-priority root manifest."""
    best: tuple[int, str] | None = None
    priority_of = {name: priority for name, _lang, priority in _MANIFESTS}

    for manifest in manifests:
        # Root manifests decide the project's language; a nested one does not.
        depth_penalty = 0 if "/" not in manifest.path else 10
        score = priority_of.get(manifest.kind, 9) + depth_penalty
        if best is None or score < best[0]:
            best = (score, manifest.language)

    return best[1] if best else None


#: `ModuleNotFoundError: No module named 'x'` / `ImportError: cannot import name`.
_MISSING_MODULE_RE = re.compile(
    r"(?:ModuleNotFoundError|ImportError):\s*No module named ['\"]([\w.]+)['\"]"
)


def _missing_modules_from_output(text: str) -> list[str]:
    """Modules pytest reported it could not import, in first-seen order.

    Read from collection output rather than sampled from source: these are the
    imports that actually failed, for the actual test suite, on the actual
    interpreter. Only the top-level package is kept — telling a user that
    `foo.bar.baz` is missing when the fix is `pip install foo` is noise.
    """
    seen: list[str] = []
    for match in _MISSING_MODULE_RE.finditer(text or ""):
        root = match.group(1).split(".")[0]
        if root not in seen:
            seen.append(root)
    return seen


async def probe_environment(repo: Path, timeout: int = 30) -> EnvironmentReport:
    """Decide whether this repository's tests can run, and say why not."""
    manifests = detect_manifests(repo)
    language = primary_language(manifests)

    if not manifests:
        return EnvironmentReport(
            status="no_manifest",
            language=None,
            manifests=[],
            test_runner=None,
            test_runner_available=False,
            missing_imports=[],
            reason=(
                "No dependency manifest was found at the repository root or one "
                "level below it, so there is nothing describing how to prepare "
                "this project."
            ),
            suggested_command=None,
            blocking=True,
        )

    if language != _SUPPORTED_LANGUAGE:
        return EnvironmentReport(
            status="unsupported",
            language=language,
            manifests=manifests,
            test_runner=None,
            test_runner_available=False,
            missing_imports=[],
            reason=(
                f"This is a {language} project. ProoFix analyses and repairs "
                "Python only — every stage of the pipeline is built on Python's "
                "AST."
            ),
            suggested_command=None,
            blocking=True,
        )

    # The operative check: will the runner start? `-c "import pytest"` is the
    # cheapest honest answer, and it uses the same interpreter A3.5 will use.
    code, _stdout, stderr = await run_command(
        ["python", "-c", "import pytest; print(pytest.__version__)"],
        cwd=repo,
        timeout=timeout,
    )
    runner_available = code == 0

    # An importable pytest is necessary but not sufficient — a repository whose
    # own dependencies are missing fails at reproduction with a bare
    # ImportError. But *sampling* the repository's imports to decide that was
    # wrong, and wrong in the dangerous direction: it blocked Flask, a fully
    # prepared checkout whose suite collects 483 tests. The sample picked up
    #
    #   `_typeshed`  — exists only under `TYPE_CHECKING`, never importable
    #   `flaskr`, `task_app`, `js_example` — example apps inside the repo
    #   `asgiref`, `celery`, `docutils` — docs extras the suite never imports
    #
    # and none of them says anything about whether the tests can run.
    #
    # So ask the thing that will actually run them. `pytest --collect-only`
    # imports every test module and its transitive dependencies and reports
    # exactly the failures that would stop reproduction — no heuristics, no
    # guessing which imports matter.
    collect_code, collect_out, collect_err = (
        await run_command(
            ["python", "-m", "pytest", "--collect-only", "-q", "--no-header", "-p", "no:cacheprovider"],
            cwd=repo,
            timeout=timeout,
        )
        if runner_available
        else (1, "", "")
    )

    # Exit 5 is "no tests collected" — the environment is fine, the suite is
    # empty. That is A3.5's `NO_TESTS`, not an environment fault, so it must not
    # block: blocking here would report a missing dependency that does not exist.
    collection_ok = collect_code in (0, 5)

    if runner_available and collection_ok:
        return EnvironmentReport(
            status="ready",
            language=language,
            manifests=manifests,
            test_runner="pytest",
            test_runner_available=True,
            missing_imports=[],
            reason=(
                "pytest collected the test suite without import errors — it can "
                "be executed."
            ),
            suggested_command=None,
            blocking=False,
        )

    # Not runnable. Name the modules pytest itself could not import, so the
    # message points at the real problem rather than a sampled guess.
    missing: list[str] = [] if runner_available else ["pytest"]
    for module in _missing_modules_from_output(f"{collect_out}\n{collect_err}"):
        if module not in missing:
            missing.append(module)
        if len(missing) >= 8:
            break

    kinds = {m.kind for m in manifests}
    if "pyproject.toml" in kinds:
        suggested = 'pip install -e ".[dev]"'
    elif "requirements.txt" in kinds:
        suggested = "pip install -r requirements.txt"
    elif "Pipfile" in kinds:
        suggested = "pipenv install --dev"
    elif "setup.py" in kinds:
        suggested = "pip install -e ."
    else:
        suggested = None

    # Name what is actually missing. When pytest is present and the project's
    # own dependencies are not, "pytest is not importable" would be false.
    if not runner_available:
        detail = (stderr or "").strip().splitlines()
        first_line = detail[0][:200] if detail else "pytest is not importable"
    elif missing:
        named = ", ".join(missing[:5])
        first_line = (
            f"pytest is available, but collecting the test suite failed to "
            f"import: {named}."
        )
    else:
        # Collection failed without naming a module — a `conftest.py` that
        # raises, a syntax error, a plugin that errors on load. Quote what
        # pytest said rather than asserting a cause it did not state.
        tail = (collect_err or collect_out or "").strip().splitlines()
        quoted = tail[-1][:200] if tail else f"pytest collection exited {collect_code}"
        first_line = f"pytest could not collect the test suite: {quoted}"

    return EnvironmentReport(
        status="not_prepared",
        language=language,
        manifests=manifests,
        test_runner="pytest",
        # Reported as found when it is: this branch is now also reached with a
        # working pytest and missing project dependencies, and claiming pytest
        # was absent there would send the reader after the wrong problem.
        test_runner_available=runner_available,
        missing_imports=missing,
        reason=(
            "This repository's dependencies are not installed in the interpreter "
            f"ProoFix would run its tests with, so no failure can be reproduced. {first_line}"
        ),
        suggested_command=suggested,
        blocking=True,
    )
