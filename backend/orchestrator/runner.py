import traceback

from langgraph.checkpoint.memory import MemorySaver

from backend.config import Settings
from backend.orchestrator.graph import build_graph
from backend.state.redis_store import RedisStore
from backend.state.schema import RunStateModel


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

        config = {"configurable": {"thread_id": run_id}}
        initial = state.model_dump(exclude_none=False)

        try:
            final = await self.graph.ainvoke(initial, config)
            result = RunStateModel(**{k: v for k, v in final.items() if k in RunStateModel.model_fields})
            if result.status != "completed":
                result.status = "completed"
            await self.store.save_state(result)
            return result
        except Exception as e:
            state.status = "failed"
            state.errors.append({"error": str(e), "trace": traceback.format_exc()})
            await self.store.save_state(state)
            raise
