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

### Informational Gentle Shell extension

The package declares `src/global/hosts/gentle-shell-extension.js` as a Pi
extension. Explicitly loading the Kairo package alongside the patched host
enables a fresh assignment table before each prompt in a hidden context message
(host assignment plus Kairo's decision), and a compact panel in the host's
right-hand Status column: ordered single-line statuses (`kairo-team-00` header,
then one `<agent> → <model id>` line per agent, or the reason Kairo does not
route it), capped at 10 lines. Kairo maps its models against the host's
authenticated models, falling back to the full catalog only when none are listed. No widget is used. This change does not install or load the package in your current host.
The extension uses the local `gentle-shell:model-routes:read/v1` event contract;
it does not call model tools, read config files, or launch a Kairo CLI process.
Replies must match the active session and root. Missing, malformed, duplicate
or late replies are unavailable, never replaced with a cached assignment.
Inherited child defaults remain unobserved; missing reviewer models remain
unconfigured. All displayed assignments are informational, not quota,
authentication, model-selection or execution guarantees. Child agents do not
enable this UI. No assignments, team state or configuration are written.

### Gentle Shell launch-model selector

Before an ordinary or Judgment Day subagent launch, the extension may answer
`gentle-shell:model-selection:select/v1` with one `provider/id`, synchronously,
from a Kairo route snapshot taken at prompt start for the same session and root.
No answer keeps the host's own model.

- A model you chose by hand (source `binding`, `profile`, `pin:*`, `frozen:*`)
  is never replaced, except that an ordinary agent whose chosen model Kairo
  marks as out of quota moves to the role's next admitted candidate. Manual
  Judgment Day agents are never touched.
- Inherited, default or definition models get the role's routed model, or the
  next admitted candidate. `jd-judge-a` and `jd-judge-b` take the Reviewer
  route and must end on different providers; with one admitted provider neither
  is answered (`judges-share-provider`) and the table says so. `jd-fix-agent`
  takes the Builder route.
- Gentle Shell agents without a project role-catalog entry use defaults:
  `gentle-ai-explore` Explorer, `gentle-ai-verify` Verifier, `gentle-ai-worker`
  and `jd-fix-agent` Builder, judges Reviewer. A generic default name
  (Builder, Reviewer, Explorer, Verifier) resolves to the exact role, else to the
  single role ending in that name (for example `Backend Builder`); zero matches
  give `unknown-agent`, several give `ambiguous-role`, and nothing is routed.
  A catalog entry always wins.
- The Kairo panel is painted on `session_start`, before any prompt, and
  refreshed on every `before_agent_start`.
- Review lenses, refuter and validator never use this event.
- A Kairo model id maps to Pi only when exactly one registry entry has that id;
  ambiguous or unknown ids are not answered. Claude and Codex hosts keep
  gentle-ai owned actors unrouted.

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
