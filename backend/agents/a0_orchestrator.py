from backend.agents.base import AgentBase
from backend.state.schema import RunStateModel


class A0OrchestratorAgent(AgentBase):
    agent_id = "A0"

    async def run(self, state: RunStateModel) -> RunStateModel:
        await self.emit_status(state, "started", "Pipeline orchestration started")
        state.status = "running"
        state.current_agent = "A0"
        await self.emit_status(state, "completed", "Orchestrator initialized")
        return state
