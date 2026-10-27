# Team shape and automatic re-form

## What the approved team holds

Each `projectTeam` entry in `project-strategy.json` keeps its `role` and its
default `model` pick (current readers, `kairo team roles init` and routing keep
working) and gains two fields:

- `band`: the role's price band, `light`, `standard` or `demanding`.
- `pool`: the band-first pool across the configured providers
  (`adapterId`, `modelId`, `displayName`, `utility`).

The concrete model for one launch is still picked per launch by routing, with
live quota and provider parity. The role set comes from the active catalog for
the project: Deliverer is present when the project has a git remote.

A strategy written before these fields existed (no `band`, no `pool`) still
loads and routes exactly as before. Nothing rewrites it until it is re-formed:
automatic refreshes never record a baseline or re-form it, and `kairo team rebuild`
produces the new format as a proposal you approve.

## Automatic re-form

`kairo team route --refresh` (also run in the background) compares the current
structure with the recorded baseline for the approved team. A structural change
re-forms the active team without approval and activates it:

- a catalog role is activated or deactivated (for example a git remote appears);
- `teamProviders` changed;
- a configured provider lost its install, login or model catalog.

Quota changes (limited windows, remaining percent, resets) never re-form.
The first formation still needs your approval, and a draft is never touched.
Your per-role overrides are carried over unless their provider left the team.
If the rebuilt team has no usable model, the previous team keeps serving.

## Where it is recorded

The structural baseline lives in the `structure` field of `project-strategy.json`.
`team-reform.json` next to it holds the last 20 re-forms, each with `at`, `reasons`
(`role_activated`, `role_deactivated`, `team_providers_changed`, `provider_lost`,
`provider_restored`) and the `before` and `after` role lists.

`kairo team show --json` exposes it read-only in the `reform` field. The next
`kairo team show` or `kairo team route` prints one line about a re-form and
does not repeat it; `--json` output never prints that line and never marks it
as announced.
