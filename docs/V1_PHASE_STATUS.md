# V1 Phase Status

Audit date: 2026-08-08. Legend: ✅ COMPLETE · 🟡 PARTIAL · 🔴 MISSING · ⛔ BLOCKED

---

## Status table

| Phase | Name | Status | V1 Frontend | Backend | Tests | Blockers |
|---|---|---|---|---|---|---|
| **0** | V2 decommission & V1-only cleanup | ✅ COMPLETE | V2 deleted + committed; dead fixtures gone; `prettier --check` clean | comment + test rename done | backend 1954✓ / frontend 20✓ | none |
| **1** | Run lifecycle & execution experience | 🟡 PARTIAL | terminal states ✅; error/retry ✅; reconnect ✅; **skeletons 🔴** (B-F08) | lifecycle events ✅; severity absence ✅ | mapping ✅, rendering ✅ (17 component tests) | none |
| **2** | Repository Intelligence surface | 🟡 PARTIAL | A1/A2/A3 cards ✅; **A0.5 has no card** | A0.5 + knowledge APIs ✅ | backend ✅ | none |
| **3** | Investigation / Evidence / Blast Radius | ✅ COMPLETE | A3.5/A4/A5 cards + visualizations | agents + citation verification ✅ | ✅ | none |
| **4** | Context Engineering / Repair Planning | 🔴 MISSING (frontend) | **no context card; planner shows summary only** | A5.5 + A6 + `/context` + `/plan` ✅ | backend ✅ | none |
| **5** | Patch Generation | 🟡 PARTIAL | filenames only, **no diff view** | A7 + `/patch` ✅ but B-B03/06/07/08 open | integrity ✅, rollback 🔴 | none |
| **6** | Validation & scoring correctness | ⛔ BLOCKED | mutation card ✅ | **B-B01 unmeasured→zero changes routing**; B-B02 false rejections | B-B01/B-B02 untested | B-B01 must land before trusting any decision |
| **7** | Final decision & report | 🟡 PARTIAL | report renders, nullable-aware ✅ | routing ✅; B-B09/10/11 open | routing ✅ | depends on 6 |
| **8** | Production hardening | 🔴 MISSING | reconnect ✅ (Phase 1); no reduced-motion, poll cost | sandbox, scale, G9, privacy, clone leak | 🔴 | B-B12 blocks hosting |
| **9** | Final QA / certification | 🔴 MISSING | — | — | no real-GitHub E2E | all above |

---

## What "complete" rests on

**Phase 3 ✅** — A3.5, A4, A5 all execute, publish typed payloads, have V1 cards
with bespoke visualizations, and are covered by backend tests. Citation
verification is deterministic and tested. Nothing outstanding that is
V1-specific.

**Phase 1 🟡** — the terminal-state half was already done and verified against
three real runs. The transport-resilience half has now landed: per-model
`{error, loading, loaded}` with a visible retry per panel (B-F01), backoff
WebSocket reconnect that never infers completion from a close (B-F03), the
`blocked` status tone (B-F05), `RunReport`'s required `report` prop (B-F02) and
`severity: "not measured"` (B-F09). What remains of B-F08 is cosmetic: there are
still no per-panel loading skeletons. The honesty defect it was filed for — a
failed fetch rendering as an empty one — is fixed; the polish is not.

**Phase 6 ⛔** — this is the one phase that cannot be called partial. B-B01 means
an axis nobody measured contributes a zero to the composite that gates
auto-merge. Until it is fixed, every routing decision downstream is suspect, so
Phase 7's report is showing numbers that may be wrong for a structural reason.

---

## Test suites

- **Backend** — 1957 pass, 4 skipped. One pre-existing environmental failure:
  `test_reproduction_stability_gate` asserts `get_head_sha(vulnapi)` is
  non-empty, but the `vulnapi/` fixture has no `.git`, so it returns `""`. The
  test's skip guard only checks that the directory exists, not that it is a git
  repo, so it fails rather than skipping. Not caused by any phase work.
- **Frontend** — 37 pass across 5 files. Component tests run on jsdom, opted
  into per file with a `// @vitest-environment jsdom` docblock; shared shims
  live in `src/test/setup.ts`. Test config is `vitest.config.ts`, separate from
  `vite.config.ts` because the TanStack Start plugin must not run under Vitest
  (it resolves a second React copy and every hook reads a null dispatcher).
