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

### 2.2 — Exclude denied/unverified everywhere (follow-up increment, not started)

- Exclude denied/unverified from: recommendations, Project Analyst selector, role editor, scored AND unscored visible candidates.
- A model reappears only once a real check reports allowed/available.
- An old persisted strategy may still show its blocked assignment temporarily to explain the problem, but a fresh reanalysis must produce a new team with zero blocked models.

### 2.3 — Propagate the real Cursor catalog error (follow-up increment, not started)

- Propagate the real error from the Cursor catalog (e.g. "Authentication required") instead of today's generic message.

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
- 2.2, 2.3, and scope 3 are NOT started. Each is a separate future work-unit commit per the delivery constraint above.
