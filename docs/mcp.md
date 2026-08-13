# Kairo MCP

Kairo exposes an MCP server so agents (Cursor, etc.) can observe governance
status, runs, alerts, Gentle, and Graphify, and publish a semantic work
snapshot for the runtime workspace. Config mutations stay consent-gated in
the CLI / panel.

## Connect from the IDE

1. Open the **Kairo** panel (bottom bar).
2. Click **Connect Agent** — opens a terminal with `kairo mcp install`.
3. Review the plan, then run `kairo mcp install --yes` in that terminal.
4. Reload Cursor MCP (Command Palette → MCP: Restart / Reload).

Or from any terminal:

```bash
kairo mcp install          # show plan (MCP entry + managed rule)
kairo mcp install --yes    # write ~/.cursor/mcp.json + ~/.cursor/rules/kairo-work-snapshot.mdc
kairo connections --json   # chips including Agent · connected
kairo next --json          # selected work snapshot + integration state
```

`--client=cursor` is the only client in v1. A backup `*.kairo-backup.<ts>` is
created when an existing file is replaced.

## Managed Cursor rule

`kairo mcp install --yes` also installs `~/.cursor/rules/kairo-work-snapshot.mdc`
(`alwaysApply: true`). It instructs the agent to call
`kairo_publish_work_snapshot` after significant turns with Goal / Progress /
Now / Blockers / Next — never prompts, transcripts, or agent-supplied
workspace paths. The first publish enrolls the conversation automatically.

## Serve (stdio)

```bash
kairo mcp
```

Stdout is reserved for the MCP protocol — no banners.

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
| `kairo_publish_work_snapshot` | Write `kairo.work-snapshot/v1` (enrolls conversation) |

What an agent can ask:

- Is governance healthy? Any drift?
- List open alerts / recent runs.
- Is Gentle available? Is Engram configured?
- Query the Graphify knowledge graph (read-only).
- Publish the current semantic work snapshot.

What MCP does **not** do: sync, setup, install agents, or mutate configs
beyond the consent-gated `mcp install` path. Workspace identity for snapshot
publish is derived at runtime from Cursor-injected `VSCODE_CWD` /
`WORKSPACE_FOLDER_PATHS` when present, otherwise the MCP process cwd —
agents cannot supply `projectKey` / paths.

## Connections chips

`kairo connections --json` (and the panel chips) summarize:

| Chip | Access |
|---|---|
| Gentle | Capabilities probe → control-plane `provider`; review-bundle export/import (import needs consent). Workflow authority is Gentle v2 only — [companion boundary](gentle-companion.md) |
| Hermes | Read-only sessions via loopback API |
| Engram | Disk evidence + version; setup needs consent |
| Graphify | Read-only query / path / explain |
| Agent | Whether `mcpServers.kairo` is registered for Cursor |
