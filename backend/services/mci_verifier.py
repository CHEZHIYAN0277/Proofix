import re
from difflib import unified_diff


def generate_diff_from_patches(patches: list[dict]) -> str:
    lines = []
    for p in patches:
        orig_lines = p.get("original", "").splitlines(keepends=True)
        new_lines = p.get("patched", "").splitlines(keepends=True)
        diff = unified_diff(
            orig_lines,
            new_lines,
            fromfile=f"a/{p['file']}",
            tofile=f"b/{p['file']}",
        )
        lines.extend(diff)
    return "".join(lines)


def extract_diff_entities(diff_text: str) -> set[str]:
    entities: set[str] = set()
    for match in re.finditer(r"(?:^|\s)([\w/]+\.py)", diff_text):
        entities.add(match.group(1))
    for match in re.finditer(r"def\s+(\w+)", diff_text):
        entities.add(match.group(1))
    for match in re.finditer(r"class\s+(\w+)", diff_text):
        entities.add(match.group(1))
    return entities


def generate_description_from_diff(diff_text: str) -> str:
    if not diff_text.strip():
        return "No changes detected."
    files = set(re.findall(r"^[+-]{3} b/(.+)$", diff_text, re.MULTILINE))
    lines = ["## Changes", ""]
    for f in sorted(files):
        lines.append(f"- Modified `{f}`")
    lines.append("")
    lines.append("## Diff Summary")
    lines.append("```diff")
    lines.append(diff_text[:3000])
    if len(diff_text) > 3000:
        lines.append("... (truncated)")
    lines.append("```")
    return "\n".join(lines)


def verify_mci(description: str, diff_text: str) -> tuple[bool, set[str]]:
    """Cross-check NER entities from description against diff. Returns (fidelity_ok, phantoms)."""
    try:
        import spacy

        nlp = spacy.load("en_core_web_sm")
        doc = nlp(description)
        desc_entities = {ent.text for ent in doc.ents if len(ent.text) > 2}
        # Also extract file-like tokens
        desc_entities.update(re.findall(r"[\w/]+\.py", description))
        desc_entities.update(re.findall(r"`([^`]+)`", description))
    except Exception:
        desc_entities = set(re.findall(r"[\w/]+\.py", description))
        desc_entities.update(re.findall(r"`([^`]+)`", description))

    diff_entities = extract_diff_entities(diff_text)
    phantoms = {e for e in desc_entities if e not in diff_entities and not e.startswith("CWE")}
    fidelity_ok = len(phantoms) == 0
    return fidelity_ok, phantoms
