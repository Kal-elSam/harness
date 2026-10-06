# Conversation result query (`conversation result <taskId>`)

## Objective

Return a structured, recoverable result for an executed task from the CLI, without the cockpit and without copy/paste, reusing the shared conversation service and `normalizeRunResult`, with Gentle shown only as project context.

## Problem

`executePlan` links task -> runId, but nothing turns a finished run into a `WorkResult` by task. `normalizeRunResult` and `associateResultWithGentleReview` have no production caller. `runs show` returns raw metadata/events only.

## Why

Closes the loop pedido -> ejecucion -> resultado recuperable -> estado Gentle using existing pieces; no second orchestrator or execution path.

## Scope

- `src/global/conversation/task-result.js`: composer, dependencies injected.
- `service.readTaskResult({ cwd, taskId })` on the shared service.
- CLI: `conversation result <taskId> [--json]` (parse, handler, help).
- Offline tests with fake dependencies only.

## Non-goals / not authorized

Real providers, diagnostic runs, review START, permission/admission changes, promotion, B-4/B-5, bridge wiring, push, PR, merge. Independent fixes (EEXIST race, "Claude run..." message) stay out. If Gentle requires consent: stop and ask.

## Contract

Envelope: `{ taskId, runId, provider, status, runState, result, gentle }`

- `status`: `not_started` (no link) | `running` (active state) | `terminal` | `evidence_missing` (link exists, run record absent; keep runId) | `evidence_unreadable` (run record or events unparseable; keep runId, error message) | `unrecognized_state` (not active, not terminal).
- `runState` keeps the ORIGINAL run state (including `interrupted`).
- Terminal = `TERMINAL_RUN_STATES` (completed, failed, cancelled, interrupted). Only terminal runs reach `normalizeRunResult`; `interrupted` normalizes to `failed` (unexpected-state error, summary kept) while `runState` stays `interrupted`.
- `result` is a `WorkResult` only when terminal; otherwise `null`. Never fabricated.
- `gentle` is `null` unless terminal. When present: `{ state, scope: "project_context", taskReview: "not_established", receipt, gate, applicability, nextTransition, reason }`. `state` in `pending | project_receipt | rdd_off | incompatible | unavailable`. No `approval` field; receipt is project context, never task approval.
- Gentle mapping: binary absent/spawn failure -> `unavailable`; parse failure, unknown schema, inventory schema, contract mismatch, non-zero without official payload, upgrade_required -> `incompatible`; rdd off -> `rdd_off`; rdd unknown is NOT off. Original error code in `reason`.
- Read-only and idempotent: repeated queries never launch, write, or duplicate.
- Unknown task: error, no run or link created.

## Constraints

- TDD: resolved ON. Source `openspec/config.yaml` (`strict_tdd: true`, `apply.tdd: true`). Runner: `npm test` (`node --test`); focused: `node --test test/<file>`. RED observed before implementation, then GREEN, then REFACTOR.
- Tests use fake dependencies only; never invoke real `gentle-ai` or providers.
- ~400 changed-line planning heuristic; forecast ~350; single delivery slice.
- Delivery strategy: `ask-on-risk` (under budget, no chain needed).
- Commit only this feature's paths; unrelated dirty files in the tree stay untouched.

## Tasks

- [x] T1 Pure composer `task-result.js` + `test/conversation-task-result.test.js` (statuses, interrupted, Gentle states, receipt-as-context, non-terminal never calls association). Route: delegated writer (2+ non-trivial files).
- [x] T2 `service.readTaskResult` + injected deps + service tests (repeat queries 0 launches, two independent runs, unknown task creates nothing). Route: delegated writer.
- [x] T3 CLI `conversation result` (`src/cli.js` parse, `conversation/cli.js` handler, `cli-help.js`) + CLI test. Route: delegated writer.

## Acceptance criteria

- [x] Success with summary; completed without summary (failed, "no summary produced"); failed; cancelled; interrupted (runState preserved, result failed).
- [x] Query while running and after finishing.
- [x] Two independent runs; repeated queries launch nothing.
- [x] Gentle pending / project_receipt / rdd_off / incompatible / unavailable; foreign receipt is not task review; no approval field.
- [x] Link with missing run -> evidence_missing keeps runId; corrupt record -> evidence_unreadable.
- [x] Unknown task rejected, no run or link created.
- [x] `npm test` result recorded honestly.

## Progress / evidence

- Tracker created before code. Branch: `feat/herd-shell-layout` (not the default branch).
- Route declaration: T1-T3 delegated to one sequential writer; trigger = writer rule (2+ non-trivial files per task set).

- T1: RED `node --test test/conversation-task-result.test.js` -> ERR_MODULE_NOT_FOUND (task-result.js); GREEN same command -> 26 pass, 0 fail (first GREEN attempt failed on Set.includes, fixed to has). Decision: any unparseable event line -> evidence_unreadable. T1 commit 264696748.
- T2: RED `node --test test/conversation-service.test.js` -> 6 fail (readTaskResult is not a function), 96 pass; GREEN -> 102 pass, 0 fail. Production Gentle reader NOT wired: default returns {provider:"unavailable", error:"gentle_reader_not_wired"} (loadGentleWorkflow spawns gentle-ai and exposes no rddMode). T2 commit c44b0488b.
- T3: RED `node --test test/conversation-cli.test.js` -> 3 fail (result action unknown), 5 pass; GREEN -> 8 pass; focused set 165 pass; full `npm test` 2522 tests, 2521 pass, 0 fail (1 skipped/other). Production Gentle reader not wired (reports gentle_reader_not_wired). T3 sha is the commit following c44b0488b.

## Next step

Review/deliver under ordinary policy; wire a production Gentle reader as a separate decision.
