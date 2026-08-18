# Kairo MCP

Kairo exposes an MCP server so agents (Cursor, etc.) can observe governance
status, runs, alerts, Gentle, and Graphify, and publish a semantic work
snapshot for the **bound** workspace. Config mutations stay consent-gated in
the CLI / panel. The `kairo.work-snapshot/v1` payload is unchanged.

## Two servers

| Server id | How it starts | Writes |
|---|---|---|
| `kairo-workspace` | Cursor extension: absolute Node ≥20 + VSIX `dist/kairo-workspace.cjs` + `mcp --workspace-bound --cwd <absolute-folder>` (native `registerServer`; `env: {}`; no PATH `kairo`) | Snapshots / enrollments |
| `kairo` (global) | `~/.cursor/mcp.json` via `kairo mcp install` — `kairo mcp` | Read-only. **Does not register** `kairo_publish_work_snapshot`. Pre-main isolation: **disable** this server and report it as *disabled*, not read-only. |

Keep the global server until a later consented removal. It must not expose
the publish tool. After a compatible runtime ships, restore that global MCP
and prove its live catalog still omits publish before any pilot session.

## Connect from the IDE

1. Open a **single-folder** Cursor window (multi-root and empty windows cannot bind writes).
2. Confirm the Kairo panel shows **Bound** after native registration resolves — not live, connected, or ready. Unbound / ambiguous show Atención. A resolved register proves configuration, not a live PID.
3. **Connect Agent** still registers the global read-only `kairo` entry (`kairo mcp install`). That is not workspace binding.
4. Reload Cursor MCP (Command Palette → MCP: Restart / Reload Window).

Or from any terminal:

```bash
node dist/kairo-workspace.cjs mcp --workspace-bound --cwd /abs/folder  # VSIX write runtime
kairo mcp --workspace-bound --cwd /abs/folder   # checkout / post-release CLI
kairo mcp                             # global / unbound: read tools only
kairo mcp install                     # show plan (global MCP entry + managed rule)
kairo mcp install --yes               # write ~/.cursor/mcp.json + managed rule
kairo connections --json              # chips including Agent · connected (registration, not liveness)
kairo next --json                     # selected work snapshot + integration state
```

`--client=cursor` is the only client in v1. A backup `*.kairo-backup.<ts>` is
created when an existing file is replaced.

## Managed Cursor rule

`kairo mcp install --yes` also installs `~/.cursor/rules/kairo-work-snapshot.mdc`
(`alwaysApply: true`). It instructs the agent to call
`kairo_publish_work_snapshot` **on `kairo-workspace`** after significant turns
with Goal / Progress / Now / Blockers / Next — never prompts, transcripts, or
agent-supplied workspace paths. The first publish enrolls the conversation
automatically.

If the publish tool is missing, stop. The global `kairo` MCP **does not
register** `kairo_publish_work_snapshot` (it does not return
`workspace_unbound`). Do not retry with `cwd`, paths, or `projectKey`.
On `kairo-workspace`, `workspace_ambiguous` and `workspace_mismatch` also
mean stop.

## Serve (stdio)

```bash
kairo mcp --workspace-bound --cwd /abs/folder
```

Stdout is reserved for the MCP protocol — no banners. Bound mode requires
`--workspace-bound` **and** an explicit `--cwd` whose canonical path equals
`process.cwd()` **or** the unique canonical `WORKSPACE_FOLDER_PATHS` folder.
HOME, `/`, inherited `VSCODE_CWD`, multiple roots, invalid paths, diverging
symlinks, and payload identity fields never authorize a write.

## Tools

| Tool | Purpose |
|---|---|
| `kairo_status` | Control-plane health + companion summary |
| `kairo_runs` | Recent / active runs |
| `kairo_alerts` | Alert list |
| `kairo_gentle_status` | Gentle probe state |
| `kairo_graph_query` | Graphify query on a workspace graph |
| `kairo_graph_path` | Graphify path between nodes |
| `kairo_context_summary` | Companion signals, Engram status, soft links |
| `kairo_fleet` | Declared fleets + OpenCode live activity |
| `kairo_publish_work_snapshot` | Write `kairo.work-snapshot/v1` (enrolls conversation). **Registered only on `kairo-workspace`.** |

Bound-server fail-closed codes: `workspace_ambiguous`, `workspace_mismatch`
(and `workspace_unbound` when `--workspace-bound` is set without a matching
`--cwd`). Payload `cwd` / `projectKey` / `projectPath` remain
`forbidden_identity_fields`. The global server does not list this tool.

What MCP does **not** do: sync, setup, install agents, or mutate configs
beyond the consent-gated `mcp install` path. Agents cannot supply workspace
identity.

## Connections chips

`kairo connections --json` (and the panel chips) summarize:

| Chip | Access |
|---|---|
| Gentle | Capabilities probe → control-plane `provider`; review-bundle export/import (import needs consent). Workflow authority is Gentle v2 only — [companion boundary](gentle-companion.md) |
| Hermes | Read-only sessions via loopback API |
| Engram | Disk evidence + version; setup needs consent |
| Graphify | Read-only query / path / explain |
| Agent | Whether `mcpServers.kairo` is **registered** in mcp.json — not a live process, not workspace binding |

## Human acceptance (Cursor isolation)

Two **unrelated** single-root windows open at once, without quitting Cursor:

| Window | Folder | Expected `projectKey` |
|---|---|---|
| A | this checkout | `<key-A>` from this folder |
| B | any other repo | `<key-B>` ≠ `<key-A>` — compute, do not hardcode |

Window B is only a second identity to prove isolation. It is not a dependency of Kairo.

Checklist:

1. Publish A → B → A. Each snapshot/enrollment lands only in that window’s key.
2. Confirm spawned argv: absolute Node, installed `kairo-workspace.cjs`, `mcp --workspace-bound --cwd <absolute-folder>`. Never PATH `kairo`. Server id `kairo-workspace`. Native stdio has no `cwd` field (`env: {}`).
3. Pre-main: disable the legacy global `kairo` MCP and report it as **disabled** (not read-only). After a compatible runtime ships, restore it and prove the live catalog omits publish.
4. Repeat after **Reload Window**, **MCP: Restart**, and a full Cursor restart.
5. Trusted single-root + resolved native register: panel **Bound**. Multi-root: `ambiguous`. Empty window: `unbound`. Missing/old Node: `registration_failed` / `runtime_unavailable`. Register failure: Reload Window. Missing `vscode.cursor.mcp.registerServer`: **Upgrade Cursor**. Untrusted: Trust Workspace. Non-`file://`: unsupported. Converging symlinks bind; diverging ones do not.
6. Panel: recoveries are Upgrade Cursor / Reload Window / Trust Workspace / Open single folder — never Repair as `kairo mcp install`. Do not treat registration as a live process.

Pilot sessions stay **0/5** until this matrix PASSes.
