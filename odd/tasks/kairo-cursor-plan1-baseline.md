# Kairo Cursor Plan 1 — clean Ratatui+analyst baseline

Locator: `odd/tasks/kairo-cursor-plan1-baseline.md`
Worktree: `agentic-harness-worktrees/kairo-plan1-baseline`
Branch: `feat/kairo-cursor-baseline`
Engram mirror: `odd/kairo-cursor-plan1-baseline/tasks` (project `harness`)

## Objective

Establish a clean integration baseline from Ratatui and preserve analyst T28/T29 so Claude can build native setup/Ops depth on a shared hash. Cursor owns integration.

## Problem

`feat/ratatui-host` and `feat/kairo-startup-analyst-team` diverged (125/199). Herd-shell dirty WIP must not be pulled in. Cockpit/Ink must stay retired; Pi `.5` stays the RPC engine.

## Scope

### In
1. Baseline merge: Ratatui base + analyst T28/T29 (eligible assignment, revalidated approve, analysis progress, team proposal).
2. Integrated tests: analyst→analyze→propose→approve→chat; access loss→recovery→approve/reject; sessions/drafts/restore.
3. Later: integrate Claude finished commits; full suites; package validation (separate auth for real provider / push / PR).

### Out
- herd-shell session-handoff / context-fill dirty tree
- Restoring cockpit/Ink product UI
- Push, PR, merge, publish without separate authorization

## Constraints

- Rust = only interactive UI (`kairo`/`start`/`resume`/`ui`/`shell`)
- Pi fork `0.87.1-kairo.5` = RPC engine only
- Conflict resolution: prefer analyst for picker/team/UI conflicts; never reintroduce retired product UIs

## Tasks

- [x] P1-T1 — Merge analyst into Ratatui baseline; resolve conflicts; deliver base hash to Claude
- [ ] P1-T2 — Integrated tests (Rust UI ↔ real sidecar; label simulations)
- [ ] P1-T3 — Integrate Claude commits; full suites; record failures honestly
- [ ] P1-T4 — Final package validation evidence (binaries, columns, Windows CLI); no remote delivery without auth

## Routing

- P1-T1: delegated-direct writer (merge touches many files; parent owns strategy)
- Route: delegated | Trigger: writer (2+ non-trivial) + preparation

## TDD

Mode: unknown for this integration branch — run focused then full applicable suites; do not invent RED for merge-only port.

## Acceptance (P1-T1)

- Entries `kairo`, `start`, `resume`, `ui`, `shell` coherent
- Analyst + team work from Rust
- Base commit hash published for Claude


## Progress / evidence

### P1-T1 — Merge baseline

- Base: `feat/ratatui-host` @ `4fd5e277e`
- Integrated: `feat/kairo-startup-analyst-team` @ `87f063eec`
- Conflict policy: took analyst (`--theirs`) for all 19 conflicted paths after verifying Rust UI function set is a superset (0 ratatui-only fns in `main.rs`) and deletions replace the old simple picker.
- Preserved: Pi `0.87.1-kairo.5`; CLI `kairo`/`ui`/`start`/`resume`/`shell` → `launchRatatuiHost`; retired cockpit/Pi opt-outs still throw.
- Dropped expired `.npmrc` Pi.5 cooldown exclude (past 2026-09-29).
- Did **not** import herd-shell dirty WIP (session-handoff / context-fill).
- Merge commit / base hash for Claude: `84d7f8573df91d2c41b587b81c8281a52fbcb99e`
- Focused Node: 212/212 pass (`team-presentation`, `project-strategy`, `project-analysis`, `project-team-sidecar`, analyst picker/access, `team-recovery`)
- `cargo test -p kairo-ui`: 295/295 pass (includes T28 analysis_progress tests)


### P1-T1 follow-up — pre-existing analyst test drift

- `conversation-service` bootstrap assertion still expected Explorer+Architect floor; T29 keeps analyst-justified roles only → assert `["Architect"]`.
- Regenerated `crates/kairo-ui/fixtures/verify-then-pick.ndjson` after aptitude explanation text drift (`UPDATE_WIRE_FIXTURE=1`); Rust `preflight_verify_wire_fixture_roundtrips_through_the_host` pass.
- These two failures already reproduced on pure `feat/kairo-startup-analyst-team` before the merge; not introduced by conflict resolution.
