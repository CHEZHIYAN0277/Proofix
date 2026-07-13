import logging
import time
from pathlib import Path

from backend.agents.base import AgentBase
from backend.models.reproduction import ReproductionResult, ReproductionStatus
from backend.services.reproduction_commands import build_reproduction_command
from backend.services.reproduction_parser import (
    extract_failed_nodeids,
    load_pytest_report,
    parse_pytest_report,
    pytest_report_path,
)
from backend.services.subprocess_runner import run_command
from backend.state.schema import RunStateModel

logger = logging.getLogger(__name__)

_STATUS_MESSAGES = {
    ReproductionStatus.CONFIRMED: "Reproduction confirmed",
    ReproductionStatus.UNCONFIRMED: "Reproduction NOT confirmed",
    ReproductionStatus.INFRA_ERROR: "Reproduction infrastructure error",
    ReproductionStatus.NO_TESTS: "No tests available for reproduction",
}


class A35ReproductionAgent(AgentBase):
    agent_id = "A3.5"

    async def run(self, state: RunStateModel) -> RunStateModel:
        state.current_agent = self.agent_id
        await self.store.save_state(state)
        await self.emit_status(state, "started", "Running reproduction gate via pytest")
        repo = Path(state.repo_clone_path or state.repo_path).resolve()
        report_path = pytest_report_path(state.run_id)

        if report_path.exists():
            report_path.unlink()

        # Instrumentation 1: log everything about the pytest invocation before it runs
        _cmd = ["python", "-m", "pytest", "--tb=long", "--json-report",
                f"--json-report-file={report_path}", "-v"]
        logger.info(
            "A3.5 PYTEST START | run_id=%s"
            " | cwd=%s"
            " | command=%s"
            " | report_path=%s"
            " | report_exists_before=%s"
            " | timeout=%d",
            state.run_id,
            str(repo),
            " ".join(_cmd),
            str(report_path),
            report_path.exists(),
            120,
        )

        _t0 = time.monotonic()
        code, stdout, stderr = await run_command(
            _cmd,
            cwd=repo,
            timeout=120,
        )
        _duration = time.monotonic() - _t0

        # Instrumentation 2: log outcome immediately after run_command returns
        logger.info(
            "A3.5 PYTEST FINISHED | run_id=%s"
            " | exit_code=%d"
            " | duration=%.2fs"
            " | stdout_len=%d"
            " | stderr_len=%d"
            " | report_exists=%s"
            " | report_path=%s",
            state.run_id,
            code,
            _duration,
            len(stdout),
            len(stderr),
            report_path.exists(),
            str(report_path),
        )

        # Instrumentation 3: full stdout/stderr when report was not created
        if not report_path.exists():
            logger.info(
                "A3.5 PYTEST STDOUT | run_id=%s\n%s",
                state.run_id,
                stdout,
            )
            logger.info(
                "A3.5 PYTEST STDERR | run_id=%s\n%s",
                state.run_id,
                stderr,
            )
        else:
            # Instrumentation 4: quick sanity check on the report that was created
            _raw = report_path.read_text(encoding="utf-8", errors="replace")
            logger.info(
                "A3.5 REPORT FOUND | run_id=%s"
                " | size=%d"
                " | preview=%s",
                state.run_id,
                len(_raw),
                _raw[:300],
            )

        report = load_pytest_report(report_path)
        result = parse_pytest_report(report, code, stdout, stderr, report_path, repo_root=repo)
        result.pre_existing_failures = extract_failed_nodeids(report)

        # Instrument: log discovered test immediately after parsing
        logger.info(
            "A3.5 PARSE_RESULT | run_id=%s | exit_code=%d"
            " | report_exists=%s | report_tests=%d"
            " | result_status=%s | failing_test=%s | confidence=%.2f"
            " | pre_existing_failures=%d",
            state.run_id,
            code,
            report is not None,
            len((report or {}).get("tests", [])),
            result.status.value,
            result.failing_test,
            result.confidence,
            len(result.pre_existing_failures),
        )

        reexec_cmd, is_targeted, reexec_timeout = build_reproduction_command(result.failing_test)
        result.reexecution_command = reexec_cmd
        result.reexecution_is_targeted = is_targeted
        result.reexecution_timeout_seconds = reexec_timeout

        # Instrument: log the full dict that will be stored in state.reproduction
        result_dict = result.model_dump(mode="json")
        logger.info(
            "A3.5 REPRODUCTION_DICT | run_id=%s"
            " | keys=%s"
            " | failing_test=%s"
            " | reexecution_command=%s"
            " | is_targeted=%s"
            " | force_draft_pr=%s",
            state.run_id,
            list(result_dict.keys()),
            result_dict.get("failing_test"),
            result_dict.get("reexecution_command"),
            is_targeted,
            result_dict.get("force_draft_pr"),
        )
        state.reproduction = result_dict
        if result.force_draft_pr:
            state.force_draft_pr = True

        # Instrument: confirm what A8 will read from state.reproduction
        logger.info(
            "A3.5 STATE_REPRODUCTION | run_id=%s"
            " | state.reproduction[failing_test]=%s"
            " | state.reproduction[status]=%s"
            " | state.force_draft_pr=%s",
            state.run_id,
            (state.reproduction or {}).get("failing_test"),
            (state.reproduction or {}).get("status"),
            state.force_draft_pr,
        )

        await self.emit_status(
            state,
            "completed",
            _STATUS_MESSAGES.get(result.status, str(result.status)),
            {
                "status": result.status.value,
                "reproduced": result.reproduced,
                "force_draft_pr": result.force_draft_pr,
                "failing_test": result.failing_test,
                "report_path": result.report_path,
            },
        )
        return state
