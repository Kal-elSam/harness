# Changelog

All notable changes to `@kal-elsam/harness` are documented here.

## 0.8.0 — 2026-07-03

Minor release. Product pivot to a local AI ecosystem configurator, plus portable
workspace component pack/import.

### Terminal setup & control plane

- `harness setup --dry-run` is the recommended entry: detects Cursor/Codex/OpenCode/Claude,
  prints the agent-global plan, writes nothing, never touches the workspace.
- `harness setup` applies the same safe agent-global result as `harness install`.
- `harness status` control plane: detected agents, installed components, ok/missing/stale,
  backups, and next action (`install`, `doctor`, `update`, `rollback`).
- Non-interactive install remains: `harness install --agents … --components …`.
- Workspace install is opt-in/legacy (`--scope=workspace`); agent-global is the primary path.
- Mental model: Harness is the local configurator/orchestrator. npm is distribution only.
  Terminal UX prioritizes clear non-interactive modes (Pi-inspired clarity, no Pi runtime).

### Advanced: component distribution

- `harness components pack <id> --out <file>` builds a `.tgz` with a one-component
  `catalog.json` and declared assets only.
- `harness components import <file>` installs into `.harness/components/` of the current
  workspace without touching `~/.harness` or running package scripts.
- Import refuses overwrites, bundled IDs, path traversal, symlinks, and undeclared assets.
- Pack/import is an advanced capability, not the product identity.

### Primary flow

```bash
harness setup --dry-run
harness setup
harness status
harness install --agents cursor,codex --components orchestrator,sdd-core
```

## 0.7.0 — 2026-07-03

Minor release. Adds public authoring commands for workspace components.

### Component authoring CLI

- `harness components validate [--cwd <path>]` validates `.harness/components/catalog.json`
  with the same loader used by install/doctor.
- `harness components init <id> --label "<label>"` scaffolds catalog entry, component directory,
  and `README.md` (`version: "0.1.0"`).
- Does not overwrite existing IDs, rejects bundled IDs, and never writes to `~/.harness`.

### Authoring flow

```bash
harness components init team-rules --label "Team Rules"
# edit .harness/components/team-rules/README.md
harness components validate
harness install --components team-rules
```

## 0.6.0 — 2026-07-03

Minor release. Adds opt-in workspace component sources for local custom components.

### Workspace component catalog

- Optional workspace catalog at `.harness/components/catalog.json` with assets under
  `.harness/components/<component-id>/`.
- `harness components` lists bundled and workspace components separately.
- `harness install --components <ids>` resolves bundled and workspace IDs from the current cwd.
- Workspace components use a generic managed section (label, installed assets, optional instructions).

### Validation and safety

- Workspace IDs must be unique and cannot override bundled components.
- Asset paths must be relative, stay inside the component directory, exist on disk, and cannot
  escape the workspace via symlinks.
- `doctor` detects drift for installed workspace assets; `uninstall` removes copied assets and
  managed sections.

## 0.5.0 — 2026-07-03

Minor release. Adds a public component catalog and inspection command.

### Component catalog

- Bundled components are declared in `global-template/components/catalog.json`
  (id, label, version, defaults, asset files, adapter hints).
- `component-registry.js` loads from the catalog instead of hardcoded imports.
- Default install still ships `orchestrator` and `sdd-core`; existing state remains valid.

### New command

- `harness components` lists bundled components, defaults, assets, and adapter hints.

### Node compatibility

- Catalog loader uses `readFileSync` + `JSON.parse` for Node `>=18.18` compliance.
- CI matrix includes Node 18.

## 0.4.2 — 2026-07-03

Patch release. Release confidence tooling only; no harness CLI behavior changes.

### Registry install verification

- Added `npm run smoke:registry` to install `@kal-elsam/harness` from the npm
  registry in an isolated temp workspace and exercise the published CLI.
- Documented post-publish steps: `release:published` and `smoke:registry`.

### Release provenance

- Attribution guard supports `--range` for CI/PR scans.
- Added `npm run release:published` to verify npm `gitHead`, tags, and `origin/main`.
- Published tarball now includes `scripts/` used by npm release/smoke commands.
- CI and publish workflows run attribution checks; publish runs `release:check` before `npm publish`.

## 0.4.1 — 2026-07-03

Corrective release. No functional changes from `0.4.0`.

- Release metadata and process hardening.
- Documented prohibition on `Co-authored-by` / AI attribution in release commits.
- Added `npm run release:check` to fail when `HEAD` contains attribution trailers.

## 0.4.0 — 2026-07-03

### Agent-global default install

- `harness install` defaults to `agent-global` scope: configures local agent roots
  (Cursor, Codex, OpenCode, Claude) under `~/.harness` without touching project
  files.
- Managed marker sections in agent configs with backup-before-change safety.
- `HARNESS_HOME` override for sandboxed installs and testing.

### Adapter contract

- Unified adapter registry with detection, planning, and managed config targets.
- Explicit `--agents` / `--adapters` selection; falls back to all supported
  agents when none are detected locally.

### Component system

- Pluggable components with `orchestrator` and `sdd-core` installed by default.
- `--components` selection and `--no-default-components` for core-only installs.
- Component assets under `~/.harness/components/` with managed sections in agent
  configs.

### Drift detection and safe sync

- `harness doctor` detects missing assets, stale hashes, and drifted managed
  sections; exits non-zero on failure.
- `harness update` repairs managed drift without overwriting user-owned content
  outside harness markers.

### Backup and rollback

- `harness backups` lists config snapshots under `~/.harness/backups/`.
- `harness rollback --to <snapshot>` previews restores (dry-run by default).
- `harness rollback --to <snapshot> --apply` restores backed-up configs with a
  safety snapshot before overwriting existing files.

### Smoke and release hardening

- `npm run smoke` validates the packed tarball (not just source) end to end.
- CI and publish workflows require smoke tests before release.
- Publish workflow runs smoke before `npm publish` via npm Trusted Publishing.
