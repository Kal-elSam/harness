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

### Increment 2 — Context/session plumbing (not started)

- [ ] Thread `sessionId` through `runCockpitApp` and conversation service methods (ASK, transcript, WorkMode) — these stop implicitly meaning "the project", start meaning "this one session"
- [ ] Headless/API callers with no `sessionId` keep today's project-wide behavior (backward compat)

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
- Next: Increment 2 (thread `sessionId` through `runCockpitApp` + conversation service methods)
