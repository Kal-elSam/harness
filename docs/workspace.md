# Workspace scope

## Workspace lifecycle: init, update, doctor

The workspace harness is not a one-shot copy. Every `init` writes a manifest
that later `update` and `doctor` runs rely on. All workspace commands accept
`--scope=workspace`; `init` implies it.

### `kairo init` / `kairo install --scope=workspace`

Installs `repo-template/` into the target project and writes
`.harness/manifest.json` with the installed mode, CLI version, and a content
hash for every file the harness created.

```bash
kairo init --mode enterprise --all-adapters
kairo install --scope=workspace --mode standard --adapters codex,cursor
```

By default it never overwrites a file that already exists. Pass `--force` to
overwrite, or `--dry-run` to preview without writing anything.

Important behavior:

- Running just `kairo` (or `npx/pnpm dlx @kal-elsam/kairo-runtime`) now runs the
  **agent-global** install, not the workspace scaffold.
- Within workspace scope, `mode=standard` remains the default.
- `--adapters` installs only the requested adapters.
- `--all-adapters` keeps the previous “install everything” behavior.

Supported adapters:

```txt
codex, cursor, claude, gemini, copilot, opencode, pi
```

### `kairo detect`

Read-only inspection command. It reports the global agents detected on this
machine, then the current project stack and adapter markers, and prints the
recommended install command.

```bash
kairo detect
```

### `kairo update --scope=workspace`

Reapplies the current harness templates to an already-installed project.

```bash
kairo update --scope=workspace --dry-run   # preview: created / updated / unchanged / skipped
kairo update --scope=workspace             # apply
kairo update --scope=workspace --force     # also overwrite files you modified locally
```

`update` is conservative by design:

- Files unchanged since install are safely refreshed to the latest template.
- Files you edited locally are **skipped** unless `--force` is passed.
- Files that exist but were never tracked by the harness are left alone.
- New files added in newer harness releases are created.
- `.harness/manifest.json` is rewritten with the new hashes, CLI version, and adapter selection.

### `kairo doctor --scope=workspace`

Read-only health check. Never modifies files.

```bash
kairo doctor --scope=workspace
```

Reports each check as `OK`, `WARNING`, or `MISSING`:

- **Required** files missing (`AGENTS.md`, `docs/ai/harness.md`,
  `docs/ai/memory.md`) fail the check (non-zero exit code).
- **Recommended** files missing are reported as warnings.
- If `.harness/manifest.json` is missing, doctor warns and suggests
  `kairo init`.
- If a file tracked in the manifest was deleted after install, doctor
  reports manifest drift.

### `.harness/manifest.json`

```json
{
  "packageName": "@kal-elsam/kairo-runtime",
  "cliVersion": "0.2.0",
  "mode": "enterprise",
  "adapters": ["codex", "cursor"],
  "installedAt": "2026-07-02T18:00:00.000Z",
  "updatedAt": "2026-07-02T18:00:00.000Z",
  "files": {
    "AGENTS.md": "3f9a...",
    "docs/ai/harness.md": "8b21..."
  }
}
```

This file is the source of truth for what the harness owns in a project.
Commit it to version control.
