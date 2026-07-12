import asyncio
import traceback

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.services.ws_broadcaster import get_broadcaster
from backend.state.events import AgentStatusEvent
from backend.state.redis_store import RedisStore

router = APIRouter(tags=["websocket"])

# ── Agent ID → frontend index mapping ───────────────────────────────

AGENT_MAP: dict[str, dict] = {
    "A1": {"index": 0},
    "A2": {"index": 1},
    "A3": {"index": 2},
    "A3.5": {"index": 3},
    "A4": {"index": 4},
    "A5": {"index": 5},
    "A6": {"index": 6},
    "A7": {"index": 7},
    "A8": {"index": 8},
    "A9": {"index": 9},
    "A10": {"index": 10},
}

# ── Frontend event translation ──────────────────────────────────────

_AGENT_INDEX: dict[str, int] = {k: v["index"] for k, v in AGENT_MAP.items()}
_ALL_AGENT_IDS = set(AGENT_MAP.keys())


def _translate_event(
    event: AgentStatusEvent,
    seq_counters: dict[str, int],
) -> list[dict]:
    """
    Convert an AgentStatusEvent into frontend-compatible events.
    """

    index = _AGENT_INDEX.get(event.agent_id)

    if index is None:
        return []

    translated: list[dict] = []

    if event.status == "started":
        translated.append(
            {
                "type": "agent.started",
                "index": index,
            }
        )

    elif event.status == "progress":
        counter_key = event.agent_id
        line_idx = seq_counters.get(counter_key, 0)
        seq_counters[counter_key] = line_idx + 1

        translated.append(
            {
                "type": "agent.line",
                "index": index,
                "lineIndex": line_idx,
            }
        )

    elif event.status == "completed":
        translated.append(
            {
                "type": "agent.finalized",
                "index": index,
                "status": "completed",
            }
        )

    elif event.status == "failed":
        translated.append(
            {
                "type": "agent.finalized",
                "index": index,
                "status": "failed",
            }
        )

    elif event.status == "retry":
        translated.append(
            {
                "type": "agent.finalized",
                "index": index,
                "status": "retry",
            }
        )

    return translated


def _check_run_completed(events: list[AgentStatusEvent]) -> bool:
    """
    Return True when all agents reached a terminal state.
    """

    terminal: set[str] = set()

    for event in events:
        if (
            event.agent_id in _ALL_AGENT_IDS
            and event.status in ("completed", "failed")
        ):
            terminal.add(event.agent_id)

    return terminal >= _ALL_AGENT_IDS


@router.websocket("/ws/runs/{run_id}")
async def ws_run_timeline(
    websocket: WebSocket,
    run_id: str,
) -> None:

    listener_task = None
    broadcaster = None
    queue = None
    pubsub = None

    try:

        store = RedisStore(websocket.app.state.redis)

        state = await store.load_state(run_id)

        if not state:
            await websocket.close(
                code=4004,
                reason="Run not found",
            )
            return

        await websocket.accept()

        # Replay history

        history = await store.get_events(run_id)

        seq_counters: dict[str, int] = {}

        for event in history:

            await websocket.send_json(
                event.model_dump(mode="json")
            )

            for fe_event in _translate_event(event, seq_counters):
                await websocket.send_json(fe_event)

        if _check_run_completed(history):
            await websocket.send_json(
                {"type": "run.completed"}
            )

        all_events = list(history)

        broadcaster = get_broadcaster()
        queue = broadcaster.subscribe(run_id)

        redis_client: aioredis.Redis = websocket.app.state.redis

        pubsub = redis_client.pubsub()

        channel = f"bugfix:{run_id}:live"

        await pubsub.subscribe(channel)

        async def redis_listener():

            try:

                while True:

                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True,
                        timeout=1.0,
                    )

                    if (
                        message
                        and message.get("type") == "message"
                    ):

                        data = message["data"]

                        if isinstance(data, bytes):
                            data = data.decode()

                        event = AgentStatusEvent.model_validate_json(data)

                        await websocket.send_json(
                            event.model_dump(mode="json")
                        )

                        for fe_event in _translate_event(
                            event,
                            seq_counters,
                        ):
                            await websocket.send_json(fe_event)

                        all_events.append(event)

                        if _check_run_completed(all_events):
                            await websocket.send_json(
                                {"type": "run.completed"}
                            )

            except asyncio.CancelledError:
                pass

        listener_task = asyncio.create_task(
            redis_listener()
        )

        while True:

            try:

                event = await asyncio.wait_for(
                    queue.get(),
                    timeout=30.0,
                )

                await websocket.send_json(
                    event.model_dump(mode="json")
                )

                for fe_event in _translate_event(
                    event,
                    seq_counters,
                ):
                    await websocket.send_json(fe_event)

                all_events.append(event)

                if _check_run_completed(all_events):
                    await websocket.send_json(
                        {"type": "run.completed"}
                    )

            except asyncio.TimeoutError:

                try:
                    await websocket.send_json(
                        {"type": "ping"}
                    )

                except Exception:
                    break

    except WebSocketDisconnect:
        print(f"WebSocket disconnected: {run_id}")

    except Exception:

        print("=" * 80)
        print("WEBSOCKET CRASH")
        print(f"Run ID: {run_id}")
        traceback.print_exc()
        print("=" * 80)

        try:
            await websocket.close(code=1011)
        except Exception:
            pass

    finally:

        if listener_task:
            listener_task.cancel()

        if broadcaster and queue:
            broadcaster.unsubscribe(
                run_id,
                queue,
            )

        if pubsub:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.close()
            except Exception:
                pass