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

## P01–P01.2 — Closed slices (summary)

Full task, evidence, and review detail was archived verbatim on
2026-09-24 to Engram topic `odd/kairo-pi-parity/archive-p01`; it is also
in git history (this file at commit `b94ff39`).

| Slice | Outcome | PR / merge | Work commits |
|-------|---------|------------|--------------|
| P01 — Visible team | Every role on its own row with model, route, and live availability (two-phase: `checking` → live, failure → `unknown`); always-visible subscription usage. | #338 · `6b7b615` | `5cb8918`, `48b4b67`, `e378a6b`, `cf72796`, `a1e08c9` |
| P01.1 — Widget UI | Themed side-by-side USAGE/TEAM panels (stacked when narrow), no 10-line cap, no `available` noise, `BLOCKED` rows plus one notify per blocked role, aligned columns, whole-command footers. | #339 · `b5f601e` | `5b6d88b`, `0d2bbc9`, `b1170fe`, `9e2a8f9` |
| P01.2 — Fast, compact widget | Usage loads apart from availability (~6 s vs ~23 s measured); last-known cache rendered dim with its age; thin labeled bars; content-sized panels. | #340 · `b3e2725` | `a20765a`, `8dc4a0f` |

Design facts later slices rely on:

- Availability comes only from `resolveAssignmentAvailability`
  (`src/global/conversation/assignment-availability.js`); the widget never
  infers it.
- Usage text and bars share one model: `buildUsageModel` /
  `formatSubscriptionUsageSegments` (`src/global/conversation/usage-summary.js`);
  cockpit output stays byte-identical.
- Live data: `loadKairoUsageData` and `loadKairoLiveData`
  (`src/global/host/workspace-snapshot.js`); last-known cache in
  `src/global/host/workspace-cache.js`; rendering in
  `src/global/host/workspace-widget.js`.
- Snapshot changes stay additive (`kairo.workspace-shell/v1`).

Recorded but not re-verified here: each slice's archive lists CI on Node
20/22/24 and a real interactive Pi TTY check as parent items, and the
blocked-role and stale-cache paths have unit-test evidence only. All
three slices exceeded the ~400-line heuristic and shipped as single PRs
under `ask-on-risk`.

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
  - Resolved by R01 (2026-09-24): 0.85.1 exposes all of them. See R01
    below.

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
  path (interactive, rpc, extension sources), including unregistered `/`
  text and `!`/`!!` shell commands (`user_bash`).
- The `input` handler fails closed: any internal error still returns
  `handled` with a visible error, never falls through to Pi's model
  (see R01 constraint 1).

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

## R01 — Pi compatibility check

- [x] R01-T1 Verify the Pi extension APIs the plan depends on exist with
  the same contract in `MIN_PI_VERSION` 0.85.1.
  - Route: inline (read-only type/runtime comparison, no source change).
  - Method: `npm pack @earendil-works/pi-coding-agent@0.85.1` into the
    session scratchpad (read-only, not installed); compared
    `dist/core/extensions/types.d.ts` and runtime files against the
    installed 0.87.1.
  - `InputEvent`/`InputEventResult` (`continue`|`transform`|`handled`),
    `SessionStartEvent` (`startup`|`reload`|`new`|`resume`|`fork` +
    `previousSessionFile`), `SessionBeforeSwitchResult`, and
    `SessionBeforeForkResult`: byte-identical between 0.85.1 and 0.87.1.
  - Present in 0.85.1: `on("input")`, `on("session_start")`,
    `on("session_before_switch")`, `on("session_before_fork")`,
    `on("user_bash")`, `sendMessage`, `registerMessageRenderer`,
    `appendEntry`, `registerCommand`, `registerProvider`,
    `unregisterProvider`, and the component-factory `setWidget`.
  - Runtime: `handled` short-circuits before the agent runs
    (0.85.1 `core/extensions/runner.js` `emitInput`,
    `core/agent-session.js` `prompt`); same in 0.87.1.
  - Outcome: no `MIN_PI_VERSION` change and no source change needed, so
    no RED/GREEN cycle applies; this task is evidence only.

### Constraints found for P02/P05 (carry into their design)

1. **A throwing `input` handler fails open.** `emitInput` catches the
   error, reports it, and continues to the next handler and then to Pi's
   model (0.85.1 and 0.87.1). P05's handler must catch everything itself
   and return `handled` on any failure, with a test that a thrown error
   still returns `handled`.
2. **Registered extension commands run before `input`.** `prompt` runs
   `_tryExecuteExtensionCommand` for `/`-prefixed text first, so
   `/mode` and `/project` never reach the `input` handler. Unregistered
   `/` text does reach it and must be handled too.
3. **`!cmd` bypasses `input`.** User shell commands go through the
   `user_bash` event, whose result (`operations` or a full `result`)
   can replace execution. P05's "block any bypass" must cover
   `user_bash`, not only `input`.
4. **`pi.on()` returns `void` in 0.85.1** (an unsubscribe function only
   from later versions). Do not rely on its return value.
5. `input` fires before skill/template expansion, and carries
   `source: interactive | rpc | extension`, so the per-source tests in
   P05 are feasible.

### Next step

Start P02 on a new branch from `main` (after this branch merges), or
stack it on this branch if the user prefers.
