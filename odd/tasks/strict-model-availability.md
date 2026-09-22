# Strict availability and reliable PROJECT TEAM loading

## Objective

Three distinct problems, fixed in order, never mixed into one release:
1. Close the pending reactive invalidation (done separately on `feat/cursor-reactive-invalidation`).
2. Prevent any unavailable model from appearing or being recommended anywhere in PROJECT TEAM.
3. Reduce initial load by removing the probe waterfall.

This document tracks scope 2 and 3 only. Scope 1 lives in `odd/tasks/cursor-reactive-invalidation.md` (already closed).

## Why

- Key learning: Cursor's own entitlement detection already worked, but its result was silently discarded by a condition written exclusively for Claude.
- "Unavailable" must mean absent from every new selection, never visible-with-a-warning, in every surface (recommendations, Project Analyst selector, role editor, scored/unscored candidate lists).
- Kairo can detect that Cursor isn't authenticated, but cannot create that authentication itself — the real error must be surfaced, not a generic message.

## Scope

### 2.1 — Strict availability, unify entitlement shape (this increment)

- `modelEntitlement` moves from a flat `modelId -> entitlement` map to `adapterId -> modelId -> entitlement`, eliminating collisions between providers that can share a raw model id (Cursor proxies models under the same id Claude uses).
- Apply entitlement to Cursor and Claude via the same central rule (`resolveEntitlement` in `model-candidate-catalog.js`, `blockingEntitlement`/`routableAlternative` in `project-router.js`) — remove the Claude-only branch that discarded Cursor's real, already-computed entitlement.
- `service.js`: build the nested shape once (`{ claude: claudeEntitlement, cursor: cursorModelEntitlement }`), thread it through `buildCompleteCandidateCatalog` and `routeProjectExecution`'s `resolveProjectRoute` call.
- No persisted-state shape changes (this structure is computed fresh every snapshot, never written to disk).

### 2.2 — Exclude denied/unverified everywhere (done)

- [x] Confirmed `buildScoredCandidatePools`'s `recommendationPool` already excluded denied AND unverified (inclusion-based `AUTOMATIC_ENTITLEMENTS = {ALLOWED, NOT_APPLICABLE}`) — "recommendations" was already correct.
- [x] `computeBootstrapAnalystCatalog` (Project Analyst selector) and `computeProjectTeamEditCatalog` (role editor) both only excluded DENIED — UNVERIFIED still passed through, scored AND unscored. New `BLOCKED_ENTITLEMENTS = Set([DENIED, UNVERIFIED])` in `project-strategy.js` replaces all four filter call sites.
- [x] Removed the now-dead UI affordance in `project-overlay.js` that let a human explicitly pick an unverified model anyway with a warning ("Unverified · extra credits" tag, and the matching CONFIRM_ANALYST/EDIT_CONFIRM warning lines) — unreachable once the catalogs never emit an unverified entry; the plan's own key learning is explicit that "unavailable" means absent, never shown-with-a-warning.
- [x] A fresh reanalysis already produces a team with zero blocked models — `buildAiTeam`/`buildEfficientTeam` only ever see `scoredAll` (the Recommendation Pool), already entitlement-filtered upstream; no change needed there.
- [x] **Correction from post-commit review (2026-09-22):** the first commit's own message and this doc wrongly claimed `manualSelectionScoredPool` feeds `/models --evidence`. Verified against the real renderer (`view.js`'s `aiTeamDetailLines()`): `/models --evidence` reads `intel.aiTeam`, `intel.efficientTeam`, and `intel.unscoredModels` directly — never `manualSelectionScoredPool`. `manualSelectionScoredPool`/`manualSelectionPool` really is internal/unused-as-a-selection-surface (confirmed correct), but the review's justification for *why* was wrong; corrected the doc comments in `model-candidate-catalog.js` (`hydrateScoredCandidatePool`/`buildScoredCandidatePools`) that still claimed "the explicit manual catalogs can still offer it with an honest warning" — a contract 2.2 itself removed.
- [x] **Real bug found by the same review, not just a docs issue:** `service.js`'s own top-level `unscoredModels` (the exact array `aiTeamDetailLines()` renders as `/models --evidence`'s UNSCORED section) only excluded DENIED, not UNVERIFIED — a genuine leak, reproduced with a dedicated RED test (an UNVERIFIED unscored Claude model appeared in `snapshot.modelIntelligence.unscoredModels`) before fixing it with the same `BLOCKED_ENTITLEMENTS` set (exported from `project-strategy.js`, reused rather than duplicated).
- [x] Regression tests (RED before the fix, GREEN after): `project-strategy.test.js` (2 rewritten from "unverified stays visible with metadata" to "unverified is absent"), `conversation-service.test.js` (1 rewritten the same way, caught in the full-suite run after the first commit; 1 new test proving the real `/models --evidence` UNSCORED leak, RED then GREEN), `project-overlay.test.js` (2 obsolete UI tests testing the removed warn-and-allow UX deleted).
- [x] Full suite green, `npm test`: confirmed after the correction commit (one unrelated, pre-existing timing-flaky test in `quick-ask.test.js` seen once — untouched by this branch, confirmed 3/3 green in isolation, not a real regression).

### 2.3 — Propagate the real Cursor catalog error (done)

- [x] Found the exact single generic message named in the plan: `view.js`'s `resolveAssignmentAvailability` hardcoded `"Unavailable — Cursor access could not be verified automatically"` for any non-AVAILABLE Cursor pool status other than EXHAUSTED, discarding `access.reason` even when the probe captured a real one (e.g. `probeCursorPoolAccess`'s own captured stderr/JSON error text). Fixed: the real reason is now appended in parens when present; the honest generic wording stays as fallback only when no real reason was ever captured.
- [x] Found a second, deeper gap the plan's own wording ("el catálogo de Cursor") pointed at: when Cursor isn't authenticated at all, `readCursorModels` fails before any model is ever known, so `resolveOrProbeCursorAccess` never even has a representative model to probe — the per-model probe-reason fix above is a no-op in that exact scenario. The real captured catalog-read error (`cursorCatalog.error`, e.g. "cursor-agent models exited with code 1: Authentication required") was computed but completely discarded — never reached `coverage`, never reached any UI. `summarizeCatalogCoverage` now optionally carries `error` (only when the catalog actually reported one — existing callers/tests with no error field are untouched), threaded from `service.js` for every adapter (not just Cursor, since Codex has the identical real captured-error shape). `fitWhyLines()` (`/why`) now appends it to that provider's coverage line instead of leaving "unknown catalog, 0/0 matched" unexplained.
- [x] Regression tests (RED before the fix, GREEN after, confirmed by temporarily reverting the fix and re-running): `cockpit-view.test.js` (2 new — probe-reason surfacing, and `/why`'s catalog-error line), `model-intelligence.test.js` (1 new — `summarizeCatalogCoverage` propagates a real error without fabricating one for providers that have none).
- [x] Full suite green, `npm test`.

### 3 — Reduce initial load (follow-up increment, not started)

- Start the independent usage/catalog/benchmark/entitlement reads concurrently.
- Run both Cursor pool probes in parallel, keeping single-flight per pool.
- Apply an in-memory-only 30s cooldown to Cursor UNVERIFIED results; never persist them as valid access.
- Keep the immediate first render, updating it once real hydration finishes.

## Constraints

- Three independent work-unit commits (one per numbered scope item above), never bundled.
- Push/PR/merge/publish require separate remote authorization (not run yet).
- No new persisted-state shape or schema change in 2.1.

## TDD

- Mode: ordinary functional checks (`node --test`), strict TDD active per user's global config — RED before GREEN for every behavior change.
- Runner: `npm test`

## Tasks — 2.1 (this increment)

- [x] Explored the real call graph: `service.js:724` already spread-merges `claudeEntitlement` and `cursorModelEntitlement` flat by modelId; `model-candidate-catalog.js`'s `resolveEntitlement` hard-returns `not_applicable` for any `adapterId !== "claude"`, silently discarding Cursor's real merged entry — confirmed as the exact bug the key learning names.
- [x] Confirmed the collision risk: `{ ...claudeEntitlement, ...cursorModelEntitlement }` lets a Cursor-proxied model overwrite a same-named Claude entry (or vice versa) since both are keyed by raw `modelId` with no adapter namespace.
- [x] `model-candidate-catalog.js`'s `resolveEntitlement`: now looks up `modelEntitlement[adapterId]?.[modelId]`, applied uniformly to every adapter present in the nested map — no more Claude-only branch. An adapter absent from the map (or a missing modelId) still resolves `not_applicable`/`unverified` exactly as before, preserving existing non-Claude, non-Cursor behavior.
- [x] `project-router.js`'s `blockingEntitlement` and `routableAlternative`: now index by `modelEntitlement[model.adapterId]?.[model.modelId]` instead of the flat `modelEntitlement[model.modelId]`.
- [x] `service.js`: `modelEntitlement` is now built as `{ claude: claudeEntitlement, cursor: cursorModelEntitlement }` and threaded through `buildCompleteCandidateCatalog` and `routeProjectExecution`.
- [x] Regression tests (RED before the fix, GREEN after): a same-named model under two adapters no longer collides; Cursor's real entitlement now reaches `buildCompleteCandidateCatalog`'s recommendation/manual pools (previously silently dropped); `resolveProjectRoute` still blocks on Cursor denial/unverified through the same gate, now via the nested shape.
- [x] Updated every existing test that assumed the old flat shape (`project-router.test.js`, `model-candidate-catalog.test.js`, `conversation-service.test.js`) to the nested `{ claude: {...}, cursor: {...} }` shape.
- [x] Full suite green, `npm test`.

## Progress

- Created: 2026-09-22
- 2.1: implemented with RED→GREEN TDD (9 tests genuinely RED before the fix — 3 new regression tests plus 6 existing tests whose flat fixtures no longer matched the new nested shape — all GREEN after), committed on `fix/strict-model-availability` (branch created from `origin/main`, does not include the separate reactive-invalidation fix, which lives on `feat/cursor-reactive-invalidation`). 142 changed lines (105 insertions, 37 deletions) across `service.js`, `project-router.js`, `model-candidate-catalog.js`, and their three test files. Full suite green: 2016/2016. Push/PR/merge/publish not run — separate remote authorization required.
- Real design refinement found mid-implementation: a fully adapter-agnostic `resolveEntitlement` broke the pre-existing contract that Claude fails closed to UNVERIFIED even with zero entitlement data, while Cursor/Codex/OpenCode-Go stay NOT_APPLICABLE with zero data (existing test: "Codex/Cursor/OpenCode-Go get entitlement not_applicable"). Resolved with an explicit `ENTITLEMENT_TRACKED_ADAPTERS = Set(["claude", "cursor"])`: untracked adapters are always NOT_APPLICABLE; Cursor is NOT_APPLICABLE only when its own `cursor` key is absent from `modelEntitlement` (opt-in tracking), but once present, an unlisted modelId fails closed to UNVERIFIED exactly like Claude always did.
- 2.2: done, see task list above. 20 changed lines (20 insertions, 56 deletions — net removal, mostly dead UI code and obsolete test assertions).
- 2.3: done, see task list above.
- Scope 3 is NOT started. Separate future work-unit commit per the delivery constraint above.
