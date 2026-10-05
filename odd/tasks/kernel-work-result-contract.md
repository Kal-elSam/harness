# Kernel WorkResult Contract + delegate Seam

## Objective

Make the kernel's delegation seam portable and honest: a validated `WorkResult` (with a mandatory real summary on success) and a `spawnAdapter(decision, request)` seam that keeps model and assignment. Contract only; ready to connect later.

## Problem

- `createWorkResult` (`src/global/kernel/contracts.js`) accepts `summary: null` for any `ok`, validates nothing, and has no cancelled/failed distinction. `createMinionResult` (orch path) already rejects an empty summary, so the same fact is treated differently per path.
- `delegate` (`src/global/kernel/service.js`) calls `spawnAdapter(decision.provider, request)`: model, `assignmentSource` and `why` are dropped, and the resolved value is returned unvalidated (`any`).
- No production `spawnAdapter` exists (only tests inject one).

## Scope

- `src/global/kernel/contracts.js`, `src/global/kernel/service.js`, and their tests (`test/kernel-contracts.test.js`, `test/worker-events.test.js`, plus a new delegate test file if cleaner).

## Non-goals

- Executors, production bridge, real AbortSignal/timeouts, UI, any Gentle contract or field. A fake reporting `cancelled` does not prove process termination.
- Status values are Kairo's own names; they are not the Gentle envelope.

## Contract (WorkResult)

- `ok`: boolean. `workerId`: non-empty string.
- `status`: `completed | failed | cancelled`; if absent, inferred from `ok` (`true` -> completed, `false` -> failed) for compatibility.
- `completed`: requires `ok:true` and a non-empty summary.
- `failed`: requires `ok:false`; with no summary, requires a non-empty `error`.
- `cancelled`: requires `ok:false`; summary/error may be null.
- Contradictory states rejected. No text is ever fabricated.

## delegate

- `spawnAdapter(decision, request)` receives the full RouteDecision. Its resolved value is validated as a WorkResult. Adapter rejections propagate. Manual handoff, wait-for-team and missing adapter keep returning the decision without executing.

## Constraints

- Existing tests inject fakes returning `{status:0}` with a provider string (`test/worker-events.test.js`); they must be updated for the new seam and contract, not worked around.
- Artifacts in English; Spanish only in chat.
- Work lands on the current branch `feat/herd-shell-layout` (another plan is active in this worktree; no branch switch).

## Acceptance criteria

- [x] Valid completed/failed/cancelled results accepted; inferred status works.
- [x] Invalid and contradictory results rejected; success without summary rejected.
- [x] `delegate` passes the full decision (provider, model, assignmentSource, why) to the adapter and validates the result.
- [x] Adapter rejection propagates; MANUAL_HANDOFF / WAIT_FOR_PROJECT_TEAM / no adapter never execute.
- [x] Two independent delegations stay independent (one fails, one resolves).
- [x] Focused tests + `npm run test:cool` green; fresh evidence recorded.

## TDD

- Mode: strict (source: project Strict TDD Mode enabled).
- Runner: `node --test <file>`; full `npm run test:cool`.
- RED observed first, then GREEN, then refactor. Never claim RED that was not run.

## Delivery

- Strategy: `ask-on-risk`; forecast well under 400 changed lines.
- RDD: on by default; assess the work-unit commit. Unrelated files stay out of the commit.
- Route: delegated writer (2 non-trivial source files + tests).

## Tasks

- [x] K-0 Tracker + Engram mirror `odd/kernel-work-result-contract/tasks`
- [x] K-1 RED: WorkResult validation tests
- [x] K-2 GREEN: `createWorkResult` validation
- [x] K-3 RED: delegate seam tests (full decision, validation, rejection, manual/wait/no-adapter, two independent)
- [x] K-4 GREEN: `delegate` seam + update existing fakes
- [x] K-5 Refactor, focused tests, `npm run test:cool`, commit, RDD assess

## Progress

- 2026-10-05: tracker created.
- 2026-10-05: writer implemented K-1..K-4 (uncommitted): `createWorkResult`/`isWorkResult` validation in contracts.js; `delegate` passes full decision and validates result in service.js; fakes in worker-events updated; new test/kernel-delegate.test.js. K-5 (commit, RDD assess) pending with parent.

## Verification evidence

- RED (`node --test test/kernel-contracts.test.js test/kernel-delegate.test.js`, before source change): 8 tests, 3 pass, 5 fail. kernel-contracts.test.js failed to load (no `isWorkResult` export); delegate tests failed (adapter received provider string, result not validated/normalized).
- GREEN: same command 20/20 pass; with worker-events 24/24 pass.
- `node --test test/kernel-contracts.test.js test/worker-events.test.js test/observability-kernel.test.js test/project-router.test.js`: 47 pass, 0 fail.
- `npm run test:cool`: 2376 tests, 2375 pass, 0 fail, 1 skipped.

## Next step

Nothing pending for this contract. The production bridge (a real spawnAdapter wired to startRun) and AbortSignal/timeouts are separate, unauthorized work.

## Close-out (2026-10-05)

- Commit `363480a0f` (`feat(kernel): validate WorkResult and pass full decision to spawnAdapter`), local only, no push. Parent re-ran focused suites: kernel-contracts, kernel-delegate, worker-events, control-plane review-association: 38 pass, 0 fail. Writer-reported full `npm run test:cool`: 2376 tests, 2375 pass, 0 fail, 1 skip (not re-run by the parent).
- RDD assess (`--base-ref HEAD~1 --committed-only`, untracked excluded): risk medium (`executable_change` in contracts.js), 6 paths, 316 lines, `review_due: false` (`under_budget`). No review started; the range stays pending in the slice until a later commit reaches the ~400-line budget.
- The first assess without an untracked declaration reported unassessable/high; it was rerun with `--untracked-scope=exclude` as the other plan's untracked files are out of scope.
