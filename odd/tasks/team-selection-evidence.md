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

- [x] T5 Evidence paths: attach `selection` (reasonKind `no-eligible-provider`, poolSize 0, evaluated []) to the QUALITY and EFFICIENT "No eligible provider currently covers this role." entries, so no coordinated entry lacks it. Global uncoordinated guides (bestModelPerRoleGlobal/bestEfficientModelPerRoleGlobal) stay out of scope by design. No selection-policy change.
- [x] T6 Tests (RED first where behavior is new): fallback (no eligible provider; leader unavailable), widened search (`wider-search-diversity`), exceptional repeat (`only-adequate-concentration` / `decisive-override`, with blockedBy on every evaluated row), Reviewer independence (`reviewer_independence` with an active Builder). Synthetic fixtures labelled synthetic; no invented benchmarks; no threshold changes.
- [x] T7 Verify + commit; re-run related files and full suite with real deps vs base.

## Acceptance
- Saved strategy for the dfd018 fixture shows, per role, every evaluated candidate and why each was blocked or chosen.
- Zero change in picks for existing fixtures/tests.
- Old `project-strategy.json` files remain readable.

## Progress / evidence
- T1 RED observed (src stashed): `not ok 1`, `not ok 2`, `not ok 4` (e.g. "Explorer has selection"); `# pass 2 # fail 3`.
- T2/T3 GREEN: `selection` on buildAiTeam/buildEfficientTeam entries (concentrationBlockCause helper; passesConcentration = cause===null); project-strategy.js copies selection + providerCapacity. `node --test test/team-selection-evidence.test.js`: pass 5 fail 0. Related 6 files: 152/152 pass.
- Full `node --test test/*.test.js`: 108 failures, identical set on base (no node_modules in worktree; verified with git stash -u). Re-verified by orchestrator with real deps (symlinked node_modules): 2444 tests, 5 failures (analyst-picker T27/T29, T23 wire, fork bundle x2), identical on base with only tracked changes stashed, so pre-existing and unrelated. Committed as one work unit (see git log).
- CORRECTION: the first writer did NOT add a synthetic exceptional-repeat test and dfd018 has no Builder, so reviewer_independence, widened search, exceptional repeat and the no-eligible fallback are untested and the two no-eligible entries lack `selection`; tracked as T5-T6. Earlier T1 wording overstated coverage.
- T5/T6 (writer): RED observed first: `node --test test/team-selection-evidence-paths.test.js` -> pass 6 fail 1 (no-eligible entries lacked `selection`). After adding `selection: { reasonKind: "no-eligible-provider", poolSize: 0, evaluated: [] }` to both no-eligible entries: pass 7 fail 0. The other 6 tests (unavailable leader, widened search, decisive-override, only-adequate-concentration, Reviewer independence with/without alternative) are characterization-only: GREEN on first run; non-vacuity shown by temporarily mutating reviewer_independence cause, wider-search reasonKind (tests failed), then reverted. Fixtures synthetic `synth-*`. Code review: `result.selection` is always defined on the "leader temporarily unavailable" paths (result is null only when the role pool is empty, which is the no-eligible branch handled first; capabilityPool/adequateCandidates always retain the leader for non-negative gap values).

## Next step
Next: coordinate the project-strategy.js change with Cursor before merge into the integrated baseline.

## T5-T7 evidence (orchestrator)
- T5/T6: new `test/team-selection-evidence-paths.test.js` (7 synthetic `synth-*` tests: no-eligible fallback RED->GREEN, leader-unavailable, wider-search-diversity, decisive-override, only-adequate-concentration, Reviewer independence with/without alternative). Production diff is evidence-only (+5 lines, NO_ELIGIBLE_SELECTION on the two no-eligible entries); no policy change.
- Non-vacuity re-checked by the orchestrator: mutating `decisive-override` reasonKind fails tests 4 and 7; the writer's mutations of `reviewer_independence` and `wider-search-diversity` also fail tests.
- T7: related 7 files 159/159. Full suite with real deps: 2451 tests, 5 failures, identical to the pre-existing base set (analyst-picker T27/T29, T23 wire, fork bundle x2).
- Known evidence limit: when the real leader is temporarily unavailable, the displayed primary is the unavailable leader and `selection.evaluated` lists only eligible candidates; the cause stays in `reason`. Latent pre-existing edge: buildEfficientTeam could crash on `result.entry` if a negative gapValue dropped the leader (not constructible today; not changed).
