import logging
from pathlib import Path

from backend.agents.base import AgentBase
from backend.models.findings import Finding
from backend.models.validation import RetryBrief, SecurityRescanResult, ValidationFailure
from backend.services.retry_brief_builder import build_retry_brief
from backend.services.repo_layout import get_scan_targets, resolve_source_roots
from backend.services.security_rescan_commands import build_security_rescan_command
from backend.services.subprocess_runner import parse_json_safe, run_command
from backend.state.schema import RunStateModel

logger = logging.getLogger(__name__)


class A9SecurityRescanAgent(AgentBase):
    agent_id = "A9"

    async def run(self, state: RunStateModel) -> RunStateModel:
        state.current_agent = self.agent_id
        await self.store.save_state(state)
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
        validation_failure = None
        if rejected:
            nf = new_findings[0]
            security_constraint = f"must not introduce {nf.message} near {nf.file}:{nf.line}"
            validation_failure = ValidationFailure(
                assertion_message=f"New security finding: {nf.message}",
                validation_stage="security",
                pytest_stdout="",
                pytest_stderr="",
            )
            failure_brief = build_retry_brief(
                validation_failure,
                state.retry_count + 1,
                patch_bundle=state.patch_bundle,
                security_constraint=security_constraint,
            )

        result = SecurityRescanResult(
            new_findings=[f.model_dump() for f in new_findings],
            rejected=rejected,
            security_score=security_score,
            failure_brief=failure_brief,
            validation_failure=validation_failure,
            reexecution_command=reexecution_command,
            reexecution_timeout_seconds=reexecution_timeout,
        )
        result_dict = result.model_dump(mode="json")
        if validation_failure:
            validation_failure = validation_failure.model_copy(
                update={"security_result": result_dict}
            )
            result.validation_failure = validation_failure
            result_dict = result.model_dump(mode="json")
            if failure_brief:
                failure_brief = failure_brief.model_copy(
                    update={"validation_failure": validation_failure}
                )
                result.failure_brief = failure_brief
                result_dict["failure_brief"] = failure_brief.model_dump(mode="json")

        state.security_result = result_dict
        if failure_brief:
            state.retry_brief = failure_brief.model_dump(mode="json")
        if validation_failure:
            state.validation_failure = validation_failure.model_dump(mode="json")

        # Fix 4: Full security diagnostic log before return
        logger.info(
            "A9 EXIT | run_id=%s | retry_count=%d"
            " | baseline_bandit=%d | baseline_semgrep=%d"
            " | post_bandit=%d | post_semgrep=%d"
            " | baseline_keys=%d | post_keys=%d"
            " | new_keys=%d | new_findings=%d"
            " | rejected=%s"
            " | security_score=%.1f (formula: max(0, 100 - new_findings*25))"
            " | DECISION: patch_retry=%s",
            state.run_id,
            state.retry_count,
            len(baseline.get("bandit", [])),
            len(baseline.get("semgrep", [])),
            len(post_bandit),
            len(post_semgrep),
            len(baseline_keys),
            len(post_keys),
            len(new_keys),
            len(new_findings),
            rejected,
            security_score,
            rejected,
        )
        if new_findings:
            logger.info(
                "A9 NEW_FINDINGS | run_id=%s | findings=%s",
                state.run_id,
                [{"file": f.file, "line": f.line, "message": f.message} for f in new_findings],
            )
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
