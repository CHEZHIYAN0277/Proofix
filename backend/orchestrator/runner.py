import logging
import traceback
from typing import get_args

from langgraph.checkpoint.memory import MemorySaver

from backend.config import Settings
from backend.orchestrator.graph import build_graph
from backend.services.ui_projection import run_decision
from backend.state.events import PRType, RunLifecycleEvent
from backend.state.redis_store import RedisStore
from backend.state.schema import RunStateModel

logger = logging.getLogger(__name__)

# Values `RunLifecycleEvent.decision` accepts. An unexpected routing outcome is
# reported as no decision rather than crashing the announcement.
PR_TYPES = frozenset(get_args(PRType))


class PipelineRunner:
    def __init__(self, store: RedisStore, settings: Settings):
        self.store = store
        self.settings = settings
        self.checkpointer = MemorySaver()
        self.graph = build_graph(store, settings).compile(checkpointer=self.checkpointer)

    async def execute(self, run_id: str) -> RunStateModel:
        state = await self.store.load_state(run_id)
        if not state:
            raise ValueError(f"Run {run_id} not found")

        state.status = "running"
        await self.store.save_state(state)
        await self._emit_lifecycle(RunLifecycleEvent(type="run.started", run_id=run_id))

        config = {"configurable": {"thread_id": run_id}}
        initial = state.model_dump(exclude_none=False)

        try:
            final = await self.graph.ainvoke(initial, config)
            result = RunStateModel(**{k: v for k, v in final.items() if k in RunStateModel.model_fields})
            if result.status != "completed":
                result.status = "completed"
            await self.store.save_state(result)
            await self._emit_completed(result)
            return result
        except Exception as e:
            state.status = "failed"
            state.errors.append({"error": str(e), "trace": traceback.format_exc()})
            await self.store.save_state(state)
            await self._emit_lifecycle(
                RunLifecycleEvent(
                    type="run.failed",
                    run_id=run_id,
                    reason=f"{type(e).__name__}: {e}",
                    sequence=state.ws_sequence + 1,
                )
            )
            raise

    async def _emit_completed(self, result: RunStateModel) -> None:
        """Announce completion without letting the announcement fail the run.

        Building the event is inside the caller's success path, so anything that
        could raise here — an unexpected `pr_type`, a projection error — is
        contained. A run that succeeded must never be reported as failed because
        its telemetry could not be assembled.
        """
        try:
            _decision, label = run_decision(result)
            pr_type = (result.pr_decision or {}).get("pr_type")
            event = RunLifecycleEvent(
                type="run.completed",
                run_id=result.run_id,
                decision=pr_type if pr_type in PR_TYPES else None,
                decision_label=label,
                sequence=result.ws_sequence + 1,
            )
        except Exception as exc:  # noqa: BLE001 — reported, never propagated
            logger.warning(
                "lifecycle_build_failed",
                extra={"lifecycle": {"run_id": result.run_id, "error": str(exc)}},
            )
            return
        await self._emit_lifecycle(event)

    async def _emit_lifecycle(self, event: RunLifecycleEvent) -> None:
        """Publish a lifecycle event. Never let telemetry fail a run.

        A run that finished but could not announce it is still a run that
        finished; raising here would turn a Redis hiccup into a failed repair.
        The WebSocket's state-poll fallback still reports terminal runs, so the
        client degrades rather than hangs.
        """
        try:
            await self.store.append_lifecycle_event(event)
        except Exception as exc:  # noqa: BLE001 — reported, never propagated
            logger.warning(
                "lifecycle_emit_failed",
                extra={"lifecycle": {"run_id": event.run_id, "type": event.type, "error": str(exc)}},
            )
