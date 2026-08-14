# Kairo for VS Code / Cursor

Gentle **control plane** panel (extension `0.8.0`):

- **Ahora** — Goal / Progress / Now / Next from the embedded `kairo.next/v1` work report
- **Workflow** — Gentle SDD / review when `provider=connected`; official `next_transition` unaltered; **Upgrade Gentle** (`gentle-ai doctor`) when v1. Receipt/gate only when Gentle publishes them. Work and Equipo survive degradation. See [Gentle companion boundary](../../docs/gentle-companion.md).
- **Equipo** — declared fleets with honesty badges (`live` | `declared` | `opaque`)
- **Atención** — actionable items; ≤2 primary actions; Setup / Models / Catalog / Doctor secondary
- Connection chips (Gentle · Hermes · Engram · Graphify · Agent) marked **optional**
- Working floor — live OpenCode sessions only (no Cursor/Claude agent theater)

The panel does a **single** fetch of `kairo control-plane --json` (plus `kairo status --json` for the status bar / checks). It does not assemble contradictory partial UI from parallel `connections` + `next` calls.

Actions open a terminal — the extension never writes configs itself. Kairo does **not** brew-install Gentle, Hermes, or Graphify.

## Requirements

- **Kairo Runtime with `kairo control-plane`** (shipped in this tracker; public npm release is a separate unit after merge)

```bash
# From a checkout that includes control-plane, or after the runtime release:
kairo control-plane --json
kairo --version
```

## Install (GitHub Release)

Canonical builds ship as **GitHub Release** assets (not VS Marketplace / Open VSX yet).

After the separate `kairo-vscode-v0.8.0` release unit:

1. Open the release:
   https://github.com/Kal-elSam/harness/releases?q=kairo-vscode
2. Download `kairo-vscode-0.8.0.vsix` (and optionally verify the `.sha256`).
3. Install manually in Cursor:

```bash
cursor --install-extension ./kairo-vscode-0.8.0.vsix
```

Or in Cursor: **Extensions → … → Install from VSIX…** and pick the downloaded file.

Reload the window after install.

Until `0.8.0` is published, keep using the last GitHub Release (`0.7.0`) or package locally from this branch.

## Local package (contributors)

```bash
cd packages/kairo-vscode
npm test
npm run package   # pins @vscode/vsce@3.9.2; writes kairo-0.8.0.vsix
```

Do not reuse an old ignored `*.vsix` on disk for releases — always rebuild.

## Honesty

| Badge | Meaning |
|-------|---------|
| `live` | OpenCode activity evidence present |
| `declared` | Configured topology on disk |
| `opaque` | IDE-managed / not inspectable (e.g. Cursor Auto) |

## Privacy

No prompts or transcripts are scraped. Work appears only after an Agent publishes a snapshot via the **workspace-bound** MCP (`kairo-workspace` / `kairo_publish_work_snapshot`) or hooks. Never send paths or `projectKey`. The panel shows **Bound** after native Cursor MCP registration — not live or ready. The global `kairo` MCP is read-only.
