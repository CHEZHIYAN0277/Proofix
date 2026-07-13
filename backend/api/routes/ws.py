import asyncio
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.state.events import AgentStatusEvent
from backend.state.redis_store import RedisStore

logger = logging.getLogger(__name__)

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

    Every translated event includes ``message`` so the frontend can
    display real-time activity lines.  Finalized events also carry
    ``payload`` for agent-specific metrics and failure reasons.
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
                "message": event.message or None,
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
                "message": event.message or None,
            }
        )

    elif event.status == "completed":
        translated.append(
            {
                "type": "agent.finalized",
                "index": index,
                "status": "completed",
                "message": event.message or None,
                "payload": event.payload,
            }
        )

    elif event.status == "failed":
        translated.append(
            {
                "type": "agent.finalized",
                "index": index,
                "status": "failed",
                "message": event.message or None,
                "payload": event.payload,
            }
        )

    elif event.status == "retry":
        translated.append(
            {
                "type": "agent.finalized",
                "index": index,
                "status": "retry",
                "message": event.message or None,
                "payload": event.payload,
            }
        )

    return translated


def _check_run_completed(events: list[AgentStatusEvent]) -> bool:
    """
    Return True when all agents reached a terminal state in the
    event stream.  This is a purely event-driven check — no Redis
    polling is involved.
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
    pubsub = None
    channel = f"bugfix:{run_id}:live"

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

        # ── Replay history ──────────────────────────────────────

        history = await store.get_events(run_id)

        seq_counters: dict[str, int] = {}
        run_completed_sent = False

        for event in history:

            await websocket.send_json(
                event.model_dump(mode="json")
            )

            for fe_event in _translate_event(event, seq_counters):
                await websocket.send_json(fe_event)

        # Check completion from replayed history + persisted status.
        # If the run already completed before the client connected,
        # the persisted state.status will be "completed" or "failed"
        # and we should inform the frontend immediately.
        if state.status in ("completed", "failed") or _check_run_completed(history):
            await websocket.send_json(
                {"type": "run.completed"}
            )
            run_completed_sent = True

        all_events = list(history)

        # ── Live updates via Redis Pub/Sub only ─────────────────
        # No polling.  The WebSocket is purely event-driven.
        # PipelineRunner persists completion state; the frontend
        # already polls GET /runs/{id} for that.

        redis_client: aioredis.Redis = websocket.app.state.redis

        pubsub = redis_client.pubsub()

        await pubsub.subscribe(channel)

        async def redis_listener():
            nonlocal run_completed_sent

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

                        # Emit run.completed exactly once when all
                        # agents reach a terminal state.
                        if not run_completed_sent and _check_run_completed(all_events):
                            await websocket.send_json(
                                {"type": "run.completed"}
                            )
                            run_completed_sent = True

            except asyncio.CancelledError:
                pass

        listener_task = asyncio.create_task(
            redis_listener()
        )

        # ── Keep-alive pings ────────────────────────────────────
        # No polling — just periodic pings to detect dead clients.

        while True:

            try:
                await asyncio.sleep(30.0)

                await websocket.send_json(
                    {"type": "ping"}
                )

            except Exception:
                break

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected | run_id=%s", run_id)

    except Exception:
        logger.exception(
            "WebSocket handler crashed | run_id=%s",
            run_id,
        )

        try:
            await websocket.close(code=1011)
        except Exception:
            pass

    finally:

        if listener_task:
            listener_task.cancel()
            try:
                await listener_task
            except asyncio.CancelledError:
                pass

        if pubsub:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.close()
            except Exception:
                pass