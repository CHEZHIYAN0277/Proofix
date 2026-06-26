from langgraph.graph import END, StateGraph

from backend.config import Settings
from backend.orchestrator.edges import after_mutation, after_security, should_reinvestigate
from backend.orchestrator.nodes import GraphNodes
from backend.state.redis_store import RedisStore
from backend.state.schema import RunState


def _model_to_dict(state: RunState) -> dict:
    return dict(state)


async def _wrap(fn, state: RunState) -> RunState:
    result = await fn(state)
    if isinstance(result, dict):
        return result
    return result.model_dump(exclude_none=False)  # type: ignore[union-attr]


def build_graph(store: RedisStore, settings: Settings) -> StateGraph:
    nodes = GraphNodes(store, settings)

    graph = StateGraph(RunState)

    async def prepare_repo(state: RunState) -> RunState:
        from backend.state.schema import RunStateModel
        model = RunStateModel(**{k: v for k, v in state.items() if k in RunStateModel.model_fields})
        result = await nodes.prepare_repo(model)
        return result.model_dump(exclude_none=False)

    async def parallel_intel(state: RunState) -> RunState:
        model = await _load_model(store, state)
        result = await nodes.parallel_intel(model)
        return result.model_dump(exclude_none=False)

    async def layer1_fan_in(state: RunState) -> RunState:
        model = await _load_model(store, state)
        result = await nodes.layer1_fan_in(model)
        return result.model_dump(exclude_none=False)

    async def reproduction_gate(state: RunState) -> RunState:
        model = await _load_model(store, state)
        result = await nodes.reproduction_gate(model)
        return result.model_dump(exclude_none=False)

    async def investigate(state: RunState) -> RunState:
        model = await _load_model(store, state)
        result = await nodes.investigate(model)
        return result.model_dump(exclude_none=False)

    async def blast_scope(state: RunState) -> RunState:
        model = await _load_model(store, state)
        result = await nodes.blast_scope(model)
        return result.model_dump(exclude_none=False)

    async def plan_fixes(state: RunState) -> RunState:
        model = await _load_model(store, state)
        result = await nodes.plan_fixes(model)
        return result.model_dump(exclude_none=False)

    async def generate_code(state: RunState) -> RunState:
        model = await _load_model(store, state)
        model.retry_count = state.get("retry_count", model.retry_count)
        model.retry_brief = state.get("retry_brief")
        result = await nodes.generate_code(model)
        return result.model_dump(exclude_none=False)

    async def increment_retry(state: RunState) -> RunState:
        model = await _load_model(store, state)
        model.retry_count += 1
        model.status = "validation_retry"
        await store.save_state(model)
        return model.model_dump(exclude_none=False)

    async def validate_mutation(state: RunState) -> RunState:
        model = await _load_model(store, state)
        result = await nodes.validate_mutation(model)
        return result.model_dump(exclude_none=False)

    async def validate_security(state: RunState) -> RunState:
        model = await _load_model(store, state)
        result = await nodes.validate_security(model)
        return result.model_dump(exclude_none=False)

    async def route_pr(state: RunState) -> RunState:
        from backend.orchestrator.trust_gating import apply_trust_gates_before_pr

        model = await _load_model(store, state)
        model = apply_trust_gates_before_pr(model, settings.max_retries)
        await store.save_state(model)
        result = await nodes.route_pr(model)
        return result.model_dump(exclude_none=False)

    graph.add_node("prepare_repo", prepare_repo)
    graph.add_node("parallel_intel", parallel_intel)
    graph.add_node("layer1_fan_in", layer1_fan_in)
    graph.add_node("reproduction_gate", reproduction_gate)
    graph.add_node("investigate", investigate)
    graph.add_node("blast_scope", blast_scope)
    graph.add_node("plan_fixes", plan_fixes)
    graph.add_node("generate_code", generate_code)
    graph.add_node("increment_retry", increment_retry)
    graph.add_node("validate_mutation", validate_mutation)
    graph.add_node("validate_security", validate_security)
    graph.add_node("route_pr", route_pr)

    graph.set_entry_point("prepare_repo")
    graph.add_edge("prepare_repo", "parallel_intel")
    graph.add_edge("parallel_intel", "layer1_fan_in")
    graph.add_edge("layer1_fan_in", "reproduction_gate")
    graph.add_edge("reproduction_gate", "investigate")
    graph.add_conditional_edges("investigate", should_reinvestigate, {
        "investigate": "investigate",
        "blast_scope": "blast_scope",
    })
    graph.add_edge("blast_scope", "plan_fixes")
    graph.add_edge("plan_fixes", "generate_code")
    graph.add_edge("generate_code", "validate_mutation")

    def mutation_router(state: RunState) -> str:
        result = after_mutation(state)
        if result == "generate_code":
            return "increment_retry"
        return result

    graph.add_conditional_edges("validate_mutation", mutation_router, {
        "validate_security": "validate_security",
        "increment_retry": "increment_retry",
        "route_pr": "route_pr",
    })
    graph.add_edge("increment_retry", "generate_code")

    def security_router(state: RunState) -> str:
        result = after_security(state)
        if result == "generate_code":
            return "increment_retry"
        return "route_pr"

    graph.add_conditional_edges("validate_security", security_router, {
        "route_pr": "route_pr",
        "increment_retry": "increment_retry",
    })
    graph.add_edge("route_pr", END)

    return graph


async def _load_model(store: RedisStore, state: RunState):
    from backend.state.schema import RunStateModel
    loaded = await store.load_state(state["run_id"])
    if loaded:
        for k, v in state.items():
            if v is not None and k in RunStateModel.model_fields:
                setattr(loaded, k, v)
        return loaded
    return RunStateModel(**{k: v for k, v in state.items() if k in RunStateModel.model_fields})
