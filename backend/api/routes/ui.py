"""Backend-for-frontend routes consumed by the React workspace.

These endpoints mirror `frontend/src/lib/api.ts` exactly. They return view
models (never raw pipeline JSON) built by `services/ui_projection.py`, so the
UI stays decoupled from agent internals.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.agents.a5_5_context_engineering import load_context_package
from backend.agents.repository_intelligence import INTELLIGENCE_STORE_KEY
from backend.api.deps import get_runner, get_settings_dep, get_store
from backend.config import Settings
from backend.orchestrator.runner import PipelineRunner
from backend.services.run_chat import answer_question
from backend.services.ui_projection import (
    SURFACE_V1,
    SURFACE_V2,
    build_agent_entries,
    build_executive_summary,
    build_repair_attempts,
    build_run_report,
    build_stage_progress,
    build_workspace_header,
    group_runs_by_repository,
    repo_display_name,
)
from backend.state.redis_store import RedisStore
from backend.state.schema import RunStateModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ui"])


class CreateRunBody(BaseModel):
    repo_path: str | None = Field(None, description="Local path to the target repo")
    url: str | None = Field(None, description="Repository URL, used when repo_path is absent")
    issue_hint: str | None = None


class ValidateRepoBody(BaseModel):
    url: str


class ChatBody(BaseModel):
    question: str


def _local_branch(path: Path) -> str | None:
    """Branch checked out at `path`, read straight from `.git/HEAD`."""
    try:
        head = (path / ".git" / "HEAD").read_text().strip()
    except OSError:
        return None
    if head.startswith("ref: refs/heads/"):
        return head.split("refs/heads/", 1)[1]
    return head[:7] or None


async def _load_run(store: RedisStore, run_id: str) -> RunStateModel:
    state = await store.load_state(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="Run not found")
    return state


async def _load_events(store: RedisStore, run_id: str):
    return await store.get_events(run_id, count=500)


async def _index_pointer(store: RedisStore, run_id: str) -> dict | None:
    """The repository-index pointer A0.5 published, when the layer ran.

    Read directly rather than through `load_repository_intelligence`: the header
    needs identity only, and following the pointer into the cross-run cache
    would deserialize the whole index on every header request.
    """
    try:
        pointer = await store.get_json(run_id, INTELLIGENCE_STORE_KEY)
    except Exception:  # noqa: BLE001 — identity is additive, never fatal
        logger.warning("index_pointer_read_failed", extra={"run_id": run_id})
        return None
    return pointer if isinstance(pointer, dict) else None


@router.get("/repositories")
async def list_repositories(store: Annotated[RedisStore, Depends(get_store)]) -> list[dict]:
    """Runs grouped by repository, most recent first — powers the sidebar."""
    run_ids = await store.list_run_ids(limit=100)
    states: list[RunStateModel] = []
    stale: list[str] = []
    for run_id in run_ids:
        state = await store.load_state(run_id)
        if state is None:
            stale.append(run_id)
            continue
        states.append(state)
    await store.prune_run_index(stale)
    return group_runs_by_repository(states)


@router.post("/repositories/validate")
async def validate_repository(body: ValidateRepoBody) -> dict:
    """Resolve a repo reference to display metadata without hitting GitHub."""
    raw = body.url.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Repository reference required")

    local = Path(raw).expanduser()
    if local.exists() and local.is_dir():
        return {
            "owner": local.resolve().parent.name,
            "name": local.resolve().name,
            "language": "Python" if any(local.rglob("*.py")) else None,
            # Read the checked-out branch rather than assuming "main".
            "branch": _local_branch(local) or "—",
            # A directory on disk has no visibility to report. Saying "Private"
            # stated something we never checked.
            "visibility": "Unknown",
            "htmlUrl": str(local.resolve()),
        }

    cleaned = raw.removesuffix(".git").rstrip("/")
    parts = [p for p in cleaned.replace("https://", "").replace("http://", "").split("/") if p]
    if len(parts) < 3 or "github.com" not in parts[0]:
        raise HTTPException(status_code=404, detail="Repository not found")

    owner, name = parts[1], parts[2]
    # Nothing here has contacted GitHub, so branch, language and visibility are
    # genuinely unknown. They were previously reported as "main"/"Public",
    # which was a guess presented as metadata.
    return {
        "owner": owner,
        "name": name,
        "language": None,
        "branch": None,
        "visibility": "Unknown",
        "htmlUrl": f"https://github.com/{owner}/{name}",
    }


@router.post("/runs")
async def create_run(
    body: CreateRunBody,
    background_tasks: BackgroundTasks,
    store: Annotated[RedisStore, Depends(get_store)],
    runner: Annotated[PipelineRunner, Depends(get_runner)],
) -> dict:
    target = body.repo_path or body.url
    if not target:
        raise HTTPException(status_code=400, detail="repo_path or url is required")

    run_id = str(uuid.uuid4())
    state = await store.init_run(run_id, target, body.issue_hint)
    background_tasks.add_task(runner.execute, run_id)
    return {
        "run_id": run_id,
        "runId": run_id,
        "status": "pending",
        "repository": repo_display_name(state),
    }


@router.get("/runs")
async def list_runs(store: Annotated[RedisStore, Depends(get_store)]) -> list[dict]:
    run_ids = await store.list_run_ids(limit=50)
    out: list[dict] = []
    for run_id in run_ids:
        state = await store.load_state(run_id)
        if state is None:
            continue
        events = await _load_events(store, run_id)
        out.append(build_workspace_header(state, events) | {"runId": run_id, "status": state.status})
    return out


@router.get("/runs/{run_id}")
async def get_run_header(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    state = await _load_run(store, run_id)
    events = await _load_events(store, run_id)
    pointer = await _index_pointer(store, run_id)
    lifecycle = await store.get_lifecycle_events(run_id)
    return build_workspace_header(state, events, pointer) | {
        "runId": state.run_id,
        "status": state.status,
        "currentAgent": state.current_agent,
        # The authoritative lifecycle record, so a client opening a finished run
        # learns how it ended without replaying the socket.
        "lifecycle": [e.model_dump(mode="json") for e in lifecycle],
    }


@router.get("/runs/{run_id}/summary")
async def get_run_summary(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    state = await _load_run(store, run_id)
    events = await _load_events(store, run_id)
    return build_executive_summary(state, events)


@router.get("/runs/{run_id}/agents")
async def get_run_agents(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
    surface: Annotated[
        str,
        Query(
            pattern="^(v1|v2)$",
            description=(
                "Which registry surface to publish. `v1` (default) returns the "
                "agents the workspace has cards for; `v2` returns the full "
                "pipeline. They differ by A5.5 alone — A0.5 joined the product "
                "surface in Phase 2 — and collapse to one value when it lands."
            ),
        ),
    ] = SURFACE_V1,
) -> list[dict]:
    state = await _load_run(store, run_id)
    events = await _load_events(store, run_id)
    return build_agent_entries(state, events, surface=surface)


@router.get("/runs/{run_id}/stages")
async def get_run_stages(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
    surface: Annotated[str, Query(pattern="^(v1|v2)$")] = SURFACE_V2,
) -> dict:
    """Stage → agent structure with each stage's live status.

    Published so no client hardcodes stage membership, ordering or labels; the
    registry is the single source of truth for all three.
    """
    state = await _load_run(store, run_id)
    events = await _load_events(store, run_id)
    return {
        "runId": run_id,
        "stages": build_stage_progress(state, events, surface=surface),
    }


@router.get("/runs/{run_id}/context")
async def get_run_context(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    """The context package A5.5 engineered for this run.

    Returns exactly what A5.5 stored — ranking, extracted symbols, redactions
    and measurements. Nothing is recomputed here, so a 404 means the stage has
    not produced a package yet, which is a fact the caller must render rather
    than a value to substitute.
    """
    await _load_run(store, run_id)
    package = await load_context_package(store, run_id)
    if package is None:
        raise HTTPException(
            status_code=404,
            detail="No context package for this run — A5.5 has not completed, or resolved no target",
        )
    return package.to_storage_dict()


@router.get("/runs/{run_id}/plan")
async def get_run_plan(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    """The repair plan A6 sequenced for this run.

    Returns `state.fix_dag` verbatim: fix nodes with their files and
    dependencies, the execution order, the dependency edges with the reason
    each was drawn, and the conflict batches. The agent projection publishes
    only counts and a six-node visualization, so this is the sole route by
    which the full plan reaches a client.

    Nothing is recomputed. A 404 means A6 has not produced a plan, which the
    caller renders as absent rather than substituting an empty one — an empty
    DAG and a stage that never ran are different facts.
    """
    state = await _load_run(store, run_id)
    if not state.fix_dag:
        raise HTTPException(
            status_code=404,
            detail="No repair plan for this run — A6 has not completed",
        )
    return state.fix_dag


@router.get("/runs/{run_id}/patch")
async def get_run_patch(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    """The patch bundle A7 generated for this run.

    Returns `state.patch_bundle` verbatim: every candidate with its original
    and patched source, the write method A7 actually used, the behavioural
    contracts it recorded, the unified diff it generated and the style exemplar
    commit it learned from. The agent projection publishes an eight-line diff
    preview and two filenames, so this is the sole route by which the full
    patch reaches a client.

    Nothing is recomputed or summarised — in particular the `method` field is
    passed through untouched, because it is what the integrity badges are
    allowed to claim. A 404 means A7 produced no bundle, which is a different
    fact from a bundle containing no patches: the first is "generation never
    completed", the second is "generation completed and changed nothing".
    """
    state = await _load_run(store, run_id)
    if not state.patch_bundle:
        raise HTTPException(
            status_code=404,
            detail="No patch bundle for this run — A7 has not completed",
        )
    return state.patch_bundle


@router.get("/runs/{run_id}/attempts")
async def get_repair_attempts(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    state = await _load_run(store, run_id)
    events = await _load_events(store, run_id)
    return build_repair_attempts(state, events)


@router.get("/runs/{run_id}/report")
async def get_run_report(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    state = await _load_run(store, run_id)
    events = await _load_events(store, run_id)
    return build_run_report(state, events)


@router.get("/runs/{run_id}/events")
async def get_run_events(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> list[dict]:
    """Raw agent timeline. The UI replays this before attaching the WebSocket."""
    await _load_run(store, run_id)
    events = await _load_events(store, run_id)
    return [e.model_dump(mode="json") for e in events]


@router.post("/runs/{run_id}/chat")
async def chat(
    run_id: str,
    body: ChatBody,
    store: Annotated[RedisStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict:
    state = await _load_run(store, run_id)
    answer = await answer_question(state, body.question, settings)
    return {"answer": answer}
