import logging
import time
import traceback

from langgraph.checkpoint.memory import MemorySaver

from backend.config import Settings
from backend.orchestrator.graph import build_graph
from backend.state.redis_store import RedisStore
from backend.state.schema import RunStateModel

logger = logging.getLogger(__name__)


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

        logger.info(
            "Pipeline started | run_id=%s | status=%s | current_agent=%s | retry_count=%d",
            run_id,
            state.status,
            state.current_agent,
            state.retry_count,
        )

        state.status = "running"
        await self.store.save_state(state)

        config = {"configurable": {"thread_id": run_id}}
        initial = state.model_dump(exclude_none=False)
        t0 = time.monotonic()

        try:
            logger.info(
                "LANGGRAPH INVOKE | run_id=%s | initial_status=%s | initial_current_agent=%s",
                run_id,
                initial.get("status"),
                initial.get("current_agent"),
            )
            final = await self.graph.ainvoke(initial, config)

            logger.info(
                "LANGGRAPH FINAL STATE | run_id=%s | keys=%s",
                run_id,
                list(final.keys()),
            )
            logger.info(
                "Graph returned | run_id=%s | status=%s | current_agent=%s",
                run_id,
                final.get("status"),
                final.get("current_agent"),
            )

            result = RunStateModel(**{k: v for k, v in final.items() if k in RunStateModel.model_fields})

            logger.info(
                "RunStateModel created | run_id=%s | status=%s | current_agent=%s | retry=%d",
                run_id,
                result.status,
                result.current_agent,
                result.retry_count,
            )

            if result.status != "completed":
                result.status = "completed"
            logger.info(
                "Saving final state | run_id=%s | status=%s | current_agent=%s",
                run_id,
                result.status,
                result.current_agent,
            )
            await self.store.save_state(result)

            elapsed = time.monotonic() - t0
            logger.info(
                "Pipeline completed | run_id=%s | duration=%.2fs | retry_count=%d",
                run_id,
                elapsed,
                result.retry_count,
            )
            return result

        except Exception as e:
            elapsed = time.monotonic() - t0
            logger.exception(
                "Pipeline failed | run_id=%s | duration=%.2fs | error=%s",
                run_id,
                elapsed,
                str(e),
            )
            state.status = "failed"
            state.errors.append({"error": str(e), "trace": traceback.format_exc()})
            await self.store.save_state(state)
            raise
