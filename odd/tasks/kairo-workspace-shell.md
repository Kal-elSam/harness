# Kairo Workspace Shell

## Objective

Replace the raw Gentle Shell/Pi startup with a compact, Kairo-owned interactive
workspace that keeps the existing project, session, model-routing, usage, and
memory value visible in one terminal.

## Problem

The current host cutover opens Gentle Shell through Pi successfully, but Kairo's
loaded extension is empty. The user sees the host's startup inventory,
duplicate-resource diagnostics, changelog, and Pi's unauthenticated model
warning instead of Kairo's PROJECT TEAM and control-plane state.

## Authorized scope

- [x] KWS-01 Define a host-facing workspace snapshot from Kairo's existing
  project strategy, session, routing, usage, and memory state; add RED/GREEN
  contract tests. RED: missing workspace-snapshot module. GREEN: 4/4 focused
  contract tests, plus 15/15 host/kernel regression tests.
- [x] KWS-02 Replace the no-op Pi extension with a compact Kairo workspace
  header and commands for status, team, sessions, usage, routing, and memory.
  RED: extension exports absent and host binding missing from environment.
  GREEN: 19/19 focused host/kernel/workspace tests. Session IDs reach the host
  through `KAIRO_SESSION_ID`, never command argv.
- [x] KWS-03 Make the normal host launch quiet and Kairo-branded; preserve
  explicit diagnostics/debug behavior without hiding real errors. RED: host
  still passed `--link`. GREEN: isolated, discovery-disabled Pi host with the
  explicit Kairo extension; 13/13 focused tests and real `gentle-shell` 0.87.1
  isolated launch completed successfully.
- [x] KWS-04 Add a Pi provider/model bridge that exposes only active,
  automatic, launchable routed choices; never invent subscription access. RED:
  provider module absent. GREEN: 17/17 focused host/provider tests and a real
  isolated `gentle-shell --list-models kairo` run listed only the current
  Kairo-routed Codex/OpenCode models.
- [x] KWS-05 Provide an honest unavailable/blocked state when no verified route
  exists, with the next Kairo action rather than Pi's generic warning. RED:
  missing routes still rendered the ordinary workspace. GREEN: focused host
  tests show the Kairo-owned unavailable state and its recovery action.
- [x] KWS-06 Exercise the real temporary Gentle Shell/Pi harness and full
  regression suite; document any host API/version constraints. A first full
  run exposed a non-interactive host regression; fixed it before final proof.
  GREEN: isolated `gentle-shell --list-models kairo` listed Kairo routes and
  the final full suite passed 2063/2063.
- [x] KWS-07 Forward Pi flags through Gentle Shell after its `--` delimiter so
  the host actually disables discovered Gentle resources. RED: launcher placed
  Pi flags before the delimiter. GREEN: 11/11 focused host/extension tests.
- [x] KWS-08 Replace the opening line-dump with a compact Kairo status surface;
  details remain behind explicit Kairo commands/overlays. RED: opening widget
  contained full TEAM/USAGE/command text. GREEN: 11/11 focused host/extension
  tests prove opening compactness and retain detail commands.

## Constraints

- Pi/Gentle Shell is the renderer and interactive-session substrate; Kairo owns
  product state, routing policy, subscriptions, and visual workspace content.
- Reuse existing Kairo sources of truth; do not duplicate PROJECT TEAM,
  entitlement, session, quota, or Engram state.
- No unreviewed third-party Pi package is a runtime dependency.
- No remote operation is authorized.
- Preserve unrelated untracked paths: `docs/assets/` and
  `scripts/inspect-opencode-tier.sh`.
- TDD mode: enabled for new behavior. Each task requires observed RED, GREEN,
  then refactor with `node --test` focused tests; finish with `npm test`.

## Acceptance criteria

- Bare `kairo` starts with a Kairo workspace, not the host's resource inventory.
- The opening surface identifies the project/session and displays compact,
  real PROJECT TEAM and access/routing state.
- User-visible Kairo commands expose sessions, usage, team, routing, and
  memory/context without opening the legacy cockpit.
- A provider/model UI can only offer candidates Kairo has verified as usable.
- Missing or exhausted access produces an actionable Kairo state.

## Delivery

- Forecast: ~650 authored changed lines across eight cohesive tasks.
- Strategy: stacked-to-main in small PR slices, explicitly chosen by the user.
  Each local work-unit commit remains local until the user separately authorizes
  its remote push/PR/merge. No remote delivery is included.

## Progress

- Created after live validation demonstrated that the host launch technically
  works but is visually and product-wise incomplete.
- User chose small stacked PRs to `main` for eventual delivery.
- KWS-01 completed locally in `fde214c` (`feat(host): add workspace snapshot
  contract`). It intentionally does not select a "latest" session when the
  host has no explicit session binding.
- KWS-02 completed locally in `3c2c525` (`feat(host): render Kairo workspace
  shell`). Pi now renders a compact Kairo widget and exposes `/kairo`,
  `/kairo-team`, `/kairo-sessions`,
  `/kairo-usage`, `/kairo-route`, and `/kairo-memory`.
- KWS-03 completed locally in `a684570` (`fix(host): isolate Kairo workspace
  resources`). Kairo now isolates the host and disables discovered extensions,
  skills, prompts, and themes; its own explicit extension remains the only
  product resource in the normal workspace launch.
- KWS-04 completed locally in `6747c49` (`feat(host): bridge Pi models through
  Kairo routes`). Pi now receives a `kairo` provider only after the Kairo
  strategy yields active, automatic and locally launchable assignments. The
  provider executes the existing native CLI adapter; it does not copy or
  synthesize API credentials.
- KWS-05 completed locally in `a3f5a4c` (`fix(host): explain unavailable Kairo
  routes`). If no verified automatic route exists, the workspace now replaces
  the ordinary widget with an explicit unavailable state and the real recovery
  action instead of implying that Pi's model setup is the fix.
- KWS-06 completed locally with corrective commit `7a83bea`
  (`fix(cli): reject noninteractive Kairo host`). The initial full-suite run
  caught an actual regression: a non-TTY could launch the host and exit zero.
  The fixed final run passed 2063/2063. Pi 0.85.1 remains the minimum host API;
  this machine's 0.87.1 also passed the isolated route-model harness.
- KWS-07/KWS-08 were authorized after a live screenshot proved that Gentle
  resource inventory still leaked into the host and that the Kairo widget is
  visually overloaded. The delimiter bug is verified against `gentle-shell
  --help`; no third-party UI package is needed for the correction.
- KWS-07 completed locally in `297118b` (`fix(host): forward Pi flags through
  Gentle Shell`). The wrapper delimiter now precedes every Pi-only flag.
- KWS-08 completed locally in `e4d67e8` (`feat(host): compact Kairo workspace
  opening`). Startup now presents project/session/team state only; usage,
  memory and assignment detail are opt-in commands.
