"""A9 — post-patch security re-scan.

Answers one question: **did the patch introduce a vulnerability that was not
there before?** It is a differential check, so the whole agent turns on what
"the same finding" means across two scans of a file whose lines have moved.

Two defects shaped the current form, both of the same family — a number that
was not a measurement:

* The finding key was ``file:line:message[:50]``. A patch that inserts a line
  above a pre-existing finding shifts it down, the key changes, and the
  unchanged finding is reported as newly introduced — a rejection, a retry, and
  a draft PR, for code the patch never touched.
* An absent scanner produced ``security_score = 100.0``. `bandit` not being
  installed is not evidence that a patch is safe, but it scored higher than any
  real scan can and cleared `SECURITY_TECHNICAL_THRESHOLD` outright.
"""

import re
from collections import Counter
from pathlib import Path

from backend.agents.base import AgentBase
from backend.models.findings import Finding
from backend.models.validation import SecurityRescanResult, ValidationFailure
from backend.services.path_resolution import normalize_path_token
from backend.services.retry_brief_builder import build_retry_brief
from backend.services.repo_layout import (
    bandit_exclude_arg,
    get_scan_targets,
    resolve_source_roots,
    semgrep_exclude_args,
)
from backend.services.security_rescan_commands import build_security_rescan_command
from backend.services.subprocess_runner import parse_json_safe, run_command
from backend.state.schema import RunStateModel

#: Points deducted per newly introduced finding.
NEW_FINDING_PENALTY = 25.0

_WHITESPACE = re.compile(r"\s+")

#: A finding's identity for differential comparison: which tool said it, in
#: which file, about what. **Not the line** — that is what moves under a patch.
FindingKey = tuple[str, str, str]


def finding_key(finding: dict, tool: str) -> FindingKey:
    """What makes two findings across two scans *the same* finding.

    The message is normalized only for whitespace and case, never truncated: the
    old 50-character prefix collided distinct bandit issues that share an
    opening clause, and a collision here is a real new vulnerability silently
    accepted — the failure direction that matters most.
    """
    message = _WHITESPACE.sub(" ", str(finding.get("message", ""))).strip().casefold()
    return (tool, normalize_path_token(str(finding.get("file", ""))), message)


def new_findings_by_multiplicity(
    baseline: list[tuple[FindingKey, dict]],
    post: list[tuple[FindingKey, dict]],
) -> list[dict]:
    """Post-scan findings with no counterpart in the baseline.

    Counting, not set difference. Set difference answers "does this kind of
    finding exist in both scans", which drops a real regression: a file that had
    one hardcoded password and now has two contains a new one, and both share a
    key. Comparing *counts* per key catches that while still absorbing a pure
    line shift, where the count is unchanged.

    When a key has surplus occurrences, the ones reported are those whose line
    is not already occupied in the baseline — so a genuinely-new second finding
    is named at its own line rather than at the pre-existing one's.
    """
    baseline_counts = Counter(key for key, _ in baseline)
    baseline_lines: dict[FindingKey, set[int]] = {}
    for key, finding in baseline:
        baseline_lines.setdefault(key, set()).add(int(finding.get("line", 0) or 0))

    grouped: dict[FindingKey, list[dict]] = {}
    for key, finding in post:
        grouped.setdefault(key, []).append(finding)

    introduced: list[dict] = []
    for key, findings in grouped.items():
        surplus = len(findings) - baseline_counts.get(key, 0)
        if surplus <= 0:
            continue
        # Unmatched lines first: they are the occurrences the baseline cannot
        # account for, and naming them points the retry at the right place.
        known = baseline_lines.get(key, set())
        ordered = sorted(findings, key=lambda f: int(f.get("line", 0) or 0) in known)
        introduced.extend(ordered[:surplus])

    return introduced


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

        bandit_executed, post_bandit = await self._run_bandit(repo, scan_targets)
        semgrep_executed, post_semgrep = await self._run_semgrep(repo, scan_targets)
        scanners_run = [
            tool
            for tool, executed in (("bandit", bandit_executed), ("semgrep", semgrep_executed))
            if executed
        ]

        # Only tools that ran may contribute to the comparison. A baseline from a
        # tool absent this time would make every one of its findings look
        # resolved, and a post-scan from a tool absent at baseline would make
        # every one of its findings look new.
        baseline_pairs = self._keyed(baseline, scanners_run)
        post_pairs = [(finding_key(f, "bandit"), f) for f in post_bandit] + [
            (finding_key(f, "semgrep"), f) for f in post_semgrep
        ]

        new_findings = [
            Finding(
                id=f"new-{index}",
                file=f.get("file", ""),
                line=f.get("line", 0),
                message=f.get("message", ""),
                tools=[f.get("tool", "")],
                severity=f.get("severity", 0.7),
            )
            for index, f in enumerate(new_findings_by_multiplicity(baseline_pairs, post_pairs))
        ]

        rejected = len(new_findings) > 0
        # No scanner ran, so nothing was verified. A perfect score here would be
        # `bandit is not installed` reported as `this patch is safe`, and it
        # cleared the auto-merge security gate outright. Absent is not 100 for
        # the same reason it is not 0 (`services/measurement.py`).
        security_score = (
            max(0.0, 100.0 - len(new_findings) * NEW_FINDING_PENALTY) if scanners_run else None
        )
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
            scanners_run=scanners_run,
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

        # The message is what the user reads on the card. "0 new findings" for a
        # scan that never ran is the same lie the score used to tell.
        message = (
            f"Security scan: {len(new_findings)} new findings"
            if scanners_run
            else "Security re-scan did not run — no scanner was available"
        )

        await self.emit_status(
            state,
            "completed",
            message,
            {
                "rejected": rejected,
                "security_score": security_score,
                "scanners_run": scanners_run,
                "source_roots": source_roots,
            },
        )
        return state

    async def _run_bandit(self, repo: Path, scan_targets: list[Path]) -> tuple[bool, list[dict]]:
        """`(executed, findings)`. Zero findings and *no scan* are not the same fact.

        Mirrors A3's `ScanOutcome` detection (`code == -1` is the runner's
        "could not execute"), deliberately without A3's stub fallback: a
        differential check against fabricated findings would compare a real scan
        to invented ones. The A3/A9 scanner duplication remains open as T5.
        """
        if not scan_targets:
            return False, []
        cmd = ["bandit", "-f", "json", "-q", "-x", bandit_exclude_arg()]
        for target in scan_targets:
            cmd.extend(["-r", str(target)])
        code, stdout, _ = await run_command(cmd, cwd=repo, timeout=60)
        if code == -1:
            return False, []
        data = parse_json_safe(stdout)
        # bandit exits 0 clean, 1 with issues; either way it emits a `results`
        # envelope. Its absence means the scan did not complete.
        if not isinstance(data, dict) or "results" not in data:
            return False, []
        return True, [
            {
                "tool": "bandit",
                "file": r.get("filename", "").replace(str(repo) + "/", ""),
                "line": r.get("line_number", 0),
                "message": r.get("issue_text", ""),
                "severity": 0.7,
            }
            for r in data.get("results", [])
        ]

    async def _run_semgrep(self, repo: Path, scan_targets: list[Path]) -> tuple[bool, list[dict]]:
        if not scan_targets:
            return False, []
        cmd = ["semgrep", "--config=auto", "--json", *semgrep_exclude_args()]
        cmd.extend(str(t) for t in scan_targets)
        code, stdout, _ = await run_command(cmd, cwd=repo, timeout=90)
        if code == -1:
            return False, []
        data = parse_json_safe(stdout)
        if not isinstance(data, dict) or "results" not in data:
            return False, []
        return True, [
            {
                "tool": "semgrep",
                "file": r.get("path", "").replace(str(repo) + "/", ""),
                "line": r.get("start", {}).get("line", 0),
                "message": r.get("extra", {}).get("message", ""),
                "severity": 0.7,
            }
            for r in data.get("results", [])
        ]

    def _keyed(self, baseline: dict, tools: list[str]) -> list[tuple[FindingKey, dict]]:
        """A3's baseline, keyed per tool. `ruff` is style, not security — excluded."""
        return [
            (finding_key(finding, tool), finding)
            for tool in tools
            for finding in baseline.get(tool, []) or []
        ]
