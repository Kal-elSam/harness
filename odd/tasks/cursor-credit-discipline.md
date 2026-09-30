# Cursor credit discipline (global + future projects)

## Objective
Stop Cursor credit burn during implementations: single-thread by default, no unprompted subagent fan-out, reviewers only at work-unit close. Fix once globally so it covers all current projects; mirror in harness template so future projects inherit it.

## Problem
Evidence from user screenshot (2026-09-30): one implementation step cost
"Explored 9 files, 3 searches, ran 1 command" on the main agent PLUS
"Waiting for subagent" billing concurrently on top. Global ~/.cursor/agents
holds 16 agents (5 review-family, 8 SDD-*, judgment-day skill) so any
per-task reviewer trigger multiplies cost. kairo-work-snapshot is
alwaysApply:true (+1 MCP call per significant turn). Harness root .cursor/
is EMPTY (verified) so no project-level trigger exists there — global fix
covers everything.

## Scope
- `~/.cursor/rules/cost-discipline.mdc` (NEW, global, alwaysApply:true, short).
- `repo-template/.cursor/rules/cost-discipline.mdc` (NEW, same content, future projects).
- Out of scope: kairo-work-snapshot (left untouched, reported as optional),
  model selection, Auto on/off, dashboard usage analysis (user-side).

## Constraints
- Rule must be SHORT (alwaysApply loads every request; ~10 lines max).
- English artifacts. Builders keep full permissions — discipline only, no neutering.
- No installs; no unrelated template refactors.

## Authorized scope
User authorized global fix covering all + future projects (2026-09-30).
Route: delegated direct attempted (explore+writer failed insufficient funds
earlier this session); fallback inline with evidence recorded.

## Acceptance criteria
- Default Cursor implementations run single-thread, no background subagents unless asked.
- Reviewers/SDD phases run only at work-unit close on explicit request.
- Template copy exists for future harness-scaffolded projects.
- Both files structurally read back; template change committed selectively.

## TDD
Mode: off for config/rule docs (no behavior code). Functional checks: structural readback.

## Delivery
Template part: selective commit on current branch (worktree has unrelated
dirty files — stage only intended files). Global ~/.cursor part: no commit
(not a git target). No push anywhere.

## Tasks
- [ ] T1 — global rule ~/.cursor/rules/cost-discipline.mdc
- [ ] T2 — template rule repo-template/.cursor/rules/cost-discipline.mdc
- [ ] T3 — selective commit of template part + readback verify
- [ ] T4 — report + optional snapshot toggle note

## Progress
- Created feature doc before first write.

## Verification evidence
- Pending.

## Next step
- Implement T1.
