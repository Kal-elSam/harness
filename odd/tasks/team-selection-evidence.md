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
- Route: T1 inline-small? No: T1+T2 touch 2 non-trivial files -> one delegated writer (writer trigger).
- Heuristic ~400 changed lines is advisory only.

## Tasks
- [x] T1 RED: tests for `selection` on team entries (reasonKind, evaluated rows, blockedBy causes incl. an exceptional repeat) in `test/team-selection-evidence.test.js`.
- [x] T2 GREEN: implement `selection` in `model-intelligence.js` (no behavior change; existing tests unchanged and green).
- [x] T3 RED+GREEN: `buildProjectStrategy` persists `selection` + `providerCapacity`; store round-trips; old file without `selection` still reads.
- [x] T4 Verify: full `npm test`, report failures honestly; commit work units (Conventional Commits, no AI attribution).

## Acceptance
- Saved strategy for the dfd018 fixture shows, per role, every evaluated candidate and why each was blocked or chosen.
- Zero change in picks for existing fixtures/tests.
- Old `project-strategy.json` files remain readable.

## Progress / evidence
- T1 RED observed (src stashed): `not ok 1`, `not ok 2`, `not ok 4` (e.g. "Explorer has selection"); `# pass 2 # fail 3`.
- T2/T3 GREEN: `selection` on buildAiTeam/buildEfficientTeam entries (concentrationBlockCause helper; passesConcentration = cause===null); project-strategy.js copies selection + providerCapacity. `node --test test/team-selection-evidence.test.js`: pass 5 fail 0. Related 6 files: 152/152 pass.
- Full `node --test test/*.test.js`: 108 failures, identical set on base (no node_modules in worktree; verified with git stash -u). Re-verified by orchestrator with real deps (symlinked node_modules): 2444 tests, 5 failures (analyst-picker T27/T29, T23 wire, fork bundle x2), identical on base with only tracked changes stashed, so pre-existing and unrelated. Committed as one work unit (see git log).
- Gap: dfd018 Reviewer rows show no reviewer_independence (Builder not an active role there); cause covered only by shared helper.

## Next step
Coordinate the project-strategy.js change with Cursor before merge into the integrated baseline.
