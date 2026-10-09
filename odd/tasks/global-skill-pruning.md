# Global skill pruning

## Objective
Remove clearly auxiliary global skills that add discovery/context surface while preserving the Git and SDD delivery workflow.

## Scope
- Remove from `~/.agents/skills`: `skill-creator`, `skill-improver`, `skill-registry`, `gentle-ai-bench`, `judgment-day`, `rdd-defect-workflow`, `comment-writer`, `go-testing`, `systemic-issue-triage`, `find-skills`, and `interview-me`.
- Remove duplicate copies of the first nine from `~/.config/agents/skills`, where present.
- Update the local Skills CLI lock only through the supported CLI if it supplies removal; otherwise report stale lock entries rather than hand-editing generated state.

## Constraints
- Preserve `branch-pr`, `chained-pr`, `work-unit-commits`, all `sdd-*`, and all `caveman*` skills.
- Do not touch repository source or unrelated existing changes.
- No remote operations.

## Authorized scope
User authorized conservative pruning on 2026-10-09: remove auxiliary/specialized skills, retain Git/SDD workflow pending audit.
Route: delegated direct. Mapping trigger: global skill sources and registry span more than four files. Writer trigger: multiple non-trivial global mutations.

## Acceptance criteria
- All 11 selected names disappear from `~/.agents/skills`.
- Duplicate config copies of the nine applicable selected names disappear.
- Retained Git/SDD/caveman skills still exist.
- `npx skills list -g` no longer reports removed primary installations, or any limitation is recorded.

## TDD
Mode: off; configuration cleanup. Checks: file existence and `npx skills list -g`.

## Delivery
Strategy: exception-ok. Forecast: one repository tracker file; global paths are not committed. Selectively commit only this tracker after verification, subject to the current branch policy.

## Tasks
- [x] T1 — remove selected global skill copies using exact-path deletion
- [x] T2 — verify retained/removed inventory; CLI check recorded as unavailable
- [x] T3 — update tracker, mirror it to Engram, and selectively commit tracker

## Progress
- Created before first mutation.
- Read-only audit found nine selected names duplicated under `~/.config/agents/skills`; deleting only `~/.agents/skills` would not remove them for registry-consuming clients.
- T1: removed all eleven selected primary directories and nine duplicate config directories after runtime approval.
- T2: direct existence checks passed: every selected primary directory is absent; retained Git/SDD/caveman directories exist.
- CLI validation unavailable: `npx --no-install skills list -g` did not produce output within 10 seconds and exited 142 via enforced alarm. The local lock still lists `find-skills` and `interview-me`; it was intentionally not hand-edited.

## Verification evidence
- `PATH_CHECK=PASS` for all removed and retained paths.
- CLI list check: unavailable/timeout (exit 142); no claim made about CLI registry refresh.
- Native RDD assessment: unavailable. `gentle-ai review assess` classified due/high only because unrelated untracked files need an inventory declaration; canonical preflight then failed safely with `operation not permitted`. No review was run and no review boundary advanced.

## Next step
- No remaining task. CLI registry refresh remains unverified because the local CLI timed out; lock entries were deliberately preserved.
