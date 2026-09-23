# Kairo Pi Parity

## Objective

Bring the interactive Kairo cockpit experience into the Pi host so `kairo`
(Pi) reaches functional parity with `kairo --legacy-cockpit` before any
release of the new host.

## Problem

The Pi host renders the PROJECT TEAM as a count ("5 routed roles") and does
not expose analysis, editing, approval, ASK/PLAN/AGENT, plans, or execution.
Those flows exist in `src/global/conversation/service.js` and the legacy
cockpit, but the Pi extension does not connect them.

## Why

Showing a role count is not a migration of the experience. Kairo must stay
the single source of truth for sessions, strategy, availability, and
execution; Pi supplies widgets and overlays only.

## Scope (slices, in order)

- P01 — Visible team: all roles (Project Analyst, Orchestrator, project team)
  with model, route, and live availability at startup; long reasons and
  warnings in a readable detail view.
- P02 — Single session binding (`kairo` creates, `kairo resume` reopens).
- P03 — Analysis (`/project`, `/project analyze`) via existing service.
- P04 — Team editing and explicit approval.
- P05 — Conversation: ASK/PLAN/AGENT, mode switch, transcript, `/clear`.
- P06 — Work: plans, approval, execution and revalidation through
  `planExecution`/`executePlan` (exact scope to be defined before starting).
- P07 — Diagnostics: models/evidence, access verification, usage, providers.
- Closing acceptance: contract + integration tests per slice, full suite,
  real TTY run start→analysis→approval→ASK/PLAN→execution→resume, then
  release and global install.

## Constraints

- Additive snapshot changes (`kairo.workspace-shell/v1`); the extension calls
  existing Kairo modules, never duplicates selection, availability, or
  persistence rules.
- `--legacy-cockpit` stays available during the transition.
- Small PRs to `main`; no publishing between slices.
- Never present a blocked assignment as available.

## TDD

- Mode: strict (source: `~/.claude/CLAUDE.md` "Strict TDD Mode: enabled").
- Runner: `node --test <file>` for focused tests, `npm test` for the suite.
- Package manager: pnpm (`pnpm install --frozen-lockfile`); never `npm install`.

## Delivery

- Strategy: `ask-on-risk`. P01 forecast: ~300 authored changed lines, one PR.
- RDD: off (decided by default) — ordinary checks only.

## P01 — Visible team

### Design

- Availability source of truth: `resolveAssignmentAvailability` (today in
  `src/global/cockpit/view.js`) fed by the conversation service's
  `modelIntelligence` (`eligibility`, `claudeEntitlement`, `cursorAccess`).
  The widget never infers availability itself.
- The service snapshot probes adapters and can be slow, so the host renders
  in two phases: the team from the persisted strategy immediately with
  availability `checking`, then re-renders once Kairo's live availability
  resolves. A failed check renders `unknown`, never `available`.

### Tasks

- [x] P01-T1 Move `resolveAssignmentAvailability` into a UI-free module and
  re-export it from `cockpit/view.js` (no behavior change).
  - Moved to `src/global/conversation/assignment-availability.js`;
    `cockpit/view.js` re-exports it, no other importer changed.
  - RED: `node --test test/assignment-availability.test.js` failed with
    `ERR_MODULE_NOT_FOUND` (module didn't exist yet).
  - GREEN: `node --test test/assignment-availability.test.js
    test/cockpit-view.test.js test/project-overlay.test.js` → 145 pass,
    0 fail.
  - Commit: `5cb8918` refactor(conversation): extract assignment
    availability to UI-free module.
- [x] P01-T2 Snapshot exposes the full team: Project Analyst, Orchestrator,
  and every project-team role with model, route (`via`), access mode, and
  an availability field; availability is injected from Kairo, defaulting to
  `checking`.
  - Added `team.rows` (additive; `team.state`/`team.assignments` unchanged)
    and `loadKairoTeamAvailability({cwd}, deps)` in
    `src/global/host/workspace-snapshot.js`.
  - RED: `node --test test/workspace-shell-snapshot.test.js` failed —
    `loadKairoTeamAvailability` not exported (SyntaxError at module load).
  - GREEN: `node --test test/workspace-shell-snapshot.test.js` → 10 pass,
    0 fail.
  - Commit: `48b4b67` feat(host): expose full team roster with live
    availability in snapshot.
- [x] P01-T3 Pi overview shows every role on its own row (role · model ·
  via · status) instead of a count; `/kairo-team` shows full warnings and
  reasons; two-phase availability refresh on `session_start`.
  - `formatKairoWorkspaceLines`/`linesForView`/`unavailableRoutesLines` in
    `src/global/host/extension/index.js` now render `team.rows`;
    `session_start` renders immediately (checking) then again once
    `loadKairoTeamAvailability` resolves (or fails closed to `unknown`
    plus one explanatory line).
  - RED: `node --test test/workspace-shell-extension.test.js` → 6 of 7
    failing (assertion/deepEqual mismatches against the new row format).
  - GREEN: `node --test test/workspace-shell-extension.test.js` → 7 pass,
    0 fail.
  - Commit: `e378a6b` feat(host): show every routed role in the Pi
    workspace overview.
- [~] P01-T4 Evidence: focused tests, full suite, CI Node 20/22/24, and a
  real TTY check of `kairo` against this project.
  - Focused: `node --test test/workspace-shell-snapshot.test.js
    test/workspace-shell-extension.test.js test/assignment-availability.test.js`
    → 25 pass, 0 fail.
  - Full suite: `npm test` → 2076 tests, 2075 pass, 1 skipped
    (`KAIRO_LIVE_PI_TEST` live-Pi test, opt-in), 0 fail. (Baseline before
    this slice: 2065/2064/1/0 — net +11 tests, all new, 0 regressions.)
  - `git diff --stat origin/main` → 7 files changed, 442 insertions(+),
    105 deletions(-) (547 authored lines total; above the ~300-line
    forecast — flagged for the parent's `ask-on-risk` delivery decision,
    not resolved here).
  - CI Node 20/22/24 and the real TTY check against this project are the
    parent's remaining items (not run from this worktree).

### Acceptance criteria

- Startup overview lists every role, not a count.
- A blocked assignment shows as blocked with Kairo's own warning text.
- No availability computed inside the widget; failures show `unknown`.
- Existing snapshot fields keep their shape (additive change).

### Progress

- Branch: `feat/kairo-pi-p01-team` from `origin/main` 54ecb3e.
- Commits: `5cb8918`, `48b4b67`, `e378a6b` (T1–T3, each its own work-unit
  commit with tests).
- T1–T3 done with observed RED→GREEN evidence above. T4 partial: local
  focused/full-suite evidence recorded; CI (Node 20/22/24) and the real
  TTY check are the parent's remaining items.

### Next step

Parent: run CI across Node 20/22/24 and the real TTY check
(`kairo` against this project), then close P01 and move to P02.
