# Cursor reactive invalidation

## Objective

When a real Cursor execution reports a real quota/limit hit, immediately invalidate that pool's cached access — the next evaluation re-checks that pool instead of trusting a stale AVAILABLE for up to 15 minutes (the probe cache's TTL).

## Why

- The real probe (`cursor-entitlement.js`/`cursor-entitlement-store.js`, shipped as part of `cursor-access-auto-detection`) only refreshes a pool's cached status when it's stale/missing — a pool that tested AVAILABLE stays trusted for the full 15-minute TTL even if a real execution against that exact pool fails on a real limit one second later.
- `invalidateCursorPoolAccess(cache, pool)` (the pure, in-memory primitive) already exists and is tested — built for exactly this, but has no real caller yet. Initial access detection doesn't substitute for reactive invalidation on a real execution failure.

## Scope

- Extend the execution-adapter contract with an optional `detectQuotaExhaustion` hook — Cursor is the only adapter that defines one; every other adapter gets a no-op default.
- Share the strict limit-message classifier (`isLimitMessage`, extracted from the existing probe's inline check) between `probeCursorPoolAccess` and the new reactive detector — real code reuse, not a second heuristic.
- New `detectCursorLimitFromOutput({ line, stream })` in `cursor-entitlement.js`: stderr lines are checked directly against the classifier; stdout lines are only trusted when they parse as JSON with `is_error: true` and a real `result` message matching the classifier — never scanning arbitrary assistant text, which could legitimately mention "usage limit" without being a real failure.
- New `invalidateStoredCursorPoolAccess(homeDir, pool)` in `cursor-entitlement-store.js` — a persistent wrapper around the existing pure `invalidateCursorPoolAccess`/`readCursorAccessCache`/`writeCursorAccessCache`, best-effort (never throws, never affects the real run's own result).
- `run-supervisor.js`'s `handleLine` calls `adapter.detectQuotaExhaustion` per real output line; on a hit, invalidates at most once per pool per run (a per-run `Set` of dedupe keys) and never touches the run's own event/metadata/result.
- Cursor's own adapter (`cursor.js`) owns all Cursor-specific knowledge (pool derivation from the launched model, the `auto` exemption) via a small closure passed as `detectQuotaExhaustion` — the supervisor only ever sees an opaque `{ dedupeKey, invalidate(homeDir) }` shape.

## Constraints

- No new commands, config, persisted state shape, or schema change — reuses the existing `cursor-access.json` cache and its existing shape.
- TTL, pool taxonomy, and the existing fail-closed policy are all unchanged.
- One local work-unit commit, expected under ~400 changed lines.
- Push/PR/merge/publish require separate remote authorization (not run yet).

## TDD

- Mode: ordinary functional checks (`node --test`)
- Runner: `npm test`

## Tasks

- [x] `isLimitMessage(text)` extracted and reused by `probeCursorPoolAccess` (no behavior change to the probe itself — same regex, same call site logic).
- [x] `detectCursorLimitFromOutput({ line, stream })`: recognizes explicit `is_error: true` + matching `result` text (stdout/JSON) and an explicit matching message on stderr; ignores normal assistant text, unrecognized errors, and any non-matching line.
- [x] `invalidateStoredCursorPoolAccess(homeDir, pool)`: read → invalidate → write, no-op if nothing cached or the pool wasn't cached, never throws.
- [x] `create-execution-adapter.js`: optional `detectQuotaExhaustion` field, defaults to a no-op returning `null`.
- [x] `cursor.js`: real `detectQuotaExhaustion` — derives the pool from the launched model (a plain modelId string, per the real handoff shape, wrapped as `{id: model}` for `classifyCursorPool`), exempts `auto`, returns `{ dedupeKey: pool, reason, invalidate(homeDir) }`.
- [x] `run-supervisor.js`: calls the hook per real line (both streams) via `handoff.model`, invalidates at most once per pool per run (a per-run `Set` of dedupe keys), best-effort (`Promise.resolve(...).catch(() => {})`), never blocks or alters the real run's own outcome.
- [x] Tests: 6 new in `cursor-entitlement.test.js` (`detectCursorLimitFromOutput` — JSON is_error+limit, stderr limit, normal assistant text ignored, unrecognized is_error ignored, non-JSON/empty ignored, ordinary stderr noise ignored); 4 new in `cursor-entitlement-store.test.js` (`invalidateStoredCursorPoolAccess` — real disk round-trip + pool independence, no-op on nothing cached, no-op on pool not cached, best-effort on read/write failure); new `cursor-execution-adapter.test.js` (5 tests — real pool derivation + invalidate closure for both pools, `auto` exemption, no-model/non-matching returns null, another adapter's real no-op default); new `run-supervisor-cursor-invalidation.test.js` (4 tests, full in-process `startRun`→`supervisePreparedRun` path — real limit hit invalidates and the run still completes, ordinary output never invalidates, 3 repeated matching lines invalidate exactly once, a failing invalidate never alters the run's own outcome).
- [x] Full suite green: 2033/2033 (2014 + 19 new), stress-tested 3x, zero real-disk leakage.

## Notes

- The originating plan also asked to reconcile a stale "Scope 4" checkbox in `odd/tasks/cockpit-trust-recovery.md` — verified against the real file: no such text exists there (only `cursor-access-auto-detection.md` ever had it, already fixed in that feature's own prior commits). Skipped as not applicable; flagged to the user rather than silently ignored.

## Progress

- Created: 2026-09-22
- Complete: core classifier reuse, reactive detection, persistent invalidation, adapter-contract hook, and run-supervisor wiring — one local work-unit commit. Push/PR/merge/publish require separate remote authorization (not run yet): 2026-09-22
