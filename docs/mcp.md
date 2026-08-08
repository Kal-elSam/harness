# Kairo MCP

Kairo exposes a **read-only** MCP server so agents (Cursor, etc.) can observe
governance status, runs, alerts, Gentle, and Graphify without writing configs.

## Connect from the IDE

1. Open the **Kairo** panel (bottom bar).
2. Click **Connect Agent** — opens a terminal with `kairo mcp install`.
3. Review the plan, then run `kairo mcp install --yes` in that terminal.
4. Reload Cursor MCP (Command Palette → MCP: Restart / Reload).

Or from any terminal:

```bash
kairo mcp install          # show plan
kairo mcp install --yes    # write ~/.cursor/mcp.json entry
kairo connections --json   # chips including Agent · connected
```

Entry written:

```json
{
  "mcpServers": {
    "kairo": {
      "command": "kairo",
      "args": ["mcp"]
    }
  }
}
```

`--client=cursor` is the only client in v1. A backup `*.kairo-backup.<ts>` is
created when the file already exists.

## Serve (stdio)

```bash
kairo mcp
```

Stdout is reserved for the MCP protocol — no banners.

## Tools (read-only)

| Tool | Purpose |
|---|---|
| `kairo_status` | Control-plane health + companion summary |
| `kairo_runs` | Recent / active runs |
| `kairo_alerts` | Alert list |
| `kairo_gentle_status` | Gentle probe state |
| `kairo_graph_query` | Graphify query on a workspace graph |
| `kairo_graph_path` | Graphify path between nodes |
| `kairo_context_summary` | Companion signals, Engram status, soft links |
| `kairo_fleet` | Declared fleets + OpenCode live activity (parent→child sessions) |

What an agent can ask:

- Is governance healthy? Any drift?
- List open alerts / recent runs.
- Is Gentle available? Is Engram configured?
- Query the Graphify knowledge graph (read-only).

What MCP does **not** do: sync, setup, install agents, or mutate configs.
Those stay consent-gated in the CLI / panel buttons (terminal).

## Connections chips

`kairo connections --json` (and the panel chips) summarize:

| Chip | Access |
|---|---|
| Gentle | Probe contract; review-bundle export/import (import needs consent) |
| Hermes | Read-only sessions via loopback API |
| Engram | Disk evidence + version; setup needs consent |
| Graphify | Read-only query / path / explain |
| Agent | Whether `mcpServers.kairo` is registered for Cursor |
