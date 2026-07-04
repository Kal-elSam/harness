# Changelog

All notable changes to `@kal-elsam/harness` are documented here.

## 0.12.0 — 2026-07-04

Minor release. Adapter matrix confidence for Cursor, Codex, OpenCode, and Claude Code.

### Adapter matrix

- `harness adapters` and `harness adapters --json` show the official supported
  adapter matrix: `id`, `label`, `rootDir`, `configFile`, `detected`, `managed`,
  `managedTargets`.
- Harness does not install Cursor/Codex/OpenCode/Claude; it configures managed
  sections in their config files only.

### Explicit all-agents selection

- `harness setup --agents all` and `harness install --agents all` force all four
  supported adapters, even when some roots are not detected.
- Default unchanged: detected agents when present, safe fallback to all when none
  are detected.

### Registry smoke

- Creates all four agent roots and validates `adapters --json`, `status --json`,
  drift repair (including OpenCode), and `uninstall`.

## 0.11.0 — 2026-07-04

Minor release. Product-style bootstrap installer UX. npm remains the distribution
mechanism; users enter through a one-liner that runs `harness`.

### Bootstrap installer

- Public script: `scripts/install.sh`
- One-liner:
  `curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh`
- Detects Node/npm, prints the plan, runs `@kal-elsam/harness` via `npx` or
  `npm exec`, and finishes with `harness setup --dry-run`.
- `--dry-run` prints the plan without downloading or executing the package.
- Safe by design: no `sudo`, no shell profile changes, no agent config or
  `~/.harness` writes (preview only). Clear errors when Node/npm are missing.

### Version docs

- `harness --version` and README/help document installed vs published version.
- Update path: `npx @kal-elsam/harness@latest sync`.

### Recommended entry

```bash
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh
npx @kal-elsam/harness setup
npx @kal-elsam/harness status
```

## 0.10.0 — 2026-07-04

Minor release. Machine-readable control-plane output and registry smoke parity
with the recommended `setup` / `status` / `sync` flow.

### JSON output

- `harness status --json`, `harness sync --dry-run --json`, and `harness doctor --json`
  emit a stable envelope for CI, tooling, and debugging.
- Stable fields: `ok`, `overall`, `agents`, `components`, `checks`, `backups`,
  `nextAction`, `cliVersion`.
- Human-readable output remains the default.
- Exit codes are unchanged: non-zero when the ecosystem is not healthy.

### Registry smoke

- `scripts/registry-smoke-test.sh` exercises `setup --dry-run`, `setup --yes`,
  `status`, drift simulation, `sync`, `status --json` (expects `overall=ok`),
  and `uninstall`.

### Docs / messaging

- Primary day-to-day repair path is `harness sync`; `update` remains a technical alias.
- Doctor and managed-section guidance point at `sync` instead of `update`.

### Recommended flow

```bash
harness setup
harness status
harness sync
harness status --json
```

## 0.9.0 — 2026-07-03

Minor release. Adds `harness sync` as the primary convergence command.

### Sync command

- `harness sync` detects managed state, repairs drift/missing/stale with the same
  safe engine as `update`, and prints a status summary.
- `harness sync --dry-run` reports planned repairs without writing.
- No global state → recommends `harness setup` and writes nothing.
- Already OK → writes nothing.
- `update` remains as a technical/compatibility alias; `sync` is the day-to-day UX.

### Recommended flow

```bash
harness setup
harness status
harness sync
```

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
