import asyncio
from collections import defaultdict
from typing import Callable

from backend.state.events import AgentStatusEvent


class WSBroadcaster:
    """In-memory pub/sub for WebSocket clients; Redis pub/sub is primary."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue[AgentStatusEvent]]] = defaultdict(list)

    def subscribe(self, run_id: str) -> asyncio.Queue[AgentStatusEvent]:
        queue: asyncio.Queue[AgentStatusEvent] = asyncio.Queue()
        self._subscribers[run_id].append(queue)
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue[AgentStatusEvent]) -> None:
        subs = self._subscribers.get(run_id, [])
        if queue in subs:
            subs.remove(queue)

    async def broadcast(self, event: AgentStatusEvent) -> None:
        for queue in self._subscribers.get(event.run_id, []):
            await queue.put(event)


_broadcaster: WSBroadcaster | None = None


def get_broadcaster() -> WSBroadcaster:
    global _broadcaster
    if _broadcaster is None:
        _broadcaster = WSBroadcaster()
    return _broadcaster
