# Delegate from the active CLI

Kairo keeps the same role-based routing workflow in Claude Code, Codex, and
OpenCode. The host constrains each request; switching hosts does not rewrite
the shared approved team. The orchestrator is the model selected in the current
session, not another model selected by Kairo. An unknown session model stays
unknown; configured defaults and stored assignments are not live evidence.

## Host identity

An explicit `--host claude-code|codex|opencode|gentle-shell` on `team route` or `team show`
takes precedence over the server/process binding `KAIRO_HOST`. Without a binding,
Kairo recognizes the Claude session marker `CLAUDECODE=1` and Codex session
markers `CODEX_THREAD_ID` / `CODEX_SESSION_ID`. Conflicting session markers require
an explicit host binding; installed directories never break the tie.

Host-neutral library callers retain their existing behavior. MCP accepts host
identity only from its server context/environment, not from tool arguments.
Preview and confirmed execution revalidation carry the same server-owned context.

```sh
kairo team route --role Builder --host codex --json
kairo team show --host codex
```

Gentle Shell currently supports explicit runtime identity only:
`--host gentle-shell` or `KAIRO_HOST=gentle-shell`. No installed directory,
Pi child marker, or configured default model identifies a Gentle Shell session.
An extension must supply the binding; Kairo does not install that extension yet.
This identity admits no executable providers: cached routing waits rather than
claiming model launch or automatic fallback support. An explicitly forced
provider is rejected with `host_provider_unavailable`. These reads never write
`models.json`. The managed `pi` adapter remains separate;
`team roles sync --host all` does not add or manage a Gentle Shell adapter.

Route JSON includes `host.id`, `host.source`, and `host.model` (currently null).
With an active host, `team show` and the MCP team view show effective compatible
assignments or explain why a role is unavailable. Drafts remain proposals, not
executable assignments. Shared phase forecasts remain visible and are labeled
as shared-team forecasts, not host-compatible route promises. Missing/stale routing inputs never turn an incompatible
stored assignment into a runnable pick. These reads do not refresh inputs,
launch models, or change the approved strategy.

## Delegation capabilities

| Active host | Eligible routes |
| --- | --- |
| Gentle Shell | None yet; runtime identity only, pending an admitted launch integration. |
| Codex | Codex-native models only; never a Claude model in a native Codex agent. |
| Claude Code | Native Claude models and existing Kairo provider bridges. |
| OpenCode | OpenCode-backed Go/Zen catalogs, subject to existing access, billing, entitlement, quota, and role qualification gates. |

OpenCode's generic `provider/model` syntax does not transfer a Claude or Codex
CLI login into OpenCode. Kairo does not infer native account access from that
syntax. No compatible qualified candidate means waiting with an explanation,
not falling back across the host capability boundary. No safety gate is weakened.

## Host role files

`kairo team roles sync` prefers the active host when identified; otherwise it
retains installed-host discovery. Explicit `--host all` still previews every
host. Picks are resolved separately for each host. Generated instructions retain
the role, concrete model, and current-session orchestrator, and use only the
host's available delegation tools. Unverified per-launch hooks remain unverified:
configuration generation is not proof of runtime interception.

For OpenCode, role sync also plans a managed
`.opencode/plugins/kairo-host.js`. After an authorized `--yes` apply and host
reload, its `shell.env` hook binds child shell tools to `KAIRO_HOST=opencode`.
This uses OpenCode's [plugin hook contract](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts).
Foreign files are preserved; retirement removes only the owned plugin.
The plugin does not identify the current model or bind unrelated processes.

Existing MCP registrations that do not convey a session marker need an explicit
server environment binding, for example `KAIRO_HOST=codex`; no account credentials
are required in that binding. This change does not install or reconfigure a live
MCP client automatically. Native Codex/OpenCode delegation and UI integration
still depend on the tools exposed by the running CLI; the Claude status plugin
does not become a Codex or OpenCode UI.
