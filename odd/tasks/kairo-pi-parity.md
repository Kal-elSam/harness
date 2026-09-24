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
- P03 — Analysis (`/project`, `/project analyze`) via existing service;
  re-analysis never removes the active team before approval.
- P04 — Team editing and explicit approval.
- P05 — Conversation: ASK/PLAN/AGENT, mode switch, transcript, `/clear`;
  Kairo owns all normal input.
- P06 — AGENT continuation: plan approval, explicit role, route preview,
  confirmation, execution, cancel, and status through
  `planExecution`/`executePlan` (scope defined in the design review below).
- P07 — Diagnostics: models/evidence, access verification, usage, providers.
- Closing acceptance: contract + integration tests per slice, full suite,
  real TTY run start→analysis→approval→ASK/PLAN→execution→resume, then
  release and global install.

See "Design review (2026-09-24)" at the end of this document for the
code-verified scope, gaps, and acceptance criteria of P02–P07.

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
    restored immediately after. **Note (2026-09-23, post-review):** this
    was a post-hoc mutation check run AFTER implementing the notify
    wiring, not a true test-first RED observed before writing the code —
    strict TDD calls for the test to fail first, then the code to make it
    pass. The two defect fixes below (post-review) instead wrote each
    failing test first and observed a genuine module-level RED before
    touching implementation code, per the coordinator's explicit
    correction.
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

### Post-review fixes (2026-09-23)

The coordinator caught two defects against the approved design in the
real render above, before this task was reported done:

1. **TEAM columns not aligned.** The original `teamRowLine` used a
   literal fixed `"  "` gap between role/model/via, so the model column
   landed at a different visible column per row (e.g. `Orchestrator  Kimi
   K3  opencode-go` vs. a much wider `Project Analyst` row) instead of
   the approved aligned-columns design.
2. **Footer overflow.** The TEAM footer's `/kairo-*` command list relied
   on `cardBottom`'s own `truncateToWidth`, which cut `/kairo-memory`
   mid-name at narrower widths, leaving a partial command plus a stray
   `[0m` artifact visible in the real render at width 100.

Fix:
- `teamColumnWidths(rows, innerWidth)` pads role/model to the longest
  real `visibleWidth` per column; only the model column ever truncates
  (`truncateToWidth`) when space is tight — the role column never does.
- `teamPanelFooter(panelWidth)` / `fitFooterCommands` now render only
  whole `/kairo-*` commands that fit the real footer-label budget
  (`footerLabelBudget`, mirroring `cardBottom`'s own arithmetic),
  dropping every trailing command starting from the first that wouldn't
  fit — never truncating one mid-name.
- `renderKairoWorkspaceWidget` now computes panel widths up front via
  the new exported `computeSideBySideWidths(width)` and threads them
  into the TEAM body/footer builders, instead of building TEAM content
  before knowing the panel width.

TDD (true test-first this time, per the coordinator's correction):
- RED (module-level, before any implementation change): added
  `computeSideBySideWidths` to the test import and two new test blocks
  (column alignment at widths 100/160; footer-never-cuts-a-command at
  widths 60/100/160) to `test/workspace-widget.test.js`, then ran
  `node --test test/workspace-widget.test.js` — failed immediately with
  `SyntaxError: ... does not provide an export named
  'computeSideBySideWidths'` (the whole file failed to load, 0 of the 18
  tests ran) — a genuine RED observed before touching
  `workspace-widget.js`.
- GREEN: implemented `computeSideBySideWidths`, `teamColumnWidths`,
  `padColumn`, `fitFooterCommands`, `footerLabelBudget`, and rewired
  `renderKairoWorkspaceWidget`/`teamPanelBody`/`teamRowLine`/
  `teamPanelFooter` to use them; `node --test test/workspace-widget.test.js`
  → 18 pass, 0 fail (including the 5 new alignment/footer tests).
- Related suites: `node --test test/workspace-widget.test.js
  test/workspace-shell-extension.test.js test/workspace-shell-snapshot.test.js
  test/usage-summary.test.js test/cockpit-view.test.js
  test/project-overlay.test.js` → 187 pass, 0 fail.
- Full suite: `npm test` → 2104 tests, 2103 pass, 1 skipped
  (`KAIRO_LIVE_PI_TEST`, opt-in), 0 fail. (One transient failure on a
  first run — `test/quick-ask.test.js`'s "codex's timeout resets on real
  output" — an unrelated, pre-existing timing test not touched by this
  slice; passed alone in isolation and on a clean full-suite rerun,
  confirmed not a regression from this change.)
- Commit: `9e2a8f9` fix(host): align TEAM columns and stop cutting footer
  commands mid-name.
- Real render re-verified against `/Users/kal-el/Desktop/agentic-harness`
  at widths 100 and 160 (read-only, identity theme): TEAM's model column
  now starts at the same visible position on every row (`Project
  Analyst  GPT-6-Astra    codex`, `Orchestrator     Kimi K3        opencode-go`,
  ...); the width-100 footer now reads `/kairo-team · /kairo-route ·
  /kairo-usage` (whole commands only, `/kairo-memory` dropped cleanly,
  no `[0m` artifact); width-160 footer shows all four commands in full.

- `git log --oneline origin/main..HEAD` (updated) → `9e2a8f9`,
  `d6b9d28`, `b1170fe`, `0d2bbc9`, `5b6d88b` (T1–T3 + fix), `34dbdc5`
  (planning docs, pre-existing).
- `git diff --stat origin/main` (updated, source+tests only, excluding
  the planning doc) → 9 files changed, 833 insertions(+), 160
  deletions(-) = 993 authored lines total across all commits in this
  slice — further above the ~300-line forecast; still flagged for the
  parent's `ask-on-risk` delivery decision, not resolved here.

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


## P01.2 — Fast, compact widget

### Why

User TTY review of P01.1 (2026-09-23): the widget took ~20–30 s to fill,
the 10-cell solid bars merged into a blob, Go windows had no labels, and
half-width panels left most of the row empty.

Measured on the user's machine: codex usage 0.7 s, opencode usage 2.2 s,
claude usage 4.7 s, full conversation-service snapshot 21.2 s. Usage waits
on model intelligence (catalogs, benchmarks, entitlements) that only
availability needs.

### Design

- Split live loading: subscription usage from the three usage readers in
  parallel (~5 s); team availability from the service snapshot separately.
  Each updates the widget as soon as it resolves.
- Last-known cache: persist the last live usage and availability under the
  Kairo home (per project for availability) with a timestamp; render it
  instantly on start in a dim tone with its age ("5m ago"), replaced by
  fresh data when it arrives. Never show cached availability as fresher
  than it is; failures keep the cached value marked stale.
- Visual: thin one-line bars (`━` in the level color for remaining, `─`
  muted for used); labels on every window (Codex `5h`/`W`, Claude `S`/`W`,
  Go `roll`/`W`/`M`); panels sized to their content, left-aligned, side by
  side with a 2-column gap, stacked when they do not fit.

### Tasks

- [x] P01.2-T1 Split usage loading from availability loading (parallel
  usage readers; availability via the service snapshot) and render each
  phase independently.
  - `loadKairoUsageData({cwd})` (workspace-snapshot.js) runs
    `readCodexUsage({cwd})`, `readClaudeUsage({})`, `readOpenCodeUsage({})`
    in parallel — same call shapes service.js's own snapshot() uses —
    and never throws (each reader already fails closed; `.catch(() =>
    null)` guards the rest).
  - `buildKairoWorkspaceSnapshot`/`loadKairoWorkspaceSnapshot` split their
    single `intelligence` argument into `usageIntelligence`/
    `availabilityIntelligence` (both default to the legacy `intelligence`
    for back-compat).
  - `extension/index.js`'s `session_start` handler fires `loadUsageData`
    and `loadLiveData` independently (`Promise.all` over two `.then`
    chains, each calling its own `rerender()`), so either can re-render
    the widget first, in whichever order it resolves, without waiting on
    the other.
  - RED: added `loadKairoUsageData` to the workspace-shell-snapshot.js
    test import plus new test blocks before writing any implementation —
    `node --test test/workspace-shell-snapshot.test.js` failed with
    `SyntaxError: ... does not provide an export named
    'loadKairoUsageData'` (whole file failed to load). Added the
    extension-side independent-resolution tests
    (`test/workspace-shell-extension.test.js`) against the OLD two-phase
    extension code — 4 of 9 failed (`expected 2, actual 1` /
    `expected 3, actual 2` / missing-data assertions), a genuine RED.
  - GREEN: `node --test test/workspace-shell-snapshot.test.js` → 15 pass,
    0 fail; `node --test test/workspace-shell-extension.test.js` → 9
    pass, 0 fail (including the two new independent-resolution-order
    tests and the rewritten availability-failure test).
  - Full suite: `npm test` → 2109 tests, 2108 pass, 1 skipped, 0 fail
    (baseline 2104/2103/1/0 — net +5, all new, 0 regressions).
  - Commit: `a20765a` feat(host): split usage loading from availability
    loading in Pi widget.
- [x] P01.2-T2 Last-known cache for usage and availability with age, stale
  handling, and tests.
  - New `src/global/host/workspace-cache.js`: `readCachedUsage`/
    `writeCachedUsage` (global, under `<home>/.harness/`) and
    `readCachedAvailability`/`writeCachedAvailability` (per project,
    under `<home>/.harness/sessions/<projectKey>/`), following
    project-strategy-store.js's own conventions (schema field,
    `writeAtomicJson`, `mkdir` recursive).
  - `loadKairoWorkspaceSnapshot` reads the last-known cache internally
    (only while its own side is still `undefined`/`null`) and writes a
    freshly resolved value back (only for a real, non-null value) — no
    cache-specific code needed in `extension/index.js`, since it already
    forwards `usageIntelligence`/`availabilityIntelligence` from T1.
  - `buildKairoWorkspaceSnapshot`/`workspaceSubscriptions`/`workspaceTeam`
    gained a `cached`/`state: "cached"` branch with `cacheAgeMs`, used
    only while the live side hasn't resolved (or explicitly failed) —
    real live data always overwrites it once it arrives.
  - `workspace-widget.js` renders the cached branch dim (`muted` tone,
    "cached Xm ago" line for USAGE; "TEAM · cached Xm ago" title for
    TEAM), with `BLOCKED` still in the error tone even while cached.
  - RED (module-level, before implementation): `test/workspace-cache.test.js`
    failed to load (`does not provide an export named 'readCachedUsage'`
    etc.); new cache-branch tests in `test/workspace-shell-snapshot.test.js`
    and `test/workspace-widget.test.js` failed genuinely (3 assertion
    failures in the snapshot file, 2 in the widget file) against the
    pre-cache code.
  - GREEN: `node --test test/workspace-cache.test.js` → 8 pass, 0 fail
    (round-trip, malformed/missing file returns `null`, global-vs-
    per-project isolation, real atomic write verified on disk in a temp
    home). `node --test test/workspace-shell-snapshot.test.js` → 24
    pass, 0 fail. `node --test test/workspace-widget.test.js` → 27 pass
    (at this point, before T3's additional tests), 0 fail.
- [x] P01.2-T3 Visual: thin bars, labeled windows, content-sized panels.
  - `paintUsageBar` now paints `━` (remaining, level-colored) and `─`
    (used, muted) instead of the old solid `█`/`░` block bar that "merged
    into a blob" per the reported defect.
  - `usage-summary.js`'s `goUsageWindows` labels Go's real `rolling`/
    `weekly`/`monthly` window names `roll`/`W`/`M` inside
    `buildUsageModel` (consumed directly by the widget); the legacy
    cockpit's `formatSubscriptionUsageSegments`/`formatProviderSegment`
    deliberately keep Go unlabeled (`showLabel = provider.name !== "Go"`)
    so its byte-identical terse-bar contract (`test/cockpit-view.test.js`)
    is preserved — this was a real regression caught during T3 (see
    below) and fixed before commit.
  - `computeSideBySideWidths(width, usageBody, teamRows)` now sizes each
    panel to its OWN content (`naturalContentWidth`/
    `desiredTeamContentWidth`, including a reserved `BLOCKED` suffix
    width) instead of a naive half-width split; side by side only when
    both desired widths plus a 2-column gap fit the given width, both
    equal to the full width when stacked — so a line can never exceed
    the given width either way.
  - RED: added the bar-character, label, and content-sizing tests to
    `test/workspace-widget.test.js` and the Go-label test to
    `test/usage-summary.test.js` before touching `workspace-widget.js`/
    `usage-summary.js` — `node --test test/workspace-widget.test.js` → 3
    genuine failures (bar characters, content-sized-at-160, the new
    `computeSideBySideWidths` content-sizing test); `node --test
    test/usage-summary.test.js` → 1 genuine failure (Go label mapping).
  - GREEN (first pass): implementing the bar/label/sizing changes turned
    all of the above green, but broke 2 PRE-EXISTING tests in
    `test/cockpit-view.test.js` (the legacy compact USAGE bar started
    showing Go labels it never had) — caught by running the related
    suites together, not by the new tests themselves. Fixed by keeping
    `formatWindowSegment`/`formatProviderSegment` label-free for Go (see
    above), with a new regression test added
    (`test/usage-summary.test.js`: "formatSubscriptionUsageSegments
    never prints Go's roll/W/M labels").
  - Also fixed one more RED→GREEN cycle: a `markerTheme()`-based existing
    test ("shows no per-row 'available' marker, but colors a blocked row
    with BLOCKED") started failing once TEAM panels became tightly
    content-sized, because `markerTheme` wraps text in literal
    `<role>...</role>` characters (unlike a real ANSI theme, whose escape
    codes are zero-width to `visibleWidth`), which are counted as real
    content by the exact-fit column math and got truncated by
    `cardLine`. Fixed by rendering that specific assertion at a width
    that forces the stacked (full-width) layout instead of the
    content-sized side-by-side one — the per-row marker/tone behavior
    under test doesn't depend on panel width, and stacked mode gives the
    row generous real headroom regardless of the test double's overhead.
    This is a test-only artifact; real (ANSI) themes add zero visible
    width, so production panels are unaffected.
  - GREEN (final): `node --test test/workspace-widget.test.js` → 27
    pass, 0 fail; `node --test test/usage-summary.test.js
    test/cockpit-view.test.js test/workspace-widget.test.js` → 118 pass,
    0 fail.
  - Commit: `8dc4a0f` feat(host): add last-known cache and redesign the
    Pi widget's usage bars (T2+T3 combined — see the "single writer"
    note below).
- [x] P01.2-T4 Evidence: render tests, full suite, CI, user TTY check.
  - Render tests: `test/workspace-widget.test.js` sweeps widths
    60/100/160 for both "no line exceeds width, all 7 roles present" and
    the new "panels are sized to their own content, never stretched to
    half the terminal" (with an explicit combined-width-vs-full-width
    check at 160); a dedicated "labels every usage window, including
    Go's roll/W/M" test; two `computeSideBySideWidths` unit tests
    (content-sized side-by-side, and forced stacking with no width
    overflow).
  - Full suite: `npm test` → 2137 tests, 2136 pass, 1 skipped
    (`KAIRO_LIVE_PI_TEST`, opt-in), 0 fail. (Baseline before this slice:
    2104/2103/1/0 — net +33 tests, all new, 0 regressions. The
    documented pre-existing flake, `test/quick-ask.test.js`'s "codex's
    timeout resets on real output", was not observed on this run.)
  - `git log --oneline origin/main..HEAD` → `8dc4a0f` (T2+T3), `a20765a`
    (T1), `e94d32d` (planning docs, pre-existing).
  - `git diff --stat origin/main -- src test` → 10 files changed, 961
    insertions(+), 107 deletions(-) = 1068 authored lines — well above
    the ~400-line planning heuristic, same pattern as P01/P01.1; flagged
    for the parent's `ask-on-risk` delivery decision, not resolved here.
  - CI (Node 20/22/24) and a real interactive Pi TTY check are the
    parent's remaining items (not run from this worktree — no live Pi
    session available here).
  - Real timing + render against `/Users/kal-el/Desktop/agentic-harness`
    (read-only; `loadKairoUsageData`/`loadKairoLiveData` called directly,
    so no cache was written to the user's real home): usage ready at
    **+6.2s**, availability ready at **+23.3s** — matching the "Why"
    section's measured expectations (usage ~5s, availability ~20s).
    Rendered at widths 100 and 160 with an identity theme after both
    resolved: identical content-sized panels at both widths (proving
    they're no longer stretched to the terminal width), real bars
    (`Codex 5h ━━━━━━━━── 75%`, `W ━━━━━━━━── 82%`; `Claude S
    ━───────── 7%`, `W ━━━━━━━━── 78%`; `Go roll ━━━━━━━━━━ 100%`, `W
    ━━━━━━──── 60%`, `M ━━━─────── 26%`), Go's `roll`/`W`/`M` labels
    visible, `TEAM · active` with all 7 real roles
    (Project Analyst/Orchestrator/Explorer/Architect/Builder/Debugger/
    Reviewer), no role blocked, no `available` marker, no line exceeding
    either width.

### Single-writer note

This slice was implemented by one delegated writer covering T1–T4. T1
landed as its own commit (`a20765a`). T2 and T3 were written and tested
sequentially against the same shared module (`workspace-widget.js`, whose
dim/cache rendering (T2) and bar/label/sizing rewrite (T3) touch
overlapping functions), so by the time both were green there was no clean
hunk-level split left that wouldn't risk a broken intermediate commit;
they were committed together (`8dc4a0f`) with a message documenting both.
Future slices with foreseeably overlapping edits in one file should
commit after each task before starting the next to keep the one-commit-
per-task convention intact.

### Acceptance criteria

- [x] With a warm cache the widget is fully drawn on start; fresh usage
  within ~5 s; availability later without blocking usage — verified by
  the extension's independent-resolution tests (T1) and the cache
  round-trip/dim-render tests (T2); the real render above additionally
  confirms usage resolves in ~6s and availability in ~23s, with usage
  never waiting on availability.
- [x] Bars read as separate one-line bars; every window labeled —
  verified by the bar-character and label tests (T3) and the real render
  above.
- [x] Panels do not stretch to half the terminal; no line exceeds the
  width — verified by the content-sizing tests and the width-sweep tests
  (T3/T4), and by the real render showing identical panel widths at 100
  and 160.

### Progress

- Branch: `feat/kairo-pi-p01-2-fast-widget` from `origin/main` b5f601e, in
  worktree `/Users/kal-el/Desktop/agentic-harness-worktrees/p01-2-fast-widget`.
- Commits: `a20765a` (T1), `8dc4a0f` (T2+T3, see the single-writer note
  above) — this doc update is its own commit (`docs(odd): record P01.2
  evidence`).
- T1–T4 done with observed RED→GREEN evidence above, including two
  regressions caught and fixed mid-T3 (the legacy cockpit's Go-label
  leak, and a `markerTheme()` test-double width artifact) before
  reporting done.
- Delivery: 1068 authored lines across the two work commits, well above
  the ~400-line-per-task planning heuristic — same pattern as P01/P01.1.
  Not a single-writer decision; flagged for the parent's `ask-on-risk`
  call (single PR vs. chained split), per the cached delivery strategy.

### Next step

Parent: decide delivery (single PR vs. chained, per `ask-on-risk`), run
CI across Node 20/22/24, and do the real interactive Pi TTY check
(`kairo` against this project) — the read-only render in T4's evidence
above already confirms real timing (usage ~6s, availability ~23s) and
both target widths outside a live Pi session. No role was blocked in the
real project at render time, so the cached-and-stale and blocked-while-
cached paths have unit-test evidence only; worth a deliberate TTY check
(e.g. airplane mode for the usage readers, or a blocked role via
`--legacy-cockpit` state) if the parent wants direct visual confirmation
of the last-known cache actually going stale.

## Design review (2026-09-24)

Read-only review of P02–P07 against the code, before starting P02. No
code, branch, or tests changed. Symbols are cited by name; line numbers
refer to `main` at `0f8ad58`.

### Verified premises

- Pi input interception exists in the **installed** Pi 0.87.1
  (`@earendil-works/pi-coding-agent`,
  `dist/core/extensions/types.d.ts`): `pi.on("input")` returns
  `InputEventResult` = `continue` | `transform` | `handled`; `handled`
  stops the input before Pi's own agent loop. Replies can be rendered with
  `pi.sendMessage` + `pi.registerMessageRenderer`; `pi.appendEntry`
  persists custom session entries.
- Pi session lifecycle: `session_start` carries
  `reason: "startup" | "reload" | "new" | "resume" | "fork"` and
  `previousSessionFile`; `session_before_switch` and
  `session_before_fork` are cancellable.
- Today the `kairo` host does not use any of these: the extension only
  calls `registerCommand`, `registerProvider`, and `on("session_start")`
  (`src/global/host/extension/index.js`). Pi's own model answers every
  normal input.

### Unverified (pending check, not a fact)

- The `input` event, `handled` result, and session events were verified
  only on 0.87.1. `MIN_PI_VERSION` is `0.85.1`
  (`src/global/host/launch-gentle-shell.js:7`). Whether 0.85.1 exposes
  them is unknown. See task R01.

### Gaps found

1. **P02 — session binding is spawn-only.** `KAIRO_SESSION_ID` is set once
   when Pi is spawned (`launch-gentle-shell.js`) and read by
   `workspace-snapshot.js`; nothing reacts to a Pi `new`/`resume`/`fork`,
   so a Pi session change keeps the old Kairo identity silently.
2. **P03 — re-analysis replaces the active team before approval.**
   `runBootstrapAnalysis` → `runLockedBootstrapAnalysis` persists by
   default (`persist` defaults to true; `writeProjectStrategyImpl` at
   `service.js:610`), overwriting the single strategy file with a
   `suggested` strategy on top of the active one. Only automatic recovery
   passes `persist: false`. `refreshProjectStrategy` keeping the team does
   NOT cover `/project analyze`. No cancel operation exists. Analyst
   selection and recommendation review live in UI code
   (`project-overlay.js`, `cockpit/app.js`).
3. **P04 — role picker lives in the cockpit UI** (`cockpit/view.js`).
   The service side (`getProjectTeamEditCatalog`,
   `setProjectTeamAssignment` gated on `suggested`,
   `approveProjectStrategy`) is reusable as-is.
4. **P05 — AGENT is identical to PLAN in the service.** `submitTask`
   routes both to `submitArchitecture`; AGENT behavior only exists as the
   cockpit's approve → `planExecution` → `executePlan` UI flow. No
   `/mode` command exists (cockpit uses Shift+Tab and `/plan`). Mode and
   transcript already persist per session (`updateSessionMode`,
   `transcript-store.js`). No enforcement point blocks input that
   bypasses Kairo.
5. **P06 — no execution status operation.** The contract is otherwise
   complete: `planExecution` requires an explicit `role` and returns a
   `confirmationTarget`; `executePlan` recomputes the route and rejects on
   any `strategyFingerprint`/`candidateKey` drift, rejects
   `MANUAL_HANDOFF`, and reserves idempotently; `cancelExecution` exists.
   Status is assembled today from `snapshot()` plus polling
   `readRunTranscript`.
6. **P07 — diagnostics formatting lives in the cockpit UI.**
   `modelsExplainLines`, `aiTeamDetailLines`, `fitWhyLines`,
   `providerLines`, `usageLines` are `CockpitView` methods; only
   `verifyClaudeEntitlements` is a service operation.
7. **`--legacy-cockpit` references:** 6 source files (`src/cli.js`,
   `src/global/cli-help.js`, `src/global/host/workspace-widget.js`,
   `src/global/host/launch-gentle-shell.js`,
   `src/global/host/extension/index.js`,
   `src/global/conversation/session-cli.js`) and 6 test files.

### Decisions carried into the slices

- PLAN only produces and shows a plan; it never executes.
- AGENT continues after the plan with explicit approval, an explicit role
  choice, and execution. The role is never inferred from text.
- Kairo remains the source of truth for session, strategy, routing, and
  execution; Pi supplies terminal, dialogs, and presentation.

### Slice scope and acceptance criteria

**R01 — Pi compatibility check (before P02).**
- Verify `input`/`handled`, `sendMessage`/`registerMessageRenderer`, and
  `session_start` reasons on Pi 0.85.1. If any is missing, raise
  `MIN_PI_VERSION` to the first version that has all of them, with a
  test on the version gate.

**P02 — Single session binding.**
- `kairo` creates and binds a real Kairo session; `kairo resume` reopens
  the chosen one.
- The panel shows the bound session ID and mode; it never shows
  `session: none · ask` as if a session were active.
- A Pi `new`/`resume`/`fork` never silently reuses another Kairo
  identity: it rebinds explicitly or is blocked with a visible reason.

**P03 — Analysis in Pi.**
- `/project` and `/project analyze` run analyst selection, analysis,
  recommendation review/editing, and approval inside Pi.
- A re-analysis that is cancelled, fails, or is pending approval never
  removes or replaces the active team. The proposal is stored apart from
  the active strategy (service change) and replaces it only on approval.
- Extract analyst-selection/review logic from UI code into a UI-free
  module shared with the cockpit.

**P04 — Team editing and approval.**
- Extract the role picker from `cockpit/view.js` into a UI-free module
  reused by P04 and P06.

**P05 — Conversation governed by Kairo.**
- `pi.on("input")` routes every normal input through the Kairo service
  and returns `handled`; Pi's selected model never receives it.
- Visible mode control and `/mode ask|plan|agent`.
- ASK answers without editing; PLAN produces and shows a plan and never
  executes; AGENT hands off to P06.
- Mode and transcript persist per session and survive `kairo resume`.
- Any input that would bypass Kairo policy is blocked, with a test per
  path (interactive, rpc, extension sources).

**P06 — AGENT continuation (work).**
- Flow: plan approval → explicit role choice → route preview
  (`planExecution`) → confirmation → execution (`executePlan` with the
  exact `confirmationTarget`) → cancel (`cancelExecution`) → status.
- Add a service-level execution status operation (wrapping the plan
  execution state and `readRunTranscript`) instead of assembling it in
  the UI.
- Revalidation drift, `MANUAL_HANDOFF`, missing role, unauthorized model,
  and unavailable role each fail closed with a visible reason, tested.

**P07 — Diagnostics.**
- Extract the `CockpitView` diagnostics formatters (models/evidence,
  exclusion reasons, providers, usage) into UI-free modules, same pattern
  as `usage-summary.js`; cockpit output stays byte-identical.
- Access verification goes through `verifyClaudeEntitlements`; no new
  selection policy.

**Closing.**
- Help and notices point to actions inside Pi.
- Remove `--legacy-cockpit` and its references only after the real TTY
  run passes: `kairo` → analyze → approve team → ASK → PLAN → AGENT →
  choose role → execute → exit → `kairo resume`.
- Full suite and CI on Node 20/22/24.

### Next step

Run R01, then start P02 on a new branch from `main`.
