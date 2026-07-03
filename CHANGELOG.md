# Changelog

All notable changes to `@kal-elsam/harness` are documented here.

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
