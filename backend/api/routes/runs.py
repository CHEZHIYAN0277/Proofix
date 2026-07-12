import asyncio
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.api.deps import get_runner, get_settings_dep, get_store
from backend.config import Settings
from backend.orchestrator.runner import PipelineRunner
from backend.state.redis_store import RedisStore

router = APIRouter(prefix="/runs", tags=["runs"])

logger = logging.getLogger(__name__)


class CreateRunRequest(BaseModel):
    repo_path: str = Field(
        default="",
        description="Local path or URL to target repo",
    )
    repo_url: str = Field(
        default="",
        description="Alias for repo_path used by frontend",
    )
    issue_hint: str | None = Field(
        None,
        description="Optional hint for which bug to target",
    )


class CreateRunResponse(BaseModel):
    run_id: str
    status: str


class RunSummary(BaseModel):
    run_id: str
    status: str
    current_agent: str
    force_draft_pr: bool
    retry_count: int
    pr_decision: dict | None = None
    errors: list[dict] = Field(default_factory=list)


@router.post("", response_model=CreateRunResponse)
async def create_run(
    body: CreateRunRequest,
    background_tasks: BackgroundTasks,
    store: Annotated[RedisStore, Depends(get_store)],
    runner: Annotated[PipelineRunner, Depends(get_runner)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> CreateRunResponse:

    run_id = str(uuid.uuid4())

    repo = body.repo_url or body.repo_path

    if not repo:
        raise HTTPException(
            status_code=400,
            detail="repo_path or repo_url is required",
        )

    await store.init_run(
        run_id,
        repo,
        body.issue_hint,
    )

    if settings.use_render_workflows:
        from render_sdk import RenderAsync

        logger.info(
            "Starting Render Workflow | run_id=%s | workflow=%s",
            run_id,
            settings.render_workflow_slug,
        )

        try:
            render_client = RenderAsync(
                token=settings.render_api_key,
            )

            await render_client.workflows.start_task(
                settings.render_workflow_slug,
                [run_id],
            )

            logger.info(
                "Render Workflow submitted successfully | run_id=%s",
                run_id,
            )

        except Exception:
            logger.exception(
                "Failed to submit Render Workflow | run_id=%s",
                run_id,
            )

            raise HTTPException(
                status_code=500,
                detail="Failed to start Render Workflow.",
            )

    else:
        logger.info(
            "Executing locally using BackgroundTasks | run_id=%s",
            run_id,
        )

        background_tasks.add_task(
            runner.execute,
            run_id,
        )

    return CreateRunResponse(
        run_id=run_id,
        status="pending",
    )


@router.get("/{run_id}", response_model=RunSummary)
async def get_run(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> RunSummary:

    state = await store.load_state(run_id)

    if not state:
        raise HTTPException(
            status_code=404,
            detail="Run not found",
        )

    return RunSummary(
        run_id=state.run_id,
        status=state.status,
        current_agent=state.current_agent,
        force_draft_pr=state.force_draft_pr,
        retry_count=state.retry_count,
        pr_decision=state.pr_decision,
        errors=state.errors,
    )


@router.get("/{run_id}/sig")
async def get_sig(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:

    sig = await store.get_json(run_id, "sig")

    if sig is None:
        state = await store.load_state(run_id)

        if not state:
            raise HTTPException(
                status_code=404,
                detail="Run not found",
            )

        return state.sig or {}

    return sig


@router.get("/{run_id}/events")
async def get_events(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> list[dict]:

    state = await store.load_state(run_id)

    if not state:
        raise HTTPException(
            status_code=404,
            detail="Run not found",
        )

    events = await store.get_events(run_id)

    return [
        event.model_dump(mode="json")
        for event in events
    ]


@router.get("/{run_id}/proof/{issue_id}")
async def get_proof_bundle(
    run_id: str,
    issue_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:

    from pathlib import Path
    import json

    from backend.models.proof import VerificationBundle

    cached = await store.get_json(
        run_id,
        f"proof:{issue_id}",
    )

    if cached:
        return VerificationBundle.model_validate(
            cached
        ).model_dump(mode="json")

    state = await store.load_state(run_id)

    if not state:
        raise HTTPException(
            status_code=404,
            detail="Run not found",
        )

    if (
        state.proof_bundle
        and state.proof_bundle.get("issue_id") == issue_id
    ):
        return state.proof_bundle

    repo_path = state.repo_clone_path or state.repo_path

    proof_file = (
        Path(repo_path)
        / ".proof-of-fix"
        / f"{issue_id}.json"
    )

    if proof_file.exists():
        data = json.loads(
            proof_file.read_text(encoding="utf-8")
        )

        return VerificationBundle.model_validate(
            data
        ).model_dump(mode="json")

    raise HTTPException(
        status_code=404,
        detail="Proof bundle not found",
    )


# ── Agent output endpoints ──────────────────────────────────────────
# Read-only views over data already computed and persisted by agents.
# No recomputation — these pull directly from Redis.


@router.get("/{run_id}/cve")
async def get_cve_report(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    """Return CVE reachability report produced by A2 (Dependency Analyzer)."""

    cached = await store.get_json(run_id, "cve")

    if cached is not None:
        return cached

    state = await store.load_state(run_id)

    if not state:
        raise HTTPException(
            status_code=404,
            detail="Run not found",
        )

    return state.cve_report or {}


@router.get("/{run_id}/static")
async def get_static_report(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    """Return consensus static analysis report produced by A3."""

    cached = await store.get_json(run_id, "static")

    if cached is not None:
        return cached

    state = await store.load_state(run_id)

    if not state:
        raise HTTPException(
            status_code=404,
            detail="Run not found",
        )

    return state.static_report or {}


@router.get("/{run_id}/blast")
async def get_blast_graph(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    """Return blast radius graph produced by A5."""

    state = await store.load_state(run_id)

    if not state:
        raise HTTPException(
            status_code=404,
            detail="Run not found",
        )

    return state.blast_graph or {}


@router.get("/{run_id}/fix-plan")
async def get_fix_plan(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    """Return ordered fix DAG produced by A6 (Repair Planner)."""

    state = await store.load_state(run_id)

    if not state:
        raise HTTPException(
            status_code=404,
            detail="Run not found",
        )

    return state.fix_dag or {}


@router.get("/{run_id}/patches")
async def get_patches(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    """Return generated patch bundle produced by A7 (Code Generation)."""

    cached = await store.get_json(run_id, "patches")

    if cached is not None:
        return cached

    state = await store.load_state(run_id)

    if not state:
        raise HTTPException(
            status_code=404,
            detail="Run not found",
        )

    return state.patch_bundle or {}


@router.get("/{run_id}/human-review")
async def get_human_review_files(
    run_id: str,
    store: Annotated[RedisStore, Depends(get_store)],
) -> dict:
    """Return files flagged for human review by A5 (Blast Radius)."""

    state = await store.load_state(run_id)

    if not state:
        raise HTTPException(
            status_code=404,
            detail="Run not found",
        )

    return {
        "run_id": run_id,
        "files": state.human_review_files or [],
    }