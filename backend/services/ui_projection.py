"""Project internal pipeline state onto the frontend's view models.

The UI never sees raw pipeline JSON. This module is the single translation
layer between `RunStateModel` / `AgentStatusEvent` and the typed models the
React app consumes (see `frontend/src/mocks/runReport.ts` and
`frontend/src/components/proofix/data.ts`).

Keeping the mapping here means agents stay free to change their internal
payloads without breaking the UI contract.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, NamedTuple

from backend.agents.a10_routing import SCORE_THRESHOLD
from backend.state.events import AgentStatusEvent
from backend.services.measurement import measured_mean
from backend.state.schema import RunStateModel

# ---------------------------------------------------------------- registry --


class StageDefinition(NamedTuple):
    """One workflow stage. Stages group agents into the story the UI tells."""

    id: str
    label: str
    order: int
    purpose: str


# The workflow the pipeline actually executes, grouped for presentation. Order
# is the order a run passes through them. `learning` runs outside the agent
# graph (the learning pipeline observes a run), so it owns no agents — an empty
# agent list is a fact about the stage, not a gap.
STAGE_REGISTRY: list[StageDefinition] = [
    StageDefinition(
        "repository",
        "Repository Understanding",
        1,
        "Build a structural and semantic model of the repository.",
    ),
    StageDefinition(
        "investigation",
        "Investigation",
        2,
        "Reproduce the failure and establish its cause with evidence.",
    ),
    StageDefinition(
        "context",
        "Context Engineering",
        3,
        "Reduce the repository to the minimal, privacy-checked repair context.",
    ),
    StageDefinition(
        "planning",
        "Repair Planning",
        4,
        "Order the repair work by dependency.",
    ),
    StageDefinition(
        "patch",
        "Repair Generation",
        5,
        "Generate repository-safe patches.",
    ),
    StageDefinition(
        "validation",
        "Validation",
        6,
        "Prove the repair works and decide whether it deserves merging.",
    ),
    StageDefinition(
        "learning",
        "Learning",
        7,
        "Fold the outcome into repository and organization memory.",
    ),
]

STAGE_BY_ID = {stage.id: stage for stage in STAGE_REGISTRY}

# Which surface an agent is published to.
#
# NOTE ON THE NAME: the frontend once called "Workspace V2" was cancelled and
# deleted. These two values are an **API contract** — the `surface` query
# parameter on `/agents` and `/stages` — and nothing here asks anyone to build
# a second frontend. Read them as:
#
#   "v1" — the product surface: the agent cards the workspace renders today
#          (`frontend/src/components/proofix`).
#   "v2" — the full-pipeline surface: every agent the graph executes, including
#          A0.5 and A5.5, which the product surface has no card for yet.
#
# The full-pipeline surface is retained because it is the only thing publishing
# A0.5 and A5.5, which genuinely run. Collapsing the two — by giving the product
# surface cards for those agents — is tracked as product work, not done here,
# because it changes what the workspace renders.
SURFACE_V1 = "v1"
SURFACE_V2 = "v2"
_BOTH = frozenset({SURFACE_V1, SURFACE_V2})
_V2_ONLY = frozenset({SURFACE_V2})


class AgentDefinition(NamedTuple):
    """One agent as the UI knows it.

    A `NamedTuple` so existing positional unpacking of the first five fields
    keeps working while new consumers read by name.
    """

    card: str
    agent_id: str
    name: str
    purpose: str
    handoff: str
    stage: str
    surfaces: frozenset[str]


# The single source of truth for agent identity, ordering and stage membership.
# Nothing downstream — backend or frontend — may hardcode this mapping.
AGENT_REGISTRY: list[AgentDefinition] = [
    AgentDefinition(
        "environment",
        "A0.7",
        "Environment Precheck",
        "Establish whether this repository's tests can execute here.",
        "Environment Report",
        "repository",
        _BOTH,
    ),
    AgentDefinition(
        "intelligence",
        "A0.5",
        "Repository Indexing",
        "Index the repository into a reusable knowledge graph.",
        "Repository Index",
        "repository",
        _V2_ONLY,
    ),
    AgentDefinition(
        "repo-intel",
        "A1",
        "Repository Intelligence",
        "Understand repository structure before any repair.",
        "Semantic Graph",
        "repository",
        _BOTH,
    ),
    AgentDefinition(
        "deps",
        "A2",
        "Dependency Analyzer",
        "Determine whether vulnerabilities are actually reachable.",
        "Reachability Map",
        "repository",
        _BOTH,
    ),
    AgentDefinition(
        "static",
        "A3",
        "Static Analysis",
        "Combine multiple analyzers into one prioritized report.",
        "Prioritized Findings",
        "repository",
        _BOTH,
    ),
    AgentDefinition(
        "reproduce",
        "A3.5",
        "Failure Reproduction",
        "Verify the reported bug actually exists.",
        "Runtime Evidence",
        "investigation",
        _BOTH,
    ),
    AgentDefinition(
        "root",
        "A4",
        "Root Cause Analysis",
        "Determine why the bug occurred, with cited evidence.",
        "Root Cause",
        "investigation",
        _BOTH,
    ),
    AgentDefinition(
        "blast",
        "A5",
        "Blast Radius",
        "Understand repository-wide impact of the change.",
        "Impact Set",
        "investigation",
        _BOTH,
    ),
    AgentDefinition(
        "context",
        "A5.5",
        "Context Engineering",
        "Reduce the repository to the minimal context a repair needs.",
        "Context Package",
        "context",
        _V2_ONLY,
    ),
    AgentDefinition(
        "planner",
        "A6",
        "Repair Planner",
        "Create a dependency-aware repair order.",
        "Repair DAG",
        "planning",
        _BOTH,
    ),
    AgentDefinition(
        "patch",
        "A7",
        "Patch Generator",
        "Generate repository-safe patches.",
        "Patch Candidate",
        "patch",
        _BOTH,
    ),
    AgentDefinition(
        "mutation",
        "A8",
        "Mutation Validation",
        "Verify repair correctness beyond a passing test.",
        "Validation Report",
        "validation",
        _BOTH,
    ),
    AgentDefinition(
        "security",
        "A9",
        "Security Re-scan",
        "Ensure the patch introduced no new vulnerabilities.",
        "Security Delta",
        "validation",
        _BOTH,
    ),
    AgentDefinition(
        "merge",
        "A10",
        "Mergeability Assessment",
        "Determine whether the repair deserves merging.",
        "PR Decision",
        "validation",
        _BOTH,
    ),
]

CARD_BY_BACKEND_ID = {a.agent_id: a.card for a in AGENT_REGISTRY}
BACKEND_BY_CARD_ID = {a.card: a.agent_id for a in AGENT_REGISTRY}
AGENT_BY_CARD_ID = {a.card: a for a in AGENT_REGISTRY}
AGENT_BY_BACKEND_ID = {a.agent_id: a for a in AGENT_REGISTRY}


def agents_for_surface(surface: str = SURFACE_V1) -> list[AgentDefinition]:
    """Registry entries published to one surface, in pipeline order."""
    return [a for a in AGENT_REGISTRY if surface in a.surfaces]


def build_stage_registry(surface: str = SURFACE_V2) -> list[dict]:
    """The stage → agent structure the workspace navigates by.

    Published so no client hardcodes stage membership, ordering or labels. A
    stage with no agents on this surface still appears: `learning` runs outside
    the agent graph, and omitting it would misrepresent the workflow.
    """
    published = agents_for_surface(surface)
    return [
        {
            "id": stage.id,
            "label": stage.label,
            "order": stage.order,
            "purpose": stage.purpose,
            "agents": [
                {
                    "id": agent.card,
                    "agentId": agent.agent_id,
                    "name": agent.name,
                    "purpose": agent.purpose,
                    "handoff": agent.handoff,
                }
                for agent in published
                if agent.stage == stage.id
            ],
        }
        for stage in sorted(STAGE_REGISTRY, key=lambda s: s.order)
    ]


_SEVERITY_BY_SCORE = ((0.9, "CRITICAL"), (0.7, "HIGH"), (0.4, "MEDIUM"))


# ------------------------------------------------------------------ helpers --


def short_run_id(run_id: str) -> str:
    """Render a run id the way the UI header expects: `11b8…3a91`."""
    compact = run_id.replace("-", "")
    if len(compact) <= 8:
        return compact
    return f"{compact[:4]}…{compact[-4:]}"


def _fmt_duration(seconds: float) -> str:
    if seconds <= 0:
        return "—"
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, rest = divmod(int(seconds), 60)
    return f"{minutes}m {rest}s"


def _relative_time(moment: datetime | None) -> str:
    if moment is None:
        return "—"
    delta = (datetime.utcnow() - moment).total_seconds()
    if delta < 60:
        return "just now"
    if delta < 3600:
        return f"{int(delta // 60)}m ago"
    if delta < 86400:
        return f"{int(delta // 3600)}h ago"
    return f"{int(delta // 86400)}d ago"


def _pct(value: Any, default: float = 0.0) -> float:
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return default


def _score(value: Any) -> float | None:
    """A score, or `None` when it was never measured.

    The nullable counterpart to `_pct`. `_pct` substitutes `0.0` for anything
    unparseable, which is right for a value that is genuinely zero and wrong for
    one that does not exist — a security re-scan that never ran was reported as
    scoring 0%, and that fabricated zero was averaged into the trust score.

    Use this for anything the pipeline may not have measured. `_pct` remains for
    values already coerced upstream (confidences, counts).
    """
    if value is None:
        return None
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


def _score_text(value: Any) -> str:
    """A score for display, never inventing a number."""
    scored = _score(value)
    return "Not measured" if scored is None else f"{scored:g}"


def _tone(value: float | None) -> str:
    # "ok" is tied to the gate A10 actually applies, so a green ring never
    # disagrees with the router's own verdict on the same number.
    #
    # An unmeasured axis is deliberately neither "ok" nor "bad": it has not
    # scored well and it has not scored badly. Painting it red said the run
    # failed a check that never ran.
    if value is None:
        return "unknown"
    if value >= SCORE_THRESHOLD:
        return "ok"
    if value >= SCORE_THRESHOLD * 0.75:
        return "warn"
    return "bad"


def repo_branch(state: RunStateModel) -> str:
    """The branch actually checked out in the target repo.

    Every view model used to report "main" regardless of what the run operated
    on, which is wrong the moment anyone points ProoFix at a feature branch.
    Read from `.git/HEAD` directly — no subprocess, and it works on a bare path
    as well as a clone.
    """
    for candidate in (state.repo_clone_path, state.repo_path):
        if not candidate:
            continue
        try:
            head = (Path(candidate).expanduser() / ".git" / "HEAD").read_text().strip()
        except OSError:
            continue
        if head.startswith("ref: refs/heads/"):
            return head.split("refs/heads/", 1)[1]
        if head:
            # Detached HEAD — the commit is the most honest thing to show.
            return head[:7]
    return "—"


def repo_display_name(state: RunStateModel) -> str:
    raw = (state.repo_path or "").rstrip("/")
    if not raw:
        return "repository"
    tail = raw.split("/")[-1]
    return tail.replace(".git", "") or "repository"


def run_decision(state: RunStateModel) -> tuple[str, str]:
    """Return (decision, human label) in the UI's vocabulary."""
    if state.status == "failed":
        return "failed", "Failed"
    # A blocked run is not a failure and not a routing outcome. It never
    # produced a patch, so there is no PR type to read — reporting "Pending"
    # here (the old fallthrough) implied work still in progress.
    if state.status == "blocked":
        return "blocked", "Environment not prepared"
    decision = (state.pr_decision or {}).get("pr_type")
    if decision == "auto_mergeable":
        return "merge", "Auto Merge"
    if decision == "diff_only":
        return "draft", "Diff Only"
    if decision == "draft":
        return "draft", "Draft PR"
    return "draft", "Pending"


def sidebar_status(state: RunStateModel) -> str:
    if state.status == "failed":
        return "failed"
    if state.status == "blocked":
        return "blocked"
    if state.status in ("pending", "running", "validation_retry"):
        return "running"
    decision, _label = run_decision(state)
    if decision == "merge":
        return "completed"
    if decision == "failed":
        return "failed"
    return "draft"


def run_display_name(state: RunStateModel) -> str:
    """Name a run after what it actually repaired."""
    root = state.root_cause or {}
    summary = (root.get("root_cause") or root.get("summary") or "").strip()
    if summary:
        return summary.split(".")[0][:44] or "Repository Analysis"
    repro = state.reproduction or {}
    if repro.get("failing_test"):
        return str(repro["failing_test"]).split("::")[-1][:44]
    return "Repository Analysis"


def total_attempts(state: RunStateModel) -> int:
    """Patch attempts made: the initial one plus every retry."""
    return state.retry_count + 1


def elapsed_seconds(state: RunStateModel, events: list[AgentStatusEvent]) -> float:
    if not events:
        return 0.0
    start = min(e.timestamp for e in events)
    end = max(e.timestamp for e in events)
    return max(0.0, (end - start).total_seconds())


# ------------------------------------------------------------- agent cards --


def _event_index(events: list[AgentStatusEvent]) -> dict[str, list[AgentStatusEvent]]:
    grouped: dict[str, list[AgentStatusEvent]] = {}
    for event in events:
        grouped.setdefault(event.agent_id, []).append(event)
    return grouped


# `blocked` is terminal: the run is over and nothing further will be emitted.
# Omitting it left downstream stages rendering as still-running forever.
RUN_TERMINAL_STATES = ("completed", "failed", "blocked")


def _agent_status(events_for_agent: list[AgentStatusEvent], state: RunStateModel, card: str) -> str:
    if not events_for_agent:
        # A finished run that never reached this agent routed around it — e.g.
        # the security re-scan is skipped when mutation validation fails.
        return "skipped" if state.status in RUN_TERMINAL_STATES else "running"
    latest = events_for_agent[-1]
    if latest.status == "failed":
        return "failed"
    if latest.status != "completed":
        return "running"

    if card == "mutation":
        mutation = state.mutation_result or {}
        if mutation.get("patch_retry_required") or mutation.get("mutant_survived"):
            return "retry"
        if mutation.get("pytest_passed") is False:
            return "failed"
    if card == "security" and (state.security_result or {}).get("rejected"):
        return "failed"
    if card == "merge":
        decision, _label = run_decision(state)
        return "draft" if decision == "draft" else "completed"
    return "completed"


def _agent_duration(events_for_agent: list[AgentStatusEvent]) -> str:
    if len(events_for_agent) < 2:
        return "—"
    span = (events_for_agent[-1].timestamp - events_for_agent[0].timestamp).total_seconds()
    return _fmt_duration(span) if span > 0 else "—"


def _lines_for(card: str, state: RunStateModel, events_for_agent: list[AgentStatusEvent]) -> list[str]:
    """Narrate what the agent did, from its own emitted messages plus state."""
    lines = [e.message for e in events_for_agent if e.message]
    detail = _narrative_detail(card, state)
    if lines or detail:
        return lines + detail
    if state.status in RUN_TERMINAL_STATES:
        return ["Skipped — the pipeline routed around this stage."]
    return ["Waiting to start…"]


def _narrative_detail(card: str, state: RunStateModel) -> list[str]:
    if card == "environment":
        # The probe's own words. A blocked run's entire explanation is this
        # `reason`, so it is rendered verbatim rather than re-composed here.
        env = state.environment or {}
        if not env:
            return []
        detail = [f"Language: {env.get('language') or 'undetermined'}."]
        runner = env.get("test_runner")
        if runner:
            available = env.get("test_runner_available")
            detail.append(
                f"Test runner {runner} "
                + ("is available." if available else "is not available.")
            )
        reason = env.get("reason")
        if reason:
            detail.append(str(reason))
        command = env.get("suggested_command")
        if command:
            detail.append(f"Suggested command: {command}")
        return detail

    if card == "repo-intel":
        sig = state.sig or {}
        files = sig.get("files") or {}
        roots = ", ".join(sig.get("source_roots") or []) or "repository root"
        return [
            f"Discovered source roots: {roots}.",
            f"Indexed {len(files)} production files.",
            f"Mapped {len(sig.get('edges') or [])} import edges.",
        ] if files else []

    if card == "deps":
        cve = state.cve_report or {}
        findings = cve.get("findings") or []
        critical = cve.get("critical_queue") or []
        unknown = [f for f in findings if f.get("classification") == "Unknown"]
        return [
            f"Screened {len(findings)} advisories against the import graph.",
            f"{len(critical)} reachable, {len(unknown)} undetermined.",
        ] if findings else ["No vulnerable dependencies detected."]

    if card == "static":
        static = state.static_report or {}
        prioritized = static.get("prioritized") or []
        return [
            f"Collapsed {static.get('raw_count', 0)} raw findings to {len(prioritized)} prioritized.",
        ] if static else []

    if card == "reproduce":
        repro = state.reproduction or {}
        status = repro.get("status")
        if status == "CONFIRMED":
            return [
                f"Failing test: {repro.get('failing_test')}",
                f"{repro.get('exception_type') or 'Failure'}: {repro.get('exception_message') or 'assertion failed'}",
                "Runtime evidence captured.",
            ]
        if status:
            return [f"Reproduction not confirmed ({status}). Repair will be routed for manual review."]
        return []

    if card == "root":
        root = state.root_cause or {}
        citations = root.get("citations") or []
        verified = [c for c in citations if c.get("verified")]
        out = []
        if root.get("root_cause"):
            out.append(str(root["root_cause"])[:220])
        if citations:
            out.append(f"{len(verified)}/{len(citations)} citations verified against source.")
        return out

    if card == "blast":
        blast = state.blast_graph or {}
        scope = blast.get("auto_patch_scope") or []
        review = blast.get("human_review_required") or []
        return [
            f"{len(scope)} files auto-patchable, {len(review)} need human review.",
        ] if blast else []

    if card == "planner":
        dag = state.fix_dag or {}
        order = dag.get("execution_order") or []
        return [
            f"Sequenced {len(order)} repair steps across {len(dag.get('dependency_edges') or [])} dependency edges.",
        ] if order else []

    if card == "patch":
        bundle = state.patch_bundle or {}
        patches = bundle.get("patches") or []
        return [f"Modified {p.get('file')}" for p in patches] if patches else []

    if card == "mutation":
        mutation = state.mutation_result or {}
        out = []
        if mutation.get("target_test_passed") is not None:
            out.append(
                "Target test passes after patch."
                if mutation["target_test_passed"]
                else "Target test still failing after patch."
            )
        if mutation.get("new_failures"):
            out.append(f"{len(mutation['new_failures'])} new regressions introduced.")
        if mutation.get("mutant_survived"):
            out.append("A mutant survived — the test passes without validating the fix.")
        return out

    if card == "security":
        security = state.security_result or {}
        new_findings = security.get("new_findings") or []
        if not security:
            return []
        # A9 having produced a result is not the same as A9 having measured
        # one. With no scanner available it finds zero findings by definition,
        # and "no new findings" would read as a clean bill of health.
        if security.get("security_score") is None:
            return ["No scanner was available, so the patch was not re-scanned."]
        return [
            f"{len(new_findings)} new findings versus the pre-patch baseline."
            if new_findings
            else "No new findings versus the pre-patch baseline."
        ]

    if card == "merge":
        decision, label = run_decision(state)
        note = (state.pr_decision or {}).get("review_note")
        out = [f"Routed as {label}."]
        if note:
            out.append(str(note))
        return out

    return []


def _latest_payload(events_for_agent: list[AgentStatusEvent], key: str) -> dict:
    """The most recent payload section an agent published, or an empty dict.

    A0.5 and A5.5 publish their measurements on the event rather than onto
    `RunStateModel`, so their cards read from the timeline. Absent means the
    agent has not reached that point — never a substituted default.
    """
    for event in reversed(events_for_agent):
        section = (event.payload or {}).get(key)
        if isinstance(section, dict):
            return section
    return {}


def _metrics_for(
    card: str,
    state: RunStateModel,
    duration: str,
    events_for_agent: list[AgentStatusEvent] | None = None,
) -> list[dict]:
    def metric(label: str, value: Any) -> dict:
        return {"label": label, "value": str(value)}

    events_for_agent = events_for_agent or []

    if card == "environment":
        env = state.environment or {}
        if not env:
            return [metric("Duration", duration)]
        return [
            metric("Environment", env.get("status") or "unknown"),
            metric("Language", env.get("language") or "—"),
            metric("Test Runner", env.get("test_runner") or "—"),
            metric("Blocking", "yes" if env.get("blocking") else "no"),
        ]

    if card == "intelligence":
        published = _latest_payload(events_for_agent, "repository_intelligence")
        if not published:
            return [metric("Duration", duration)]
        cache = published.get("cache") or {}
        return [
            metric("Graph Nodes", published.get("repository_nodes", 0)),
            metric("Graph Edges", published.get("repository_edges", 0)),
            metric("Callables", published.get("call_graph_nodes", 0)),
            metric("Commits Indexed", published.get("git_commits_indexed", 0)),
            metric("Remembered Repairs", published.get("repair_memory_entries", 0)),
            metric("Cache Hits", cache.get("hits", published.get("cache_hits", 0))),
            metric("Index Build", _fmt_duration((published.get("total_ms") or 0) / 1000)),
            metric("Duration", duration),
        ]

    if card == "context":
        published = _latest_payload(events_for_agent, "context_engineering")
        if not published or published.get("skipped"):
            return [metric("Duration", duration)]
        reduction = published.get("token_reduction")
        return [
            metric("Files Ranked", published.get("files_ranked", 0)),
            metric("Context Files", published.get("context_files", 0)),
            metric("Context Functions", published.get("context_functions", 0)),
            metric(
                "Token Reduction",
                f"{float(reduction) * 100:.0f}%" if reduction is not None else "—",
            ),
            metric("Prompt Tokens", published.get("estimated_prompt_tokens", 0)),
            metric("Redactions", published.get("privacy_redactions", 0)),
            metric("Privacy Guard", published.get("privacy_guard_status", "—")),
            metric("Duration", duration),
        ]

    if card == "repo-intel":
        sig = state.sig or {}
        files = sig.get("files") or {}
        return [
            metric("Files", len(files)),
            metric("Import Edges", len(sig.get("edges") or [])),
            metric("Source Roots", len(sig.get("source_roots") or [])),
            metric("Duration", duration),
        ]
    if card == "deps":
        cve = state.cve_report or {}
        findings = cve.get("findings") or []
        return [
            metric("Advisories", len(findings)),
            metric("Reachable", len(cve.get("critical_queue") or [])),
            metric("Unknown", sum(1 for f in findings if f.get("classification") == "Unknown")),
            metric("Duration", duration),
        ]
    if card == "static":
        static = state.static_report or {}
        prioritized = static.get("prioritized") or []
        return [
            metric("Raw Findings", static.get("raw_count", 0)),
            metric("Prioritized", len(prioritized)),
            metric("Consensus", sum(1 for f in prioritized if f.get("consensus"))),
            metric("Duration", duration),
        ]
    if card == "reproduce":
        repro = state.reproduction or {}
        return [
            metric("Status", repro.get("status", "—")),
            metric("Confidence", f"{_pct((repro.get('confidence') or 0) * 100)}%"),
            metric("Baseline Failures", len(repro.get("pre_existing_failures") or [])),
            metric("Duration", duration),
        ]
    if card == "root":
        root = state.root_cause or {}
        citations = root.get("citations") or []
        return [
            metric("Citations", len(citations)),
            metric("Verified", sum(1 for c in citations if c.get("verified"))),
            metric("Confidence", f"{_pct((root.get('confidence') or 0) * 100)}%"),
            metric("Duration", duration),
        ]
    if card == "blast":
        blast = state.blast_graph or {}
        return [
            metric("In Scope", len(blast.get("scope") or [])),
            metric("Auto-patchable", len(blast.get("auto_patch_scope") or [])),
            metric("Human Review", len(blast.get("human_review_required") or [])),
            metric("Duration", duration),
        ]
    if card == "planner":
        dag = state.fix_dag or {}
        return [
            metric("Steps", len(dag.get("execution_order") or [])),
            metric("Dependencies", len(dag.get("dependency_edges") or [])),
            metric("Conflicts", len(dag.get("conflict_batches") or [])),
            metric("Duration", duration),
        ]
    if card == "patch":
        bundle = state.patch_bundle or {}
        patches = bundle.get("patches") or []
        diff = bundle.get("diff_text") or ""
        added = sum(1 for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++"))
        removed = sum(1 for ln in diff.splitlines() if ln.startswith("-") and not ln.startswith("---"))
        return [
            metric("Files Patched", len(patches)),
            metric("Lines Added", added),
            metric("Lines Removed", removed),
            metric("Duration", duration),
        ]
    if card == "mutation":
        mutation = state.mutation_result or {}
        score = mutation.get("mutation_score")
        return [
            metric("Correctness", _score_text(mutation.get("correctness_score"))),
            metric("Mutation Score", "—" if score is None else f"{float(score):.2f}"),
            metric("New Failures", len(mutation.get("new_failures") or [])),
            metric("Duration", duration),
        ]
    if card == "security":
        security = state.security_result or {}
        return [
            metric("Security Score", _score_text(security.get("security_score"))),
            metric("New Findings", len(security.get("new_findings") or [])),
            metric("Rejected", "yes" if security.get("rejected") else "no"),
            metric("Duration", duration),
        ]
    if card == "merge":
        axis = (state.pr_decision or {}).get("axis_scores") or {}
        _decision, label = run_decision(state)
        return [
            metric("Correctness", _score_text(axis.get("correctness"))),
            metric("Security", _score_text(axis.get("security"))),
            metric("Fidelity", _score_text(axis.get("fidelity"))),
            metric("Decision", label),
        ]
    return [metric("Duration", duration)]


def _evidence_for(
    card: str,
    state: RunStateModel,
    events_for_agent: list[AgentStatusEvent] | None = None,
) -> dict:
    def payload(title: str, subtitle: str, fields: list[dict], pills: list[str] | None = None) -> dict:
        out: dict[str, Any] = {"title": title, "subtitle": subtitle, "fields": fields}
        if pills:
            out["pills"] = pills
        return out

    def field(label: str, value: Any, mono: bool = False) -> dict:
        return {"label": label, "value": str(value), "mono": mono}

    events_for_agent = events_for_agent or []

    if card == "environment":
        env = state.environment or {}
        if not env:
            return payload("Environment Report", "The precheck did not run for this run.", [])
        manifests = [
            str(m.get("path")) for m in (env.get("manifests") or []) if m.get("path")
        ]
        return payload(
            "Environment Report",
            "Whether this repository's tests can execute here.",
            [
                field("Status", env.get("status") or "unknown", True),
                field("Language", env.get("language") or "—", True),
                field("Test runner", env.get("test_runner") or "—", True),
                field("Reason", str(env.get("reason") or "—")),
                field("Suggested command", str(env.get("suggested_command") or "—"), True),
            ],
            manifests or None,
        )

    if card == "intelligence":
        published = _latest_payload(events_for_agent, "repository_intelligence")
        graph = _latest_payload(events_for_agent, "knowledge_graph")
        if not published:
            return payload("Repository Index", "Not yet published by this run.", [])
        fields = [
            field("Repository id", published.get("repository_id", "—"), True),
            field("Graph nodes", published.get("repository_nodes", 0), True),
            field("Graph edges", published.get("repository_edges", 0), True),
            field("Documented symbols", published.get("documentation_entries", 0), True),
        ]
        if graph:
            fields.append(field("Knowledge graph nodes", graph.get("node_count", 0), True))
        return payload(
            "Repository Index",
            "Reusable structural model shared across runs.",
            fields,
            [c.get("name", "") for c in (graph.get("capabilities") or [])[:6] if c.get("name")],
        )

    if card == "context":
        published = _latest_payload(events_for_agent, "context_engineering")
        if not published:
            return payload("Context Package", "Not yet published by this run.", [])
        if published.get("skipped"):
            return payload(
                "Context Package",
                "No repair target resolved — the generator kept its own context path.",
                [field("Skipped", published.get("skipped"), True)],
            )
        reduction = published.get("token_reduction")
        return payload(
            "Context Package",
            "Minimal, privacy-checked context handed to the patch generator.",
            [
                field("Target file", published.get("target_file") or "—", True),
                field("Target function", published.get("target_function") or "—", True),
                field("Context functions", published.get("context_functions", 0), True),
                field("Original tokens", published.get("original_tokens", 0), True),
                field("Reduced tokens", published.get("reduced_tokens", 0), True),
                field(
                    "Token reduction",
                    f"{float(reduction) * 100:.0f}%" if reduction is not None else "—",
                    True,
                ),
                field("Privacy guard", published.get("privacy_guard_status", "—"), True),
                field("Redactions", published.get("privacy_redactions", 0), True),
            ],
        )

    if card == "repo-intel":
        sig = state.sig or {}
        files = sig.get("files") or {}
        roles: dict[str, int] = {}
        for node in files.values():
            roles[node.get("role", "internal-util")] = roles.get(node.get("role", "internal-util"), 0) + 1
        return payload(
            "Semantic Intent Graph",
            "Static map of intent across the repository.",
            [
                field("Files indexed", len(files), True),
                field("Import edges", len(sig.get("edges") or []), True),
                field("Auth boundaries", roles.get("auth-boundary", 0), True),
                field("Public APIs", roles.get("public-api", 0), True),
            ],
            list(sig.get("source_roots") or [])[:6],
        )

    if card == "deps":
        cve = state.cve_report or {}
        findings = cve.get("findings") or []
        return payload(
            "Reachability Report",
            "Vulnerability surface narrowed by import-graph analysis.",
            [
                field("Advisories", len(findings), True),
                field("Reachable", len(cve.get("critical_queue") or []), True),
                field("Informational", sum(1 for f in findings if f.get("classification") == "Informational"), True),
                field("Unknown", sum(1 for f in findings if f.get("classification") == "Unknown"), True),
            ],
            [f"{f.get('package')}" for f in findings[:6] if f.get("package")],
        )

    if card == "static":
        static = state.static_report or {}
        prioritized = static.get("prioritized") or []
        return payload(
            "Prioritized Findings",
            "Consensus-ranked across bandit, semgrep and ruff.",
            [
                field("Raw findings", static.get("raw_count", 0), True),
                field("Prioritized", len(prioritized), True),
                field("Multi-tool consensus", sum(1 for f in prioritized if f.get("consensus")), True),
                field(
                    "Top severity",
                    f"{prioritized[0].get('severity', 0):.2f}" if prioritized else "—",
                    True,
                ),
            ],
            [f"{f.get('file')}:{f.get('line')}" for f in prioritized[:5]],
        )

    if card == "reproduce":
        repro = state.reproduction or {}
        return payload(
            "Runtime Evidence",
            "Proof the bug exists before any repair is attempted.",
            [
                field("Failing test", repro.get("failing_test") or "—", True),
                field("Exception", repro.get("exception_type") or "—", True),
                field("Location", f"{repro.get('failing_file') or '—'}:{repro.get('failing_line') or ''}", True),
                field("Confidence", f"{_pct((repro.get('confidence') or 0) * 100)}%", True),
            ],
        )

    if card == "root":
        root = state.root_cause or {}
        citations = root.get("citations") or []
        return payload(
            "Root Cause Brief",
            "Every claim anchored to a verified file and line.",
            [
                field("Summary", str(root.get("summary") or "—")[:120]),
                field("Citations", len(citations), True),
                field("Verified", sum(1 for c in citations if c.get("verified")), True),
                field("Confidence", f"{_pct((root.get('confidence') or 0) * 100)}%", True),
            ],
            [f"{c.get('file')}:{c.get('line')}" for c in citations[:5]],
        )

    if card == "blast":
        blast = state.blast_graph or {}
        return payload(
            "Impact Set",
            "Files reachable from the confirmed origin.",
            [
                field("Origins", ", ".join(blast.get("origins") or []) or "—", True),
                field("In scope", len(blast.get("scope") or []), True),
                field("Auto-patchable", len(blast.get("auto_patch_scope") or []), True),
                field("Human review", len(blast.get("human_review_required") or []), True),
            ],
            list(blast.get("auto_patch_scope") or [])[:6],
        )

    if card == "planner":
        dag = state.fix_dag or {}
        return payload(
            "Repair DAG",
            "Dependency-ordered repair sequence.",
            [
                field("Steps", len(dag.get("execution_order") or []), True),
                field("Dependency edges", len(dag.get("dependency_edges") or []), True),
                field("Conflict batches", len(dag.get("conflict_batches") or []), True),
                field("First step", (dag.get("execution_order") or ["—"])[0], True),
            ],
            list(dag.get("execution_order") or [])[:6],
        )

    if card == "patch":
        bundle = state.patch_bundle or {}
        patches = bundle.get("patches") or []
        contracts = bundle.get("contracts") or []
        return payload(
            "Patch Candidate",
            "AST-validated edits with behavioural contracts.",
            [
                field("Files", len(patches), True),
                field("Method", patches[0].get("method") if patches else "—", True),
                field("Contract", str(contracts[0].get("assertion"))[:110] if contracts else "—"),
                field("Style exemplar", str(bundle.get("style_exemplar_commit") or "—")[:12], True),
            ],
            [p.get("file") for p in patches if p.get("file")],
        )

    if card == "mutation":
        mutation = state.mutation_result or {}
        failure = mutation.get("validation_failure") or {}
        return payload(
            "Validation Report",
            "Scoped test run plus mutation gauntlet.",
            [
                field("Target test", _tristate(mutation.get("target_test_passed"), "pass", "fail"), True),
                field(
                    "Regressions",
                    _tristate(mutation.get("regression_tests_passed"), "none", "detected"),
                    True,
                ),
                field("Mutant survived", _tristate(mutation.get("mutant_survived"), "yes", "no"), True),
                field("Assertion", str(failure.get("assertion_message") or "—")[:110]),
            ],
            list(mutation.get("new_failures") or [])[:5],
        )

    if card == "security":
        security = state.security_result or {}
        new_findings = security.get("new_findings") or []
        return payload(
            "Security Delta",
            "Post-patch scan compared against the pre-patch baseline.",
            [
                field("Security score", _score_text(security.get("security_score")), True),
                field("New findings", len(new_findings), True),
                field("Verdict", "rejected" if security.get("rejected") else "accepted", True),
                field("Top finding", str(new_findings[0].get("message"))[:100] if new_findings else "—"),
            ],
            [f"{f.get('file')}:{f.get('line')}" for f in new_findings[:5]],
        )

    if card == "merge":
        decision_data = state.pr_decision or {}
        axis = decision_data.get("axis_scores") or {}
        proof = state.proof_bundle or {}
        _decision, label = run_decision(state)
        return payload(
            "Mergeability Decision",
            "Trust axes plus the proof bundle shipped with the PR.",
            [
                field("Decision", label, True),
                field("Scope risk", _score_text(axis.get("scope_risk")), True),
                field("Proof bundle", str(proof.get("bundle_hash") or "—")[:20], True),
                field("Review note", str(decision_data.get("review_note") or "—")[:110]),
            ],
        )

    return payload("Evidence", "No evidence captured for this stage.", [])


def _visualization_for(card: str, state: RunStateModel) -> dict | None:
    """Build the typed visualization payloads the UI renders per agent."""
    if card == "repo-intel":
        sig = state.sig or {}
        files = sig.get("files") or {}
        if not files:
            return None
        top = sorted(files.items(), key=lambda kv: -(kv[1].get("criticality") or 0))[:6]
        return {
            "kind": "repo-intel",
            "data": {
                # `ast` was `imports * 24 + 40` and `astNodes` was `imports * 24`
                # — invented magnitudes presented as a measured node count. The
                # SIG records imports, so report imports and nothing more.
                "files": [
                    {"name": path.split("/")[-1], "ast": len(node.get("imports") or [])}
                    for path, node in top
                ],
                "graphNodes": len(files),
                "metrics": {
                    "files": len(files),
                    "imports": sum(len(n.get("imports") or []) for n in files.values()),
                    "dependencies": len(sig.get("edges") or []),
                    "semanticRoles": len({n.get("role") for n in files.values()}),
                },
            },
        }

    if card == "deps":
        cve = state.cve_report or {}
        findings = cve.get("findings") or []
        if not findings:
            return None
        reachable = [f for f in findings if f.get("classification") == "Critical"]
        unreachable = [f for f in findings if f.get("classification") != "Critical"]
        return {
            "kind": "deps",
            "data": {
                "path": [
                    {"name": f.get("package", "?"), "sub": f.get("cve_id", "")} for f in reachable[:4]
                ],
                "unreachable": [{"name": f.get("package", "?")} for f in unreachable[:5]],
                "metrics": {
                    "reachable": len(reachable),
                    "deadFindings": len(unreachable),
                    "attackPaths": len(cve.get("critical_queue") or []),
                },
            },
        }

    if card == "static":
        static = state.static_report or {}
        prioritized = static.get("prioritized") or []
        if not prioritized:
            return None

        def severity_band(score: float) -> str:
            if score >= 0.7:
                return "HIGH"
            if score >= 0.4:
                return "MEDIUM"
            return "LOW"

        return {
            "kind": "static",
            "data": {
                # No `or ["bandit"]` fallback: naming a scanner that did not run
                # is worse than showing none.
                "scanners": sorted({t for f in prioritized for t in (f.get("tools") or [])}),
                "findings": [
                    {
                        "sev": severity_band(float(f.get("severity") or 0)),
                        "text": f"{f.get('message', 'finding')} ({f.get('file')}:{f.get('line')})"[:90],
                        "at": idx,
                    }
                    for idx, f in enumerate(prioritized[:6])
                ],
                "metrics": {
                    "raw": static.get("raw_count", 0),
                    "deduped": len(prioritized),
                    "prioritized": len(prioritized),
                },
            },
        }

    if card == "reproduce":
        repro = state.reproduction or {}
        if not repro.get("status"):
            return None
        failing = repro.get("failing_test") or "test suite"
        baseline = repro.get("pre_existing_failures") or []
        tests = [{"name": failing, "result": "FAIL"}]
        tests += [{"name": t, "result": "FAIL"} for t in baseline[:3] if t != failing]
        stack = [ln for ln in str(repro.get("traceback") or "").splitlines() if ln.strip()][-6:]
        return {
            "kind": "reproduce",
            "data": {
                # No invented fallbacks: showing a command the run never issued,
                # or an assertion it never raised, makes the card fiction.
                "command": repro.get("reexecution_command") or "—",
                "tests": tests,
                "failure": {
                    "name": failing,
                    "assertion": str(repro.get("exception_message") or "—")[:140],
                    "expected": "pass",
                    "actual": repro.get("exception_type") or "—",
                    "stack": stack,
                },
                "successMessage": (
                    "Failure reproduced — runtime evidence captured."
                    if repro.get("status") == "CONFIRMED"
                    else f"Reproduction {repro.get('status')} — routed for manual verification."
                ),
            },
        }

    if card == "root":
        root = state.root_cause or {}
        citations = root.get("citations") or []
        if not citations:
            return None
        return {
            "kind": "root",
            "data": {
                "lines": [
                    {"code": f"{c.get('file')}:{c.get('line')}", "probe": str(c.get("claim") or "")[:70]}
                    for c in citations[:5]
                ],
                "bugMessage": str(root.get("root_cause") or root.get("summary") or "Root cause identified")[:160],
                "evidence": [
                    {
                        "n": idx + 1,
                        "title": str(ref.get("source", "evidence")).replace("_", " ").title(),
                        "detail": str(ref.get("claim") or "")[:90],
                        "conf": round(float(ref.get("weight") or 0) * 100),
                    }
                    for idx, ref in enumerate((root.get("evidence_refs") or [])[:4])
                ],
            },
        }

    if card == "blast":
        blast = state.blast_graph or {}
        scope = blast.get("scope") or []
        if not scope:
            return None
        origins = blast.get("origins") or []
        return {
            "kind": "blast",
            "data": {
                "source": origins[0] if origins else "origin",
                "modules": [
                    {"name": s.get("path", "?"), "hitAt": int(s.get("hop_count") or 0)} for s in scope[:8]
                ],
            },
        }

    if card == "planner":
        dag = state.fix_dag or {}
        order = dag.get("execution_order") or []
        if not order:
            return None
        nodes = [
            {"id": issue, "label": issue[:18], "x": 12 + (idx % 3) * 34, "y": 20 + (idx // 3) * 30}
            for idx, issue in enumerate(order[:6])
        ]
        index_by_id = {n["id"]: i for i, n in enumerate(nodes)}
        edges = [
            [index_by_id[e["from_issue"]], index_by_id[e["to_issue"]]]
            for e in (dag.get("dependency_edges") or [])
            if e.get("from_issue") in index_by_id and e.get("to_issue") in index_by_id
        ]
        return {"kind": "planner", "data": {"nodes": nodes, "edges": edges[:8]}}

    if card == "patch":
        bundle = state.patch_bundle or {}
        patches = bundle.get("patches") or []
        if not patches:
            return None
        diff_lines = str(bundle.get("diff_text") or "").splitlines()
        original = [
            {"t": ln[1:][:78], "op": "del" if ln.startswith("-") else "ctx"}
            for ln in diff_lines
            if (ln.startswith("-") and not ln.startswith("---")) or ln.startswith(" ")
        ][:8]
        generated = "\n".join(
            ln[1:] for ln in diff_lines if ln.startswith("+") and not ln.startswith("+++")
        )[:600]
        contracts = bundle.get("contracts") or []
        return {
            "kind": "patch",
            "data": {
                "thoughts": [str(c.get("assertion"))[:90] for c in contracts[:3]],
                "original": original or [{"t": "(no context lines)", "op": "ctx"}],
                "generated": generated or "(no additions)",
                # "AST validated" and "Integrity checked" were emitted for every
                # patch whether or not either check had run, which is exactly the
                # kind of unearned assurance this product exists to avoid. A7
                # stamps each candidate with the write method it actually used,
                # so the badge follows that.
                "badges": (
                    ["AST validated"]
                    if all(p.get("method") == "ast_validated_write" for p in patches)
                    else []
                )
                + [p.get("file", "") for p in patches[:2]],
            },
        }

    if card == "mutation":
        mutation = state.mutation_result or {}
        if not mutation:
            return None
        survived = bool(mutation.get("mutant_survived"))
        score = mutation.get("mutation_score")
        correctness = mutation.get("correctness_score")
        # A8 records an aggregate, not a per-mutant ledger. This used to emit
        # eight fabricated mutants with a kill count of 6-or-4 picked from a
        # boolean, and the UI computed a percentage from them — a chart of
        # numbers no tool produced. Only the real measurements go out now.
        return {
            "kind": "mutation",
            "data": {
                "score": float(score) if score is not None else None,
                "survived": survived,
                "pytestPassed": bool(mutation.get("pytest_passed")),
                "correctness": float(correctness) if correctness is not None else None,
                "correctnessThreshold": SCORE_THRESHOLD,
                "failureMessage": (
                    "A mutant survived — the test passes without validating the fix."
                    if survived
                    else (
                        f"Mutation score {float(score):.2f}."
                        if score is not None
                        else "Mutation testing did not run — no score was produced."
                    )
                ),
            },
        }

    if card == "merge":
        decision_data = state.pr_decision or {}
        axis = decision_data.get("axis_scores") or {}
        if not axis:
            return None
        _decision, label = run_decision(state)
        # The literal 80s here duplicated A10's gate by coincidence rather than
        # by reference, so changing SCORE_THRESHOLD would have left the card
        # marking axes "ok" that the router had just rejected.
        scope = _score(axis.get("scope_risk"))
        # `value: null` is the honest answer for an axis nobody measured, and
        # `ok` is only true for a measurement that actually cleared the bar —
        # never for a substituted zero, and never for an absence.
        metrics = [
            {
                "label": label,
                "value": value,
                "ok": value is not None and value >= SCORE_THRESHOLD,
                "measured": value is not None,
            }
            for label, value in [
                ("Correctness", _score(axis.get("correctness"))),
                ("Security", _score(axis.get("security"))),
                ("Fidelity", _score(axis.get("fidelity"))),
            ]
        ]
        metrics.append(
            {
                # High is good on this axis — see build_run_report.
                "label": "Scope Safety",
                "value": scope,
                "ok": scope is not None and scope >= SCORE_THRESHOLD,
                "measured": scope is not None,
                "scopeLabel": (
                    "Not measured"
                    if scope is None
                    else "Contained"
                    if scope >= SCORE_THRESHOLD
                    else "Elevated risk"
                ),
            }
        )
        return {
            "kind": "merge",
            "data": {
                "metrics": metrics,
                "weights": [0.4, 0.35, 0.25],
                "decisionLabel": label,
                "reviewNote": str(decision_data.get("review_note") or "All trust gates satisfied."),
            },
        }

    return None


def build_agent_entries(
    state: RunStateModel,
    events: list[AgentStatusEvent],
    *,
    surface: str = SURFACE_V1,
) -> list[dict]:
    """Project the pipeline into the UI's agent card list.

    `surface` selects which registry entries are published. It defaults to V1 so
    the existing workspace keeps receiving exactly the eleven cards it has
    renderers for; V2 asks for the full pipeline.
    """
    grouped = _event_index(events)
    entries: list[dict] = []

    for position, definition in enumerate(agents_for_surface(surface), start=1):
        card = definition.card
        agent_events = grouped.get(definition.agent_id, [])
        duration = _agent_duration(agent_events)
        stage = STAGE_BY_ID[definition.stage]
        entry: dict[str, Any] = {
            "id": card,
            "index": position,
            "agent": definition.name,
            "purpose": definition.purpose,
            # The registry has carried this label all along; the UI was reading
            # its own copy out of the mock fixtures instead, so a live run
            # labelled its evidence handoffs from a hardcoded table.
            "handoff": definition.handoff,
            # Identity and stage membership travel with the card so no client
            # rebuilds the registry locally.
            "agentId": definition.agent_id,
            "stage": stage.id,
            "stageLabel": stage.label,
            "stageOrder": stage.order,
            "status": _agent_status(agent_events, state, card),
            "duration": duration,
            "lines": _lines_for(card, state, agent_events),
            "metrics": _metrics_for(card, state, duration, agent_events),
            "evidence": _evidence_for(card, state, agent_events),
        }

        visualization = _visualization_for(card, state)
        if visualization:
            entry["visualization"] = visualization

        if card == "patch":
            entry["modifiedFiles"] = [
                p.get("file") for p in (state.patch_bundle or {}).get("patches", []) if p.get("file")
            ]
        if card == "blast":
            entry["pills"] = list((state.blast_graph or {}).get("auto_patch_scope") or [])

        entries.append(entry)

    return entries


# What a validation field reads when the pipeline never measured it. Distinct
# from both outcomes so a UI can render absence as absence.
NOT_MEASURED = "not measured"


def _tristate(value: Any, when_true: str, when_false: str) -> str:
    """Project a `bool | None` validation flag without collapsing `None`.

    `None` means the check did not run — a scoped validation that never reached
    the regression phase, or a result recorded before the field existed.
    Rendering that as the failing branch reported a failure the pipeline never
    observed, which is the one thing this projection layer must never do.
    """
    if value is None:
        return NOT_MEASURED
    return when_true if value else when_false


def _learning_observed(events: list[AgentStatusEvent]) -> bool:
    """Whether the learning pipeline actually ran during this run.

    A0.5 attaches a `learning` section to its completed event only when
    `learning_enabled` is on *and* the pipeline returned a profile. Absence of
    that section is the observable fact that learning did not run — which is
    why this reads the timeline rather than inferring from run status.
    """
    return any(
        isinstance((event.payload or {}).get("learning"), dict) for event in events
    )


def _stage_status(
    agent_statuses: list[str],
    state: RunStateModel,
    *,
    executed: bool | None = None,
) -> str:
    """Roll agent statuses up to their stage.

    Order matters: a stage containing a failure has failed regardless of what
    else finished, and a stage still running outranks one that finished. A
    stage whose agents were all routed around is `skipped`, not `completed` —
    reporting work that never happened as done is the error this whole layer
    exists to avoid.

    `executed` covers stages that own no agent on this surface: it must be the
    observed fact of whether that stage's work ran, never an assumption. `None`
    means the question is not applicable (the stage has agents to speak for it).
    """
    if not agent_statuses:
        # No agents on this surface. The stage exists in the workflow but has
        # nothing in the graph to report — `learning` is the standing case.
        # Completion is claimed only on evidence that it actually ran; a
        # terminal run is not itself evidence, and previously reporting
        # `completed` here asserted work that may never have happened.
        if executed:
            return "completed"
        if state.status in RUN_TERMINAL_STATES:
            return "skipped"
        return "waiting"
    if "failed" in agent_statuses:
        return "failed"

    terminal_run = state.status in RUN_TERMINAL_STATES
    # `running` and `retrying` describe work in flight. Once the run has
    # settled nothing is in flight, so reporting either would leave a finished
    # run showing a live spinner. The outcome is carried by the decision, not
    # by the stage.
    if "running" in agent_statuses and not terminal_run:
        return "running"
    if "retry" in agent_statuses and not terminal_run:
        return "retrying"
    if all(s == "skipped" for s in agent_statuses):
        return "skipped"
    return "completed"


def build_stage_progress(
    state: RunStateModel,
    events: list[AgentStatusEvent],
    *,
    surface: str = SURFACE_V2,
) -> list[dict]:
    """The stage registry with this run's live status folded in."""
    grouped = _event_index(events)
    entries = {
        definition.card: definition for definition in agents_for_surface(surface)
    }
    stage_executed = {"learning": _learning_observed(events)}

    stages: list[dict] = []
    for stage in sorted(STAGE_REGISTRY, key=lambda s: s.order):
        members = [d for d in entries.values() if d.stage == stage.id]
        agents: list[dict] = []
        for definition in members:
            agent_events = grouped.get(definition.agent_id, [])
            agents.append(
                {
                    "id": definition.card,
                    "agentId": definition.agent_id,
                    "name": definition.name,
                    "purpose": definition.purpose,
                    "handoff": definition.handoff,
                    "status": _agent_status(agent_events, state, definition.card),
                    "duration": _agent_duration(agent_events),
                    "message": agent_events[-1].message if agent_events else "",
                }
            )
        stages.append(
            {
                "id": stage.id,
                "label": stage.label,
                "order": stage.order,
                "purpose": stage.purpose,
                "status": _stage_status(
                    [a["status"] for a in agents],
                    state,
                    executed=stage_executed.get(stage.id),
                ),
                "agents": agents,
            }
        )
    return stages


# ------------------------------------------------------------- view models --


def repository_identity(state: RunStateModel, index_pointer: dict | None = None) -> dict:
    """Stable identity of the repository under repair.

    `repository_id` is the key every cross-run store is keyed by — repair
    memory, learned profiles, the digital twin. It is preferred from the index
    A0.5 published; when that layer has not run, it is derived with the same
    canonical function A0.5 itself uses, so the two can never disagree.

    `head_sha` is only ever reported when a run actually recorded one. A commit
    the pipeline never observed is left null rather than guessed.
    """
    pointer = index_pointer or {}

    repository_id = pointer.get("repository_id") or None
    if not repository_id and state.repo_path:
        from backend.services.repair_memory import repository_id as compute_repository_id

        repository_id = compute_repository_id(state.repo_path)

    head_sha = pointer.get("head_sha") or state.base_commit_sha or None

    return {
        "repositoryId": repository_id,
        "repositoryName": repo_display_name(state),
        "headSha": head_sha,
        "repositoryHash": pointer.get("repository_hash") or None,
    }


def build_workspace_header(
    state: RunStateModel,
    events: list[AgentStatusEvent],
    index_pointer: dict | None = None,
) -> dict:
    _decision, label = run_decision(state)
    return {
        "repository": repo_display_name(state),
        "branch": repo_branch(state),
        "shortRunId": short_run_id(state.run_id),
        "retries": state.retry_count,
        "executionTime": _fmt_duration(elapsed_seconds(state, events)),
        "decisionLabel": label,
        # The precheck's report, published verbatim. A blocked run's entire
        # explanation lives here — without it the client knows the run stopped
        # and not why, which is the state this sprint was meant to remove.
        "environment": state.environment,
        **repository_identity(state, index_pointer),
    }


def _severity_label(state: RunStateModel) -> str:
    """Severity of the top-ranked static finding, or absence when none exist.

    The old floor was `"LOW"`, returned both for a genuine low-severity finding
    and for a run where A3 never produced one — a run blocked at A0.7 reported
    `LOW` severity for a scan that never happened. Same class of defect as the
    `0.0` axis defaults: an unmeasured value rendered as a measured one. An
    empty `prioritized` list now says so.
    """
    findings = (state.static_report or {}).get("prioritized") or []
    if not findings:
        return NOT_MEASURED
    top = float(findings[0].get("severity") or 0)
    for threshold, label in _SEVERITY_BY_SCORE:
        if top >= threshold:
            return label
    return "LOW"


def _trust_score(state: RunStateModel) -> float | None:
    """The composite trust score, or `None` when nothing was measured.

    Previously this summed four axes and divided by four regardless of how many
    had been measured, with `_pct` substituting `0.0` for the rest. A run whose
    security re-scan was skipped was therefore penalised for it twice: the axis
    showed 0%, and that 0 dragged the composite down by a quarter. The score
    that gates merges was being reduced by work nobody performed.

    Now the denominator is the number of real measurements. A measured zero
    still counts — it is a result.
    """
    axis = (state.pr_decision or {}).get("axis_scores") or {}
    if not axis:
        return None

    mean = measured_mean(
        [
            _score(axis.get("correctness")),
            _score(axis.get("security")),
            _score(axis.get("fidelity")),
            _score(axis.get("scope_risk")),
        ]
    )
    return None if mean is None else round(mean / 100, 2)


def build_executive_summary(state: RunStateModel, events: list[AgentStatusEvent]) -> dict:
    root = state.root_cause or {}
    repro = state.reproduction or {}
    mutation = state.mutation_result or {}
    decision, _label = run_decision(state)
    blast = state.blast_graph or {}
    score = mutation.get("mutation_score")

    bug = repro.get("exception_type") or "Static finding"
    if repro.get("failing_test"):
        bug = str(repro["failing_test"]).split("::")[-1]

    return {
        "repository": repo_display_name(state),
        "bug": bug[:48],
        "severity": _severity_label(state),
        "rootCause": str(root.get("root_cause") or root.get("summary") or "Pending analysis")[:80],
        # A4 publishes a confidence; a run where A4 never ran has none. The
        # `or 0` turned that absence into "0.0%", which reads as a measured
        # no-confidence verdict rather than an investigation that never happened.
        "confidence": (
            "not measured" if root.get("confidence") is None else f"{_pct(root['confidence'] * 100)}%"
        ),
        "filesAffected": len(blast.get("scope") or []),
        "attempts": total_attempts(state),
        # No 0.85 mutation gate exists anywhere in the pipeline — that figure was
        # invented for this string. The real gate A10 gates on is the correctness
        # score against SCORE_THRESHOLD, so show the measurement unqualified.
        "mutationScore": ("not scored" if score is None else f"{float(score):.2f}"),
        "runtime": _fmt_duration(elapsed_seconds(state, events)),
        # `_trust_score` is now nullable — formatting it unconditionally would
        # raise on a run where no axis was measured.
        "trustScore": (lambda t: "not measured" if t is None else f"{t:.2f}")(_trust_score(state)),
        "decision": decision,
        "decisionReason": _summary_decision_reason(state, decision),
    }


def _summary_decision_reason(state: RunStateModel, decision: str) -> str:
    """Why the run ended where it did.

    "All trust gates satisfied" was the default for *any* run with no review
    note — including a blocked run that never reached a trust gate, and a draft
    PR that was drafted precisely because a gate was not satisfied. It is only
    true of an auto-mergeable run, so only an auto-mergeable run may say it.
    """
    note = str((state.pr_decision or {}).get("review_note") or "").strip()
    if note:
        return note[:160]
    # `run_decision` speaks the UI's vocabulary, where `auto_mergeable` is
    # "merge". Testing for the router's word here would have meant the sentence
    # never appeared on the one run entitled to it.
    if decision == "merge":
        return "All trust gates satisfied."
    if decision == "blocked":
        return "The repository's environment was not prepared, so the pipeline stopped before validation."
    return "No review note was recorded for this decision."


def _pytest_unavailable(mutation: dict) -> bool:
    """True when validation never ran because the target repo had no usable pytest.

    This is the difference between "the patch is wrong" and "we could not tell",
    and the report must not present the second as the first.

    A8 now records this as a fact (`pytest_available`), decided where pytest is
    actually invoked. The string search below is retained only for runs stored
    before that field existed — deciding it here was always a guess about a
    subprocess this layer never saw, and it left the projection printing an
    explanation that contradicted the score sitting next to it.
    """
    if mutation.get("pytest_available") is False:
        return True

    brief = mutation.get("failure_brief") or {}
    failure = brief.get("validation_failure") or {}
    blob = " ".join(
        str(part or "")
        for part in (brief.get("stack_trace"), failure.get("traceback"), failure.get("pytest_stderr"))
    )
    return "No module named pytest" in blob or "no tests ran" in blob.lower()


def _mutation_evidence(mutation: dict) -> dict:
    """Evidence line whose text matches its own boolean.

    The label used to read "Mutation validation passed" whether or not it had,
    so a red cross sat next to the word "passed".
    """
    if not mutation:
        return {"ok": False, "text": "Mutation validation did not run"}
    if _pytest_unavailable(mutation):
        return {"ok": False, "text": "Mutation validation blocked — pytest unavailable in target repo"}
    if not mutation.get("pytest_passed"):
        return {"ok": False, "text": "Mutation validation failed — tests did not pass"}
    if mutation.get("mutant_survived"):
        return {"ok": False, "text": "Mutation validation failed — mutant survived"}
    if mutation.get("mutation_score") is None:
        return {"ok": False, "text": "Mutation validation incomplete — no score produced"}
    return {"ok": True, "text": "Mutation validation passed"}


def _rejection_reason(state: RunStateModel, mutation: dict) -> str:
    """Plain-language account of why no patch cleared validation.

    The UI used to assert "rejected by mutation testing" unconditionally, which
    was wrong whenever mutation testing never got to run.
    """
    attempts = total_attempts(state)
    if not mutation:
        return f"{attempts} patch attempts were made; none reached validation."
    if _pytest_unavailable(mutation):
        return (
            f"{attempts} patch attempts could not be validated: pytest was unavailable in the "
            "target repository, so neither the test suite nor mutation testing ran. The axis "
            "scores below reflect unverified work, not failed work."
        )
    if not mutation.get("pytest_passed"):
        return f"{attempts} patch attempts were rejected: the test suite did not pass."
    if mutation.get("mutant_survived"):
        return (
            f"{attempts} patch attempts were rejected by mutation testing — a mutant survived, "
            "meaning the tests do not actually constrain the repaired behaviour."
        )
    return f"{attempts} patch attempts were made and validation passed."


def _decision_reason(state: RunStateModel) -> str:
    """Why the run routed where it did, taken from the router's own note."""
    decision = state.pr_decision or {}
    note = decision.get("review_note") or decision.get("description_why")
    return str(note).strip() if note else ""


def _agents_run(events: list[AgentStatusEvent]) -> int:
    """Agents that actually emitted work, rather than the registry's length.

    A pipeline that routes around a stage — a skipped security re-scan, say —
    did not run eleven agents, and saying so overstated the run.
    """
    return len({e.agent_id for e in events if e.agent_id in CARD_BY_BACKEND_ID})


def build_run_report(state: RunStateModel, events: list[AgentStatusEvent]) -> dict:
    decision, label = run_decision(state)
    axis = (state.pr_decision or {}).get("axis_scores") or {}
    root = state.root_cause or {}
    citations = root.get("citations") or []
    mutation = state.mutation_result or {}
    repro = state.reproduction or {}
    proof = state.proof_bundle or {}
    primary = citations[0] if citations else {}

    security = state.security_result or {}
    evidence = [
        {"ok": repro.get("status") == "CONFIRMED", "text": "Runtime reproduced"},
        {"ok": bool(citations) and all(c.get("verified") for c in citations), "text": "Root cause confirmed"},
        {"ok": bool(state.blast_graph), "text": "Blast radius analyzed"},
        _mutation_evidence(mutation),
        # A skipped re-scan is not a clean re-scan — report it as not run. The
        # same applies when A9 ran but no scanner was installed: it rejects
        # nothing because it examined nothing.
        {"ok": False, "text": "Security re-scan not run"}
        if not security or security.get("security_score") is None
        else {"ok": not security.get("rejected"), "text": "Security re-scan clean"},
    ]
    if state.validation_exhausted:
        evidence.append({"ok": False, "text": f"Retry exhausted ({state.retry_count} retries)"})

    return {
        "runId": state.run_id,
        "shortRunId": short_run_id(state.run_id),
        "repository": repo_display_name(state),
        "branch": repo_branch(state),
        "decision": decision,
        "decisionLabel": label,
        "trustScore": _trust_score(state),
        # The gate A10 actually applies, normalised to the 0-1 scale the trust
        # score uses. The previous 0.9 matched no threshold in the codebase, so
        # runs were reported as falling short of a bar that did not exist.
        "trustThreshold": round(SCORE_THRESHOLD / 100, 2),
        # Prose stays whole. These fields were previously sliced at 60 and 180
        # characters and dropped into a fixed English sentence in the UI, which
        # produced half-words glued into a template that described a different
        # bug than the one the run actually found.
        "rootCause": {
            "summary": str(root.get("summary") or "").strip(),
            "statement": str(root.get("root_cause") or "").strip(),
            "location": f"{primary.get('file', '—')}:{primary.get('line', '')}",
            "claim": str(primary.get("claim") or "").strip(),
            "verified": bool(primary.get("verified")),
        },
        "rejection": {
            "attempts": total_attempts(state),
            "survivors": 1 if mutation.get("mutant_survived") else 0,
            # None means "never measured". Coercing it to 0.0 rendered a 0.00
            # that read as a real measurement of a worthless patch.
            "score": (
                float(mutation["mutation_score"])
                if mutation.get("mutation_score") is not None
                else None
            ),
            # The real validation gate: A10 rejects on `correctness_score` against
            # SCORE_THRESHOLD. The 0.85 "mutation threshold" shown here before
            # existed nowhere in the pipeline.
            "correctnessScore": (
                float(mutation["correctness_score"])
                if mutation.get("correctness_score") is not None
                else None
            ),
            "correctnessThreshold": SCORE_THRESHOLD,
            "reason": _rejection_reason(state, mutation),
        },
        "decisionReason": _decision_reason(state),
        # `value: null` where the pipeline measured nothing, and tone
        # `"unknown"` alongside it. An axis that never ran is neither passing
        # nor failing, and colouring it red accused the run of failing a check
        # nobody performed.
        #
        # Scope Safety note: `compute_scope_risk` returns 90 when nothing needs
        # human review and falls toward 20 as review items pile up, so high is
        # good — the same direction as the other three axes, and the same
        # direction A10 gates on. Labelling it "Scope Risk" inverted that: 20%
        # read as low risk when it actually meant the scope was barely contained.
        "trust": [
            {"label": label, "value": value, "tone": _tone(value)}
            for label, value in [
                ("Correctness", _score(axis.get("correctness"))),
                ("Security", _score(axis.get("security"))),
                ("Fidelity", _score(axis.get("fidelity"))),
                ("Scope Safety", _score(axis.get("scope_risk"))),
            ]
        ],
        "files": [p.get("file") for p in (state.patch_bundle or {}).get("patches", []) if p.get("file")],
        "evidence": evidence,
        "proofBundle": f"sha256:{str(proof.get('bundle_hash') or '')[:8]}…{str(proof.get('bundle_hash') or '')[-4:]}"
        if proof.get("bundle_hash")
        else "—",
        "agentCount": _agents_run(events),
        "totalDurationSeconds": round(elapsed_seconds(state, events), 1),
    }


def _attempt_action_clause(patch_payload: dict) -> str:
    """What this attempt generated, and what prompted it."""
    metrics = patch_payload.get("a7_patch_metrics") or {}
    target = metrics.get("target_file")
    reason = metrics.get("retry_reason")
    on_target = f" on {target}" if target else ""

    if not reason:
        return f"Initial patch{on_target}"
    prompt = " from runtime evidence" if metrics.get("runtime_prompt") else ""
    return f"Regenerated after {str(reason).replace('_', ' ')}{prompt}{on_target}"


def _attempt_outcome_clause(validation_payload: dict) -> str:
    """Why this attempt was rejected, in the most specific terms available."""
    if not validation_payload:
        return "awaiting validation"

    assertion = validation_payload.get("assertion_message")
    failing = validation_payload.get("failing_test")
    if assertion:
        return f"{failing}: {assertion}" if failing else str(assertion)
    if failing:
        return f"failing test {failing}"

    new_failures = validation_payload.get("new_failures") or []
    if new_failures:
        listed = ", ".join(str(f) for f in new_failures[:2])
        return f"introduced {len(new_failures)} new test failure(s): {listed}"

    if validation_payload.get("mutant_survived"):
        return "mutant survived — the test passes without validating the fix"
    if validation_payload.get("regression_tests_passed") is False:
        return "regression tests failed"
    if validation_payload.get("pytest_passed") is False:
        return "pytest failed"
    if validation_payload.get("pytest_passed"):
        return "validation passed"
    return "validation inconclusive"


def _attempt_detail(patch_payload: dict, validation_payload: dict) -> str:
    """Say what this specific attempt did and how it turned out."""
    action = _attempt_action_clause(patch_payload)
    outcome = _attempt_outcome_clause(validation_payload)
    return f"{action} — {outcome}"[:160]


def _attempt_score_label(validation_payload: dict) -> str:
    """Report the score that was actually measured, or say none was."""
    mutation_score = validation_payload.get("mutation_score")
    if mutation_score is not None:
        return f"mutation {float(mutation_score):.2f}"
    # mutmut only runs once pytest passes, so a failed attempt has no mutation
    # score at all. Fall back to the correctness score, which is always computed.
    correctness = validation_payload.get("correctness_score")
    if correctness is not None:
        return f"correctness {float(correctness) / 100:.2f}"
    return "not scored"


def build_repair_attempts(state: RunStateModel, events: list[AgentStatusEvent]) -> dict:
    """Reconstruct each repair attempt from its own patch/validation event pair.

    `state` only ever holds the *last* attempt's mutation result, so deriving
    the rows from it made every attempt render identically. The per-attempt
    truth is in the event history: one A7 (generate) and one A8 (validate)
    completion per cycle, each carrying that cycle's own payload.
    """
    grouped = _event_index(events)
    patch_events = [e for e in grouped.get("A7", []) if e.status == "completed"]
    validation_events = [e for e in grouped.get("A8", []) if e.status == "completed"]

    mutation = state.mutation_result or {}
    attempts: list[dict] = []

    for n, patch_event in enumerate(patch_events, start=1):
        patch_payload = patch_event.payload or {}
        validation_event = validation_events[n - 1] if n <= len(validation_events) else None
        validation_payload = (validation_event.payload or {}) if validation_event else {}

        if validation_event is None:
            result = "Validation Pending"
        elif validation_payload.get("pytest_passed") and not validation_payload.get(
            "patch_retry_required"
        ):
            result = "Validation Passed"
        else:
            result = "Validation Failed"

        attempts.append(
            {
                "n": n,
                "action": "Generate Patch",
                "detail": _attempt_detail(patch_payload, validation_payload),
                "result": result,
                # Kept numeric for the existing model; `scoreLabel` is what the
                # UI shows, so an unmeasured attempt never renders as 0.00.
                "mutation": float(validation_payload.get("mutation_score") or 0),
                "scoreLabel": _attempt_score_label(validation_payload),
            }
        )

    # Older runs predate the per-attempt payload fields; fall back to the
    # attempt count so the section is never silently empty.
    if not attempts and mutation:
        for n in range(1, (total_attempts(state)) + 1):
            attempts.append(
                {
                    "n": n,
                    "action": "Generate Patch",
                    "detail": "Attempt detail unavailable for this run.",
                    "result": "Validation Failed",
                    "mutation": 0.0,
                    "scoreLabel": "not scored",
                }
            )

    if state.validation_exhausted:
        message = f"Validation did not pass after {len(attempts)} attempts."
    elif mutation.get("mutant_survived"):
        message = "A surviving mutant showed the patch was not validated by the test."
    elif mutation.get("pytest_passed"):
        message = "Validation passed."
    else:
        message = "Validation incomplete."

    return {
        "attempts": attempts,
        "failureMessage": message,
        "nextStepLabel": "Proceed to Mergeability Assessment",
    }


def build_sidebar_entry(state: RunStateModel) -> dict:
    return {
        "id": state.run_id,
        "name": run_display_name(state),
        "status": sidebar_status(state),
        "time": _relative_time(state.created_at),
    }


def group_runs_by_repository(states: list[RunStateModel]) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for state in states:
        grouped.setdefault(repo_display_name(state), []).append(build_sidebar_entry(state))
    return [{"name": name, "runs": runs} for name, runs in grouped.items()]
