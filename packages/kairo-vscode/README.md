# Kairo for VS Code / Cursor

A **Console Ninja–style panel** in the IDE bottom bar:

- **Setup** — detect the agents you actually use (Cursor, Codex, Claude, …)
- **Entries** — conflicts/warnings first; Details always show resolve buttons
  (Fix SDD, Repair, Update graph, Why optional?, Doctor, Refresh)
- Connection chips (Gentle · Hermes · Engram · Graphify · Agent) marked **optional**
- **Fleet** tree — declared orchestrator→minion models (OpenCode + Gentle);
  Cursor Auto shown as opaque / IDE-managed
- **Activity** — live OpenCode sessions (active/idle); Refresh to update
- Details: **Change model (plan)** / **Apply** for OpenCode, Claude, Codex
  (terminal + `--yes`; never silent writes; never Cursor Auto)
- Click Hermes when unavailable → **Start Hermes gateway**
- Fix SDD / Repair / Doctor / Refresh in the toolbar when needed

Status comes from `kairo status --json`. Connections come from
`kairo connections --json` (includes `fleets` + recommended button actions).
Actions open a terminal — the extension never writes configs itself.

Kairo does **not** brew-install Gentle, Hermes, or Graphify. Those stay
optional externals; the panel only guides and refreshes.

## Install

```bash
npm install -g @kal-elsam/kairo-runtime
cd packages/kairo-vscode && npm run package
cursor --install-extension ./kairo-0.6.0.vsix
```

## Use

1. Open the **Kairo** tab in the bottom panel.
2. Review **Fleet** (declared models) and **Activity** (OpenCode live sessions).
3. Change models via Details → plan / `--yes` (`kairo fleet set`).
4. CONFLICT/WARNING entries show resolve buttons from `kairo status` (`resolutions[]`).
5. For SDD conflicts: **Ver diff**, **Conservar el mío** (adopt), or **Usar versión Kairo** (overwrite with backup).
6. Skip optional chips you do not use — governance still works.

See also: [docs/mcp.md](../../docs/mcp.md).
