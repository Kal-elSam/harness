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
- [ ] Ship: branch → commit → PR → CI → merge → release → publish → global install verified

### Increment 3 — Task/plan attribution (not started)

- [ ] New tasks/plans persist an optional `sessionId` (safe: `readTaskRecord`'s validation is an allow-list, not exact-match — confirmed old records unaffected)
- [ ] Timeline shows only the current session's tasks; approve/reject/execute validate task→session ownership

### Increment 4 — CLI surface + UI (not started)

- [ ] `kairo start` (always new), `kairo resume [sessionId]` (selector when no id given), `kairo list` (current project; `--all` deferred)
- [ ] Auto-title from first real non-`/`-command message, max 80 chars (title truncation logic already built in Increment 1's `createSession`)
- [ ] Header shows active session title + short id
- [ ] `/clear` clears only the current session's transcript + ASK history (already true today via existing `clearTranscript`/`clearAskHistory` wiring — confirm still true once sessionId is real)

## Progress

- Created: 2026-09-21
- Increment 1 code complete, tests green, real dry-run verified, shipped as v0.30.2: 2026-09-21
- Independent audit of v0.30.2 found 4 real hostile-input/partial-state bugs; all 4 reproduced and fixed, full suite 1950/1950, stress-tested 3x: 2026-09-21
- Increment 1b shipped as v0.30.3 (PR #318, merge `171c515`, release `ea9ab4e`), global install verified: 2026-09-21
- Next: Increment 2 (thread `sessionId` through `runCockpitApp` + conversation service methods)
