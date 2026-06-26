import asyncio
import json

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.services.ws_broadcaster import get_broadcaster
from backend.state.events import AgentStatusEvent
from backend.state.redis_store import RedisStore

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/runs/{run_id}")
async def ws_run_timeline(websocket: WebSocket, run_id: str) -> None:
    store = RedisStore(websocket.app.state.redis)
    state = await store.load_state(run_id)
    if not state:
        await websocket.close(code=4004, reason="Run not found")
        return

    await websocket.accept()

    history = await store.get_events(run_id)
    for event in history:
        await websocket.send_json(event.model_dump(mode="json"))

    broadcaster = get_broadcaster()
    queue = broadcaster.subscribe(run_id)

    redis_client: aioredis.Redis = websocket.app.state.redis
    pubsub = redis_client.pubsub()
    channel = f"bugfix:{run_id}:live"
    await pubsub.subscribe(channel)

    async def redis_listener() -> None:
        try:
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("type") == "message":
                    data = message["data"]
                    if isinstance(data, bytes):
                        data = data.decode()
                    event = AgentStatusEvent.model_validate_json(data)
                    await websocket.send_json(event.model_dump(mode="json"))
        except asyncio.CancelledError:
            pass

    listener_task = asyncio.create_task(redis_listener())

    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                await websocket.send_json(event.model_dump(mode="json"))
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        listener_task.cancel()
        broadcaster.unsubscribe(run_id, queue)
        await pubsub.unsubscribe(channel)
        await pubsub.close()
