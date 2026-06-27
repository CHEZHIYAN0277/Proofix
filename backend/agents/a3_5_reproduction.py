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

_STATUS_MESSAGES = {
    ReproductionStatus.CONFIRMED: "Reproduction confirmed",
    ReproductionStatus.UNCONFIRMED: "Reproduction NOT confirmed",
    ReproductionStatus.INFRA_ERROR: "Reproduction infrastructure error",
    ReproductionStatus.NO_TESTS: "No tests available for reproduction",
}


class A35ReproductionAgent(AgentBase):
    agent_id = "A3.5"

    async def run(self, state: RunStateModel) -> RunStateModel:
        await self.emit_status(state, "started", "Running reproduction gate via pytest")
        repo = Path(state.repo_clone_path or state.repo_path).resolve()
        report_path = pytest_report_path(state.run_id)

        if report_path.exists():
            report_path.unlink()

        code, stdout, stderr = await run_command(
            [
                "python",
                "-m",
                "pytest",
                "--tb=long",
                "--json-report",
                f"--json-report-file={report_path}",
                "-v",
            ],
            cwd=repo,
            timeout=120,
        )

        report = load_pytest_report(report_path)
        result = parse_pytest_report(report, code, stdout, stderr, report_path, repo_root=repo)
        result.pre_existing_failures = extract_failed_nodeids(report)

        reexec_cmd, is_targeted, reexec_timeout = build_reproduction_command(result.failing_test)
        result.reexecution_command = reexec_cmd
        result.reexecution_is_targeted = is_targeted
        result.reexecution_timeout_seconds = reexec_timeout

        result_dict = result.model_dump(mode="json")
        state.reproduction = result_dict
        if result.force_draft_pr:
            state.force_draft_pr = True

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
