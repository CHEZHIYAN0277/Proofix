from abc import ABC, abstractmethod
from datetime import datetime

from backend.config import Settings, get_settings
from backend.services.ws_broadcaster import get_broadcaster
from backend.state.events import AgentStatusEvent
from backend.state.redis_store import RedisStore
from backend.state.schema import RunStateModel


class AgentBase(ABC):
    agent_id: str = "A0"

    def __init__(self, store: RedisStore, settings: Settings | None = None):
        self.store = store
        self.settings = settings or get_settings()

    async def emit_status(
        self,
        state: RunStateModel,
        status: str,
        message: str = "",
        payload: dict | None = None,
    ) -> None:
        state.ws_sequence += 1
        event = AgentStatusEvent(
            run_id=state.run_id,
            agent_id=self.agent_id,
            status=status,  # type: ignore[arg-type]
            timestamp=datetime.utcnow(),
            message=message,
            payload=payload,
            sequence=state.ws_sequence,
        )
        await self.store.append_event(event)
        await get_broadcaster().broadcast(event)

    @abstractmethod
    async def run(self, state: RunStateModel) -> RunStateModel:
        ...
