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
- [ ] KWS-04 Add a Pi provider/model bridge that exposes only Kairo-verified,
  launchable routed choices; never invent subscription access.
- [ ] KWS-05 Provide an honest unavailable/blocked state when no verified route
  exists, with the next Kairo action rather than Pi's generic warning.
- [ ] KWS-06 Exercise the real temporary Gentle Shell/Pi harness and full
  regression suite; document any host API/version constraints.

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

- Forecast: ~550 authored changed lines across six cohesive tasks.
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
- KWS-03 completed locally; commit pending. Kairo now isolates the host and
  disables discovered extensions, skills, prompts, and themes; its own explicit
  extension remains the only product resource in the normal workspace launch.
