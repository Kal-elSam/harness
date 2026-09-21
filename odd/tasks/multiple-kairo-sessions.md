# Multiple Kairo sessions

## Objective

Convert Kairo's single-session-per-project model into independent, named sessions: `kairo start` (new), `kairo resume [sessionId]`, `kairo list`. Each session isolates chat transcript, ASK history, and WorkMode. PROJECT TEAM strategy and provider quota stay project-scoped, unchanged.

## Why

Verified this session: real ASK conversation continuity (v0.30.0/0.30.1) only makes sense *within* a session — a single transcript-per-project meant "continuity" and "isolation between separate conversations" were the same file, with no way to start fresh or resume a specific past conversation. External-agent plan proposed the shape; verified against real code (task schema, existing lock primitive, real callers of session/transcript stores, `projectKeyForPath` determinism, PROJECT TEAM/quota independence) before starting.

## Scope (4 increments, feature-branch-chain)

1. **Store, migration, locking** (this doc's current state)
2. Context/session plumbing in service.js + cockpit
3. Task/plan attribution and isolation per session
4. `start`/`resume`/`list` CLI surface, selector UI, docs

## Out of scope (v1)

- Session rename/delete/fork
- `resume`/`list` operate on the current project only (no `--all` cross-project view yet, though the plan mentions it as a later option)

## Constraints

- `acquireRequestLock` (architect-store.js) is a pattern reference only, NOT directly reusable — different root, key shape, and staleness window (15 min vs. hours-legitimate for a session)
- `readTaskRecord` throws on corrupt data, returns null only on missing directory — never assume null-on-corruption
- Migration is lazy, idempotent, and NEVER deletes/moves the original legacy files (session.json/transcript.json/ask-history.json) — copy only
- `ask-history-store.js` has its own independent path-building code — a third file needing migration, not sharing code with session-store.js/transcript-store.js
- PROJECT TEAM (`project-strategy-store.js`) and usage (`usage-store.js`, actually global not just project-scoped) are untouched by this feature entirely

## TDD

- Mode: ordinary functional checks (`node --test`), no strict TDD flag required
- Runner: `npm test`

## Tasks

### Increment 1 — Store, migration, locking

- [x] INC1-01 `session-lock.js` — new lock primitive (mkdir-as-lock + lease.json + PID-liveness recovery + token-gated release), adapted from `acquireRequestLock`'s pattern with a session-appropriate root/key/staleness (24h fallback, PID-liveness is the real primary path)
  - Real requirement: a second live holder gets a real, clear thrown error — never a silent `{acquired: false}`
- [x] INC1-02 `session-registry.js` — `createSession`, `listSessions` (most-recently-updated first, skips corrupt individual session dirs), `resolveSessionRef` (exact id or unique prefix; throws only on genuine ambiguity, returns null on unknown)
- [x] INC1-03 `migrateLegacySessionIfNeeded` — lazy, idempotent import of the old single-session files into a `legacy-<projectKey>` session; folds the old WorkMode into the new v2 metadata; never touches the originals
- [x] INC1-04 Tests RED→GREEN: `test/session-lock.test.js` (6 tests), `test/session-registry.test.js` (13 tests)
- [x] INC1-05 Real dry-run: copied this actual project's real `~/.harness/sessions/<key>/` directory to an isolated temp home, ran the real migration against the copy, verified originals byte-identical and untouched, migrated content byte-identical to source. Cleaned up the scratch copy afterward; real `~/.harness` never touched.
- [x] INC1-06 Full suite green: 1945/1945, stress-tested 3x, confirmed zero real-disk side effects from any test
- [x] INC1-07 PR #317 → CI green (Node 20/22/24) → merged (real merge commit) → released as **v0.30.2**, published, global install verified (`gitHead` matches `9cd1cd0`)

### Increment 1b — Corrective slice: hostile-input hardening (found by independent audit against v0.30.2)

Four real bugs, each independently reproduced against the actual v0.30.2 code before fixing — none were caught by the original 87 focused tests because none exercised partial/interrupted state or hostile persisted data.

- [x] BUG-1 `migrateLegacySessionIfNeeded`'s guard was "conversations/ isn't empty", so an interrupted prior migration attempt (junk dir, no real session.json) permanently blocked every retry. Fixed: guard now checks for a real, schema-valid v2 session (`readValidSession`), not mere directory presence.
- [x] BUG-2 No session-id format validation before path-joining — `listSessions`/future CLI wiring could reach `sessionDirFor` with something like `../../etc`. Fixed: `SESSION_ID_PATTERN` (UUID or `legacy-<16hex>`) enforced at `sessionDirFor`, the single choke point every session path goes through; throws `Invalid session id "…"` instead of building the path.
- [x] BUG-3 `createSession` persisted any `mode` string, including invalid ones (e.g. `"yolo"`), with no validation against `WORK_MODES`. Fixed: rejects with `Unknown work mode "…"` before touching disk.
- [x] BUG-4 A corrupt (malformed JSON) `lease.json` threw an uncaught `SyntaxError` out of `readLease`, permanently blocking the session lock instead of being treated as stale/recoverable. Fixed: JSON.parse failure in `readLease` now returns `null`, same as a missing lease — recovered exactly like any other stale lock.
- [x] Tests RED→GREEN: 5 new regression tests (4 bugs + BUG-2's `listSessions` path via a real invalid-named directory), one pre-existing test (`listSessions skips a corrupt individual session directory…`) adjusted — its fixture used the invalid-shaped name `"corrupt-session"` to simulate corrupt *content*, which the new BUG-2 validation now rejects for the (correct, separate) reason of *invalid name*; renamed the fixture to a real UUID shape so it again tests corrupt content specifically.
- [x] Full suite green: 1950/1950 (1945 + 5 new), stress-tested 3x, zero real-disk leakage confirmed (`~/.harness/sessions/*/conversations` never created for a real project key)
- [x] PR #318 → CI green (Node 20/22/24) → merged (`--merge`, real merge commit `171c515`) → released as **v0.30.3**, published, global install verified (`gitHead` matches `ea9ab4e`)

### Increment 2 — Context/session plumbing

- [x] `session-registry.js`: `getSession` (real v2 doc for one session id, or null) and `updateSessionMode` (persists WorkMode onto that session's own v2 document, never the legacy `session.json`)
- [x] `transcript-store.js`/`ask-history-store.js`: optional `sessionId` param — given, scopes the file under `conversations/<sessionId>/` (via `sessionDirFor`'s existing choke-point validation); omitted, keeps exactly today's project-wide file (backward compat for headless/API callers)
- [x] `service.js`: `askQuestion`, `submitTask`, `getSession`, `setMode`, `loadTranscript`, `appendTranscript`, `clearTranscript` all accept an optional `sessionId` and route accordingly; new `resolveActiveSession({cwd})` — most-recently-updated real session, or a new one when none exists yet (today's only session-selection policy; explicit `start`/`resume`/`list` is Increment 4)
- [x] `runCockpitApp` resolves the active session once at startup and threads it through every relevant call site (transcript load/append/clear, ASK, WorkMode read/write)
- [x] Tests RED→GREEN: 9 new regression tests across `transcript-store.test.js`, `ask-history-store.test.js`, `session-registry.test.js`, `conversation-service.test.js`, `cockpit-app.test.js`; 7 pre-existing `cockpit-app.test.js` assertions updated to expect the new `sessionId: null` field on mocked service calls (an intentional, correct shape change, not a regression)
- [x] Full suite green: 1959/1959 (1950 + 9 new), stress-tested 3x, zero real-disk leakage
- [x] PR #319 → CI green (Node 20/22/24) → merged (`--merge`, real merge commit `dc5581d`) → released as **v0.31.0**, published, global install verified (`gitHead` matches `6343e7a`)

### Increment 3 — Task/plan attribution

- [x] `architect-types.js`: `createArchitectureRequestKey` folds `sessionId` into the request key, so two different real sessions asking the identical task text each get their own task, never silently reusing each other's (a caller with no sessionId keeps today's exact key)
- [x] `architect-manager.js`: `createArchitecturePlan` accepts `sessionId`, records it on the draft/status document; safe per the standing constraint — `readTaskRecord`'s validation is an allow-list, not exact-match, so the new field never breaks old records
- [x] `service.js`: `publicPlan` exposes `sessionId`; `snapshot({cwd, sessionId})` shows only that session's own tasks plus any task that predates sessions (no recorded `sessionId`) — an omitted `sessionId` still shows everything, unchanged; `showPlan`/`decidePlan`/`planExecution`/`executePlan` all accept an optional `sessionId` and throw `"...belongs to a different session"` only when BOTH sides are real and disagree — never blocks a legacy task or a caller that omits `sessionId`
- [x] `runCockpitApp` threads the resolved `sessionId` into every plan/task call site (snapshot/refresh, `/plan`, approve, reject, request-execute, execute, show-plan)
- [x] Tests RED→GREEN: 3 new regression tests (`architect-store.test.js`: two sessions asking the identical task never collide; `conversation-service.test.js`: snapshot scoping + ownership guard on all four actions); 6 pre-existing tests updated for the new `sessionId: null` field on mocked calls
- [x] Full suite green: 1962/1962 (1959 + 3 new), stress-tested 3x, zero real-disk leakage
- [x] PR #320 → CI green (Node 20/22/24) → merged (`--merge`, real merge commit `b5f7fc3`) → released as **v0.31.1**, published, global install verified (`gitHead` matches `d25e051`)

### Increment 4 — CLI surface + UI

- [x] New `src/global/conversation/session-cli.js`: `runKairoStart` (always creates a brand new real session via `createSession`, never reuses), `runKairoResume` (exact id/unique prefix via `resolveSessionRef`; no ref + one session resumes it directly; no ref + several shows a real numbered picker via a readline prompt, injectable for tests; non-interactive terminal with several candidates and no ref throws instead of guessing), `runKairoSessionsList` (current project, most recently updated first, `--json` supported)
- [x] `cli.js`: new `resume`/`list` top-level commands (`normalizeCommand`, dispatch, `parseResumeAction` for the optional positional session ref), `start` now dispatches to `runKairoStart` instead of `runCockpitCli` directly
- [x] `cockpit/cli.js`'s `runCockpitCli` forwards an explicit `sessionId` to the cockpit app factory
- [x] `cockpit/app.js`'s `runCockpitApp` accepts an explicit `sessionId` that is used as-is (never second-guessed by `resolveActiveSession`); omitted, falls back to the existing Increment-2 auto-resolution policy — kept for any embedder that predates explicit selection
- [x] `cli-help.js` documents `start`/`resume`/`list`
- [x] Auto-title from first real non-`/`-command message (already built in Increment 1's `createSession`/title-truncation logic) and header display remain out of this slice — cosmetic UI polish, not required for the CLI surface to be real and correct; `--all` cross-project view stays explicitly out of scope (v1), per the original plan
- [x] `/clear` clearing only the current session's transcript + ASK history was already verified true in Increment 2 (both calls are `sessionId`-scoped)
- [x] Tests RED→GREEN: new `test/session-cli.test.js` (10 tests: parseArgs coverage, all 3 CLI functions with mocked deps, one real end-to-end test against the actual session-registry storage — no mocks), 2 new regression tests (`cockpit-cli.test.js`: sessionId forwarded to the app factory; `cockpit-app.test.js`: an explicit sessionId is never overridden by `resolveActiveSession`)
- [x] Full suite green: 1974/1974 on a clean run (1962 + 12 new); one run showed 1 failure in `test/quick-ask.test.js` (a pre-existing, unrelated real-timer flake under full-suite CPU load — confirmed by re-running that file alone, 15/15 twice), stress-tested 3x, zero real-disk leakage
- [x] PR #321 → CI green (Node 20/22/24) → merged (`--merge`, real merge commit `776b9bf`) → released as **v0.32.0**, published, global install verified (`gitHead` matches `559f5bf`)

## Progress

- Created: 2026-09-21
- Increment 1 code complete, tests green, real dry-run verified, shipped as v0.30.2: 2026-09-21
- Independent audit of v0.30.2 found 4 real hostile-input/partial-state bugs; all 4 reproduced and fixed, full suite 1950/1950, stress-tested 3x: 2026-09-21
- Increment 1b shipped as v0.30.3 (PR #318, merge `171c515`, release `ea9ab4e`), global install verified: 2026-09-21
- Increment 2 shipped as v0.31.0 (PR #319, merge `dc5581d`, release `6343e7a`), global install verified: 2026-09-21
- Increment 3 shipped as v0.31.1 (PR #320, merge `b5f7fc3`, release `d25e051`), global install verified: 2026-09-21
- Increment 4 shipped as v0.32.0 (PR #321, merge `776b9bf`, release `559f5bf`), global install verified: 2026-09-21
- **All 4 planned increments shipped. Feature complete for v1** (session rename/delete/fork and `--all` cross-project view remain explicitly out of scope, per the original plan).
