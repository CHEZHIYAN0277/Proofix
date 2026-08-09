# V1 Phase Status

Audit date: 2026-08-08. Legend: ✅ COMPLETE · 🟡 PARTIAL · 🔴 MISSING · ⛔ BLOCKED

---

## Status table

| Phase | Name | Status | V1 Frontend | Backend | Tests | Blockers |
|---|---|---|---|---|---|---|
| **0** | V2 decommission & V1-only cleanup | ✅ COMPLETE | V2 deleted + committed; dead fixtures gone; `prettier --check` clean | comment + test rename done | backend 1954✓ / frontend 20✓ | none |
| **1** | Run lifecycle & execution experience | 🟡 PARTIAL | terminal states ✅; error/retry ✅; reconnect ✅; **skeletons 🔴** (B-F08) | lifecycle events ✅; severity absence ✅ | mapping ✅, rendering ✅ (17 component tests) | none |
| **2** | Repository Intelligence surface | ✅ COMPLETE | A0.5 card + visualization ✅; header identity strip ✅ | A0.5 on the `v1` surface ✅ | 19 card tests + 3 identity tests | none |
| **3** | Investigation / Evidence / Blast Radius | ✅ COMPLETE | A3.5/A4/A5 cards + visualizations | agents + citation verification ✅ | ✅ | none |
| **4** | Context Engineering / Repair Planning | ✅ COMPLETE | A5.5 card + viz ✅; context panel (ranking, redactions) ✅; planner shows edge reasons ✅ | A5.5 on the `v1` surface ✅ | 15 card tests + 6 panel tests | none |
| **5** | Patch Generation | ✅ COMPLETE | diff view + patch panel ✅ | B-B03/06/07/08 ✅ | 19 A7 tests + 6 diff-parser + 5 panel | none |
| **6** | Validation & scoring correctness | ✅ COMPLETE | mutation card ✅; null axes render "Not measured" | B-B01 ✅ (`measurement.py`); B-B02 ✅ (line-free finding key); B-B16 ✅ (absent scanner ≠ 100) | 15 A9 tests + `measured_mean` arithmetic + projection | none |
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

**Phase 5 ✅** (closed 2026-08-09) — the diff is the product, and it was
reachable only as two filenames. `/runs/{id}/patch` had served both sides of
every file all along.

Four backend defects closed, all the same family as Phase 6's: the pipeline
stating something it had not established.

* **B-B03** was worse than filed. `_expected_from_test_name` matched on
  `"exp" in root_cause_text` — which hits "unexpected", "export", "explicit",
  "experiment" — so a null-dereference repair was told its expected behaviour
  was "Reject tokens whose exp timestamp is earlier than time.time()", in the
  one prompt section that says what success looks like. Expected behaviour is
  now built from evidence only: the failing test, the exception it raises, and
  A4's citation-verified conclusion. Thin evidence produces a thin prompt
  rather than a guess. The same literals are gone from the retry brief, and
  `github_repo_name` no longer defaults to the fixture repository — an
  unconfigured target now refuses to publish instead of naming `vulnapi`.
* **B-B06** rollback. The subtlety is that a plan producing *no patch* is
  ordinary — most scope files need no change — so that must never trigger a
  restore. What must is an exception partway through: writes already on disk
  are real, `state.patch_bundle` is never set, and A8 then validates changes no
  bundle records. A7 now snapshots every file it writes and restores them on
  exception. The redundant `write_text(original)` immediately before the patch
  write is gone with it.
* **B-B07** was mostly already handled — `validate_patch_integrity` rejects a
  no-op, so a stub output never became a candidate. What remained: an LLM
  exception returned `apply_stub_plan`, the integrity gate rejected it as
  `no_op`, and that overwrote `retry_reason` — so a call that never completed
  was recorded as "the model returned an unchanged file". A failed call is now
  a failed attempt, with the error preserved.
* **B-B08** the lease was 60 s against one to three LLM calls. It is now 600 s
  and renewed per plan; losing it stops further writes rather than risking a
  concurrent writer in the same clone.

The diff renderer is a plain table, deliberately no `shiki` — that dependency
was removed once already and re-adding ~2 MB to colour keywords buys less than
add/remove colouring. Line numbers come from the hunk headers and advance per
side, so they are the file's own numbering; `+++`/`---` are classified before
`+`/`-` content, or every file header reads as two extra changed lines.

**Phase 4 ✅** (closed 2026-08-09) — A5.5 is the pipeline's **privacy
boundary**: the only point where secrets are masked before an LLM call. It ran
on every run and published to the `v2` surface alone, so the evidence that
nothing secret reached the model had no consumer at all.

Split by cost, deliberately:

* The **card** summarises from the agent's event payload — target, token
  reduction, guard status, counts — so the polled `/agents` response stays
  small. `token_reduction` is `null` rather than `0.0` when unmeasured, and
  `privacy_guard_status: "failed"` is never rounded to `clean`: it means the
  guard itself errored, so nothing may be assumed about what got through.
* The **context panel** reads `/runs/{id}/context` once and renders the full
  ranking with its per-signal breakdown, plus the redaction ledger. A ranking
  you cannot inspect is an oracle, and A5.5's whole design is that its
  selection is deterministic and reviewable.

**A 404 is an answer, not a failure.** `/context` 404s until A5.5 publishes.
`apiFetch` now throws a typed `ApiError` carrying the status, and
`getRunContext` maps 404 to `null` while every other status still rejects. The
panel renders three distinct states — error (retryable), pending (404), loaded
— because "Could not load. Retry" over a stage that had not run is the same
class of lie as a failed fetch rendering as an empty one (B-F01).

The package is fetched write-once: A5.5 runs a single time per run, so once
read the poll skips the request rather than growing by a round trip for an
answer that cannot change.

A6's planner card now publishes the *reason* recorded for each dependency edge
and names the conflicting fixes. Only counts were published before, and a
number cannot be disagreed with.

**`surface` is now inert.** Both values return the same cards. The parameter is
still accepted and validated because it is in the published schema, but
`_V2_ONLY` is deleted rather than left as an empty category, and a registry test
asserts the two surfaces stay identical so the split cannot quietly reopen.

**Phase 2 ✅** (closed 2026-08-09) — A0.5 moved from the `v2`-only surface onto
the product surface, so the layer whose entire purpose is reusing work across
runs is no longer invisible to the person paying for it.

The card leads with **how the index was obtained** — cache hit, incremental, or
full rebuild — because that is the only fact distinguishing A0.5 from A1
re-reading the same files. Its visualization is a timing breakdown of the
phases that actually ran (a zero-millisecond phase is omitted, not drawn as a
sliver) plus node/edge/callable/commit/remembered-repair counts.

A0.5 is projected unlike any other agent, and two things followed from that:

* It never mutates `RunStateModel` by design, so `_visualization_for` now takes
  the agent's events — its numbers exist only in its own emitted payload.
* Its failure is caught so the pipeline can continue, so it emits `started` and
  never a terminal event. `_agent_status` read that as "running" forever on a
  finished run; a terminal run now resolves an unfinished agent to `failed`
  when `state.errors` names it and `skipped` otherwise.

Disabled A0.5 (`repository_intelligence_enabled=False`) emits nothing and
renders as absence — `skipped`, no visualization, no zeroed index.

The header identity strip (`repositoryId` / `headSha` / `repositoryHash`)
renders values the backend had been publishing all along. Fields the run never
observed are omitted rather than dashed.

**`surface` does not collapse yet.** The two values now differ by A5.5 alone;
retiring the parameter is Phase 4's to finish.

**Phase 6 ✅** (closed 2026-08-09) — every number that gates a merge is now a
real measurement, in both directions.

B-B01's half was already done: `services/measurement.py` holds the tri-state
semantics, `AxisScores` is nullable, and `measured_mean` divides by the
measurements rather than by four.

What closed the phase:

* **B-B02** — A9's finding identity dropped the line number. The key was
  `file:line:message[:50]`, so a patch inserting a line above a pre-existing
  finding shifted it, changed its key, and had it rejected as newly introduced.
  Identity is now `(tool, normalized path, normalized message)` with the
  message no longer truncated — the 50-character prefix collided distinct
  bandit issues, and a collision there *accepts* a real vulnerability.
  Comparison is by multiplicity (`Counter`), not set difference, so a file that
  went from one hardcoded password to two still reports one new finding.
* **B-B16** (found during the phase) — the inverse of B-B01. A9 returned `[]`
  both for "scanned, nothing found" and "bandit could not be executed", and the
  score is derived from that count, so an absent scanner produced
  `security_score = 100.0` and cleared the 90.0 auto-merge gate. Scanners now
  report `(executed, findings)`; with none executed the score is `None`, which
  `meets_threshold` refuses. Two projection sites that read "A9 produced a
  result" as "A9 measured one" were corrected with it.

---

## Test suites

- **Backend** — 2030 pass, 4 skipped. One pre-existing environmental failure:
  `test_reproduction_stability_gate` asserts `get_head_sha(vulnapi)` is
  non-empty, but the `vulnapi/` fixture has no `.git`, so it returns `""`. The
  test's skip guard only checks that the directory exists, not that it is a git
  repo, so it fails rather than skipping. Not caused by any phase work.
- **Frontend** — 57 pass across 6 files. Component tests run on jsdom, opted
  into per file with a `// @vitest-environment jsdom` docblock; shared shims
  live in `src/test/setup.ts`. Test config is `vitest.config.ts`, separate from
  `vite.config.ts` because the TanStack Start plugin must not run under Vitest
  (it resolves a second React copy and every hook reads a null dispatcher).
