import hashlib
import shutil
import subprocess
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from git import Repo


def clone_or_copy_repo(repo_path: str) -> str:
    """Clone repo to temp dir or copy local path."""
    path = Path(repo_path)
    tmp = tempfile.mkdtemp(prefix="sentinel_")
    if path.exists() and path.is_dir():
        shutil.copytree(path, tmp, dirs_exist_ok=True)
        return tmp
    Repo.clone_from(repo_path, tmp)
    return tmp


def get_churn_weights(repo_path: Path, days: int = 90) -> dict[str, float]:
    """Parse git log for bug-fix commit density per file."""
    weights: dict[str, int] = {}
    try:
        repo = Repo(repo_path)
        since = datetime.now() - timedelta(days=days)
        for commit in repo.iter_commits(since=since.isoformat()):
            msg = (commit.message or "").lower()
            if not any(kw in msg for kw in ("fix", "bug", "patch", "hotfix")):
                continue
            for item in commit.stats.files:
                weights[item] = weights.get(item, 0) + 1
    except Exception:
        pass
    if not weights:
        return {}
    max_count = max(weights.values())
    return {f: min(1.0, c / max_count) for f, c in weights.items()}


def get_head_sha(repo_path: Path) -> str:
    """Return full HEAD commit SHA for the repo clone."""
    try:
        repo = Repo(repo_path)
        return repo.head.commit.hexsha
    except Exception:
        return ""


def get_worktree_diff_hash(repo_path: Path) -> str:
    """Hash of unstaged + staged changes for cache invalidation on uncommitted edits."""
    try:
        repo = Repo(repo_path)
        unstaged = repo.git.diff("HEAD") or ""
        staged = repo.git.diff("--cached") or ""
        combined = f"{unstaged}\n{staged}"
        return hashlib.sha256(combined.encode("utf-8")).hexdigest()
    except Exception:
        return ""


def get_style_exemplar(repo_path: Path, file_path: str, max_commits: int = 3) -> tuple[str | None, str]:
    """Get recent commit hash and diff for style exemplar."""
    try:
        repo = Repo(repo_path)
        commits = list(repo.iter_commits(paths=file_path, max_count=max_commits))
        if not commits:
            return None, ""
        commit = commits[0]
        diff = repo.git.show(commit.hexsha, "--", file_path)
        return commit.hexsha, diff
    except Exception:
        return None, ""
