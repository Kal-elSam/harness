# Kairo MCP

Kairo exposes an MCP server so agents (Cursor, etc.) can observe governance
status, runs, alerts, Gentle, and Graphify, and publish a semantic work
snapshot for the **bound** workspace. Config mutations stay consent-gated in
the CLI / panel. The `kairo.work-snapshot/v1` payload is unchanged.

## Two servers

| Server id | How it starts | Writes |
|---|---|---|
| `kairo-workspace` | Cursor extension, per single-root window: `kairo mcp --workspace-bound --cwd .` with `cwd` = that folder | Snapshots / enrollments |
| `kairo` (global) | `~/.cursor/mcp.json` via `kairo mcp install` — `kairo mcp` | Read-only. **Does not register** `kairo_publish_work_snapshot`. |

Keep the global server until a later consented removal. It must not expose
the publish tool — never “accidentally” write into the right project.

## Connect from the IDE

1. Open a **single-folder** Cursor window (multi-root and empty windows cannot bind writes).
2. Confirm the Kairo panel shows **ready** (provider registered, single-root) — not unbound / ambiguous Atención. The panel does not claim a live PID.
3. **Connect Agent** still registers the global read-only `kairo` entry (`kairo mcp install`). That is not workspace binding.
4. Reload Cursor MCP (Command Palette → MCP: Restart / Reload Window).

Or from any terminal:

```bash
kairo mcp --workspace-bound --cwd .   # writable stdio (extension sets cwd)
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
kairo mcp --workspace-bound --cwd .
```

Stdout is reserved for the MCP protocol — no banners. Bound mode requires
`--workspace-bound` **and** explicit `--cwd` whose realpath equals `process.cwd()`.
HOME, `/`, inherited `VSCODE_CWD`, inherited `WORKSPACE_FOLDER_PATHS`, and
payload identity fields never authorize a write.

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
2. Confirm PID / argv / binding: `kairo mcp --workspace-bound --cwd .` with cwd = that folder. Server id `kairo-workspace`.
3. Global `kairo` MCP: publish tool is **absent** from the catalog; zero snapshots.
4. Repeat after **Reload Window**, **MCP: Restart**, and a full Cursor restart.
5. Single-root + successful provider register: panel `ready`. Multi-root: `ambiguous`, no writable provider. Empty window or register failure: `unbound`. Missing MCP API: **Upgrade Cursor** (not Reload Window). Symlink aliases converge via realpath.
6. Panel: unbound/ambiguous show Atención + Open folder / Upgrade Cursor — never Repair as `kairo mcp install`. Do not treat registration as a live process.

Pilot sessions stay **0/5** until this matrix PASSes.
