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
- RDD: on (decided by default; `gentle-ai review mode status`, 2026-09-24).

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

P02 started 2026-09-24, stacked on this branch (user choice).

## P02 — Single session binding

Branch: `feat/kairo-pi-p02-session-binding`, stacked on
`feat/kairo-pi-r01-pi-compat` (PR #351, CI green, not merged yet).

### Current behavior (mapped 2026-09-24)

- Bare `kairo` launches Pi with no `KAIRO_SESSION_ID` (`src/cli.js` case
  `host` → `launchGentleShell` without `sessionId`); only `kairo start` and
  `kairo resume` bind (`session-cli.js` `launchBoundSession`).
- Unbound snapshot session is `{state: "unbound"}`, rendered by
  `usagePanelFooter` (`workspace-widget.js`) as `session: none · ask`; the
  status bar also defaults to `ask`.
- The extension reads `env.KAIRO_SESSION_ID` on every refresh and only
  listens to `session_start`; nothing maps a Pi session to a Kairo
  session (`host.json` only repeats Kairo's own id).
- No test covers the unbound state.

### Design

- Product decision (user, 2026-09-24): **bind everything**. Pi `/new`
  creates and binds a new Kairo session; `/resume` rebinds the Kairo
  session recorded for that Pi session; `/fork` creates a new Kairo
  session inheriting the previous mode.
- Bare `kairo` behaves like `kairo start`: create, then bind.
- Pi identity: `ctx.sessionManager.getSessionId()` (present in 0.85.1 and
  0.87.1 `ReadonlySessionManager`).
- Mapping store: one per-project index next to the sessions,
  `kairo.pi-bindings/v1` = `{ [piSessionId]: { kairoSessionId, boundAt } }`,
  written atomically with the existing session-registry conventions.
- The extension holds the current Kairo binding in memory, initialized from
  `KAIRO_SESSION_ID` at `startup`/`reload` (and recorded for the current Pi
  session); `new`/`resume`/`fork` replace it. The env var is no longer read
  on every refresh.
- `resume` of a Pi session with no recorded (or missing) Kairo session
  creates a new Kairo session and says so visibly; it never reuses the
  previous binding.
- Fail closed: any error creating, reading, or recording a binding leaves
  the extension **unbound** with a visible notice; it never keeps the
  previous Kairo id.
- Presentation: bound shows the short id and mode; unbound shows
  `session: unbound` (no mode) in the footer, status bar, and
  `/kairo-sessions`, never a default `ask`.
- Out of scope: reopening the Pi transcript when running
  `kairo resume <ref>` (Pi starts a fresh Pi session bound to that Kairo
  session; the mapping records it).

### Tasks

- [x] P02-T1 Bare `kairo` creates and binds a session (same path as
  `kairo start`); `--legacy-cockpit` routing unchanged.
  - Files: `src/cli.js` (case `"host"`), `test/cli-implicit-host.test.js`.
  - RED: `node --test test/cli-implicit-host.test.js` — "bare kairo
    must create exactly one real session" (0 !== 1).
  - GREEN: `node --test test/cli-implicit-host.test.js
    test/cli-default-entry.test.js test/session-cli.test.js` — 23/23,
    5/5, all pass.
  - Commit: `36f91d9`.
- [x] P02-T2 Pi binding index module: record, look up, and fail closed on
  malformed files; atomic writes; per-project isolation.
  - Files: `src/global/conversation/pi-session-bindings.js`,
    `test/pi-session-bindings.test.js`.
  - RED: `node --test test/pi-session-bindings.test.js` — module not
    found (`ERR_MODULE_NOT_FOUND`).
  - GREEN: same command — 10/10 pass.
  - Commit: `f7d6bfd`.
- [x] P02-T3 Extension binding lifecycle: in-memory binding;
  `session_start` `startup`/`reload`/`new`/`resume`/`fork` per the design;
  fail closed to unbound with a notice.
  - Files: `src/global/host/extension/index.js`,
    `test/workspace-shell-extension.test.js`.
  - RED: `node --test test/workspace-shell-extension.test.js` against
    the pre-T3 baseline (implementation stashed) — 9 new tests failed,
    16 pre-existing unaffected.
  - GREEN: same command, implementation restored — 25/25 pass. Also
    reran `test/workspace-shell-snapshot.test.js`,
    `test/workspace-widget.test.js`, `test/session-registry.test.js` —
    73/73 pass, no regression.
  - Commit: `a48b7e6`.
  - Honesty note: the T3 RED above was observed post-hoc, by stashing
    the already-written implementation and re-running the tests — not
    genuine test-first RED.
  - Fix (parent review, 2026-09-24): `reason: "reload"` was handled
    identically to `"startup"` and always fell back to
    `KAIRO_SESSION_ID`, so after a `/new` or `/fork` a `/reload`
    silently rebound to the original launch session (reuse of another
    Kairo identity, forbidden by P02). `reload` now looks up the
    current Pi session's own recorded mapping first; a mapping to a
    missing Kairo session fails closed to unbound, never falls back
    to env.
    - RED (genuine, test-first, against the pre-fix code):
      `node --test test/workspace-shell-extension.test.js` — 3 of 4
      new regression tests failed (`not ok 18/19/21`; the 4th,
      "no mapping falls back to env", already passed since that path
      was unaffected by the bug).
    - GREEN: `node --test test/workspace-shell-extension.test.js
      test/pi-session-bindings.test.js` — 40/40 pass. `npm test` —
      2218/2219 pass, 1 opt-in skip, 0 failures.
    - Commit: `bac6630`.
- [x] P02-T4 Presentation: bound id + mode; explicit unbound in footer,
  status bar, and `/kairo-sessions`; unbound tests added.
  - Files: `src/global/host/workspace-widget.js` (`usagePanelFooter`),
    `src/global/host/extension/index.js` (`workspaceStatus`),
    `test/workspace-widget.test.js`, `test/workspace-shell-extension.test.js`.
  - `/kairo-sessions` was already correct (unbound test added, passed
    immediately — no source change needed there).
  - RED: `node --test test/workspace-widget.test.js` — unbound footer
    test failed (`session: 11111111 · ask`-style default, not
    "session: unbound"); `node --test test/workspace-shell-extension.test.js`
    — status bar test failed (`"Kairo · agentic-harness · ask"`).
  - GREEN: both commands — 28/28 and 27/27 pass.
  - Full focused set (session-cli, session-registry, host-launch,
    workspace-shell-extension, workspace-shell-snapshot,
    workspace-widget, cli-implicit-host, cli-default-entry,
    pi-session-bindings): 141/141 pass, 1 opt-in skip
    (`KAIRO_LIVE_PI_TEST`).
  - Commit: `b65c1d2`.
- [ ] P02-T5 Evidence: focused tests, full suite, CI, real TTY run
  (`kairo` → `/new` → `/resume` → `/fork` → exit → `kairo resume`).
  - Review: high-risk `review-d2c096fb6f19ae7d` via native `--untracked-scope=exclude --expected-untracked-inventory=sha256:6f7679...` (three unrelated untracked files `docs/assets/social/kairo-linkedin-control-plane.png`, `report.json`, `scripts/inspect-opencode-tier.sh` excluded without editing `.git/info/exclude`). Consent granted, 4 lenses inspected all 9 manifest paths, `approved` with 0 BLOCKER/CRITICAL findings across risk/resilience/readability/reliability, authority burned `sha256:e5579b0` at 2026-09-24. `gentle-ai review status` preflight was re-queried to obtain the fresh digest; no digest was reused across workspace changes.
  - Focused: `node --test test/cli-implicit-host.test.js test/pi-session-bindings.test.js test/workspace-shell-extension.test.js test/workspace-widget.test.js test/workspace-shell-snapshot.test.js test/session-registry.test.js test/session-cli.test.js test/cli-default-entry.test.js` → 137+ tests pass, 0 fail (individual file counts: cli-implicit-host + pi-bindings 10/10, workspace-shell-extension 27+ incl. reload regression 4/4, widget 28/28 with unbound footer, snapshot/registry ancillary 73/73). Earlier T4 focused run 141/141 pass.
  - Full suite: `npm test` → 2219 tests, 2218 pass, 1 skipped (`KAIRO_LIVE_PI_TEST` opt-in), 0 fail. No regressions vs 2218 baseline reported at T3 fix.
  - Automated session evidence ≠ real TTY evidence: the fake-Pi harness above verifies binding creation and per-reason transitions, but does NOT substitute the interactive Pi TUI run.
  - CI: PR #352 https://github.com/Kal-elSam/harness/pull/352 — 2026-09-24 17:33 UTC **SUCCESS** Node 20 / 22 / 24 (run 36034898582, jobs 107752402866/941/670). Avance registrado, no cierre por sí solo.
  - Real TTY — **pendiente y bloquea el cierre de T5**: `kairo` → `/new` → `/resume` → `/fork` → exit → `kairo resume`, comprobando que cada sesión conserva la vinculación correcta y que un fallo queda visible (panel `session: unbound` vs `session: <8hex> · <mode>`). Hasta completar esta corrida interactiva, T5 permanece abierta.
  - Corrección 2026-09-24: reabierto T5 tras cierre prematuro en 787d0b9 — CI verde y fake-Pi no bastan para cerrar.
  - Bloqueo real verificado (2026-09-24): Pi 0.87.1 no persiste sesión vacía — `newSession()` en `session-manager.js:691-715` prepara header + ruta pero deja `flushed=false` sin crear JSONL; `_persist:788-798` solo escribe al llegar el primer `assistant`, por eso `/resume` muestra "No sessions in current folder" y `/fork` exige mensaje previo. Headless con Tab no lo arregla. El TTY real tras `/new` mostró el error `Extension ... ctx is stale after session replacement` en `extension/index.js:186` (uso de `ctx.cwd/ctx.ui` tras `await`); los tests verdes previos (68/68, 2218/2219) no lo reproducían. Parche de Pi debe escribir header y poner `flushed=true` juntos, o el primer guardado intentará recrear el mismo archivo con `wx` y fallará con `EEXIST`/duplicado. Regresión stale: RED en 002a779, GREEN en b7435ed.
  - Correction (2026-09-24): the vendored patch attempt (a58cac4, 7c8f59c) was
    withdrawn before push. It overwrote the global Pi's
    `dist/core/session-manager.js`, but the `pi` bin runs
    `dist/bundle/cli.js` with its own chunk, so the TUI never loaded the
    patch. Its commit message ("Outside Kairo, Pi keeps its original
    behavior") was false. Local backup ref: `backup/p02-defective-vendor`.
    Repaired by P02-T6..T10.

### P02 repair — Kairo-only Pi fork (2026-09-24)

Fork: `@kal-elsam/kairo-pi-coding-agent@0.87.1-kairo.1`, built from the
upstream `earendil-works/pi` source at 0.87.1 with the upstream build. Its
source lives in a separate sibling repo (`../kairo-pi`), with the patch as
commits on top of the upstream 0.87.1 tag. There is no `pi` bin. The
empty-session behavior is off by default and turns on only with
`KAIRO_PI_EMPTY_SESSIONS=1`, which the Kairo launcher sets in the child
environment only. Pi's own subprocesses inherit it (documented).

- [x] P02-T6 Withdraw the defective vendor: rebuild the history from
  9cbed7a and remove `vendor/` (tracked and untracked). Global Pi check
  (read-only): the `.bak-kairo` file is byte-identical to the official
  0.87.1 tarball, the current file is byte-identical to the Kairo patch,
  and no other file differs. Route: inline.
- [x] P02-T7 Restore the global Pi (outside the repo; authorized by the
  user 2026-09-24): copied `.bak-kairo` back, then deleted it.
  - Evidence: the backup matched the official 0.87.1 at restore time.
    After the restore, `diff -rq` of the official tarball against the
    install shows no difference (besides `node_modules`), and no
    `.bak-kairo` remains.
  - Deviation: the second pre-check ("current file == Kairo patch") used
    a wrong path and failed, and the script's `set -e` did not stop the
    restore. That check had passed minutes earlier in T6, and the final
    state is verified identical to the official package.
- [ ] P02-T8 Fork: patch the source behind the env gate, run the upstream
  build, and add tests on the built bundle (gate on and off: empty
  session persisted, /resume lists it, /fork on an empty session creates
  a child with session_start:fork, the first append adds no duplicate
  header). Check `npm pack --dry-run` includes `dist/bundle/**`, LICENSE,
  and attribution. Route: delegated writer (new repo, build, tests).
  - Done (fork repo `../kairo-pi`, branch `kairo/0.87.1` on upstream tag
    `v0.87.1` = `f07218c4d`): tests `3f3b98e4e` (RED 6 fail / 4 pass),
    fix `a8a10c4f5` (GREEN 10/10; parent re-ran it: 10/10), lock script
    `10ddd65d9`, rebrand `a4ac58ddb`. Node 22.23.0. Upstream suite
    2422 pass before the rename. `npm pack --dry-run`: 60 files,
    `dist/bundle/**`, LICENSE, NOTICE.md, no bin. The tarball is in the
    session scratchpad.
  - Closed before publishing (delegated writer, then a parent split of
    the mislabeled commits; the pre-split backup ref is
    `backup/kairo-t8-before-split`, with an identical final tree):
    - (a) The distribution tests now assert the fork identity (name, no
      bin, `exports` pointing to `dist/bundle`, and first-time setup off
      for the fork). `dc9703d54`.
    - (b) The release build is `npm run build:offline` (an upstream
      switch) with `packages/ai/src/providers/data/` committed. That
      catalog is a models.dev snapshot from 2026-09-24, not from the
      0.87.1 release date, because upstream never versioned it; this is
      documented in NOTICE.md. `38961683f` (catalog), `7543ea0d0`
      (NOTICE).
    - Evidence: three builds (including a full clean build) produced
      byte-identical `dist/bundle` output. Against the official 0.87.1
      tarball, the only content differences are the Kairo gate and the
      catalog drift. `cli.js` is byte-identical; the other files differ
      only in chunk hash names.
    - Checks: `npx vitest --run test/kairo` 10/10; the fork package's
      `npm test` 2422 pass, 50 skip, 0 fail; the parent re-ran the kairo
      and distribution tests, 20/20. `npm pack --dry-run`: 60 files, no
      bin. Tarball sha256 `69df4a27…c778bf` (built before the split, from
      the same tree).
  - Still open (minor): 3 upstream `first-time-setup` cases now pass
    vacuously in the fork, because `isOfficialDistribution()` returns
    false first. Tighten or document them before publishing.
  - Noted: `isOfficialDistribution()` is false for the fork, which only
    disables the experimental first-time setup. The config dir stays
    `.pi`, so sessions are shared with a standalone Pi.
- [x] P02-T9 Kairo launcher: resolves the fork by path through Kairo's own
  module resolution and runs `<root>/dist/bundle/cli.js` with
  `process.execPath` after checking Node >=22.19. It fails explicitly
  on a missing package, wrong name or version, or missing bundle; it
  never uses PATH `pi`; and it sets `KAIRO_PI_EMPTY_SESSIONS=1` in the
  child env only. Commits: `bd37236`, `482a8b1`.
  - Review `review-e4a26e2f991beac3` approved (user consent).
- [x] P02-T9b Review follow-ups:
  - The write guard is an fsImpl seam test, plus a child-process probe
    (`test/helpers/launch-write-probe.mjs`) that patches node:fs before
    import. RED came from planted direct, rename, and open writes.
  - Commits: `3c66897`, `2690a8c`, `969d5ab`, `fa7373e`, `5d36bba`.
  - Reviews `review-80e62b92156fe3f9` and the `fa7373e..0f2c589` range
    were approved (user consent). The advisory probe findings (reported
    as spurious failures only) remain open for the next probe change.
  - Delivery note: do not push before the fork pin. `.1` was pinned in
    T10 and replaced by the `.2` pin in T8b (`f90a90a`).
  - The full evidence (commands, RED/GREEN output, and review findings)
    was archived verbatim on 2026-09-24 to Engram topic
    `odd/kairo-pi-parity/archive-p02-t9`. It is also in git history
    (this file at `4af6db4`).
- [ ] P02-T8b Fork packaging defect (found in the TTY attempt): the
  published `0.87.1-kairo.1` ships 60 files. The official 0.87.1 ships
  1108. The fork's `files` kept only `dist/bundle`, so TUI runtime
  assets are missing: `dist/modes/interactive/theme`, components, utils,
  cli, docs/images, and examples, plus `npm-shrinkwrap.json`. The
  parent's T8 brief asked for `dist/bundle/**` and accepted "no dist/core"
  as good; the root cause is on the parent.
  - Fix: restore upstream `files` (`dist` minus its 3 exclusions, `docs`,
    `examples`, `containerization.md`, CHANGELOG, and a shrinkwrap
    regenerated for the fork name). Bump to `0.87.1-kairo.2`.
  - Tests: a regression that runs `npm pack` against the built `dist`
    with upstream's exclusions, expecting an empty difference (RED on
    the current package first), and a real TUI start over a PTY from a
    tarball installed into a clean prefix.
  - Then (each needs specific authorization): publish `.2` with
    `--tag kairo`, `npm deprecate` `.1`, and move `latest` to `.2`.
    After that, pin `.2` in Kairo, run the suite and CI, and repeat the
    TTY run.
  - Route: delegated writer (fork repo).
  - Fork side done: `a8943dd1f` (packaging regression test) and
    `146fa0456` (restores upstream `files`, bumps to `0.87.1-kairo.2`,
    and regenerates the shrinkwrap with the existing upstream script).
    - RED: `npx vitest --run test/kairo/packaging-files.test.ts` 3/3
      fail (hundreds of missing paths, no shrinkwrap, no theme JSON).
    - GREEN: 3/3 pass. `test/kairo` 13/13 (parent re-ran it: 13/13).
      The package `npm test` has 2425 pass, 50 skip, 0 fail.
    - PTY smoke from clean prefixes, with a temporary HOME and agent
      dir, `PI_OFFLINE=1`, and no model calls. `.1` exits 1 with
      `ENOENT ... dist/modes/interactive/theme/dark.json` and never
      renders. `.2` renders `pi v0.87.1-kairo.2`, the footer, and doc
      links resolved from `docs/`, then exits 0 on Ctrl+D.
    - Pack: 1110 files. The parent checked the diff against the official
      1108: only LICENSE and NOTICE.md are extra, and 3 chunks differ
      only in their hash names. No bin. Tarball sha256 `b6a0db34…d7bbb`.
  - Registry (the user ran the commands, 2026-09-25): `.2` is published
    and its integrity `sha512-57piJG…26/CQ==` equals the verified
    tarball; 1110 files. `kairo` and `latest` point to `.2`. `.1` is
    deprecated with the message "Missing TUI runtime assets; use
    0.87.1-kairo.2".
  - Kairo pin `f90a90a`:
    - `KAIRO_PI_PACKAGE_VERSION`, package.json, and the lockfile are on
      `.2`. The wrong-version test now derives the expected version
      from the constant.
    - RED: 3 host-launch tests failed with the constant on `.2` and the
      install still on `.1` (one was the hard-coded regex, fixed).
    - The repo's versioned `.npmrc` has `minimum-release-age=1440`,
      which blocked `.2`. The user chose a version-scoped exclusion,
      `minimum-release-age-exclude[]=@kal-elsam/kairo-pi-coding-agent@0.87.1-kairo.2`,
      kept in `.npmrc` next to the policy (the repo has no
      `pnpm-workspace.yaml`). Negative check: installing `.1` (under
      24 h old) with the same `.npmrc` still fails with
      `ERR_PNPM_NO_MATURE_MATCHING_VERSION`.
    - GREEN: `pnpm install --frozen-lockfile` OK. Focused: 21 pass,
      0 fail, 1 skip. `npm test` twice: 2233 pass, 0 fail, 1 skip.
    - A first full run had 1 intermittent failure, and its output was
      not captured, so the test is unidentified. Pending: capture it if
      it recurs.
    - Side effect: an earlier `pnpm install` with purge allowed emptied
      `node_modules`. It was restored from the lockfile before
      continuing.
  - Review of `55e903f..90db7f7` (the `.2` pin, the release-age
    exclusion, and docs): high risk; consent granted by the user. 4
    lenses, **approved** with no blocking findings, and acknowledged.
    - Applied: a `.npmrc` comment saying why the exclusion exists, who
      approved it, and when to remove it; the T9b and T10 note no longer
      contradicts itself.
    - Rejected: R3 "pin consistency untested". `test/host-launch.test.js:443`
      already asserts the package.json pin equals KAIRO_PI_PACKAGE_VERSION.
    - Follow-up: remove the exclusion once `.2` is older than 1440
      minutes (after 2026-09-26 08:48 local).
    - The intermittent failure could not be reproduced: 5 more full runs
      (2 earlier, 3 with full logs kept) all gave 2233 pass / 0 fail. It
      remains unidentified.
  - Push (authorized by the user): `55e903f..ce6ee7a`. CI run 36161103241
    on `ce6ee7a` — **success** (Node 22, Node 24). This also proves that
    the frozen CI install accepts `.2` under the version-scoped exclusion.
  - Real PTY run with `.2` (2026-09-25, by the parent; the user chose a
    real PTY with an isolated temporary HARNESS_HOME). The TUI was driven
    by keystrokes, the screen was rebuilt with pyte, and it was
    cross-checked against files. No model prompts were sent.
    - Start: TUI renders, exits 0 on Ctrl+D. An empty Pi session is
      persisted at start (JSONL with its header only). Bound Pi →
      Kairo, 1:1.
    - `/new`: new Pi session `01a0d96d` → new Kairo `30da37ee`
      (`/kairo-sessions` shows it). No `ctx is stale` warning. PASS.
    - `/resume`: lists both empty sessions as `(no messages)` (before
      the fork: "No sessions in current folder"). Selecting the older
      one rebinds to Kairo `70e2eae2`, matching the binding file for Pi
      `01a0d96c`. PASS.
    - `/fork` on the empty session: **FAIL**, "No messages to fork
      from". `interactive-mode.ts:5341` `showUserMessageSelector()`
      returns early when there are no user messages. The fork patched
      only SessionManager, not this UI guard.
    - The `kairo resume` step was not run, because `/fork` already
      fails. **T5 stays open.**
    - Also found:
      - (a) The fork shows "Update Available: New version 0.87.1 is
        available. Run pi update". Semver ranks the `0.87.1-kairo.2`
        prerelease below `0.87.1`, so the update check nags, and
        `pi update` would leave the fork. The fork must disable the
        check or fix the comparison.
      - (b) Kairo gap: the `unavailable-routes` view (no team analyzed)
        shows only `ask` in the status bar and no session id. The
        `session: <8hex> · <mode>` line exists only in the two-panel
        layout. This does not meet "the panel shows the bound id and
        mode".
      - (c) The first `/kairo-sessions` in run 2 did not execute
        (autocomplete took the Enter), so that one step was ambiguous;
        run 3 repeated it successfully.
      - (d) The repo's `(HARNESS_HOME)/` directory has exactly the
        layout Kairo creates, so it most likely came from a run with
        the literal `HARNESS_HOME=(HARNESS_HOME)`.
  - Next: fix the fork (empty-session `/fork`, update check) and Kairo
    (session id in every view), publish `.3`, and repeat this run.
- [x] P02-T11 Fork `.3`: empty-session `/fork`. With
  `KAIRO_PI_EMPTY_SESSIONS=1` and a truly empty session, the TUI calls a
  runtime empty-fork path that emits a cancellable `session_before_fork`
  with `entryId: ""`, `position: "at"`, and `emptySession: true`. It
  reuses the parent-linked child creation and `session_start` reason
  `fork`. The empty id is rejected when the flag is off or the session
  has entries; RPC fork and `/clone` are unchanged. Nothing in Kairo
  listens to `session_before_fork` (checked). Separate RED/GREEN for the
  TUI command and for the runtime/event contract. Bump to
  `0.87.1-kairo.3` and run the packaging check. Route: delegated
  writer (fork repo).
  - Done (fork repo, delegated writer; the parent verified each step):
    - Implementation: `a059533a0` (RED 6 fail), `30ad7761a` (runtime
      `forkEmptySession()` plus the TUI path; `session_before_fork` with
      `entryId ""`, `position "at"`, and `emptySession true`,
      cancellable), and `543698fb6` (bump to `.3`).
    - Pre-publish PTY with the `.3` bundle, run by the parent:
      `/fork` on an empty session showed "Forked to a new Kairo session
      (e8a22a8b)", and the child had `parentSession`. It also exposed an
      ORPHAN header-only session: `SessionManager.create()` already
      persists a session, and `newSession({parentSession})` then created
      a second one.
    - Orphan fixes: `d28ee9a83` (RED: 3 files instead of 2) and
      `17d3a082a` (pass `parentSession` into `create()`). The same
      pattern existed in `fork()` from the first message and in
      `newSession({parentSession})`: `531ca9c7b` (RED) and `167cc12eb`
      fix them, plus a guard that plain `/new` still makes one file.
    - `84affa94c`: the packaging tests get an explicit 20 s timeout in
      the test file (npm pack measured 1–6.6 s under load), so no CLI
      flag is needed.
    - Checks with no flags: `npx vitest --run test/kairo` 25/25 (the
      parent re-ran it: 25/25). The package's `npm test` has 2437 pass,
      50 skip, 0 fail. The PTY re-check produced exactly 2 files,
      original and child.
    - The root monorepo `npm test` has 2 failures outside this package:
      `pi-ai` needs a local Ollama daemon (environmental), and
      `chord` hits `delta.test.ts` "large append argument lists"
      RangeError. The parent verified that `packages/chord` has no diff
      against `v0.87.1`, so that one is upstream, and the fork consumes
      the published chord anyway.
    - Tarball sha256 `7621f1e78c51c7f2…` (in the session scratchpad).
- [x] P02-T12 Kairo: set the existing `PI_SKIP_VERSION_CHECK=1` only in
  the child env (no semver change), and use one session-identity
  formatter (`session: <8hex> · <mode>` / `session: unbound`) in the
  overview, the replacement views (including unavailable-routes), and
  the status bar. Separate RED/GREEN for the launcher env and for
  bound/unbound in each view. Route: delegated writer (Kairo repo),
  running in parallel with T11 in a separate repo.
- Intermittent full-suite failure, identified and fixed (`600d4fb`, route:
  inline, user OK):
  - Six sequential full runs were clean. Running three suites
    concurrently reproduced it: `test/quick-ask.test.js` "codex's timeout
    resets on real output" returned `error` instead of `answered`. It
    raced real 60/80/120 ms timers with a 20 ms margin.
  - Fix: drive `setTimeout` with `node:test` mock timers.
  - RED: with the stdout reset planted off, the new test fails
    deterministically. GREEN: 4 concurrent plus 30 sequential runs are
    clean, and `npm test` gives 2234 pass / 0 fail / 1 skip.
  - A second failure under concurrency (`package-contents.test.js`,
    ENOENT on the packed tgz) only appears when several suites pack the
    same tarball in one checkout at once, so it is an artifact of the
    parallel run itself.
  - T12 done: `a60f12d` (PI_SKIP_VERSION_CHECK only in the child env)
    and `9bfb071` (shared `formatSessionIdentity` for the overview,
    every replacement view, and the status bar). Parent spot check: 80
    pass / 0 fail.
- `.3` published (the user ran the commands; passkey approvals for
  publish and dist-tag were separate). Parent verification: registry
  integrity `sha512-qSNDEr…x1lg==` equals the verified tarball, 1110
  files, and `latest` and `kairo` point to `.3`.
  - Kairo pin: RED 2 tests fail with the constant on `.3` and the install
    on `.2`. Then package.json, the lockfile, and the `.npmrc` exclusion
    were REPLACED from `.2` to exactly `.3`, with no `.2` line kept.
    GREEN: `pnpm install --frozen-lockfile` OK; focused 80 pass, 0 fail;
    `npm test` 2234 pass, 0 fail, 1 skip.
  - Full PTY run through `kairo` with `.3` (by the parent, temporary
    HARNESS_HOME, no model prompts):
    - Bindings on disk are all correct: start Pi `615a` → `74b66a0f`,
      `/new` Pi `a0bb` → `6b8b1854`, and `/fork` child Pi `fb3c`
      (parentSession `615a`) → `5f069ed0`. There are 3 files and no
      orphan.
    - **Display defect:** the panel and status bar lag after `/new`
      (they still showed `74b66a0f` about 5 s later). After `/fork` the
      notice says `5f069ed0`, but the panel and status bar show
      `6b8b1854` (the `/new` session) until exit. The binding logic sets
      `boundKairoSessionId` correctly, so the widget/status refresh path
      is wrong.
    - Route: delegated writer (root cause, RED/GREEN, PTY table).
    - `/resume` → older session showed `74b66a0f`, which is correct.
    - The `kairo resume` step is pending until the display is fixed.
    - T5 stays open.
  - Local display fix: an older `loadSnapshot` could finish after a later
    `session_start` and repaint its ID. A generation guard drops that stale
    render. Deterministic `/new` → `/fork` test: RED on ce04ca8 (shows the
    `/new` ID), GREEN with the fix. Real `.3` PTY: startup `7e7fcb20`,
    `/new` `9c47f5d0`, `/fork` `81eeb08b`; panel/status match bindings at
    each step and after 12 s. `kairo resume` selecting the child also shows
    `81eeb08b`. Full suite: 2235 pass, 0 fail, 1 skip (outside sandbox;
    loopback HTTP is blocked inside it). Native `/resume` lists empty
    sessions, but selecting one in this run remains unverified.
  - Next: commit, push/CI with authorization, then verify native `/resume`
    selection and the full PTY lifecycle before closing T5/T10.
- [ ] P02-T10 Publish (needs explicit authorization: npm,
  `--tag kairo`, credential), pin the exact version, run CI, then the
  real TTY run. Only then close T5.
  - Local integration (delegated writer; publication was already done by
    the user, not by this work unit): public npm resolution and tarball
    download succeeded without npm credentials in a temporary directory.
    Work-unit commit: `9f08654`.
    `package.json` now pins the exact published
    `@kal-elsam/kairo-pi-coding-agent@0.87.1-kairo.1`; `pnpm-lock.yaml`
    records its registry integrity and transitive dependencies. No
    `file:` dependency or vendored Pi remains.
  - Strict build policy: the new dependency graph includes
    `@google/genai`, `esbuild`, and `protobufjs` install scripts. The repo
    keeps `pnpm.onlyBuiltDependencies: []` and explicitly lists those
    three in `pnpm.ignoredBuiltDependencies`; no install scripts were
    approved. A clean, offline `pnpm install --frozen-lockfile` passed
    using the public packages cached from the isolated download. An
    earlier install over existing `node_modules` failed with
    `ERR_PNPM_IGNORED_BUILDS` because pnpm retained pending builds; a
    fresh installation passed. The old generated `node_modules` tree was
    preserved under `/private/tmp/kairo-t10-modules-backup-*`.
  - TDD: `node --test test/host-launch.test.js` had one behavioral RED:
    Kairo's manifest did not pin the required fork version. After the
    manifest/lock install, the new test resolves the actual installed
    package, verifies its identity/version and `dist/bundle/cli.js`, and
    executes `cli.js --version` only on Node >=22.19. Focused GREEN:
    17 pass, 1 opt-in live test skipped, 0 fail.
  - Test-gate correction after self-review: the initial smoke condition
    checked only the Node major version, which would have run the fork
    on unsupported Node 22.0–22.18. It now compares all three components
    against `MIN_NODE_VERSION`; this does not change product behavior.
    Correction commit: `cf9afce`. Focused: 17 pass, 1 skipped; full:
    2231 pass, 1 skipped, 0 fail.
  - Full suite: `npm test` with an isolated npm cache and permission for
    the loopback-only UI test: 2231 pass, 1 opt-in live test skipped,
    0 fail. A sandboxed run had two environmental failures (`listen EPERM`
    on 127.0.0.1 and npm cache write `EPERM`); both passed with the
    corresponding permissions/cache configuration. No interactive TTY
    run, CI run, push, PR, or merge was performed in this work unit.
  - Review of `420df58..6cce2b7`: high risk; consent granted by the user.
    4 lenses, **approved** with no blocking findings, and acknowledged.
    Advisory WARNINGs worth fixing before push:
    - R4/R3-001: the fork smoke `spawnSync` has no timeout, no
      `stdio: ignore` for stdin, and no `result.error` check. A blocking
      `--version` would hang the whole suite and CI with no diagnosis.
    - R2-001/R3-002: below MIN_NODE_VERSION the launch half is skipped
      silently and the test still passes. Use `t.skip` with a reason.
    - R3-003 (and R2-002): the package root comes from a triple
      `dirname`. Walk up to the package.json with the fork's name
      instead, as the launcher does.
    - R3-004 (suggestion): the version compare assumes three numeric
      components.
  - Decision (user, 2026-09-24): Kairo as a whole requires Node >=22.19.0,
    the legacy cockpit included (engines set in `9f08654`). Node 20
    reached end of life in April 2026 and cannot run the Pi host.
  - Pre-push follow-ups done in `1414097` (inline):
    - The fork smoke now resolves the bundle through the launcher itself
      (real resolver, spawn stubbed). No triple `dirname`, and no
      exported private helper.
    - `--version` runs with a 30 s timeout and stdin ignored, and the
      test asserts that `result.error` is undefined, reporting the
      signal.
    - Below MIN_NODE_VERSION the version test is an explicit `skip` with
      a reason, not a silent pass. The comparison is `isNodeAtLeast`,
      which pads to three components and has its own test.
    - Node 20 was removed from the `ci.yml` matrix. README.md,
      docs/contributing.md, and docs/install.md now say Node 22.19+.
    - Checks: `node --test test/host-launch.test.js
      test/ecosystem-degrade.test.js` → 21 pass / 0 fail / 1 skip (the
      opt-in live test); `npm test` → 2233 pass / 0 fail / 1 skip.
    - No RED for these test-hardening changes: they change how failures
      are reported, not product behavior.
    - Review of `6c2a8ff..236a60f`: flagged high because of the test
      spawn and the CI YAML. **Declined for this candidate** by the user,
      since the change is tests and docs only. The decline was validated
      (`declined_this_candidate`, same target identity). RDD stays on,
      and related fixes are grouped before the next review. CI on the
      pushed commit is still required.
  - Push (authorized by the user, 2026-09-24): `b7435ed..55e903f` to
    `origin/feat/kairo-pi-p02-session-binding`. Before pushing, checked
    that no auth.json or `(HARNESS_HOME)/` path is tracked or in the
    pushed commits.
  - CI: run 36070663911 on `55e903f` — **success** (Test on Node 22,
    Test on Node 24).
  - Remaining for T5/T10: the real TTY run by the user (`kairo` → `/new` →
    `/resume` → `/fork` → exit → `kairo resume`), then close both and
    integrate #351 → #352 in order.

Route: one delegated writer for T1–T4 (4+ non-trivial files across CLI,
registry, extension, and widget; writer trigger). One work-unit commit
per task.

### Acceptance criteria

- `kairo` and `kairo resume` always start bound; the panel shows the bound
  id and mode.
- No path shows `session: none · ask` or an implied `ask` when unbound.
- Pi `new`/`resume`/`fork` each end bound to the right Kairo session, or
  unbound with a visible reason; never to the previous Kairo id by
  accident.

### Delivery

Forecast ~400 authored lines (code + tests). Strategy `ask-on-risk`; PR
stacked on #351.
