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
- [x] P02-T9 Kairo launcher: remove any global write; resolve the fork's
  CLI by path and run it with `process.execPath` after checking Node
  ≥22.19; fail explicitly if the package is missing or at another
  version; set `KAIRO_PI_EMPTY_SESSIONS=1` only in the child env. Tests:
  fake-HOME tree snapshot fails on any write outside the repo or
  HARNESS_HOME (corrected in P02-T9b to intercept the launcher's actual
  mkdirSync/writeFileSync write calls, since the original only snapshotted
  a HOME the launcher never touches); a different `pi` on PATH is ignored.
  Validate locally
  against the temporary tarball (preliminary). Route: delegated writer.
  - Done (`bd37236`, single commit — tests and implementation together):
    `src/global/host/launch-gentle-shell.js` no longer resolves `pi` via
    `whichImpl(PATH)`/`probeImpl`. It resolves the package root by
    calling an injectable `resolveEntryImpl` (default:
    `fileURLToPath(import.meta.resolve("@kal-elsam/kairo-pi-coding-agent"))`),
    walks up from that entry file to the `package.json` whose `name`
    matches, and requires `version === "0.87.1-kairo.1"` exactly (both
    constants centralized as `KAIRO_PI_PACKAGE_NAME`/
    `KAIRO_PI_PACKAGE_VERSION`); no PATH fallback on any failure. Node
    version is checked via an injectable `nodeVersion` param against a
    new `MIN_NODE_VERSION = "22.19.0"`. Spawn uses an injectable
    `execPath` (default `process.execPath`) against
    `<packageRoot>/dist/bundle/cli.js`. `KAIRO_PI_EMPTY_SESSIONS: "1"`
    is set only on the child env object built for `spawnImpl`; a test
    asserts `process.env.KAIRO_PI_EMPTY_SESSIONS` stays `undefined`
    after launch. No leftover `.bak-kairo`/`~/.local` copy code was
    found in the launcher (checked, none present).
  - RED: confirmed by `git stash`-ing the new source and running the
    new/changed test files against the old (`whichImpl`/`probeImpl`)
    implementation — both files failed at import time (`does not
    provide an export named 'KAIRO_PI_PACKAGE_NAME'`), 0/0 pass, exit 1.
  - GREEN (same files, new implementation): `test/host-launch.test.js`
    + `test/ecosystem-degrade.test.js` → 13 pass, 1 skip (opt-in live
    test), 0 fail.
  - Focused: `node --test test/host-launch.test.js
    test/cli-implicit-host.test.js test/session-cli.test.js
    test/ecosystem-degrade.test.js test/pi-session-bindings.test.js
    test/workspace-shell-extension.test.js` → 71 pass, 1 skip, 0 fail.
  - Full: `npm test` → 2224 pass, 1 skip, 0 fail (baseline before this
    task: 2218 pass, 1 skip — net +6 tests, no regressions).
  - Lint/typecheck: no `lint`/`typecheck` script exists in
    `package.json`; skipped.
  - Smoke (preliminary, outside the repo, per constraint 7): installed
    the local tarball with `npm install
    .../kairo-pi-coding-agent-0.87.1-kairo.1.tgz --prefix
    <scratchpad>/t9-smoke --no-save`, then called the launcher's real
    resolution/spawn logic against that prefix (real
    `import.meta.resolve`, no fake resolver) and ran the resolved
    `<execPath> <root>/dist/bundle/cli.js --version`:
    resolved package `@kal-elsam/kairo-pi-coding-agent 0.87.1-kairo.1`;
    `--version` printed `0.87.1-kairo.1`, exit 0, empty stderr. No
    interactive TUI was launched.
  - Docs: searched `docs/*.md` and `README.md` for "pi"/PATH/"Install
    Pi"/`--legacy-cockpit` mentions tied to this launcher; the only hit
    (`docs/adapters.md` "Kairo does not install Pi...") documents the
    unrelated `kairo run --agent pi` execution adapter
    (`src/global/runtime/execution-adapters/pi.js`), not this
    interactive host launcher, and was left unchanged.
  - Deviation from the task's literal step order: tests were written
    and iterated in the same working session as the implementation
    rather than committed as a separate RED commit; RED was still
    observed and recorded (above) by diffing against the prior
    implementation before committing, per the "TDD" section's allowance
    to commit tests with the change.
  - Not done here (explicitly out of scope per constraint 7/T10): the
    package was not added to `package.json`/`pnpm-lock.yaml`, and it
    was not published; both are P02-T10.
  - Parent spot check: the focused set passes 71, 0 fail, 1 skip.
    Correction: the writer called `fakePiOnPath()` in
    `test/cli-implicit-host.test.js` "vestigial", but it is still used
    at line 56, so it stays.
  - Review: high risk (process boundary). Consent was granted by the user.
    Lineage `review-e4a26e2f991beac3`, range `9cbed7a..482a8b1` (base tree
    `5b3c8f6`), with the unrelated untracked files excluded. All 4 lenses
    were admitted and the review was **approved** with no blocking
    findings; the acknowledgement burned the authority
    (`gentle-ai.review-acknowledged/v1`).
  - Advisory findings are non-blocking. The ones worth fixing are tracked
    in P02-T9b.
- [x] P02-T9b Review follow-ups:
  - (a) The fake-HOME test overclaims (R2 and R3-003 WARNING). It only
    snapshots a HOME the launcher never uses. Snapshot a common temp root
    that holds HOME, cwd, and the package root, and allow only
    HARNESS_HOME. Fix the test name and the T9 doc claim to match.
  - (b) Check that `dist/bundle/cli.js` exists before spawning, and fail
    with an explicit error; add a test (R3-001, R4 suggestion).
  - (c) Add a test for the error when no package.json with the fork's
    name is found (R3-004).
  - (d) Test names: the execPath default and the "PATH ignored" setup are
    decorative (R2 suggestions).
  - (e) The opt-in live test still gates on `which pi`; gate it on
    resolving the fork instead (R2 suggestion).
  - Done (`3c66897`, single commit — tests and the two source guards
    together): `src/global/host/launch-gentle-shell.js` gained an
    injectable `fsImpl` (default `{ mkdirSync, writeFileSync }`, the
    launcher's real functions) threaded into `prepareKairoPiHome`, and an
    `existsSync(cliPath)` check before spawning that throws an explicit
    "bundle is missing" error with `--legacy-cockpit` guidance.
  - (a) `mock.method` on the `node:fs` module object does NOT intercept
    `launch-gentle-shell.js`'s named ESM imports — verified empirically
    (a minimal repro: `mock.method(fs, "writeFileSync", ...)` never fired
    while a sibling module's `import { writeFileSync } from "node:fs"`
    call still hit the real filesystem). Traced the whole module and its
    two callees (`resolveHomeDir`, `isValidSessionId`): both are
    read-only, so with the child spawn stubbed the launcher's only writes
    are `mkdirSync`/`writeFileSync`, both inside `prepareKairoPiHome`.
    Renamed the test to "launchGentleShell's only filesystem writes are
    mkdirSync/writeFileSync, and every one lands under HARNESS_HOME"; it
    wraps the injected `fsImpl.mkdirSync`/`fsImpl.writeFileSync` so every
    call is both recorded and actually performed, then asserts each
    recorded path is under the fake `HARNESS_HOME`. No write API used by
    this code path is left unobserved.
  - (b) Added the `existsSync(cliPath)` guard plus
    `test/helpers/kairo-pi-fixture.js`'s new `withCliEntry: false` option
    (package.json and `dist/bundle/` present, `cli.js` missing) and a test
    asserting the thrown message names the exact missing path and
    `--legacy-cockpit`.
  - (c) Added `buildKairoPiEntryWithoutPackageJson()` (no package.json
    anywhere in the entry's ancestor chain — safe because the fork's name
    never matches any real ancestor of the OS temp dir) and a test
    expecting the existing "Could not find ... package.json" error; this
    behavior already existed pre-T9b (confirmed by running the new test
    against the pre-T9b source: it already passed, no RED). Also added
    `buildKairoPiFixtureWithMalformedIntermediatePackageJson()` (a real
    matching root package + a malformed `package.json` one level below
    it) and a test proving the malformed-file catch-and-continue branch
    is exercised: resolution still succeeds and spawns the root's
    `cli.js`.
  - (d) Renamed "spawns process.execPath..." to "resolution succeeds and
    spawns the injected execPath..." (it always injected a fake
    `execPath`, never `process.execPath`) and added a new test asserting
    the true default: with `execPath` omitted and spawn stubbed, the
    launcher calls `process.execPath`. Rewrote "a different pi on PATH is
    ignored" (its fake-pi-binary setup was never actually checked against
    — the launcher has no PATH-lookup code to bypass) as "PATH is never
    consulted: launch spawns the resolved fork even with an empty PATH",
    which sets `PATH: ""` and asserts the resolved fork/execPath are used
    regardless. Left `fakePiOnPath()` in `test/cli-implicit-host.test.js`
    untouched (still used at line 56).
  - (e) The opt-in live test now resolves
    `dirname(fileURLToPath(import.meta.resolve(KAIRO_PI_PACKAGE_NAME)))`
    + `cli.js` and skips unless that path exists (plus
    `KAIRO_LIVE_PI_TEST=1`), instead of gating on `which pi`; when it
    runs, it spawns `process.execPath <resolved cli.js>` instead of a
    `pi` binary from PATH, matching how the launcher itself spawns.
  - RED (behavioral, not import error — via `git stash` on only
    `src/global/host/launch-gentle-shell.js` while keeping the new/changed
    test files, confirmed with `node --test test/host-launch.test.js`):
    (a) "the launcher must perform at least one write to prove
    interception is live" failed (0 writes observed — old code called the
    real `mkdirSync`/`writeFileSync` directly, bypassing the injected
    `fsImpl`); (b) "missing dist/bundle/cli.js..." failed (`should not
    spawn` thrown instead of the expected explicit message — old code
    spawned instead of checking `cli.js` first); (c) both "no package.json
    with the fork's name..." and "a malformed intermediate package.json is
    skipped..." already passed against the old code — no RED, recorded
    here per the letter of the task.
  - Planted-write proof for (a): temporarily hardcoded
    `prepareKairoPiHome`'s `dir` to `/tmp/not-harness-home/...` (ignoring
    `env.HARNESS_HOME`), reran `test/host-launch.test.js`: the write test
    failed (op-list/HARNESS_HOME mismatch — writes escaped the fake
    HARNESS_HOME). Reverted immediately; confirmed clean via `git diff`
    against the prior committed version before committing.
  - GREEN: `node --test test/host-launch.test.js
    test/ecosystem-degrade.test.js` → 17 pass, 1 skip, 0 fail.
  - Focused: `node --test test/host-launch.test.js
    test/cli-implicit-host.test.js test/session-cli.test.js
    test/ecosystem-degrade.test.js test/pi-session-bindings.test.js
    test/workspace-shell-extension.test.js` → 75 pass, 1 skip, 0 fail.
  - Full: `npm test` → 2228 pass, 1 skip, 0 fail (baseline before this
    task: 2224 pass, 1 skip — net +4 tests: no-name-match,
    malformed-intermediate-skip, missing-bundle, default-execPath; no
    regressions).
  - Lint/typecheck: no `lint`/`typecheck` script exists in
    `package.json`; skipped (same as T9).
  - Not done here (out of scope, per constraint 7/T10): the fork was not
    added to `package.json`/`pnpm-lock.yaml`.
  - Delivery note (R4-unshipped-hard-dependency WARNING): this branch
    must not be pushed or merged before P02-T10 pins the published
    package. Until then, the default `kairo` launch fails with the
    explicit "not installed" error.
  - Parent gap fix (`969d5ab`, route: inline). The fsImpl test only sees
    writes routed through the injected fsImpl, and the writer's planted
    RED also went through fsImpl. A direct named-import write (the class
    of the withdrawn global-Pi patch) passed it. The new test runs the
    launcher in a child process
    (`test/helpers/launch-write-probe.mjs`) that patches every node:fs and
    fs/promises write API and calls `syncBuiltinESMExports()` before
    importing the launcher, then asserts every recorded write is under
    HARNESS_HOME.
    - RED: planted `writeFileSync(join(cwd, "planted-direct-write.txt"))`
      after `prepareKairoPiHome`. Result: the fsImpl test passed and the
      new test failed, naming the path outside HARNESS_HOME.
    - GREEN after the revert: `node --test test/host-launch.test.js
      test/ecosystem-degrade.test.js`: 18 pass, 0 fail, 1 skip.
      `npm test`: 2230 pass, 0 fail, 1 skip.
    - Scope: this covers writes made in the launcher process. The spawned
      Pi child is stubbed, and its own writes are the fork's concern.
  - Review of the T9b range: high risk; consent granted by the user.
    Lineage `review-80e62b92156fe3f9`, range `482a8b1..fa7373e`, 4
    lenses, **approved** with no blocking findings, and acknowledged.
    Advisory findings (R2 and R3 WARNING): the probe overclaimed "every
    write API". It recorded only the first path of rename, copyFile, cp,
    symlink, and link, and did not wrap open-for-write or
    createWriteStream. The fsImpl comment was stale.
  - Follow-up `5d36bba` (inline, the parent's own probe) fixes this:
    - Both paths of two-path APIs are recorded; open/openSync/
      fs/promises.open with write flags and createWriteStream are wrapped;
      descriptor writes are covered through the recorded open. The
      coverage is listed in the probe header.
    - Results now go to a dedicated file, so launcher console output
      cannot corrupt them.
    - The argv guard is derived from a named arg list. The test is renamed
      to what it proves, the fsImpl comment is corrected, and the
      decorative `notEqual(command, "pi")` is removed.
    - RED: three planted writes (a direct `writeFileSync`, a `renameSync`
      with its destination outside HARNESS_HOME, and an
      `openSync(..., "w")`) each fail and name the path.
    - GREEN after restoring: 18 pass / 0 fail / 1 skip on the focused
      files; `npm test` 2230 pass / 0 fail / 1 skip.
  - Review of `fa7373e..0f2c589`: high risk; consent granted by the user.
    4 lenses, **approved** with no blocking findings, and acknowledged.
    Advisory findings are left open deliberately; they are not fixed in
    a loop, because each fix reopens a high-risk review:
    - R2 WARNING: the probe records copyFile/cp sources and symlink
      targets as writes. That could cause a spurious failure later, but
      never a false pass.
    - R4/R3: `fs.open(path, callback)` treats the callback as flags,
      which could record a false write (again only a spurious failure).
    - R3: the coverage header still overclaims `fs.WriteStream` and
      `mkdtempDisposable*`.
    - R2: PROBE_ARGS is duplicated.
    Address these the next time the probe changes.
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
    executes `cli.js --version` on Node >=22. Focused GREEN: 17 pass,
    1 opt-in live test skipped, 0 fail.
  - Full suite: `npm test` with an isolated npm cache and permission for
    the loopback-only UI test: 2231 pass, 1 opt-in live test skipped,
    0 fail. A sandboxed run had two environmental failures (`listen EPERM`
    on 127.0.0.1 and npm cache write `EPERM`); both passed with the
    corresponding permissions/cache configuration. No interactive TTY
    run, CI run, push, PR, or merge was performed in this work unit.

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
