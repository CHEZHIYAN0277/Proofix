# V1 Phase Status

Audit date: 2026-08-08. Legend: ✅ COMPLETE · 🟡 PARTIAL · 🔴 MISSING · ⛔ BLOCKED

---

## Status table

| Phase | Name | Status | V1 Frontend | Backend | Tests | Blockers |
|---|---|---|---|---|---|---|
| **0** | V2 decommission & V1-only cleanup | 🟡 PARTIAL | V2 deleted (124 files) — **uncommitted**; dead fixtures + lint debt remain | comment + test rename done | backend 1954✓ / frontend 20✓ | none |
| **1** | Run lifecycle & execution experience | 🟡 PARTIAL | terminal states ✅; **error/retry/reconnect 🔴** | lifecycle events ✅ | mapping ✅, rendering 🔴 | none |
| **2** | Repository Intelligence surface | 🟡 PARTIAL | A1/A2/A3 cards ✅; **A0.5 has no card** | A0.5 + knowledge APIs ✅ | backend ✅ | none |
| **3** | Investigation / Evidence / Blast Radius | ✅ COMPLETE | A3.5/A4/A5 cards + visualizations | agents + citation verification ✅ | ✅ | none |
| **4** | Context Engineering / Repair Planning | 🔴 MISSING (frontend) | **no context card; planner shows summary only** | A5.5 + A6 + `/context` + `/plan` ✅ | backend ✅ | none |
| **5** | Patch Generation | 🟡 PARTIAL | filenames only, **no diff view** | A7 + `/patch` ✅ but B-B03/06/07/08 open | integrity ✅, rollback 🔴 | none |
| **6** | Validation & scoring correctness | ⛔ BLOCKED | mutation card ✅ | **B-B01 unmeasured→zero changes routing**; B-B02 false rejections | B-B01/B-B02 untested | B-B01 must land before trusting any decision |
| **7** | Final decision & report | 🟡 PARTIAL | report renders, nullable-aware ✅ | routing ✅; B-B09/10/11 open | routing ✅ | depends on 6 |
| **8** | Production hardening | 🔴 MISSING | no reconnect, no reduced-motion, poll cost | sandbox, scale, G9, privacy, clone leak | 🔴 | B-B12 blocks hosting |
| **9** | Final QA / certification | 🔴 MISSING | — | — | no real-GitHub E2E | all above |

---

## What "complete" rests on

**Phase 3 ✅** — A3.5, A4, A5 all execute, publish typed payloads, have V1 cards
with bespoke visualizations, and are covered by backend tests. Citation
verification is deterministic and tested. Nothing outstanding that is
V1-specific.

**Phase 1 🟡** — the terminal-state half is genuinely done and verified against
three real runs (blocked / completed / failed). The transport-resilience half
(B-F01 errors, B-F03 reconnect, B-F08 loading) is entirely absent.

**Phase 6 ⛔** — this is the one phase that cannot be called partial. B-B01 means
an axis nobody measured contributes a zero to the composite that gates
auto-merge. Until it is fixed, every routing decision downstream is suspect, so
Phase 7's report is showing numbers that may be wrong for a structural reason.

---

## Uncommitted work in the tree

Everything below is staged/untracked and **not committed**:

- V2 deletion: 124 files
- Blocked-run fix: `runLifecycle.ts` (new), `liveEventStream.ts`,
  `useExecutionRun.ts`, `mockEventStream.ts`, `Workspace.tsx`, `mocks/runReport.ts`
- Backend: `ws.py` (terminal states + quiet disconnects),
  `ui_projection.py` (A0.7 card + surface comment)
- Tests: 2 frontend files (new), `test_ws_blocked_and_disconnect.py` (new),
  `test_ui_projection.py` / `test_agent_registry.py` (extended),
  `test_workspace_v2_api.py` → `test_run_api_surfaces.py`
- Docs: 2 V2 plans deleted, QA report marked historical, 7 audit docs added

**Recommendation: commit this before starting any phase.** A phase that begins
on top of 145 uncommitted changes has no clean rollback point.
