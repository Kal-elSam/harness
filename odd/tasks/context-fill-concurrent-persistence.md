# Context-fill concurrent persistence

## Objective

Close partial-checkpoint reads and hook races on shared context-fill state as one concurrent persistence cluster: atomic STATE.md publish + locked shared JSON updates. Harden live-owner / dead-owner / contention lock policy.

## Problem

`writeCheckpoint` used non-atomic `writeFile`, so SessionStart could load a truncated STATE.md. `claimVisibleNotice` / `recordContextFill` did unlocked read-modify-write on `context-fill.json`, so concurrent hooks could grant the notice twice or drop `announced` marks. First lock pass still stole from a **live** holder after `staleAfterMs`, corrupting serialized mutators.

## Scope

- `src/global/runtime/write-atomic-json.js` (`writeAtomicText` / `writeAtomicFile`)
- `src/global/observability/context-fill-{checkpoint,hook,state,constants}.js`
- `test/context-fill-persistence.test.js`
- No kernel edits

## Acceptance

- [x] Readers never see partial STATE.md during commit
- [x] Concurrent claims grant once; record+claim merge announced marks
- [x] Multiprocess claims/records keep both adapters
- [x] Existing hook/atomic JSON tests green
- [x] Live owner past stale age is not stolen; waiter fails busy or waits
- [x] Dead owner lock expires and yields
- [x] Contended mutators serialize after release

## Evidence

- First slice `79162fe3a`: atomic checkpoint + locked RMW; 17 persistence/hook/atomic tests pass.
- Lock hardening (this close-out): reproduced live-owner steal (`waiterOutcome:"waiter"` while owner held); fixed `isStale` to steal only when holder pid is dead / lock unusable.
- `node --test test/context-fill-persistence.test.js test/kairo-control-plane-review-association.test.js test/kairo-control-plane-review-status.test.js`: 28 pass.

## RDD evaluation (persistence range `79162fe3a^..79162fe3a`)

Honest: prior kernel assess `under_budget` on `363480a0f` **does not cover** this commit.

| Agent | Result |
|-------|--------|
| `cursor` | `unassessable` / `high` / `review_due: true` (runtime not eligible for immutable receipt review) |
| `claude-code` + `--untracked-scope exclude` + inventory `sha256:6f767953…` | `risk: high` (`process_boundary` / `shell_process` on `context-fill-checkpoint.js`), `changed_paths: 7`, `changed_lines: 413`, `review_due: true` / `high_risk` |

Review not started from Cursor (ineligible runtime). Preflight STATUS for claude-code shows `fresh_target_ready` → `review.start` available on an eligible runtime. Slice remains **due**, not granted.

## Close-out

Persistence cluster closed with live-owner fix + integrated association evidence against Claude `WorkResult`. Native review receipt still pending on an eligible agent.
