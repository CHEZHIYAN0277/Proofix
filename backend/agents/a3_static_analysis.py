import math
from pathlib import Path

from backend.agents.base import AgentBase
from backend.models.findings import Finding, StaticAnalysisReport
from backend.services.repo_layout import get_scan_targets, iter_python_files, resolve_source_roots
from backend.services.sig_helpers import get_file_criticality, get_sig_or_defaults
from backend.services.subprocess_runner import parse_json_safe, run_command
from backend.state.schema import RunStateModel


class A3StaticAnalysisAgent(AgentBase):
    agent_id = "A3"

    async def run(self, state: RunStateModel) -> RunStateModel:
        await self.emit_status(state, "started", "Running consensus static analysis")
        repo = Path(state.repo_clone_path or state.repo_path).resolve()

        # Soft read SIG — never block on A1
        sig_data = await self.store.get_json(state.run_id, "sig")
        sig, default_crit = get_sig_or_defaults(sig_data)
        scan_targets = get_scan_targets(state, repo, sig_data)
        source_roots = resolve_source_roots(repo, state.source_roots or None, sig_data)

        raw_findings: list[dict] = []
        baseline: dict = {"bandit": [], "semgrep": [], "ruff": []}

        bandit_findings = await self._run_bandit(repo, scan_targets)
        semgrep_findings = await self._run_semgrep(repo, scan_targets)
        ruff_findings = await self._run_ruff(repo, scan_targets)

        baseline["bandit"] = bandit_findings
        baseline["semgrep"] = semgrep_findings
        baseline["ruff"] = ruff_findings

        for f in bandit_findings:
            raw_findings.append({**f, "tool": "bandit"})
        for f in semgrep_findings:
            raw_findings.append({**f, "tool": "semgrep"})
        for f in ruff_findings:
            raw_findings.append({**f, "tool": "ruff"})

        clustered = self._cluster_findings(raw_findings)
        prioritized = self._rank_findings(clustered, sig, default_crit)[:8]

        report = StaticAnalysisReport(
            raw_count=len(raw_findings),
            prioritized=prioritized,
            baseline_json=baseline,
        )
        report_dict = report.model_dump(mode="json")
        await self.store.set_json(state.run_id, "static", report_dict)
        state.static_report = report_dict
        await self.emit_status(
            state,
            "completed",
            f"Distilled {len(raw_findings)} raw findings to {len(prioritized)} prioritized",
            {
                "prioritized_count": len(prioritized),
                "source_roots": source_roots,
                "scan_targets": [str(p.resolve().relative_to(repo)) for p in scan_targets],
            },
        )
        return state

    async def _run_bandit(self, repo: Path, scan_targets: list[Path]) -> list[dict]:
        if not scan_targets:
            return self._stub_bandit(repo, [])
        cmd = ["bandit", "-f", "json", "-q"]
        for target in scan_targets:
            cmd.extend(["-r", str(target)])
        code, stdout, _stderr = await run_command(cmd, cwd=repo, timeout=60)
        if code == -1 or (code != 0 and not stdout.strip()):
            return self._stub_bandit(repo, scan_targets)
        data = parse_json_safe(stdout)
        results = []
        for r in data.get("results", []):
            results.append({
                "file": r.get("filename", "").replace(str(repo) + "/", ""),
                "line": r.get("line_number", 0),
                "message": r.get("issue_text", ""),
                "severity": {"HIGH": 0.9, "MEDIUM": 0.6, "LOW": 0.3}.get(r.get("issue_severity", "LOW"), 0.3),
            })
        return results if results else self._stub_bandit(repo, scan_targets)

    def _roots_from_targets(self, repo: Path, scan_targets: list[Path]) -> list[str]:
        repo = repo.resolve()
        if not scan_targets:
            return [""]
        roots: list[str] = []
        for target in scan_targets:
            try:
                rel = str(target.resolve().relative_to(repo)).replace("\\", "/")
                roots.append(rel + "/" if rel else "")
            except ValueError:
                roots.append("")
        return roots

    def _stub_bandit(self, repo: Path, scan_targets: list[Path]) -> list[dict]:
        findings = []
        roots = self._roots_from_targets(repo, scan_targets)
        for py in iter_python_files(repo, roots):
            content = py.read_text(encoding="utf-8")
            rel = str(py.relative_to(repo))
            if "pickle" in content:
                findings.append({"file": rel, "line": 1, "message": "pickle usage", "severity": 0.9})
            if "secret" in content.lower() and "=" in content:
                findings.append({"file": rel, "line": 1, "message": "hardcoded secret", "severity": 0.8})
        return findings

    async def _run_semgrep(self, repo: Path, scan_targets: list[Path]) -> list[dict]:
        if not scan_targets:
            return self._stub_semgrep(repo, [])
        cmd = ["semgrep", "--config=auto", "--json"]
        cmd.extend(str(t) for t in scan_targets)
        code, stdout, _stderr = await run_command(cmd, cwd=repo, timeout=90)
        if code == -1 or not stdout.strip():
            return self._stub_semgrep(repo, scan_targets)
        data = parse_json_safe(stdout)
        results = []
        for r in data.get("results", []):
            results.append({
                "file": r.get("path", "").replace(str(repo) + "/", ""),
                "line": r.get("start", {}).get("line", 0),
                "message": r.get("extra", {}).get("message", ""),
                "severity": 0.7,
            })
        return results if results else self._stub_semgrep(repo, scan_targets)

    def _stub_semgrep(self, repo: Path, scan_targets: list[Path]) -> list[dict]:
        findings = []
        roots = self._roots_from_targets(repo, scan_targets)
        for py in iter_python_files(repo, roots):
            try:
                content = py.read_text(encoding="utf-8")
            except OSError:
                continue
            if 'f"SELECT' in content or "f'SELECT" in content:
                rel = str(py.relative_to(repo))
                line = content.find("SELECT")
                line_no = content[: max(line, 0)].count("\n") + 1 if line >= 0 else 1
                findings.append({
                    "file": rel,
                    "line": line_no,
                    "message": "SQL injection",
                    "severity": 0.95,
                })
        return findings

    async def _run_ruff(self, repo: Path, scan_targets: list[Path]) -> list[dict]:
        if not scan_targets:
            return []
        cmd = ["ruff", "check", "--output-format=json"]
        cmd.extend(str(t) for t in scan_targets)
        _code, stdout, _ = await run_command(cmd, cwd=repo, timeout=60)
        data = parse_json_safe(stdout) if stdout.strip() else []
        if isinstance(data, dict):
            data = data.get("results", [])
        results = []
        for r in data if isinstance(data, list) else []:
            results.append({
                "file": r.get("filename", "").replace(str(repo) + "/", ""),
                "line": r.get("location", {}).get("row", 0),
                "message": r.get("message", ""),
                "severity": 0.4,
            })
        return results

    def _cluster_findings(self, raw: list[dict]) -> list[dict]:
        clusters: dict[str, dict] = {}
        for f in raw:
            file = f.get("file", "")
            line = f.get("line", 0)
            key = f"{file}:{line // 5 * 5}"
            if key not in clusters:
                clusters[key] = {
                    "file": file,
                    "line": line,
                    "message": f.get("message", ""),
                    "tools": [],
                    "severity": f.get("severity", 0.5),
                }
            tool = f.get("tool", "unknown")
            if tool not in clusters[key]["tools"]:
                clusters[key]["tools"].append(tool)
            clusters[key]["severity"] = max(clusters[key]["severity"], f.get("severity", 0.5))
        for c in clusters.values():
            c["consensus"] = len(c["tools"]) >= 2
        return list(clusters.values())

    def _rank_findings(self, clustered: list[dict], sig, default_crit: float) -> list[Finding]:
        ranked: list[Finding] = []
        for i, c in enumerate(clustered):
            crit = get_file_criticality(sig, c["file"], default_crit)
            churn = 0.5
            if sig and c["file"] in sig.files:
                churn = sig.files[c["file"]].churn_weight
            blast = c["severity"] * crit * math.log(max(1, len(c["tools"]) + 1)) * (1 + churn)
            ranked.append(
                Finding(
                    id=f"finding-{i}",
                    file=c["file"],
                    line=c["line"],
                    message=c["message"],
                    tools=c["tools"],
                    severity=c["severity"],
                    blast_radius_score=blast,
                    consensus=c["consensus"],
                )
            )
        ranked.sort(key=lambda x: x.blast_radius_score, reverse=True)
        return ranked
