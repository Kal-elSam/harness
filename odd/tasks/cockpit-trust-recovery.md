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

## Scope (4 increments, single ODD doc, no auto-publish between increments)

1. Session and transcript integrity
2. Non-blocking startup
3. Compact overlay and safe reanalysis
4. Persisted PROJECT TEAM validity

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

### Increment 3 — Compact overlay and safe reanalysis (not started)

- [ ] `r` transitions immediately to `LOADING_PREFLIGHT` (real state change before the async preflight call starts).
- [ ] Block reentrancy while a preflight is already in flight (a second `r` press is a no-op, not a second concurrent call).
- [ ] Move `Quality (reference)`/`Efficient (reference)` behind the same `showTeamEvidence`/`e` gate the `Evidence` block already uses.
- [ ] Default view shows only Analyst + operational team.

### Increment 4 — Persisted PROJECT TEAM validity (not started)

- [ ] Verify routing/fallback and suggested/active strategy behavior first (Fable-as-persisted-suggestion claim, NEEDS REANALYSIS claim) before writing any fix.
- [ ] A suggestion with currently-blocked/unverified picks displays as NEEDS REANALYSIS — display-time only, persisted schema unchanged.
- [ ] An unverified model (e.g. Fable) is never shown as a recommendation.
- [ ] An active strategy keeps showing its blocked assignment, marked BLOCKED, with execution routing still prevented — hiding it would misrepresent the approved configuration.

## Progress

- Created: 2026-09-21
- Plan approved by user: one ODD doc, 4 increments, no auto-publish between them.
- Increment 1 (session and transcript integrity) complete: transcript writes serialized per path, header shows short session id, real-storage isolation confirmed, unreproduced disk-leak anomaly investigated and documented (see Increment 1's own notes above). Full suite 1978/1978, committed locally on `feat/cockpit-trust-recovery` (not pushed/PR'd/released — no auto-publish between increments, per plan): 2026-09-21
- Increment 2 (non-blocking startup) complete: tui.start() no longer blocks on the snapshot probe, background hydration + coalesced refresh() + ready promise. Full suite 1981/1981: 2026-09-21
- Next: Increment 3 (compact overlay and safe reanalysis)
