"""Single-pass Python AST parsing shared by import graph and role classification."""

from __future__ import annotations

import ast
import tokenize
from io import BytesIO
from pathlib import Path

from pydantic import BaseModel, Field


class ParsedModule(BaseModel):
    imports: list[str] = Field(default_factory=list)
    classes: list[str] = Field(default_factory=list)
    functions: list[str] = Field(default_factory=list)
    decorators: list[str] = Field(default_factory=list)
    bases: list[str] = Field(default_factory=list)
    docstring: str | None = None
    exported_symbols: list[str] = Field(default_factory=list)
    top_level_comments: list[str] = Field(default_factory=list)


def _decorator_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Call):
        return _decorator_name(node.func)
    return ""


def _base_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return ""


def _module_level_comments(source: str) -> list[str]:
    comments: list[str] = []
    try:
        tokens = tokenize.tokenize(BytesIO(source.encode("utf-8")).readline)
        for tok in tokens:
            if tok.type == tokenize.COMMENT and tok.start[1] == 0:
                text = tok.string.lstrip("#").strip()
                if text:
                    comments.append(text)
    except tokenize.TokenError:
        pass
    return comments[:10]


def parsed_module_from_tree(tree: ast.Module, source: str) -> ParsedModule:
    imports: list[str] = []
    functions: list[str] = []
    classes: list[str] = []
    decorators: list[str] = []
    bases: list[str] = []
    exported: list[str] = []
    all_names: list[str] | None = None

    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module.split(".")[0])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append(node.name)
            for dec in node.decorator_list:
                name = _decorator_name(dec)
                if name:
                    decorators.append(name)
            if not node.name.startswith("_"):
                exported.append(node.name)
        elif isinstance(node, ast.ClassDef):
            classes.append(node.name)
            for dec in node.decorator_list:
                name = _decorator_name(dec)
                if name:
                    decorators.append(name)
            for base in node.bases:
                b = _base_name(base)
                if b:
                    bases.append(b)
            if not node.name.startswith("_"):
                exported.append(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "__all__":
                    if isinstance(node.value, (ast.List, ast.Tuple)):
                        all_names = []
                        for elt in node.value.elts:
                            if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                all_names.append(elt.value)

    exported_symbols = all_names if all_names is not None else list(dict.fromkeys(exported))

    return ParsedModule(
        imports=list(dict.fromkeys(imports)),
        classes=classes,
        functions=functions,
        decorators=list(dict.fromkeys(decorators)),
        bases=list(dict.fromkeys(bases)),
        docstring=ast.get_docstring(tree),
        exported_symbols=exported_symbols,
        top_level_comments=_module_level_comments(source),
    )


def parse_python_file(repo_path: Path, relative_path: str) -> ParsedModule | None:
    """Parse a single Python file once. Returns None if missing or syntactically invalid."""
    full = repo_path.resolve() / relative_path
    if not full.is_file():
        return None
    try:
        source = full.read_text(encoding="utf-8")
        tree = ast.parse(source)
    except (SyntaxError, OSError, UnicodeDecodeError):
        return None
    return parsed_module_from_tree(tree, source)
