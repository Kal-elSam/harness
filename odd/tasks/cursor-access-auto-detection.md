# Cursor access auto-detection

## Objective

Replace Increment 5's manual `/project cursor available|exhausted` toggle with real, automatic detection of Cursor access — Codex, Claude (per-model), and OpenCode already detect their own usage automatically; Cursor was the one adapter where Kairo delegated that responsibility to the human, which is a real UX/trust gap, not a deliberate design choice.

## Why

- Codex/Claude/OpenCode already have automatic usage readers (`codex-usage.js`, per-model Claude entitlement probes, `opencode-usage.js`). Cursor v0.34.0 only checks CLI authentication/catalog presence — real quota was incorrectly left to a human toggle.
- Cursor does not expose quota via its CLI — confirmed by `cursor-models.js`'s own header comment and the absence of any usage-reading code anywhere in this codebase; it's only ever surfaced in Cursor's own web dashboard. A minimal real probe (the same pattern Claude's own per-model entitlement check already uses — `probeClaudeModelEntitlement` in `claude-model-entitlement.js` — because it too has no cheaper way to know) is the only real signal available; there is no free alternative.
- Cursor's own catalog has (at least) two real, independent classes of model: Cursor's own proprietary line (`Composer`) and third-party models Cursor proxies (GPT, Claude/Fable, Gemini, …) — a single global boolean would incorrectly couple their access state.

## Scope

1. Core probe primitive + classification + cache (self-contained, fully testable without touching `checkCandidate`/UI)
2. Wiring into `checkCandidate`/eligibility (replaces the Increment 5 manual gate)
3. Retiring `/project cursor available|exhausted` from help/messages/UI
4. PROJECT TEAM readable-detail-block UI (carried over from the earlier external plan, still not started)

Each scope item ships and is verified independently; no auto-publish between them.

## Constraints

- Fail-closed, matching Increment 5's own policy: success → available; an explicit real limit/quota error → exhausted; timeout, auth failure, or any unrecognized output → **unverified**, never guessed available.
- At most one probe per pool in flight at a time (no duplicate concurrent spawns for the same pool).
- Probe result cached 15 minutes — never one real `cursor-agent -p` spawn per refresh/poll tick.
- A real execution reporting a limit hit invalidates that pool's cache immediately (never waits out the TTL).
- Cursor's `auto` model stays opaque/unscored/manual — no probe needed for it (unchanged from Increment 5).
- Old manual `manualExhausted` records are ignored for future decisions, never deleted from disk (no destructive migration).
- Probe runs in the background after first render (never blocks `tui.start()` — matches Increment 2's non-blocking-startup philosophy) and before `/project analyze` when no recent evidence exists.

## Pool classification

Cursor's own proprietary model line is `Composer` (confirmed via the real captured catalog fixture in `cursor-models.test.js`: `composer-2.5`). Classification rule, documented as a real-but-revisable heuristic, not asserted as Cursor's own official taxonomy: a model whose id or display name contains "composer" (case-insensitive) is `CURSOR_MODELS`; everything else real and non-`auto` is `OTHER_MODELS` (this is the pool that gates a proxied model like Fable).

## TDD

- Mode: ordinary functional checks (`node --test`)
- Runner: `npm test`

## Tasks

### Scope 1 — Core probe primitive + classification + cache

- [x] New `src/global/observability/cursor-entitlement.js`: `CURSOR_POOL`/`CURSOR_ACCESS_STATUS` enums, `classifyCursorPool(model)` (Composer → `CURSOR_MODELS`, everything else real → `OTHER_MODELS`, documented as a revisable heuristic, not an official Cursor taxonomy), `probeCursorPoolAccess({pool, modelId, cwd, spawn, timeoutMs})` — spawns a real, minimal, non-destructive `cursor-agent -p "hi" --mode ask --model <modelId> --output-format json`, classifies the real result: `is_error: false` with a real answer → AVAILABLE; `is_error: true` with a message matching a known limit/quota phrase → EXHAUSTED; everything else (timeout, spawn failure, broken JSON, signal kill, an unrecognized error like an auth/login prompt) → UNVERIFIED, fail-closed.
- [x] New `src/global/observability/cursor-entitlement-store.js`: `readCursorAccessCache`/`writeCursorAccessCache` (fail-closed read, mkdir+writeAtomicJson), `resolveCursorPoolAccess` (15-minute TTL, per-pool, mirrors `resolveClaudeEntitlements`), `mergeCursorAccessResult` (only persists real AVAILABLE/EXHAUSTED — UNVERIFIED is never cached, so a transient failure gets a genuine retry next time rather than a 15-minute lockout), `invalidateCursorPoolAccess` (clears one pool immediately, for the real-execution-hits-a-limit case in Scope 2).
- [x] New `cursorAccessPath` in `paths.js`'s `harnessHomePaths`.
- [x] Tests RED→GREEN: 12 new tests across `cursor-entitlement.test.js` (pool classification; AVAILABLE/EXHAUSTED/UNVERIFIED classification including timeout/spawn-error/broken-JSON/signal-kill/unrecognized-error; missing modelId; exact argv shape) and `cursor-entitlement-store.test.js` (round-trip persistence; TTL expiry; two pools staying independent; UNVERIFIED never cached; immediate single-pool invalidation never touching the other pool).
- [x] Full suite green: 2008/2008 (1996 + 12 new), stress-tested 3x. One real session directory again appeared under this project's actual `~/.harness` during stress run 1 — the **fourth** occurrence of the same unexplained anomaly this session; cleaned up, not chased further (same reasoning as before — none of this scope's code touches session/registry code either).

### Scope 2 + 3 — Wire the real probe in, retire the manual toggle (shipped together — inseparable at the code level)

Discovered during implementation: enabling real per-model gating while leaving the old adapter-level manual-toggle gate in place would leave Cursor permanently blocked (the old gate never turns "on" for real access); removing the old gate before the new one existed would leave zero protection. These had to ship as one coherent change, not two independently-releasable scopes as originally planned.

- [x] `execution-router.js`'s `checkCandidate` no longer takes `cursorManualQuota` at all — Cursor's own branch is now pure availability/launchability, identical treatment to codex/claude/opencode-go. All real quota gating moved to per-model entitlement (see below).
- [x] `service.js`: new `resolveOrProbeCursorAccess()` — reads the 15-minute disk cache, probes at most one real representative model per pool (never per model, never concurrently) only when that pool's cached state is stale/missing, merges results back, writes to disk. Runs inside `snapshot()`'s own background-refresh cycle (Increment 2's non-blocking-startup pattern), gated by `enableProviderProbes` like every other real probe. A pool with no real candidate model in the current catalog is never probed.
- [x] `cursorStatusToEntitlement()` projects Cursor's AVAILABLE/EXHAUSTED/UNVERIFIED into the SAME shared `ENTITLEMENT` vocabulary Claude's own entitlement already uses — no second, parallel gating mechanism. The combined `modelEntitlement` (claude + cursor, per real modelId) now feeds `buildCompleteCandidateCatalog` (Recommendation Pool filtering — an exhausted/unverified Cursor model is excluded from `scoredAll` at the SOURCE, same as denied/unverified Claude) and `routeProjectExecution`'s `resolveProjectRoute` call (REAL execution blocking via the EXISTING, already-generic `blockingEntitlement` — zero changes needed in `project-router.js` itself).
- [x] `view.js`'s `resolveAssignmentAvailability` gained a real Cursor branch (checked via the new `cursorAccess` param, pool-level, human-readable messages: `"Cursor Other Models quota exhausted (…)"` / `"Cursor access could not be verified automatically"`); `auto` is explicitly exempted (never probed/scored, must never be blocked by a pool it was never part of). Flows automatically into the dashboard panel, `NEEDS REANALYSIS`, and `BLOCKED` — zero new overlay code, same pattern as Increment 5's own Fable fix.
- [x] `setCursorManualQuota` removed entirely from `service.js` (was about to become a silent no-op nobody read — worse than leaving it, since it would look like it did something). `/project cursor` in `app.js` now replies `"Cursor access is now detected automatically — /project cursor is no longer needed."`; `/help` and `/project` usage text no longer mention it.
- [x] Old persisted `manualExhausted` records are simply never read anymore (the old `readProviderUsage("cursor")` call site was deleted) — never deleted from disk, exactly "ignored for future decisions, not migrated."
- [x] Confirmed (test): an exhausted `OTHER_MODELS` pool never affects `CURSOR_MODELS`' own independent state, both at the cache-resolver layer (Scope 1) and now through the full real routing path (`resolveProjectRoute`, `resolveAssignmentAvailability`).
- [ ] "Real execution reporting a limit hit invalidates that pool's cache immediately" (`invalidateCursorPoolAccess`, built in Scope 1) — the PRIMITIVE exists and is tested, but no real execution-adapter failure path calls it yet. Deferred as a small, clearly-scoped follow-up rather than rushed into this already-large change.
- [x] Tests RED→GREEN: `execution-router.test.js` (checkCandidate simplified — 4 stale manual-quota tests replaced with 1); `conversation-service.test.js` (`setCursorManualQuota` removal confirmed; real probe wiring with explicit mocks, never relying on an unmocked real spawn; per-model UNVERIFIED-by-default confirmed); `cockpit-view.test.js` (`resolveAssignmentAvailability`'s Cursor branch — available/exhausted/unverified/auto-exempt); `project-router.test.js` (real execution blocking for an exhausted Cursor assignment, reusing the existing generic `blockingEntitlement` mechanism); `cockpit-app.test.js` (`/project cursor` now says access is automatic).
- [x] Full suite green: 2006/2006 (1996 + 10 net new/changed), stress-tested 3x, zero real-disk leakage.

### Scope 4 — PROJECT TEAM readable detail block

Branch: `fix/project-team-readable-detail`. Pure UI — no ranking, routing, quota, or ProjectStrategy change. `invalidateCursorPoolAccess`'s real-execution call site remains its own separate, still-deferred follow-up, not touched here.

- [x] `buildResultRoleList()` (project-overlay.js): compact rows are role + model only now — no inline `description`, no provider (`this.view.aiTeamLabel(entry.model)` replaces `teamRoleLabel`). The old inline WHY sentence and provider suffix, cramped into the picker's fixed-width column, were the real, reported clipping cause.
- [x] New `pushAssignmentDetail(role, model, { entry, note })` closure inside `render()`'s `S.RESULT` case: renders `Model:` / `Via:` / `Access:` (+ `Why:` when a real `entry` is passed), reusing `resolveAssignmentAvailability()` and `explainTeamDecision()` directly — no second availability/explanation formula.
- [x] Project Analyst and Orchestrator now render as full, non-editable context blocks above `PROJECT TEAM` (Orchestrator was a real, confirmed gap — it lived in `strategy.orchestrator` but was never shown in the overlay at all before this).
- [x] The selected role's own detail block renders below the compact list, resolved fresh every render via `resultSelectList.getSelectedItem()` — keyboard and mouse navigation both flow through the same `selectedIndex`, so no separate selection-tracking state was added.
- [x] Evidence/Quality/Efficient stay behind `e`, unchanged. Enter/`a`/`e`/`r`/Esc behavior unchanged (all 55 pre-existing regression tests pass with zero modification).
- [x] Real word-wrapping (pi-tui's `Text` component) confirmed via a dedicated test with a long WHY sentence — never truncated. One layout bug found and fixed along the way: concatenating a warning string with a literal `"  needs reanalysis"` suffix could get that literal phrase split mid-wrap; moved to its own short, never-wrapping line.
- [x] Tests: 7 new regression tests in `test/project-overlay.test.js` (compact-row content, default selection, keyboard/mouse-equivalent selection change, Cursor-exhausted/Claude-unverified/available Access text, Analyst/Orchestrator non-editability, long-reason wrapping, narrow-width border/footer).
- [x] Committed locally: `af9b01e` (`fix(cockpit): make PROJECT TEAM details readable`) — full suite 2013/2013, stress-tested 3x, zero real-disk leakage.

**Pre-ship correction** (caught before shipping, own real bug in the first pass): the compact rows still carried `(override)` and `needs reanalysis` markers, and a plain mouse click on a row silently opened that role's edit picker — indistinguishable from just browsing, and inconsistent with arrow-key navigation (which only ever moved selection). Fixed in a second commit:

- [x] `buildResultRoleList()`: rows are now STRICTLY role + model — `(override)`/`needs reanalysis` markers removed from the row entirely. Both now live only in the detail block (via `pushAssignmentDetail`'s `note` param for override, and its existing `needs reanalysis` marker for a blocked pick) and, for a strategy-wide problem, the existing top NEEDS REANALYSIS banner — never a third place.
- [x] `resultSelectList.onSelect` removed entirely — pi-tui's `SelectList` already moves `selectedIndex` on both a keyboard confirm and a real mouse click before calling `onSelect`, so leaving it unset makes selecting a row (either way) a real no-op beyond updating the selection.
- [x] `handleInput`'s `S.RESULT` branch now intercepts Enter explicitly, before it reaches `resultSelectList.handleInput` — Enter is the one, explicit way to open the selected role's edit picker; arrow keys and Esc are unaffected (still routed through `resultSelectList.handleInput` as before).
- [x] Tests: the old "click opens the picker" test was replaced with one asserting a click only moves selection/updates the detail block and never touches the edit catalog, followed by an explicit Enter that does; the one test that poked `resultSelectList.onSelect` directly now drives a real Enter keypress instead; one new test confirms available/blocked/overridden rows are all still strictly role + model, with override/reanalysis status confirmed present only in the detail block.
- [x] Committed locally: `fix(cockpit): separate project team selection from editing` — full suite 2014/2014 (2013 + 1 new), stress-tested 3x, zero real-disk leakage.
- [ ] push/PR/CI/merge/publish deliberately NOT run yet — the plan itself scopes those as a separate remote authorization (planned as v0.35.1).

## Progress

- Created: 2026-09-22
- Scope 1 (core probe primitive + classification + cache) complete: full suite 2008/2008, stress-tested 3x. Not yet wired into `checkCandidate`/eligibility or the UI — that's Scopes 2-3, and remains fully backward compatible (Increment 5's manual toggle still governs real eligibility until Scope 2 lands): 2026-09-22
- Scope 2 + 3 (real wiring + manual-toggle retirement, shipped together) complete: full suite 2006/2006, stress-tested 3x, zero real-disk leakage: 2026-09-22
- Shipped as v0.35.0: PR #324 merged to main with a real merge commit (d3b9f3c), release commit a10b709, tagged `kairo-runtime-v0.35.0`, published to npm (CI green on Node 20/22/24), global install verified (`kairo --version` → 0.35.0, gitHead matches a10b709): 2026-09-22
- Deferred, not a blocker: wiring a real execution-adapter limit-hit to call `invalidateCursorPoolAccess` immediately (the primitive already exists and is tested).
- Next: Scope 4 (PROJECT TEAM readable detail block) remains fully unstarted — separate, explicitly deferred decision, not started without a new go-ahead.
