"""Integration tests for the run API surfaces.

Exercises the real FastAPI app against a fake Redis: registry surfaces, the
context endpoint, stage progress, repository identity and lifecycle replay.

The `surface=v1|v2` parameter these tests exercise is an API contract, not a
second frontend — see the note above `SURFACE_V1` in `ui_projection.py`. The
frontend once called Workspace V2 was cancelled and removed; these endpoints
remain because they are backend capability the product uses or will use.

The governing rule these tests enforce is that absent data is reported as
absent. An endpoint that invents a value to avoid a 404 is the failure mode the
whole workspace is built to prevent.
"""

import fakeredis.aioredis
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from backend.agents.a5_5_context_engineering import CONTEXT_STORE_KEY
from backend.agents.repository_intelligence import INTELLIGENCE_STORE_KEY
from backend.config import Settings
from backend.main import create_app
from backend.models.context import ContextMetrics, ContextPackage, RankedContextFile, Redaction
from backend.models.fix_dag import DependencyEdge, FixDAGPlan, FixNode
from backend.models.patch import BehavioralContract, PatchBundle, PatchCandidate
from backend.state.events import AgentStatusEvent, RunLifecycleEvent
from backend.state.redis_store import RedisStore

RUN_ID = "d4c3b2a1-9f8e-7d6c-5b4a-3e2d1c0b9a88"
MISSING_RUN_ID = "00000000-0000-0000-0000-000000000000"


@pytest_asyncio.fixture
async def client():
    redis = fakeredis.aioredis.FakeRedis(decode_responses=False)
    app = create_app()
    app.state.redis = redis
    app.state.settings = Settings(stub_mode=True, redis_url="redis://localhost:6379/0")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http, RedisStore(redis, app.state.settings)
    await redis.aclose()


async def _seed_run(store: RedisStore, run_id: str = RUN_ID, status: str = "completed"):
    state = await store.init_run(run_id, "/tmp/clones/vulnapi")
    state.status = status
    state.base_commit_sha = "abc123"
    await store.save_state(state)
    return state


def _package() -> ContextPackage:
    return ContextPackage(
        target_file="vulnapi/auth.py",
        target_function="validate_token",
        root_cause_summary="expiry never compared",
        acceptance_criteria=["reject tokens whose exp is in the past"],
        ranked_files=[
            RankedContextFile(
                file="vulnapi/auth.py",
                score=1.8,
                reason="resolved target",
                confidence=0.9,
                signals={"stack_frame": 1.0, "verified_citation": 0.8},
                is_target=True,
            )
        ],
        redactions=[Redaction(file="vulnapi/config.py", line=3, detector="name_pattern")],
        privacy_guard_status="masked",
        metrics=ContextMetrics(
            files_ranked=42,
            context_files=2,
            context_functions=3,
            original_tokens=18000,
            reduced_tokens=2400,
            token_reduction=0.867,
            privacy_redactions=1,
        ),
    )


# -- G1: registry surfaces -------------------------------------------------


async def test_agents_endpoint_defaults_to_the_v1_surface(client):
    http, store = client
    await _seed_run(store)

    response = await http.get(f"/api/runs/{RUN_ID}/agents")
    assert response.status_code == 200

    agent_ids = [entry["agentId"] for entry in response.json()]
    # A5.5 is the one agent V1 still has no renderer for; handing it over would
    # add a card that never animates. A0.5 gained one in Phase 2.
    assert "A5.5" not in agent_ids
    assert "A0.5" in agent_ids
    assert "A1" in agent_ids


async def test_agents_endpoint_publishes_the_full_pipeline_on_v2(client):
    http, store = client
    await _seed_run(store)

    response = await http.get(f"/api/runs/{RUN_ID}/agents", params={"surface": "v2"})
    assert response.status_code == 200

    entries = response.json()
    agent_ids = [e["agentId"] for e in entries]
    assert "A0.5" in agent_ids
    assert "A5.5" in agent_ids
    for entry in entries:
        assert entry["stage"]
        assert entry["stageLabel"]
        assert isinstance(entry["stageOrder"], int)


async def test_unknown_surface_is_rejected(client):
    http, store = client
    await _seed_run(store)

    response = await http.get(f"/api/runs/{RUN_ID}/agents", params={"surface": "v3"})
    assert response.status_code == 422


async def test_stages_endpoint_publishes_the_workflow(client):
    http, store = client
    await _seed_run(store)

    response = await http.get(f"/api/runs/{RUN_ID}/stages")
    assert response.status_code == 200

    stages = response.json()["stages"]
    assert [s["id"] for s in stages] == [
        "repository", "investigation", "context", "planning", "patch", "validation", "learning",
    ]
    context_stage = next(s for s in stages if s["id"] == "context")
    assert [a["agentId"] for a in context_stage["agents"]] == ["A5.5"]
    assert context_stage["label"] == "Context Engineering"


async def test_stage_status_reflects_agent_events(client):
    http, store = client
    # A live run: `running` is only a truthful stage status while the run is
    # still in flight (R4).
    await _seed_run(store, status="running")
    await store.append_event(
        AgentStatusEvent(run_id=RUN_ID, agent_id="A1", status="completed", message="SIG built")
    )
    await store.append_event(
        AgentStatusEvent(run_id=RUN_ID, agent_id="A4", status="started", message="investigating")
    )

    stages = {s["id"]: s for s in (await http.get(f"/api/runs/{RUN_ID}/stages")).json()["stages"]}

    assert stages["investigation"]["status"] == "running"
    a1 = next(a for a in stages["repository"]["agents"] if a["agentId"] == "A1")
    assert a1["status"] == "completed"
    assert a1["message"] == "SIG built"


# -- G2: context endpoint --------------------------------------------------


async def test_context_endpoint_returns_the_stored_package(client):
    http, store = client
    await _seed_run(store)
    await store.set_json(RUN_ID, CONTEXT_STORE_KEY, _package().to_storage_dict())

    response = await http.get(f"/api/runs/{RUN_ID}/context")
    assert response.status_code == 200

    body = response.json()
    assert body["target_file"] == "vulnapi/auth.py"
    assert body["target_function"] == "validate_token"
    assert body["metrics"]["original_tokens"] == 18000
    assert body["metrics"]["reduced_tokens"] == 2400
    assert body["privacy_guard_status"] == "masked"
    # Ranking explainability is what the flagship stage is built on.
    assert body["ranked_files"][0]["signals"]["stack_frame"] == 1.0
    assert body["redactions"][0]["detector"] == "name_pattern"


async def test_context_endpoint_404s_when_no_package_exists(client):
    http, store = client
    await _seed_run(store)

    response = await http.get(f"/api/runs/{RUN_ID}/context")
    assert response.status_code == 404
    assert "context package" in response.json()["detail"].lower()


async def test_context_endpoint_404s_for_an_unknown_run(client):
    http, _store = client
    response = await http.get(f"/api/runs/{MISSING_RUN_ID}/context")
    assert response.status_code == 404


async def test_context_endpoint_does_not_recompute(client):
    """The endpoint reads; it never rebuilds. A stored package with impossible
    numbers must come back verbatim, proving nothing regenerated it."""
    http, store = client
    await _seed_run(store)
    package = _package()
    package.metrics.files_ranked = 999
    await store.set_json(RUN_ID, CONTEXT_STORE_KEY, package.to_storage_dict())

    body = (await http.get(f"/api/runs/{RUN_ID}/context")).json()
    assert body["metrics"]["files_ranked"] == 999


# -- Phase 5: repair plan endpoint -----------------------------------------


def _plan() -> FixDAGPlan:
    return FixDAGPlan(
        nodes=[
            FixNode(issue_id="cve-pyjwt", files=["requirements.txt"]),
            FixNode(issue_id="fix-auth", files=["vulnapi/auth.py"], depends_on=["cve-pyjwt"]),
            FixNode(issue_id="fix-routes", files=["vulnapi/auth.py", "vulnapi/routes.py"]),
        ],
        execution_order=["cve-pyjwt", "fix-auth", "fix-routes"],
        conflict_batches=[["fix-auth", "fix-routes"]],
        dependency_edges=[
            DependencyEdge(
                from_issue="cve-pyjwt",
                to_issue="fix-auth",
                reason="dependency upgrade precedes the code that imports it",
            )
        ],
    )


async def _seed_plan(store: RedisStore, plan: FixDAGPlan) -> None:
    state = await store.load_state(RUN_ID)
    assert state is not None
    state.fix_dag = plan.model_dump(mode="json")
    await store.save_state(state)


async def test_plan_endpoint_returns_the_stored_dag(client):
    http, store = client
    await _seed_run(store)
    await _seed_plan(store, _plan())

    response = await http.get(f"/api/runs/{RUN_ID}/plan")
    assert response.status_code == 200

    body = response.json()
    assert body["execution_order"] == ["cve-pyjwt", "fix-auth", "fix-routes"]
    assert body["conflict_batches"] == [["fix-auth", "fix-routes"]]
    # The per-edge reason and per-node files are the fields the agent
    # projection never publishes; the stage is unbuildable without them.
    assert body["dependency_edges"][0]["reason"].startswith("dependency upgrade")
    assert body["nodes"][1]["depends_on"] == ["cve-pyjwt"]
    assert body["nodes"][2]["files"] == ["vulnapi/auth.py", "vulnapi/routes.py"]


async def test_plan_endpoint_404s_before_a6_completes(client):
    http, store = client
    await _seed_run(store)

    response = await http.get(f"/api/runs/{RUN_ID}/plan")
    assert response.status_code == 404
    assert "repair plan" in response.json()["detail"].lower()


async def test_plan_endpoint_404s_for_an_unknown_run(client):
    http, _store = client
    response = await http.get(f"/api/runs/{MISSING_RUN_ID}/plan")
    assert response.status_code == 404


async def test_plan_endpoint_does_not_recompute(client):
    """A plan whose order contradicts its edges comes back unchanged — proof
    the route reads A6's output rather than re-deriving one."""
    http, store = client
    await _seed_run(store)
    plan = _plan()
    plan.execution_order = ["fix-auth", "cve-pyjwt", "fix-routes"]
    await _seed_plan(store, plan)

    body = (await http.get(f"/api/runs/{RUN_ID}/plan")).json()
    assert body["execution_order"] == ["fix-auth", "cve-pyjwt", "fix-routes"]


# -- Phase 6: patch bundle endpoint ----------------------------------------


def _bundle() -> PatchBundle:
    return PatchBundle(
        issue_id="fix-auth",
        patches=[
            PatchCandidate(
                file="vulnapi/auth.py",
                original="def validate_token(t):\n    return decode(t)\n",
                patched="def validate_token(t):\n    claims = decode(t)\n    check_exp(claims)\n    return claims\n",
                method="ast_validated_write",
            )
        ],
        contracts=[
            BehavioralContract(
                assertion="a token whose exp is in the past is rejected",
                location="vulnapi/auth.py::validate_token",
            )
        ],
        style_exemplar_commit="deadbeef",
        diff_text="--- a/vulnapi/auth.py\n+++ b/vulnapi/auth.py\n-    return decode(t)\n+    claims = decode(t)\n",
    )


async def _seed_bundle(store: RedisStore, bundle: PatchBundle) -> None:
    state = await store.load_state(RUN_ID)
    assert state is not None
    state.patch_bundle = bundle.model_dump(mode="json")
    await store.save_state(state)


async def test_patch_endpoint_returns_the_stored_bundle(client):
    http, store = client
    await _seed_run(store)
    await _seed_bundle(store, _bundle())

    response = await http.get(f"/api/runs/{RUN_ID}/patch")
    assert response.status_code == 200

    body = response.json()
    assert body["issue_id"] == "fix-auth"
    assert body["style_exemplar_commit"] == "deadbeef"
    # Original and patched source are the fields the agent projection never
    # publishes — it emits eight preview lines — so the diff view is
    # unbuildable without them.
    assert body["patches"][0]["original"].startswith("def validate_token")
    assert "check_exp" in body["patches"][0]["patched"]
    assert body["contracts"][0]["location"] == "vulnapi/auth.py::validate_token"
    assert body["diff_text"].startswith("--- a/vulnapi/auth.py")


async def test_patch_endpoint_passes_the_write_method_through(client):
    """The integrity badge may claim only what A7 stamped, so `method` has to
    survive the route unaltered — including a value the UI has no badge for."""
    http, store = client
    await _seed_run(store)
    bundle = _bundle()
    bundle.patches[0].method = "libcst"
    await _seed_bundle(store, bundle)

    body = (await http.get(f"/api/runs/{RUN_ID}/patch")).json()
    assert body["patches"][0]["method"] == "libcst"


async def test_patch_endpoint_404s_before_a7_completes(client):
    http, store = client
    await _seed_run(store)

    response = await http.get(f"/api/runs/{RUN_ID}/patch")
    assert response.status_code == 404
    assert "patch bundle" in response.json()["detail"].lower()


async def test_patch_endpoint_distinguishes_no_bundle_from_an_empty_one(client):
    """A7 completing with zero patches is a result, not an absence: every plan
    failed the integrity check. That has to reach the client as a 200 with an
    empty list, or the stage reports "not generated yet" for a run that did."""
    http, store = client
    await _seed_run(store)
    await _seed_bundle(store, PatchBundle(issue_id="fix-auth"))

    response = await http.get(f"/api/runs/{RUN_ID}/patch")
    assert response.status_code == 200
    assert response.json()["patches"] == []


async def test_patch_endpoint_404s_for_an_unknown_run(client):
    http, _store = client
    response = await http.get(f"/api/runs/{MISSING_RUN_ID}/patch")
    assert response.status_code == 404


# -- G4: repository metadata -----------------------------------------------


async def test_header_exposes_repository_identity(client):
    http, store = client
    await _seed_run(store)
    await store.set_json(
        RUN_ID,
        INTELLIGENCE_STORE_KEY,
        {"repository_id": "repo-abc", "head_sha": "cafebabe", "repository_hash": "h1"},
    )

    body = (await http.get(f"/api/runs/{RUN_ID}")).json()

    assert body["repositoryId"] == "repo-abc"
    assert body["headSha"] == "cafebabe"
    assert body["repositoryHash"] == "h1"
    assert body["repositoryName"]
    assert body["branch"]


async def test_header_identity_without_the_index_layer(client):
    http, store = client
    await _seed_run(store)

    body = (await http.get(f"/api/runs/{RUN_ID}")).json()

    # Derived identity is still published; the unobserved commit is not.
    assert body["repositoryId"]
    assert body["headSha"] == "abc123"  # the recorded base commit


async def test_header_keeps_the_v1_contract(client):
    http, store = client
    await _seed_run(store)

    body = (await http.get(f"/api/runs/{RUN_ID}")).json()
    for key in (
        "repository", "branch", "shortRunId", "retries",
        "executionTime", "decisionLabel", "runId", "status", "currentAgent",
    ):
        assert key in body, f"V1 header key {key} disappeared"


# -- G5: lifecycle ---------------------------------------------------------


async def test_header_replays_lifecycle_events(client):
    http, store = client
    await _seed_run(store)
    await store.append_lifecycle_event(RunLifecycleEvent(type="run.started", run_id=RUN_ID))
    await store.append_lifecycle_event(
        RunLifecycleEvent(
            type="run.completed", run_id=RUN_ID, decision="draft", decision_label="Draft PR"
        )
    )

    body = (await http.get(f"/api/runs/{RUN_ID}")).json()

    assert [e["type"] for e in body["lifecycle"]] == ["run.started", "run.completed"]
    assert body["lifecycle"][1]["decision"] == "draft"
    assert body["lifecycle"][1]["decision_label"] == "Draft PR"
    assert body["lifecycle"][0]["timestamp"]


async def test_lifecycle_is_empty_before_a_run_starts(client):
    http, store = client
    await _seed_run(store)
    body = (await http.get(f"/api/runs/{RUN_ID}")).json()
    assert body["lifecycle"] == []


async def test_agent_timeline_excludes_lifecycle_frames(client):
    http, store = client
    await _seed_run(store)
    await store.append_lifecycle_event(RunLifecycleEvent(type="run.started", run_id=RUN_ID))
    await store.append_event(
        AgentStatusEvent(run_id=RUN_ID, agent_id="A1", status="completed", message="done")
    )

    events = (await http.get(f"/api/runs/{RUN_ID}/events")).json()

    # V1 replays this endpoint and parses every frame as an agent event.
    assert [e["agent_id"] for e in events] == ["A1"]


# -- OpenAPI ---------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/runs/{run_id}/context",
        "/api/runs/{run_id}/plan",
        "/api/runs/{run_id}/patch",
        "/api/runs/{run_id}/stages",
        "/api/runs/{run_id}/agents",
    ],
)
async def test_new_routes_are_registered_in_openapi(client, path):
    http, _store = client
    schema = (await http.get("/openapi.json")).json()
    assert path in schema["paths"]
