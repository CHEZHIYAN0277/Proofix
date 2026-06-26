import tempfile
from pathlib import Path

import pytest

from backend.services.repo_layout import (
    discover_source_roots,
    is_production_file,
    resolve_scan_paths,
)


@pytest.fixture
def repo_tmp():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


def test_discover_src_layout(repo_tmp):
    (repo_tmp / "src" / "myapp").mkdir(parents=True)
    (repo_tmp / "src" / "myapp" / "__init__.py").write_text("")
    (repo_tmp / "src" / "myapp" / "main.py").write_text("print('hi')")
    roots = discover_source_roots(repo_tmp)
    assert "src/myapp/" in roots


def test_discover_app_layout(repo_tmp):
    (repo_tmp / "app").mkdir()
    (repo_tmp / "app" / "__init__.py").write_text("")
    (repo_tmp / "app" / "routes.py").write_text("")
    roots = discover_source_roots(repo_tmp)
    assert "app/" in roots


def test_discover_backend_layout(repo_tmp):
    (repo_tmp / "backend").mkdir()
    (repo_tmp / "backend" / "service.py").write_text("")
    roots = discover_source_roots(repo_tmp)
    assert "backend/" in roots


def test_discover_top_level_package(repo_tmp):
    (repo_tmp / "myproject").mkdir()
    (repo_tmp / "myproject" / "__init__.py").write_text("")
    (repo_tmp / "myproject" / "core.py").write_text("")
    roots = discover_source_roots(repo_tmp)
    assert "myproject/" in roots


def test_discover_flat_layout(repo_tmp):
    (repo_tmp / "main.py").write_text("")
    roots = discover_source_roots(repo_tmp)
    assert "" in roots


def test_discover_tests_only_fallback(repo_tmp):
    (repo_tmp / "tests").mkdir()
    (repo_tmp / "tests" / "test_x.py").write_text("")
    roots = discover_source_roots(repo_tmp)
    assert roots == [""]


def test_is_production_file_excludes_tests():
    assert is_production_file("tests/test_x.py", ["src/myapp/"]) is False
    assert is_production_file("src/myapp/main.py", ["src/myapp/"]) is True


def test_resolve_scan_paths(repo_tmp):
    (repo_tmp / "src" / "pkg").mkdir(parents=True)
    paths = resolve_scan_paths(repo_tmp, ["src/pkg/"])
    assert len(paths) == 1
    assert paths[0].name == "pkg"
