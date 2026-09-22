# Claude entitlement in-memory cache invalidation

## Objective

`/models --verify-access` must take effect on the very next `/project`/dashboard poll in the same session — never stuck behind a stale in-memory read for up to 10 minutes.

## Why

- Live user testing: ran `/models --verify-access` (7 of 9 Claude models newly ALLOWED, confirmed persisted — `Claude access check: 9 probed · 7 allowed · 2 denied · 0 unverified · cache updated`), then immediately ran `/project` again in the same long-running session and got the exact same all-Codex/Opencode-go team, zero Claude models, as if verification never happened.
- Root cause, confirmed by reading the code: `service.js`'s `snapshot()` reads Claude entitlement through `readClaudeEntitlementCacheCached`, an in-memory `createCachedProbe` wrapper with a 10-minute TTL (`claudeEntitlementCacheTtlMs`, default `600_000`). `verifyClaudeEntitlements` (the `--verify-access` handler) reads/writes the raw disk file directly and never invalidates that in-memory wrapper — so the same long-running Kairo process keeps serving the pre-verification snapshot until the TTL naturally expires.
- Immediate workaround told to the user: restart the Kairo session (fresh process, no stale in-memory cache) or wait ~10 minutes. This document tracks the real fix instead of leaving that as the permanent answer.

## Scope

- `createCachedProbe` (service.js): add an `invalidate()` method on the returned function, clearing its in-memory cache slot.
- `verifyClaudeEntitlements`: call `readClaudeEntitlementCacheCached.invalidate()` immediately after a successful disk write (only when `hasPersistable`, matching the existing "never invent evidence from an all-unverified sweep" rule — nothing to invalidate when nothing was written).
- No other `createCachedProbe` instance needed invalidation for this bug — scoped to the one instance this bug actually affects.

## Constraints

- One local work-unit commit, small (mechanical, single file + its test).
- Separate branch (`fix/claude-entitlement-cache-invalidation`, from `origin/main`) — unrelated to the concurrent `fix/strict-model-availability` work, which was mid-flight in the same session when this bug was found live.
- Push/PR/merge/publish require separate remote authorization (not run yet).

## TDD

- Mode: ordinary functional checks (`node --test`), strict TDD active — RED before GREEN.
- Runner: `npm test`

## Tasks

- [x] Reproduced the exact bug with a RED regression test: a stateful fake disk (`readClaudeEntitlementCache`/`writeClaudeEntitlementCache` sharing one in-memory `diskDoc` variable, exactly like a real file would behave) — first `snapshot()` sees UNVERIFIED, `verifyClaudeEntitlements()` persists ALLOWED, the very next `snapshot()` in the same service instance still returned UNVERIFIED before the fix.
- [x] `createCachedProbe` now exposes `.invalidate()`, clearing its private `cache` slot; `readClaudeEntitlementCacheCached.invalidate()` is called right after `writeClaudeEntitlementCacheImpl` succeeds in `verifyClaudeEntitlements`.
- [x] Regression test GREEN after the fix; full existing `conversation-service.test.js` suite (87 tests) unaffected.
- [x] Full suite green, `npm test`.

## Progress

- Created: 2026-09-22
- Found live, during real user testing of the `fix/strict-model-availability` work (unrelated branch) in the same conversation — reproduced and fixed here on its own branch instead of bundling into that unrelated feature.
- Implemented, tested, committed on `fix/claude-entitlement-cache-invalidation` (from `origin/main`). Push/PR/merge/publish not run — separate remote authorization required.
