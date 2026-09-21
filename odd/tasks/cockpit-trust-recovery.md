# Cockpit trust recovery

## Objective

Restore trust in `kairo start` and PROJECT TEAM by fixing four independently verified problems: a snapshot-blocked startup, a real transcript write race, a reanalyze ('r') flow with no loading state and no reentrancy guard, and PROJECT TEAM surfaces that can silently show a blocked/unverified model as if it were a real recommendation.

## Why

External audit's claims were independently re-verified against the real code before starting (not assumed):
- `runCockpitApp` does `await refresh()` (a full `snapshot()`) before `tui.start()` — confirmed in `src/global/cockpit/app.js`.
- `appendTranscriptEntry` (`transcript-store.js`) is read-modify-write with zero serialization — confirmed by reading the function body.
- `reanalyze()` (`project-overlay.js`) nulls state in memory and calls `loadPreflight()` without transitioning `this.state` to `LOADING_PREFLIGHT` first, and with no in-flight guard — confirmed by reading the function.
- `Quality (reference)`/`Efficient (reference)` render unconditionally in `case S.RESULT`, unlike the `Evidence` block which is already gated by `showTeamEvidence`/`e` — confirmed by reading the render switch.
- The Fable/persisted-suggestion claim and the NEEDS REANALYSIS/blocked-active-strategy claims were NOT independently re-derived this session (product-policy shaped, not pure bugs) — verify each before coding, per the plan's own Key Learning.

## Scope (single ODD doc, no auto-publish between increments)

1. Session and transcript integrity
2. Non-blocking startup
3. Compact overlay and safe reanalysis
4. Persisted PROJECT TEAM validity
4b. Corrective slice (3 gaps found by independent audit before shipping)
5. Cursor eligibility (this doc reopened for a related, systemic problem — same root cause class as Increment 4: Kairo trusting stale/unverified state as if it were confirmed) — PROJECT TEAM readable-block redesign from the same external plan is deliberately NOT part of this increment; a separate, later increment if pursued.

## Constraints

- RDD stays disabled for this whole feature; remote delivery and releases remain separate, explicit decisions per increment (never automatic).
- No persisted schema changes for Increment 4 — NEEDS REANALYSIS is a display-time derivation, never rewritten into the stored strategy file.
- The "unexpected transcript history" claim requires a real PTY reproduction before being declared fixed — if it doesn't reproduce, it stays an open finding, never a speculative fix.
- `/resume` inside the cockpit responds "Exit and run kairo resume" — no second, duplicate in-TUI session selector.
- `ready: Promise<void>` is an addition to `runCockpitApp`'s existing return shape — must not break any current consumer/test that destructures today's return value.

## TDD

- Mode: ordinary functional checks (`node --test`), ready-for-focused-RED/GREEN per increment, full suite at the close of each increment.
- Runner: `npm test`

## Tasks

### Increment 1 — Session and transcript integrity

- [x] INC1-01 Serialize `appendTranscriptEntry` writes per resolved path (an in-process `Map<path, Promise>` queue in `transcript-store.js`) so two concurrent appends for the same file can never race and drop one. Confirmed RED without the fix (reverted the source, re-ran the new test, watched it fail) then GREEN with it restored.
- [x] INC1-02 **Open finding, not silently closed**: this repo has no PTY test infrastructure at all (no `node-pty` dependency, no existing PTY-based test anywhere in `test/`) — building one from scratch is a separate infra investment outside this increment's real scope, so a literal PTY-level reproduction of "unexpected history" was not attempted. What WAS verified, concretely and repeatably: (a) at the store layer, a brand-new session's transcript file is provably isolated from a legacy project-wide transcript with real prior content (`test/session-cli.test.js`); (b) at the `runCockpitApp` boot path, the resolved `sessionId` is what `loadTranscript`/`getSession` are actually called with (existing `cockpit-app.test.js` coverage from Increment 4 of multi-session). If the original report describes a scenario beyond "a new session shows old content," that specific scenario remains unreproduced and open — flag it back to whoever reported it for a more precise repro, rather than guessing further.
- [x] INC1-03 Confirmed via a new real end-to-end test (no mocked storage): `kairo start` against a project with a real, populated legacy `transcript.json` still opens the brand-new session with a provably empty transcript.
- [x] INC1-04 Shows the short session id (first 8 chars) in the cockpit dashboard header (`SESSION <8 chars>`) — new `view.setSessionId()`, called by `runCockpitApp` right after session resolution.
- [x] INC1-05 Tests RED→GREEN: concurrent-append test (`transcript-store.test.js`), real-storage new-session-isolation test (`session-cli.test.js`), header tests (`cockpit-view.test.js`, `cockpit-app.test.js`) — 4 new tests total.
- [x] INC1-06 Full suite green: 1978/1978 (1974 + 4 new), doc + Engram mirror updated, conventional commit.

**Investigated, non-reproducing anomaly (documented, not silently dropped):** two of the very first stress runs for this increment left two real session directories under this actual project's real `~/.harness/sessions/dfd01812152434aa/conversations/` (found via the routine leak check). Traced every code path that can call `createSession`/`resolveActiveSession` for real; none of the tests that exercise them (`session-cli.test.js`, `conversation-service.test.js`, `cockpit-app.test.js`) omit the mocks needed to stay isolated. Added temporary instrumentation to `createSession` to fail loudly on any non-temp `homeDir`, then ran the full suite 6 more consecutive times (3 plain, 3 instrumented) — all 6 came back completely clean, zero hits, zero leakage. Removed the instrumentation. Given a genuine bug in this deterministic, fully-mocked-in-tests code would reproduce close to 100% of the time, not twice-then-never-again across 6 targeted attempts, this is most likely an external/coincidental event from outside the test run, not a defect in this increment's code — but it's recorded here rather than silently dismissed, in case it recurs.

### Increment 2 — Non-blocking startup

- [x] `tui.start()` now runs right after the fast, local-only phase (session resolution, transcript, WorkMode) — never waits on `service.snapshot()` (the potentially ~20s usage/model-intelligence probes) first.
- [x] The real snapshot hydrates in the background, right after `tui.start()`: kicked off via `refresh()` and exposed as `ready`, never blocking the return of `runCockpitApp` itself.
- [x] Compact loading state: reuses the existing `beginAction`/spinner mechanism (`"Loading usage and model intelligence"`), cleared once `ready` resolves — no new UI primitive needed.
- [x] `ready: Promise<void>` added to `runCockpitApp`'s return value; existing consumers that only destructure `{tui, view, stop, done, refresh}` are unaffected (pure addition).
- [x] `refresh()` calls are now serialized: an in-flight `service.snapshot()` call is never joined by a second overlapping one — a `refresh()` requested while one is running coalesces into exactly one queued follow-up cycle (never an unbounded backlog), so every caller still eventually gets a real refresh.
- [x] Tests RED→GREEN: 3 new regression tests (tui starts before snapshot resolves; loading indicator shown/cleared around `ready`; concurrent `refresh()` calls coalesce to one queued follow-up, never overlapping `snapshot()` calls) + 1 pre-existing test updated to `await app.ready` before asserting on hydrated state (an honest, correct behavior change — the whole point of this increment).
- [x] Full suite green: 1981/1981 (1978 + 3 new), stress-tested 3x (one run hit the same pre-existing, already-confirmed-unrelated `quick-ask.test.js` timing flake), zero real-disk leakage.

### Increment 3 — Compact overlay and safe reanalysis

- [x] `reanalyze()` now sets `this.state = S.LOADING_PREFLIGHT` synchronously, before the async `loadPreflight()` call even starts — the modal shows real progress immediately instead of looking dead.
- [x] Reentrancy is blocked implicitly and correctly: once state leaves RESULT/ACTIVE/STALE, `handleInput`'s own `'r'` branches for those states no longer match, so a second (or third) `'r'` press while a preflight is in flight is a real no-op — confirmed via a test with a manually-gated preflight call and 3 rapid `'r'` presses, exactly 1 real call.
- [x] `Quality (reference)`/`Efficient (reference)` moved behind the exact same `showTeamEvidence`/`'e'` gate the `Evidence` block already used — the default RESULT view now shows only Analyst + the real operational PROJECT TEAM, matching the plan's own intent.
- [x] Tests RED→GREEN: 3 new regression tests (`project-overlay.test.js`) — synchronous LOADING_PREFLIGHT transition, reentrancy guard (1 real call from 3 presses), Quality/Efficient hidden by default and revealed only via `'e'`.
- [x] Full suite green: 1984/1984 on clean runs (1981 + 3 new), stress-tested 3x (one run hit the same pre-existing, unrelated `quick-ask.test.js` flake), zero real-disk leakage.

### Increment 4 — Persisted PROJECT TEAM validity

**Verification before coding, per the plan's own Key Learning:**

- Confirmed `resolveProjectRoute` (project-router.js) already correctly refuses to route to a blocked/unverified assignment for an ACTIVE strategy (`blockingEntitlement`/`eligibility` checks return `WAIT_FOR_PROJECT_TEAM`, never `ROUTED`) — execution-blocking was never actually broken.
- Confirmed the dashboard panel (`view.js`'s `projectTeamPanel`) already re-validates every role (any status) against CURRENT `eligibility`/`claudeEntitlement` on every render via `resolveAssignmentAvailability` — this side was never broken either.
- Confirmed `scoredAll`/the Recommendation Pool (`buildScoredCandidatePools` in `model-candidate-catalog.js`) already excludes `DENIED`/`UNVERIFIED` entitlement at the SOURCE (`AUTOMATIC_ENTITLEMENTS = {ALLOWED, NOT_APPLICABLE}`) — a **freshly computed** suggestion cannot recommend an unverified model like Fable.
- Found the REAL, narrow gap by reading the code: `project-overlay.js`'s own `buildResultRoleList()` (RESULT state) and `teamLines()` (ACTIVE/STALE state) never applied this same live-availability check the dashboard panel already does — so a **persisted** suggestion or active strategy, re-displayed later after real access changed (e.g. Fable recommended weeks ago, now unverified), showed its picks in the overlay as if nothing changed. This is the actual bug behind both the "Fable" and "NEEDS REANALYSIS" claims — the same root cause, not two separate issues.

**Fix:**

- [x] New `suggestionNeedsReanalysis()`/`isCurrentlyUnavailable()` helpers reuse `resolveAssignmentAvailability` (imported from `view.js`) against the live snapshot's `modelIntelligence.eligibility`/`claudeEntitlement` — the exact same real-time source the dashboard panel already checks. Display-time only; never mutates or re-persists the strategy.
- [x] RESULT state: header becomes `"NEEDS REANALYSIS"` (instead of `"Suggested Project Team"`) when the bootstrap analyst or any projectTeam pick is currently unavailable; a warning line points at `r` to re-analyze; the analyst line and each affected role row get a `"needs reanalysis"` note.
- [x] ACTIVE/STALE state: `teamLines()` gained an opt-in `checkAvailability` flag (only the real operational team list uses it — Quality/Efficient reference lines stay pure comparison, never gated); a currently-blocked assignment now shows `"BLOCKED"` in the overlay itself, not only the dashboard panel — the real model name stays visible (hiding it would misrepresent the approved configuration), matching `resolveProjectRoute`'s own execution-blocking, which was already correct.
- [x] Tests RED→GREEN: 3 new regression tests — persisted suggestion with an unverified analyst shows NEEDS REANALYSIS; an available suggestion shows the ordinary header (no false positive); an ACTIVE strategy with a blocked pick shows BLOCKED in the overlay.
- [x] Full suite green: 1987/1987 on clean runs (1984 + 3 new), stress-tested 3x (2 of 3 hit the same pre-existing, unrelated `quick-ask.test.js` flake), zero real-disk leakage.

## Progress

- Created: 2026-09-21
- Plan approved by user: one ODD doc, 4 increments, no auto-publish between them.
- Increment 1 (session and transcript integrity) complete: transcript writes serialized per path, header shows short session id, real-storage isolation confirmed, unreproduced disk-leak anomaly investigated and documented (see Increment 1's own notes above). Full suite 1978/1978, committed locally on `feat/cockpit-trust-recovery` (not pushed/PR'd/released — no auto-publish between increments, per plan): 2026-09-21
- Increment 2 (non-blocking startup) complete: tui.start() no longer blocks on the snapshot probe, background hydration + coalesced refresh() + ready promise. Full suite 1981/1981: 2026-09-21
- Increment 3 (compact overlay and safe reanalysis) complete: 'r' shows real loading state immediately and can't be double-triggered; Quality/Efficient hidden behind 'e' by default. Full suite 1984/1984: 2026-09-21
- Increment 4 (persisted PROJECT TEAM validity) complete: verified the real root cause first (overlay never re-checked live availability, unlike the dashboard panel), then fixed both the RESULT (NEEDS REANALYSIS) and ACTIVE/STALE (BLOCKED) overlay views. Full suite 1987/1987. **All 4 increments of cockpit-trust-recovery shipped locally.**: 2026-09-21
- Independent audit of the 4-increment slice (still unpushed, local only) found 3 real gaps before shipping; all 3 independently re-verified against real code before fixing (see Increment 4b below).

### Increment 4b — Corrective slice: 3 real gaps found by independent audit before shipping

Each verified against the real code before fixing, not assumed:

- [x] BUG-1 `clearTranscript` did not join `appendTranscriptEntry`'s per-path write queue — reproduced with a gated write: an append already in flight when `/clear` fires could complete AFTER the clear and silently resurrect the just-cleared content. Fixed: `clearTranscript` now goes through the same `serializeByPath` queue.
- [x] BUG-2 `suggestionNeedsReanalysis()` checked the bootstrap analyst and `projectTeam`, but never `strategy.orchestrator` — a real, separate top-level field (see `buildProjectStrategy`), not part of `projectTeam`. A blocked/unverified Orchestrator alone (e.g. Fable) could still look like a clean, current recommendation. Fixed: the check now also covers `strategy.orchestrator`.
- [x] BUG-3 `acquireSessionLock` (built in Increment 1 of multi-session support) had zero real callers anywhere — the exclusive lock existed but protected nothing. In-process write serialization (the transcript queue) only ever covered races WITHIN one process; two real processes running `kairo resume` on the same session could still race. Fixed: `service.acquireSessionLock({cwd, sessionId})` (new method) is now called by `runCockpitApp` right after session resolution (before `tui.start()` — fast, local-only), and `stop()` releases it, with `done` only resolving once that release actually settles.
- [x] Tests RED→GREEN: 5 new regression tests — append-vs-clear race (confirmed RED without the fix via a deliberately gated write), Orchestrator-only-blocked triggers NEEDS REANALYSIS, a real lock conflict refuses to start (never reaches `tui.start()`), `stop()`/`done` wait for the real release, and one full real-storage integration test (`service.acquireSessionLock` against real temp files, no mocks) proving a second real attempt is refused and a later one succeeds after release.
- [x] Full suite green: 1992/1992 on clean runs (1987 + 5 new), stress-tested 3x (2 of 3 hit the same pre-existing, unrelated `quick-ask.test.js` timing flake), zero real-disk leakage.

## Progress (continued)

- Increment 4b complete: 2026-09-21. All corrective gaps closed.
- Second independent audit confirmed ready to ship (focused regressions 201/201; full suite 1990/1992 locally, the 2 remaining failures attributed to known sandbox limits — `listen EPERM`, `npm pack` — unrelated to this change, CI as the definitive gate).
- Shipped as v0.33.0: 2026-09-21 (see closing note below the release, further down).
- New external plan reopened this doc for a related, systemic problem: Kairo confuses "Cursor's CLI lists this model" with "this account can actually run it right now." Verified before starting.
- Increment 5 (Cursor eligibility) shipped as **v0.34.0** (PR #323, merge `fb6a224`, release `f61d90d`), global install verified: 2026-09-21

### Increment 5 — Cursor eligibility (fail-closed, Auto never scored)

**Verification before coding:**

- Confirmed `readCursorModels()` (`cursor-models.js`) is a faithful, raw parse of `cursor-agent models` — it returns whatever the CLI lists, including a literal `"auto"` entry, with zero live quota signal.
- Confirmed `checkCandidate`'s old cursor branch only checked `cursorManualQuota?.manualExhausted` — a **missing** record (never touched `/project cursor available|exhausted`) evaluated to `undefined` (falsy) and was silently treated as **available**. Fail-OPEN by default — the real bug.
- Confirmed `catalogsByAdapter.cursor` (`service.js`) fed the raw Cursor catalog — including `"auto"` — straight into `scoreAvailableModels`/`buildCompleteCandidateCatalog`, meaning Auto could be scored and recommended like any real, checkable named model.
- Confirmed `checkCandidate` is already the SINGLE real chokepoint used by `selectAskProvider`, `selectExecutionProvider`, and `service.js`'s own `snapshot()` eligibility loop — "centralize the check" required no new plumbing, only fixing the one existing function.
- Confirmed NEEDS REANALYSIS/BLOCKED (Increment 4) already re-validates any model's `eligibility[adapterId].ok` live on every render — a persisted Cursor assignment automatically inherits the fix with zero new overlay code, verified with a dedicated test.

**Fix:**

- [x] `execution-router.js`'s `checkCandidate`: Cursor is now fail-closed. `manualExhausted === true` → blocked (unchanged, "out of credits"). `manualExhausted === false` (an explicit, real `/project cursor available` record) → the only way to be `ok: true`. Anything else (no record at all) → blocked, `"Cursor access unverified — run /project cursor available…"`.
- [x] `cursor-models.js`: new `CURSOR_AUTO_MODEL_ID`/`isCursorAutoModel()`. `service.js`'s `catalogsByAdapter.cursor` filters `"auto"` out before it ever reaches scoring — Auto can never be recommended or auto-selected as if it were a real, checkable candidate.
- [x] No destructive migration needed: `manualExhausted` was already always a real boolean in every persisted record (`!!exhausted`) — verified, not assumed; old records remain readable as-is.
- [x] "Centralize the check": no new plumbing needed — `checkCandidate` was already the single chokepoint; fixing it there was enough for dashboard, analysis, edit, reanalysis, and execution to all agree.
- [x] NEEDS REANALYSIS/BLOCKED for a persisted Cursor assignment: confirmed, not assumed, via a dedicated test — the existing Increment 4 mechanism (`resolveAssignmentAvailability` against live `eligibility`) picks this up automatically.
- [x] Tests RED→GREEN: fail-closed default (`execution-router.test.js`, 2 new + 1 existing test's expectation flipped from fail-open to require an explicit confirmed record); Auto excluded from scoring (`conversation-service.test.js`, 1 existing test extended + 1 new "untouched account is unverified" test); `isCursorAutoModel` unit coverage (`cursor-models.test.js`); Cursor BLOCKED propagation through the existing overlay mechanism (`project-overlay.test.js`).
- [x] Full suite green: 1996/1996 (1992 + 4 new), stress-tested 3x. One real session directory briefly appeared under this project's actual `~/.harness` during stress run 1 — the **third** occurrence of this unexplained, previously-investigated anomaly this session (6 dedicated targeted reproduction attempts in Increment 1 found nothing; today's changes touch zero session/registry code). Cleaned up; not chased further, reported honestly rather than silently dismissed. Runs 2-3 clean.
- [ ] PROJECT TEAM readable-block redesign (rows + wide detail block, Analyst/Orchestrator as non-editable assignments) from the same external plan — deliberately NOT part of this increment; a separate decision if pursued.
- [x] PR #323 → CI green (Node 20/22/24) → merged (`--merge`, real merge commit `fb6a224`) → released as **v0.34.0**, published, global install verified (`gitHead` matches `f61d90d`).
- Shipped as **v0.33.0**: PR #322 → CI green (Node 20/22/24, confirming the real 1992/1992) → merged (`--merge`, real merge commit `35cc6dd`) → released, published, global install verified (`gitHead` matches `a7fff80`). **Feature complete.** 2026-09-21
