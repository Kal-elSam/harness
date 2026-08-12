# Kairo for VS Code / Cursor

A **Console Ninja–style panel** in the IDE bottom bar:

- **Work snapshot** — Goal / Progress / Now / Next from `kairo next` (`kairo.next/v1`)
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
- Repair only when integration is broken (`showRepair`)

Status comes from `kairo status --json`. Connections come from
`kairo connections --json` (includes `fleets` + recommended button actions).
Work state comes from `kairo next --json`. Actions open a terminal — the
extension never writes configs itself.

Kairo does **not** brew-install Gentle, Hermes, or Graphify. Those stay
optional externals; the panel only guides and refreshes.

## Requirements

- **Kairo Runtime `>= 0.15.0`**

```bash
npm i -g @kal-elsam/kairo-runtime@latest
kairo --version   # expect 0.15.0 or newer
```

## Install (GitHub Release)

Canonical builds ship as **GitHub Release** assets (not VS Marketplace / Open VSX yet).

1. Open the latest release:  
   https://github.com/Kal-elSam/harness/releases?q=kairo-vscode
2. Download `kairo-vscode-0.7.0.vsix` (and optionally verify the `.sha256`).
3. Install manually in Cursor:

```bash
cursor --install-extension ./kairo-vscode-0.7.0.vsix
```

Or in Cursor: **Extensions → … → Install from VSIX…** and pick the downloaded file.

Reload the window after install.

## Local package (contributors)

```bash
cd packages/kairo-vscode
npm test
npm run package   # pins @vscode/vsce@3.9.2; writes kairo-0.7.0.vsix
```

Do not reuse an old ignored `*.vsix` on disk for releases — always rebuild.

## Use

1. Open the **Kairo** tab in the bottom panel.
2. Confirm work snapshot / integration state (active · enrolled; Repair hidden when healthy).
3. Review **Fleet** (declared models) and **Activity** (OpenCode live sessions).
4. Change models via Details → plan / `--yes` (`kairo fleet set`).
5. CONFLICT/WARNING entries show resolve buttons from `kairo status` (`resolutions[]`).
6. For SDD conflicts: **Ver diff**, **Conservar el mío** (adopt), or **Usar versión Kairo** (overwrite with backup).
7. Skip optional chips you do not use — governance still works.

See also: [docs/mcp.md](../../docs/mcp.md).
