# team-selection-evidence

Branch: `feat/team-selection-evidence` (from `feat/kairo-cursor-baseline` @ 80e9ad0ad).
Mirror: Engram topic `odd/team-selection-evidence/tasks`.

## Objective
Persist, inside `project-strategy.json`, the evaluated candidate pool and the per-role selection causes that the team selector already computes and currently discards.

## Problem
`buildProjectStrategy` stores only `{role, model, reason}` per role. `reasonKind`, `poolSize`, the narrow band (`pool`) and the full ranking (`fullRanked`) are local to `assignOneRole`/`buildAiTeam` and lost. A saved proposal cannot be audited without re-running live catalogs.

## Scope (authorized)
- `src/global/intelligence/model-intelligence.js`: add `selection` to each `buildAiTeam` / `buildEfficientTeam` entry; split `passesConcentration` into a cause-returning helper (original becomes `cause === null`). No behavior change.
- `src/global/conversation/project-strategy.js`: copy `entry.selection` into `qualityTeam` / `efficientTeam` rows; add strategy-level `providerCapacity`. (Coordinate with Cursor before merge; kept minimal.)
- `project-strategy-store.js`: no change expected; prove additive/back-compat with a test.
- New test file(s) only; no change to thresholds, bands, floors or benchmarks.

## Out of scope
Any ranking/policy change, new files for evidence, UI changes, bringing fixes to other branches.

## Shape
`selection: { reasonKind, poolSize, evaluated: [{ candidateKey, adapterId, modelId, gapValue, inBand, blockedBy }] }`
`blockedBy`: `null | "model_cap" | "provider_cap" | "reviewer_independence"`.
Bound `evaluated` to the role's `fullRanked` (already small).

## Execution
- TDD: strict (RED observed before implementation, then GREEN). Source: user/global config. Runner: `node --test <file>`; full: `npm test`.
- Route: T1-T3 delegated writer (2+ non-trivial files). T5-T6 delegated writer (model-intelligence.js + test file, writer trigger); T7 verification inline by the parent.
- Heuristic ~400 changed lines is advisory only.

## Tasks
- [x] T1 RED: tests for `selection` on team entries (reasonKind, evaluated rows, blockedBy causes) in `test/team-selection-evidence.test.js`.
- [x] T2 GREEN: implement `selection` in `model-intelligence.js` (no behavior change; existing tests unchanged and green).
- [x] T3 RED+GREEN: `buildProjectStrategy` persists `selection` + `providerCapacity`; store round-trips; old file without `selection` still reads.
- [x] T4 Verify: full `npm test`, report failures honestly; commit work units (Conventional Commits, no AI attribution).

- [ ] T5 Evidence paths: attach `selection` (reasonKind `no-eligible-provider`, poolSize 0, evaluated []) to the QUALITY and EFFICIENT "No eligible provider currently covers this role." entries, so no coordinated entry lacks it. Global uncoordinated guides (bestModelPerRoleGlobal/bestEfficientModelPerRoleGlobal) stay out of scope by design. No selection-policy change.
- [ ] T6 Tests (RED first where behavior is new): fallback (no eligible provider; leader unavailable), widened search (`wider-search-diversity`), exceptional repeat (`only-adequate-concentration` / `decisive-override`, with blockedBy on every evaluated row), Reviewer independence (`reviewer_independence` with an active Builder). Synthetic fixtures labelled synthetic; no invented benchmarks; no threshold changes.
- [ ] T7 Verify + commit; re-run related files and full suite with real deps vs base.

## Acceptance
- Saved strategy for the dfd018 fixture shows, per role, every evaluated candidate and why each was blocked or chosen.
- Zero change in picks for existing fixtures/tests.
- Old `project-strategy.json` files remain readable.

## Progress / evidence
- T1 RED observed (src stashed): `not ok 1`, `not ok 2`, `not ok 4` (e.g. "Explorer has selection"); `# pass 2 # fail 3`.
- T2/T3 GREEN: `selection` on buildAiTeam/buildEfficientTeam entries (concentrationBlockCause helper; passesConcentration = cause===null); project-strategy.js copies selection + providerCapacity. `node --test test/team-selection-evidence.test.js`: pass 5 fail 0. Related 6 files: 152/152 pass.
- Full suite in the evidence worktree (orchestrator report): 2444 tests, **5** failures claimed (analyst-picker T27/T29, T23 wire, fork bundle ×2), claimed identical on base with stash.
- CORRECTION: the first writer did NOT add a synthetic exceptional-repeat test and dfd018 has no Builder, so reviewer_independence, widened search, exceptional repeat and the no-eligible fallback are untested and the two no-eligible entries lack `selection`; tracked as T5-T6. Earlier T1 wording overstated coverage.

### Cursor integration on `feat/kairo-cursor-baseline` (2026-10-01)

- Cherry-picked `1380a968e` → tip `de3a74e5e` on `kairo-plan1-baseline`.
- Related suite: `test/team-selection-evidence.test.js` + intelligence/strategy/contracts → **146/146 pass**.
- Full `node --test 'test/*.test.js'` on **integrated tip** (`de3a74e5e`): **2444 tests, 3 fail, 1 skip** — not 5.
- Same command on **clean baseline** (`80e9ad0ad`, parent before evidence): **2439 tests, 3 fail, 1 skip** — **same three names and errors**.
- Failures confirmed on this baseline (do not import the other-base “fork bundle ×2” diagnosis):
  1. `analyst-picker-views.test.js` T27 — `assert.match` on null explanation
  2. `analyst-picker-views.test.js` T29 — same
  3. `analyst-preflight-analyze-wire.test.js` T23 wire — `every row carries its own explanation`
- Fork-bundle / host-launch tests that were named in the other report **pass** on this baseline (e.g. host-launch installed fork bundle ok).
- Evidence delivery did **not** introduce these three; they pre-exist on `80e9ad0ad`. Out of scope to fix here unless authorized.

## Next step
T5 → T6 → T7 on the evidence branch (or continue on this baseline). Coordinate further `project-strategy.js` shape only if needed.
