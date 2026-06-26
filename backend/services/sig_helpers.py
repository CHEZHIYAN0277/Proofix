from backend.models.sig import SemanticIntentGraph
from backend.services.repo_layout import is_production_file


DEFAULT_CRITICALITY = 0.4


def get_sig_or_defaults(sig_data: dict | None) -> tuple[SemanticIntentGraph | None, float]:
    if sig_data:
        sig = SemanticIntentGraph.model_validate(sig_data)
        return sig, DEFAULT_CRITICALITY
    return None, DEFAULT_CRITICALITY


def get_file_criticality(sig: SemanticIntentGraph | None, file_path: str, default: float = DEFAULT_CRITICALITY) -> float:
    if sig and file_path in sig.files:
        return sig.files[file_path].criticality
    return default


def is_module_reachable(
    sig: SemanticIntentGraph | None,
    package_name: str,
) -> bool | None:
    """Return True/False if SIG available, None if unknown."""
    if sig is None:
        return None
    pkg = package_name.lower().replace("-", "_")
    source_roots = sig.source_roots or []

    for path, node in sig.files.items():
        if node.role == "test-only":
            continue
        if source_roots and not is_production_file(path, source_roots):
            continue
        if path.endswith("__init__.py"):
            continue
        for imp in node.imports:
            if imp.lower().replace("-", "_") == pkg:
                return True
    return False


def reclassify_cve_report(sig_data: dict | None, cve_report_data: dict) -> dict:
    """Re-classify Unknown CVEs once SIG is available at fan-in."""
    from backend.models.cve import CVEReachabilityReport

    if not cve_report_data:
        return cve_report_data

    sig, _ = get_sig_or_defaults(sig_data)
    report = CVEReachabilityReport.model_validate(cve_report_data)
    critical_queue: list[str] = []

    for record in report.findings:
        if record.classification != "Unknown" and record.reachable is not None:
            if record.classification == "Critical":
                critical_queue.append(record.cve_id)
            continue

        reachable = is_module_reachable(sig, record.package)
        if reachable is None:
            record.reachable = None
            record.classification = "Unknown"
        elif reachable:
            record.reachable = True
            record.classification = "Critical"
            critical_queue.append(record.cve_id)
        else:
            record.reachable = False
            record.classification = "Informational"

    report.critical_queue = list(set(critical_queue))
    return report.model_dump()
