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
- P01 actual: 547 authored code+test lines (about 180 are a pure move in T1).
  User chose a single PR over a stacked split (size exception, 2026-09-23).
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

- [x] P01-T5 Always-visible subscription usage (added 2026-09-23 after the
  user's TTY review: "there is information that should always be visible,
  like our subscription usage — we had it before"). The persistent overview
  shows the legacy cockpit's compact USAGE line (Codex 5h/W, Claude S/W,
  Go windows, with LOW/LIMITED markers) taken from the same conversation
  service snapshot phase 2 already reads (no extra probe). Extract the
  cockpit's `compactUsageLines` text logic into a UI-free formatter reused
  by both. Before live data arrives the line reads `usage checking`; on
  failure `usage unknown`.
  - Extracted `compactUsageLines`' Codex/Claude/Go text (and
    `quotaWarnSuffix`) into `src/global/conversation/usage-summary.js`
    (`formatSubscriptionUsageSegments`); `cockpit/view.js` now calls it
    and re-exports `quotaWarnSuffix` for its other callers — output is
    byte-identical (existing cockpit-view tests pass unchanged).
    RED: `node --test test/usage-summary.test.js` → module not found.
    GREEN: same command → 5 pass, 0 fail; `node --test
    test/cockpit-view.test.js test/project-overlay.test.js` → 145 pass,
    0 fail (byte-identical confirmed). Commit: `cf72796`.
  - Renamed `loadKairoTeamAvailability` → `loadKairoLiveData` in
    `src/global/host/workspace-snapshot.js`, extended to also return
    `usage`/`providers` from the SAME `service.snapshot()` call (asserted
    by a test counting snapshot() invocations == 1). Added additive
    `subscriptions` field to `buildKairoWorkspaceSnapshot` with the same
    checking/unknown/real three-state contract as `team.rows`.
    `src/global/host/extension/index.js`: overview prints
    `USAGE · <segments>` right after SESSION (checking/unknown before/on
    a failed probe); `/kairo-usage` shows the same line plus its existing
    measured-token detail; `unavailableRoutesLines` shows it too.
    RED: `node --test test/workspace-shell-snapshot.test.js
    test/workspace-shell-extension.test.js` → SyntaxError (renamed
    export not found) then assertion failures against the new fields.
    GREEN: same command → 19 pass, 0 fail. Commit: `a1e08c9`.
  - Real render against `/Users/kal-el/Desktop/agentic-harness` (read-only,
    live strategy) confirms both phases:
    phase 1: `USAGE · checking`, every team row `checking`;
    phase 2: `USAGE · Codex 5h 80% / W 83% │ Claude S 60% / W 85% │
    Go 100% / 60% / 26%`, every team row `available`.

### Acceptance criteria

- Startup overview lists every role, not a count.
- A blocked assignment shows as blocked with Kairo's own warning text.
- No availability computed inside the widget; failures show `unknown`.
- Existing snapshot fields keep their shape (additive change).
- Subscription usage is visible at startup without any command.

### Progress

- Branch: `feat/kairo-pi-p01-team` from `origin/main` 54ecb3e; PR #338 open.
- Commits: `5cb8918`, `48b4b67`, `e378a6b` (T1–T3), `1e0e19e`/`0a1a748`
  (docs), `cf72796`/`a1e08c9` (T5) — each its own work-unit commit with
  tests.
- T1–T3, T5 done with observed RED→GREEN evidence above. T4 partial:
  local focused/full-suite evidence recorded; CI (Node 20/22/24) and the
  real TTY check are the parent's remaining items.
- Full suite after T5: `npm test` → 2083 tests, 2082 pass, 1 skipped,
  0 fail (baseline before T5 was 2076/2075/1/0 — net +7 tests, 0
  regressions).
- `git diff --stat origin/feat/kairo-pi-p01-team` (T5's two commits only)
  → 8 files changed, 318 insertions(+), 88 deletions(-).

### Next step

Parent: run CI across Node 20/22/24 and the real TTY check
(`kairo` against this project — the read-only render in T5's evidence
above already confirms the two-phase USAGE line end to end), then close
P01 and move to P02.

## P01.1 — Widget UI

### Why

User TTY review of P01 (2026-09-23): the string-array widget is plain,
unaligned and uncolored, and Pi caps string widgets at 10 lines
(`MAX_WIDGET_LINES`), which truncated the Reviewer row. The user asked for
two side-by-side panels and no `available` noise: approved team models are
expected to be available; only exceptions should surface, with a prompt to
re-analyze the project.

### Design

- `ctx.ui.setWidget(key, (tui, theme) => component)` — a component factory
  has no line cap and receives Pi's theme. Built from `pi-tui` `Box`,
  `HStack`/`VStack`, `Text`.
- Left panel USAGE: Codex (5h, W), Claude (S, W), Go windows as bars with
  percentages; green normally, warning color for LOW, error color for
  LIMITED. Footer: session + mode.
- Right panel TEAM: aligned columns role / model / via; no per-row status
  when available; `checking…` dimmed in the panel title while live data
  loads; a blocked row in error color with `BLOCKED`; footer lists
  `/kairo-*` commands.
- Narrow terminals stack the panels vertically instead of breaking.
- Blocked assignment: one `ctx.ui.notify` per blocked role per refresh
  naming role, model, Kairo's warning, and the next step
  (`kairo --legacy-cockpit` → `/project analyze` until P03 lands).
- Live check failure: one dim line saying availability could not be
  verified; never implies available.
- Data unchanged: same snapshot fields from P01; usage needs a structured
  (numeric) model extracted next to `usage-summary.js`, reused by the
  existing text formatter.

### Tasks

- [x] P01.1-T1 Structured usage model (providers → windows with label,
  remainingPercent, level normal/low/limited) in the UI-free module; the
  existing text formatter builds on it with byte-identical output.
  - `buildUsageModel({usage, providers})` added to
    `src/global/conversation/usage-summary.js`; `formatSubscriptionUsageSegments`
    now builds its text from the same model (`formatProviderSegment`/
    `formatWindowSegment`), so the two can never drift apart.
  - RED: `node --test test/usage-summary.test.js` — `SyntaxError: ...
    does not provide an export named 'buildUsageModel'`.
  - GREEN: `node --test test/usage-summary.test.js test/cockpit-view.test.js
    test/project-overlay.test.js` → 150 pass, 0 fail (existing
    formatSubscriptionUsageSegments/cockpit tests confirm byte-identical
    text output, unchanged).
  - Commit: `5b6d88b` feat(conversation): expose structured usage model
    alongside the text formatter.
- [x] P01.1-T2 Widget component: two panels side by side, stacked when
  narrow, themed; every team row always rendered (no 10-line cap).
  - `src/global/host/workspace-widget.js`: pure `renderKairoWorkspaceWidget
    (snapshot, width, theme, extraLines)` builds two `card.js` panels
    (USAGE bars from `usageModel`, TEAM rows); side by side at width ≥ 70,
    stacked below that. `createKairoWorkspaceWidget(snapshot, extraLines)`
    wraps it as a Pi `(tui, theme) => component` factory — no
    MAX_WIDGET_LINES cap. `card.js`'s `cardBottom`/`renderPanel` gained an
    optional `footer` label (backward compatible) so panel bottoms mirror
    `cardTop`'s title, e.g. `session: none · ask`.
    `workspace-snapshot.js` additively exposes `subscriptions.usageModel`
    (same structured model, built once alongside `segments`).
  - RED: `node --test test/workspace-widget.test.js` — module not found;
    `node --test test/workspace-shell-snapshot.test.js` — `usageModel`
    field missing from `deepEqual`.
  - GREEN: `node --test test/workspace-widget.test.js test/cockpit-view.test.js
    test/project-overlay.test.js test/usage-summary.test.js
    test/workspace-shell-snapshot.test.js` → 174 pass, 0 fail.
  - Commit: `0d2bbc9` feat(host): render the Kairo workspace widget as
    themed USAGE/TEAM panels.
- [x] P01.1-T3 Availability UX: no `available` marker, `checking…` title,
  blocked rows highlighted, one notify per blocked role with the
  re-analysis next step, failure line.
  - Enforced in `workspace-widget.js`: `teamRowLine` never prints
    "available"; `teamPanelTitle` dims to `TEAM · checking…` while any
    row is unresolved; a blocked row gets the error tone plus `BLOCKED`.
    `blockedRoleNotifications(team)` returns one entry per blocked role;
    `extension/index.js`'s `notifyBlockedRoles` calls `ctx.ui.notify(...,
    "warning")` once per entry on every `refreshWorkspace`. The one dim
    failure line (`extraLines`) is still appended below both panels.
    `/kairo-team` and the unavailable-routes fallback now render through
    `createKairoTextWidget` (uncapped) since 7 roles with warnings can
    exceed 10 lines; `/kairo-sessions`/`/kairo-usage`/`/kairo-route`/
    `/kairo-memory` stay plain string arrays (always well under 10 lines).
  - RED: mutation check — commenting out the `notifyBlockedRoles(ctx,
    snapshot)` call and re-running
    `node --test test/workspace-shell-extension.test.js` fails exactly
    the "notifies once per blocked role..." test (1 of 8 failing);
    restored immediately after.
  - GREEN: `node --test test/workspace-shell-extension.test.js
    test/workspace-shell-snapshot.test.js test/workspace-widget.test.js
    test/usage-summary.test.js test/cockpit-view.test.js
    test/project-overlay.test.js` → 182 pass, 0 fail.
  - Commit: `b1170fe` feat(host): wire the Pi extension to the themed
    workspace widget.
- [x] P01.1-T4 Evidence: render tests at 60/100/160 columns, full suite,
  CI, user TTY check.
  - Render tests: `test/workspace-widget.test.js` sweeps widths 60/100/160
    against a 7-role fixture (Project Analyst, Orchestrator, Builder,
    Reviewer, Tester, Researcher, Documenter), asserting every line's
    `visibleWidth(line) <= width` and every role's name present in the
    output (also verifies stacked-vs-side-by-side switching, no
    `available` marker, `BLOCKED` tone, footers, and the >10-line
    component path).
  - Full suite: `npm test` → 2099 tests, 2098 pass, 1 skipped
    (`KAIRO_LIVE_PI_TEST`, opt-in), 0 fail. (Baseline before this slice:
    2083/2082/1/0 — net +16 tests, all new, 0 regressions.)
  - `git log --oneline origin/main..HEAD` → `b1170fe`, `0d2bbc9`,
    `5b6d88b` (T1–T3), `34dbdc5` (planning docs, pre-existing).
  - `git diff --stat origin/main` (source+tests only, excluding the
    planning doc) → 9 files changed, 696 insertions(+), 160 deletions(-)
    = 856 authored lines — well above forecast; flagged for the parent's
    `ask-on-risk` delivery decision, same as P01's own overage, not
    resolved here.
  - CI (Node 20/22/24) and a real interactive Pi TTY check are the
    parent's remaining items (not run from this worktree — no live Pi
    session available here). The real-data render below is the closest
    equivalent available from this worktree.
  - Real render against `/Users/kal-el/Desktop/agentic-harness`
    (read-only, live strategy, identity theme, `visibleWidth` verified
    ≤ width at 100 and 160): both phases confirmed — phase 1 shows
    `usage checking` and `TEAM · checking…` with all 7 real roles
    already listed (Project Analyst, Orchestrator, Explorer, Architect,
    Builder, Debugger, Reviewer); phase 2 shows real bars (`Codex 5h 75%
    / W 82%`, `Claude S 44% / W 82%`, `Go 100% / 60% / 26%`) and
    `TEAM · active` with the same 7 roles, no role blocked, no
    `available` marker anywhere, side-by-side panels at both widths with
    every line within the given width.

### Acceptance criteria

- [x] All 7 roles visible with no truncation at common widths — verified
  by the 60/100/160 width sweep and the real-project render.
- [x] Two panels side by side when width allows; stacked otherwise; no
  line exceeds the given width — verified by `visibleWidth(line) <= width`
  assertions in the width sweep and by the real render.
- [x] No per-row `available`; blocked roles highlighted and notified once
  per refresh — verified by unit tests (including a RED mutation check
  for the notify call) and confirmed absent from the real render (no
  role happened to be blocked in the live project, so the highlighted/
  notified path is unit-test-only evidence here, not TTY evidence).
- [x] Cockpit output unchanged — `formatSubscriptionUsageSegments`,
  `test/cockpit-view.test.js`, and `test/project-overlay.test.js` all
  stayed green untouched throughout (150/174/182-pass runs above).

### Progress

- Branch: `feat/kairo-pi-p01-1-widget-ui` from `origin/main` 6b7b615, in
  worktree `/Users/kal-el/Desktop/agentic-harness-worktrees/p01-1-widget-ui`.
- Commits: `5b6d88b` (T1), `0d2bbc9` (T2), `b1170fe` (T3) — each its own
  work-unit commit with tests; this doc update is its own commit
  (`docs(odd): record P01.1 evidence`).
- T1–T4 done with observed RED→GREEN (or RED-mutation→GREEN for T3's
  notify behavior) evidence above.
- Delivery: 856 authored lines across the three work commits, well above
  the ~300-line-per-task planning heuristic — same pattern as P01. Not a
  single-writer decision; flagged for the parent's `ask-on-risk` call
  (single PR vs. chained split), per the cached delivery strategy.

### Next step

Parent: decide delivery (single PR vs. chained, per `ask-on-risk`), run
CI across Node 20/22/24, and do the real interactive Pi TTY check
(`kairo` against this project) — the read-only render in T4's evidence
above already confirms both render phases and both target widths outside
a live Pi session. No role was blocked in the real project at render
time, so the blocked/BLOCKED/notify path has unit-test evidence only;
worth a deliberate TTY check with a blocked role (e.g. via
`--legacy-cockpit` state) if the parent wants direct visual confirmation.

