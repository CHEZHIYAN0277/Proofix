from backend.agents.base import AgentBase
from backend.models.blast import BlastGraphResult
from backend.models.sig import SemanticIntentGraph
from backend.services.blast_traversal import resolve_origins, traverse_multi_origin
from backend.state.schema import RunStateModel


class A5BlastGraphAgent(AgentBase):
    agent_id = "A5"

    async def run(self, state: RunStateModel) -> RunStateModel:
        await self.emit_status(state, "started", "Expanding blast graph scope")
        sig_data = state.sig or await self.store.get_json(state.run_id, "sig")
        root_cause = state.root_cause or {}
        citations = root_cause.get("citations", [])

        if not sig_data or not citations:
            result = BlastGraphResult(auto_patch_scope=[], scope=[], origins=[])
        else:
            sig = SemanticIntentGraph.model_validate(sig_data)
            origins = resolve_origins(citations)
            result = traverse_multi_origin(sig, origins)

        result_dict = result.model_dump(mode="json")
        state.blast_graph = result_dict
        state.human_review_files = result.human_review_required
        await self.emit_status(
            state,
            "completed",
            f"Blast scope: {len(result.auto_patch_scope)} files auto-patchable from {len(result.origins)} origins",
            {
                "scope_count": len(result.scope),
                "human_review": len(result.human_review_required),
                "origins": result.origins,
            },
        )
        return state
