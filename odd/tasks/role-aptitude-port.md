# Role-aptitude port
Objective: bring the role-aptitude module from `feat/kairo-startup-analyst-team` (4bb45cebb) into `delivery/kairo-runtime-clean` without merging that stale parallel history, then delete the feat branch.
Branch: `delivery/kairo-runtime-clean`. Delivery: feature-branch-chain (cached). Runner: `node --test`.

## Specs
- S1: Port only the role-aptitude module: `src/global/intelligence/role-aptitude-*.js` (8 files), `test/role-aptitude-*.test.js` (5 files), `fixtures/role-aptitude/v1/**`. Adapt imports to what exists on delivery; tests green.
- S2: Production wiring ported from feat (model-candidate-catalog, model-intelligence, project-strategy, service, team-decision) so the integration tests pass unweakened. With no aptitude evidence recorded, team formation output must stay identical (existing tests unchanged and green).
- S3: After S1 is committed and verified, delete local and remote `feat/kairo-startup-analyst-team` (Sam rule L9: no stale branches), with a verified bundle first.

## Tasks
- [x] P1 (S1, S2; 357f3a7e4; RED 39/2 -> GREEN 54/0; parent full JS 3123 pass / 0 fail; Codex review blocker snapshot leak fixed, rechecked) port module — delegated team-builder-codex (CODEX-HEAVY quota, Claude 7%)
- [ ] P2 (S3) bundle + delete feat branch — inline

## Log
- L1 (2026-10-15, Sam): "¿Arranco por unificar feat/kairo-startup-analyst-team con delivery/? si". Trial merge: 81 conflicts (mostly AA in crates/kairo-ui; delivery is a curated rebuild, feat is a stale parallel line). Aborted, no changes.
- L2 (2026-10-15, Sam): "si" to porting only the role-aptitude module instead of merging the branch.
- 2026-10-15 P1 attempt 1 blocked (no edits): role-aptitude-selection and -operational tests need production wiring (buildTeamSelectionPool, owned-evidence in buildAiTeam/buildEfficientTeam, service getOwnedEvidenceStore/AccountKey). Parent decision: port the wiring too (that wiring is the point of Sam's goal: real per-role aptitude in team formation) rather than weaken tests; S2 rewritten.
