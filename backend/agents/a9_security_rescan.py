from pathlib import Path

from backend.agents.base import AgentBase
from backend.models.findings import Finding
from backend.models.validation import RetryBrief, SecurityRescanResult
from backend.services.repo_layout import get_scan_targets, resolve_source_roots
from backend.services.security_rescan_commands import build_security_rescan_command
from backend.services.subprocess_runner import parse_json_safe, run_command
from backend.state.schema import RunStateModel


class A9SecurityRescanAgent(AgentBase):
    agent_id = "A9"

    async def run(self, state: RunStateModel) -> RunStateModel:
        await self.emit_status(state, "started", "Running post-patch security re-scan")
        repo = Path(state.repo_clone_path or state.repo_path).resolve()
        static = state.static_report or {}
        baseline = static.get("baseline_json", {})
        sig_data = state.sig or await self.store.get_json(state.run_id, "sig")
        scan_targets = get_scan_targets(state, repo, sig_data)
        source_roots = resolve_source_roots(repo, state.source_roots or None, sig_data)

        post_bandit = await self._run_bandit(repo, scan_targets)
        post_semgrep = await self._run_semgrep(repo, scan_targets)

        baseline_keys = self._finding_keys(baseline.get("bandit", []) + baseline.get("semgrep", []))
        post_keys = self._finding_keys(post_bandit + post_semgrep)

        new_keys = post_keys - baseline_keys
        new_findings = []
        for f in post_bandit + post_semgrep:
            key = f"{f.get('file')}:{f.get('line')}:{f.get('message', '')[:50]}"
            if key in new_keys:
                new_findings.append(
                    Finding(
                        id=f"new-{len(new_findings)}",
                        file=f.get("file", ""),
                        line=f.get("line", 0),
                        message=f.get("message", ""),
                        tools=["bandit" if f in post_bandit else "semgrep"],
                        severity=f.get("severity", 0.7),
                    )
                )

        rejected = len(new_findings) > 0
        security_score = max(0.0, 100.0 - len(new_findings) * 25)
        reexecution_command, reexecution_timeout = build_security_rescan_command(scan_targets)
        failure_brief = None
        if rejected:
            nf = new_findings[0]
            failure_brief = RetryBrief(
                attempt=state.retry_count + 1,
                security_constraint=f"must not introduce {nf.message} near {nf.file}:{nf.line}",
            )
            state.retry_brief = failure_brief.model_dump(mode="json")

        result = SecurityRescanResult(
            new_findings=[f.model_dump() for f in new_findings],
            rejected=rejected,
            security_score=security_score,
            failure_brief=failure_brief,
            reexecution_command=reexecution_command,
            reexecution_timeout_seconds=reexecution_timeout,
        )
        result_dict = result.model_dump(mode="json")
        state.security_result = result_dict

        await self.emit_status(
            state,
            "completed",
            f"Security scan: {len(new_findings)} new findings",
            {
                "rejected": rejected,
                "security_score": security_score,
                "source_roots": source_roots,
            },
        )
        return state

    async def _run_bandit(self, repo: Path, scan_targets: list[Path]) -> list[dict]:
        if not scan_targets:
            return []
        cmd = ["bandit", "-f", "json", "-q"]
        for target in scan_targets:
            cmd.extend(["-r", str(target)])
        _code, stdout, _ = await run_command(cmd, cwd=repo, timeout=60)
        data = parse_json_safe(stdout)
        return [
            {
                "file": r.get("filename", "").replace(str(repo) + "/", ""),
                "line": r.get("line_number", 0),
                "message": r.get("issue_text", ""),
                "severity": 0.7,
            }
            for r in data.get("results", [])
        ]

    async def _run_semgrep(self, repo: Path, scan_targets: list[Path]) -> list[dict]:
        if not scan_targets:
            return []
        cmd = ["semgrep", "--config=auto", "--json"]
        cmd.extend(str(t) for t in scan_targets)
        _code, stdout, _ = await run_command(cmd, cwd=repo, timeout=90)
        data = parse_json_safe(stdout)
        return [
            {
                "file": r.get("path", "").replace(str(repo) + "/", ""),
                "line": r.get("start", {}).get("line", 0),
                "message": r.get("extra", {}).get("message", ""),
                "severity": 0.7,
            }
            for r in data.get("results", [])
        ]

    def _finding_keys(self, findings: list[dict]) -> set[str]:
        return {f"{f.get('file')}:{f.get('line')}:{f.get('message', '')[:50]}" for f in findings}
