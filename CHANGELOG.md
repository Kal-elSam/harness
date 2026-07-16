# Changelog

All notable changes to `@kal-elsam/kairo-runtime` are documented here.
Historical entries below may reference the legacy `@kal-elsam/harness` package name.

## Unreleased

### Added

- OpenCode Go / Zen as first-class Intelligence backends via `OPENCODE_API_KEY`
  (`opencode-go`, `opencode-zen`) with an explicit transport registry
  (`chat_completions`, `responses`, `runtime`).
- OpenCode CLI runtime backend (`opencode`) for Anthropic/Google models without
  direct HTTP transport, using `opencode run --format json` plus an analysis-only
  preamble (intent signal, not a universal non-mutation guarantee).
- Safe OpenCode evidence: CLI install + `opencode auth list` providers + `/models`
  probe. States distinguish `configured`, `authenticated`,
  `entitlement_unverified`, and `limit_reached` without reading `auth.json` or
  claiming subscription/balance from a key alone.
- Ephemeral `--backend` / `--model` overrides for `intelligence models|route|ask`
  (does not persist `preferredBackend` / `preferredModel`).
- Doctor advisory check for intelligence providers (optional; never fails health).

### Changed

- Default cloud routing precedence: Ollama → OpenCode Go → OpenCode Zen →
  OpenRouter. Go limit failures never auto-spend Zen credits.
- Health guidance treats API-key presence as configured credentials, not proven
  authentication, and recommends Ollama, OpenCode CLI, `OPENCODE_API_KEY`, and
  `OPENROUTER_API_KEY`.

## 0.4.3 — 2026-07-13

Patch release. Fix System health crash on real profile.sources.

### Fixes

- Format `profile.sources` from the real `{ global, project }` contract as
  `global`, `project`, or `none` instead of calling `.join()` on the object.

### Compatibility

- Runtime, commands, and persisted formats unchanged.

## 0.4.2 — 2026-07-13

Patch release. Prefer launchable agents over missing global-state markers in Home CTA.

### Fixes

- Home readiness/NEXT prefer New run whenever any agent is launchable, even if
  `~/.harness/state.json` is absent or `diagnostics.detected` is still 0.

### Compatibility

- Runtime, commands, and persisted formats unchanged.

## 0.4.1 — 2026-07-13

Patch release. Prefer launchable agents over empty diagnostics.detected in Home readiness/CTA.

### Fixes

- Home readiness and NEXT treat launchable agents as ready-to-work even when `diagnostics.detected` is still 0.

### Compatibility

- Runtime, commands, and persisted formats unchanged.

## 0.4.0 — 2026-07-13

Minor release. Informative Home and clearer cockpit navigation.

### Features

- Replace Overview/Mission Control with Home that explains Kairo, derives readiness
  (`Needs setup` / `Needs attention` / `Limited` / `Ready to work`), and recommends a
  real next action with an Enter destination.
- Prefer **New run** when any agent is launchable; missing intelligence is an optional
  limitation, not a blocker.
- Rename navigation: Home, Running now, History, Agents, New run, System health — with
  contextual descriptions, status summaries, and selected ≠ currently open section.
- System health separates agents, intelligence, authentication, and configuration.
- Readable recent/active run lines; empty states explain absence and suggest next steps.
- Wide/compact/minimal preserve critical Home information; list windowing covers agents
  and diagnostics; load errors offer `R Retry` while Esc remains available.

### Compatibility

- Internal view ids, explicit commands, runtime, profiles, and run formats are unchanged.
- UI copy remains English. `NO_COLOR`, `HARNESS_ASCII=1`, and `HARNESS_INK=0` stay supported.

### Docs

- Quick Start describes Home, renamed navigation, and layout parity.

## 0.3.1 — 2026-07-13

Patch release. Predictable cockpit navigation focus and contextual footer hints.

### Fixes

- Informational views (Overview, Diagnostics, Providers, Help) keep navigation focus
  so ↑↓/Enter switch sections without requiring Tab.
- Esc returns deterministically: nested run detail → list → Overview → exit.
- Tab only switches regions when content is interactive (runs lists, launch).
- Footer lists only keys that work in the current context.

### Compatibility

- Runtime, persisted formats, and explicit commands are unchanged.

## 0.3.0 — 2026-07-13

Minor release. Full-screen responsive cockpit TUI for interactive shell and setup.

### Features

- Idempotent alternate-screen session across onboarding → setup → cockpit, with
  restore on normal exit, Ctrl+C, SIGTERM, SIGHUP, and errors.
- Deep-space cockpit shell: navigation, mission control, and system strip with
  textual status labels (never color-only).
- Responsive layouts: wide (≥100×28), compact (≥72×20), minimal (60–71 or short),
  live resize, truncated lists with `… more`; `<60` columns keep the explicit TTY gate.
- Region navigation: arrows within a region, Tab between regions, Enter to open,
  Esc to return (exit only from Home), `R` refresh, `C` cancel, `?` help.
- Setup Ink UI shares the cockpit theme/panel language without changing setup logic.

### Compatibility

- Bare `kairo` routing, `kairo shell`, setup flags, explicit commands, JSON, and
  non-TTY flows are unchanged. `state.json`, profiles, and run formats are unchanged.
- `NO_COLOR`, limited Unicode (`HARNESS_ASCII=1`), and `HARNESS_INK=0` remain supported.
- Direct dependency: `ansi-escapes`.

### Docs

- Quick Start and help describe the cockpit, breakpoints, and keybindings.

## 0.2.3 — 2026-07-13

Patch release. First-run onboarding and guided returning dashboard.

### Features

- Bare interactive `kairo` routes by `~/.harness/state.json`: missing → onboarding
  (welcome → diagnosis → confirmed setup) then dashboard; present → operations dashboard.
- Dashboard shows a stable purpose line and a contextual next step (configure,
  enable intelligence, launch a run, or review problems).
- Explicit commands, setup flags, and non-TTY flows keep prior behavior.

### Docs

- Quick Start and `--help` describe first-run vs returning routing.

## 0.2.2 — 2026-07-10

Minor release. Kairo Runtime MVP: launch, supervise, and audit agent CLI runs with
privacy-first persistence and cross-process supervision.

### Features

- CLI: `kairo run`, `kairo runs list|show|stop` with `--no-wait`, `--model`, and opt-in transcript capture.
- Execution adapters for Cursor, Codex, and Claude Code; OpenCode inspect-only in v1.
- Persisted audit trail under `~/.harness/runs/<runId>/` (`state.json`, `events.jsonl`).
- Detached supervisor via `spawn` (no fork IPC); `starting` grace for cross-process recover.
- TUI operations dashboard with multi-step launch wizard (agent, task, model, permissions).
- Smoke script: `scripts/runtime-mvp-smoke.sh` with `SMOKE_MODEL` override.

### Security

- Task content is not stored in audit artifacts; only `taskDigest` + `taskLength`.
- Ephemeral `handoff.json` is consumed or cleaned on cancel, fail, or recover.

## 0.2.1 — 2026-07-10

Patch release. Fixes the orchestrator Diagnostics menu entry so it opens a
dedicated read-only view instead of silently staying on Home.

### Fixes

- Orchestrator **Diagnostics** maps to a `DIAGNOSTICS` view with summary, intelligence
  availability, agent capabilities, and recommendations.
- Home keeps the compact snapshot; `Esc` still returns to the menu from subviews.
- Menu navigation uses shared pure helpers covered by `test/orchestrator-state.test.js`.

## 0.2.0 — 2026-07-09

Minor release. Harness Engineering intelligence layer: governed project context,
local-first backends, cloud opt-in, token budgets, and provider-neutral routing.

### Features

- Pluggable intelligence backends: Ollama (local) and OpenRouter (`openrouter/free` candidate).
- Custom OpenAI-compatible HTTP providers via profile `customProviders` (`baseUrl` + `apiKeyEnv` only).
- Context compiler builds evidence-based `ContextPack` (stable + per-request) without dumping the repo.
- Routing prefers user overrides, then Ollama, then OpenRouter free after explicit cloud consent.
- Privacy gates: private paths excluded by default; cloud invoke requires consent + confirmation.
- Token budgets and usage telemetry (input/output/cached/model/fallback).
- CLI: `kairo intelligence status|models|context|route|ask`.
- Orchestrator shell menu includes Intelligence diagnostics.
- Profile fields: `preferredBackend`, `preferredModel`, `cloudConsent`, token budgets, `customProviders`.

### Security

- Credentials are read only from environment variables (`OPENROUTER_API_KEY`, `OLLAMA_HOST`, named `apiKeyEnv`).
- Profiles and disk state never store API keys, tokens, or secrets.
- Without a backend or consent, Kairo remains in diagnostics/configuration mode.
- Remote custom providers cannot use `apiKeyEnv` in 0.2.0, preventing a project profile from redirecting a bearer credential to an arbitrary host.

### Notes

- `openrouter/free` is a dynamic router candidate, not a permanently hardcoded model lock.
- Kairo owns reasoning governance; providers only supply inference.
- Agent CLI capability registry from 0.1.5 remains unchanged for setup/install/status/doctor.
- Deferred to 0.2.1 (MEDIUM): broader secret-key coverage (`accessKey`, `awsAccessKeyId`,
  `passwd`); tighten link-local / metadata host classification in `customProviders` baseUrl
  validation (`169.254.0.0/16`).

## 0.1.5 — 2026-07-09

Minor release. Interactive orchestrator foundation: shell, diagnostics, capability
registry, and profile resolution without changing the safe-by-default confirmation model.

### Features

- Bare `kairo` opens an interactive orchestrator shell on capable TTY sessions.
- `kairo orchestrator [--json]` exposes read-only capability diagnostics.
- Capability registry probes installed agent CLIs and reports availability states.
- Global and project profile resolution for coordinator routing preferences.
- Action planner with human confirmation for sensitive setup operations.

### Fixes

- `resolveSuggestedInvocation()` accepts injectable `env` for package-manager detection;
  tests no longer mutate global `process.env`.

### Notes

- Does not yet expose model-ID discovery or full Harness Engineering governance (0.2.0).
- Kairo never stores tokens or credentials.

## 0.1.4 — 2026-07-09

Patch release. Fixes public installer smoke for Kairo Runtime versions.

### Fixes

- `install-script-url` resolves `0.1.x` versions to `kairo-runtime-v*` tags instead of legacy `v*`.
- Legacy `@kal-elsam/harness` tags (`0.29.x` and above) still use `v*` refs.
- `install.sh` runs `npm install -g --force` so bootstrap upgrades replace legacy global bins safely.

## 0.1.3 — 2026-07-09

Patch release. Adds opt-in Engram and Graphify components for persistent memory and
context-graph workflows.

### Features

- Bundled opt-in components: `engram-memory` and `graphify-context` (not enabled by default).
- Install with `kairo setup --components orchestrator,sdd-core,engram-memory,graphify-context`.
- Managed sections and contract assets under `~/.harness/components/`.
- Non-invasive doctor/status checks for Engram MCP availability and Graphify CLI/graph freshness.
- Authority order documented: user > AGENTS.md > repo docs > Engram > Graphify.

### Notes

- Does not auto-install Engram, Graphify, MCP servers, or git hooks.
- Kairo remains the coordinator; the repository stays the source of truth.

## 0.1.2 — 2026-07-08

Patch release. Bootstrap installer now installs the global `kairo` CLI.

### Fixes

- `install.sh` runs `npm install -g @kal-elsam/kairo-runtime` before setup so
  `kairo status` works immediately after install.
- Post-install next steps and README use `kairo` as the primary command.
- Installer smoke tests verify `kairo` from npm global bin instead of `npx`.

## 0.1.0 — 2026-07-07

First public release of **Kairo Runtime** under `@kal-elsam/kairo-runtime`.

### Rebrand

- Product identity: Kairo Runtime — Local Agent Operating System.
- Preferred CLI: `kairo` and `kairo-runtime`.
- Legacy CLI aliases retained: `harness`, `agentic-harness`, `sgs-harness`, `harness-sgs`.
- Legacy state paths unchanged: `~/.harness`, `HARNESS_HOME`, `harness:managed:*`.
- Command headers and setup copy use Kairo Runtime branding.
- Bridge package `@kal-elsam/harness` remains out of scope for this release.

## 0.29.1 — 2026-07-07

Patch release. Fixes Ink setup preview hang and release provenance checks.

### Fixes

- Ink `Plan preview` no longer stalls indefinitely on "Building preview…" when the
  preview effect re-runs after setting `previewLoading`.
- `release:published` accepts `origin/main` ahead of the published tag/commit as long
  as main contains the release `gitHead`.

## 0.29.0 — 2026-07-07

Minor release. Ink setup opens with a branded splash screen before agent detection.

### Splash screen

- New `SPLASH` step precedes agent detection in the Ink setup flow.
- Full ASCII `HARNESS` logo with tagline `Agent Engineering Platform`, subtitle
  `Local Agent Operating System`, and `Press Enter to continue` hint.
- Narrow terminals automatically use a compact logo variant.
- `Enter` advances to detection; `Esc` cancels as before.
- `--simple`, non-TTY/CI, and `--yes`/`--confirm` paths are unchanged (no splash).

## 0.28.0 — 2026-07-07

Minor release. Interactive setup uses Ink for a full terminal UI.

### Ink setup experience

- Bare `harness` / `harness setup` in a TTY opens an Ink app: header, agent cards,
  visual selectors, plan preview, confirmation, and branded success output.
- `harness setup --simple` keeps the Clack prompt flow; dumb terminals fall back
  to Clack automatically.
- Brand tokens from `src/global/brand/` are reused; no duplicated style system.
- `--json`, non-TTY/CI, `--yes`, `--confirm`, `--dry-run`, and explicit flags
  keep the existing textual engines unchanged.

### Dependencies

- Added `ink` and `react` for the interactive setup renderer.

## 0.27.0 — 2026-07-07

Minor release. Premium terminal identity for the interactive setup wizard.

### Brand layer

- New `src/global/brand/` tokens: name, tagline, agent labels (Cursor, Codex,
  OpenCode, Claude Code), and semantic colors (success, warning, danger, muted,
  accent).
- New `src/global/clack/theme.js` formats splash, agent detection card, plan
  preview, and result summary for the Clack wizard.

### Setup wizard UX

- Intro: `HARNESS — Local Agent Operating System` with compact welcome splash.
- Agent detection card with human hints (`ready`, `not detected`, `managed later`).
- Plan preview grouped into Agents, Components, Managed writes, and Preserved
  content — less technical noise on the happy path.
- Non-TTY, `--json`, `--yes`, and explicit flags keep the existing textual CLI.

## 0.26.0 — 2026-07-07

Minor release. Interactive setup now uses `@clack/prompts` instead of the homemade TUI.

### Setup wizard (Clack)

- `harness` / `harness setup` in a TTY opens a polished Clack wizard: intro branding,
  agent detection, multiselect for agents/components, managed-change preview, and
  explicit confirmation.
- `--json`, non-TTY/CI, `--yes`, `--confirm`, `--dry-run`, and explicit
  `--agents` / `--components` flags keep the existing non-interactive flow.
- Removed the custom TUI in `src/global/tui/*` (key-reader, ANSI paint, multi-select).
- **Node.js** minimum is now `>=20.12.0` (`@clack/prompts` requirement).

## 0.25.0 — 2026-07-07

Minor release. Bare `harness` is now the recommended interactive entrypoint.

### Default entrypoint

- `harness` with no subcommand routes to `harness setup` (interactive TUI in a TTY).
- `harness --dry-run` previews the setup plan without writing agent configs or
  `~/.harness` state.
- `harness install` remains the explicit technical path for CI, scripts, and
  non-interactive configure.
- `harness --scope=workspace` still routes to workspace `init` (legacy opt-in).

## 0.24.0 — 2026-07-07

Minor release. Interactive TUI for `harness setup`.

### Setup TUI

- `harness setup` opens a step-by-step terminal UI in interactive terminals.
- Non-TTY, flags (`--yes`, `--confirm`, `--agents`, `--components`), and dumb
  terminals keep the existing textual CLI flow.
- TUI reuses detect/plan/apply logic; preview shows managed markers, paths, and
  planned changes before writes.

## 0.23.1 — 2026-07-06

Patch release. Terminal UX polish with no write-behavior changes.

### Terminal UX

- Dry-run output now says `Backups planned` instead of `Backups` in setup/install
  plans and sync repair previews.
- `harness help` lists all current `--json` supported commands and points long
  examples to README.md (less noise in the main help screen).
- New `npm run ux:smoke` script captures and validates key terminal flows:
  help, setup dry-run, status (missing/ok/drift), sync dry-run, history, report,
  and common error messages.

## 0.23.0 — 2026-07-06

Minor release. Read-only diagnostics report for local support bundles.

### Diagnostics report

- New `harness report` command combines CLI version, adapters, effective policy,
  status summary, diff/drift preview, and recent history in one read-only bundle.
- `harness report --json` emits a stable envelope for CI and tooling.
- `harness report --out <file>` writes only to the explicit user path (never
  `~/.harness` by default); human text or JSON depending on flags.
- `harness report --limit <n>` controls how many history events are included
  (default 20).
- Corrupt `history.jsonl` lines surface as warnings without failing the report.
- No telemetry, no config writes, no full config contents — paths, states, and
  managed section summaries only.

## 0.22.0 — 2026-07-06

Minor release. History querying and last-operation UX for the audit log.

### History querying

- `harness history` adds read-only filters: `--command`, `--action`, and `--limit`.
- New `harness history last` shows the most recent matching event (`--json` supported).
- Filters combine before `--limit` (most recent N of the filtered set).
- `history last` with no entries exits 0 and reports a clear empty state.
- All history queries are read-only; `history.jsonl` stays append-only.

## 0.21.0 — 2026-07-06

Minor release. Local operation history / audit log for managed commands.

### Operation history / audit log

- New append-only audit file: `~/.harness/history.jsonl` (one JSON object per line).
- New `harness history` command with `--json` and `--limit <n>`.
- Records managed operations: `setup`, `sync`, `upgrade`, `rollback --apply`,
  `uninstall`, `policy set`, and `policy reset`.
- Each event captures timestamp, command, action, wrote, dryRun, policy,
  consentSource, agents, components, checksBefore/checksAfter when applicable,
  backupsCreated, snapshotsUsed (rollback), and cliVersion.
- `--dry-run` and upgrade preview do not write `~/.harness` or history entries;
  persistent audit starts on real apply, interactive cancellation, rollback apply,
  uninstall, or policy changes.
- Cancelled interactive operations log `action: cancelled`.
- Consent failures before writes do not create history entries.
- Corrupt lines in `history.jsonl` are skipped with warnings; valid events still display.

## 0.20.0 — 2026-07-06

Minor release. Policy visibility and consent audit in control-plane output.

### Policy visibility and consent audit

- `harness status` prints a `Policy` section and `status --json` adds a stable
  `policy` field (`source`, `profile`, `applyMode`, `preflight`, agents,
  components, path).
- `harness explain` includes effective policy and `~/.harness/policy.json` path.
- `setup`, `sync`, and `upgrade` preflight output shows `Consent source` and
  `Policy profile` without changing 0.19.0 write behavior.
- `harness policy --json` keeps backward compatibility and adds `effective`.
- Without a policy file, output clearly reports defaults / no policy file.

## 0.19.0 — 2026-07-06

Minor release. Local policy profiles for setup, sync, and upgrade.

### Local policy profiles

- New `harness policy` command to view and edit operation preferences stored in
  `~/.harness/policy.json` (`policy --json`, `policy set <key> <value>`,
  `policy reset`).
- Supported profiles: `safe` (interactive prompt), `ci` and `fast` (apply via
  policy consent with preflight, no prompt).
- Safe defaults when a policy file exists: `applyMode: prompt`, `preflight: true`,
  `agents: detected`, `components: [orchestrator, sdd-core]`.
- Precedence: CLI flags override policy; policy overrides internal defaults.
- Without a policy file, 0.18.0 behavior is unchanged.
- `policy reset` removes only `policy.json`; state, adapters, and components are
  preserved.

## 0.18.0 — 2026-07-06

Minor release. Explicit apply confirmation in interactive terminals.

### Apply confirmation policy

- Interactive terminals now show managed preflight and prompt before applying
  `setup --yes`, `sync`, and `upgrade --yes`.
- Non-interactive mode requires `--yes`, `--confirm`, or `--no-preflight` before writes.
- `setup --confirm` applies with preflight and no prompt using defaults or explicit flags.
- Non-interactive `harness setup` without consent flags is rejected before writing state.
- New `--confirm` applies after preflight without an interactive prompt.
- `--json` and `--dry-run` behavior unchanged.

## 0.17.0 — 2026-07-06

Minor release. Managed preflight summary before apply commands.

### Preflight diff before apply

- `harness setup --yes`, `harness sync`, and `harness upgrade --yes` now print a
  managed preflight summary (planned creates/updates/repairs, managed markers, and
  user-owned preserved content) immediately before writing configs or state.
- New `--no-preflight` skips the extra output for CI and trusted scripts.
- `harness diff`, `--dry-run`, and `--json` behavior unchanged.

## 0.16.0 — 2026-07-06

Minor release. Read-only managed diff preview before apply commands.

### Managed diff preview

- New `harness diff` and `harness diff --json` preview missing/stale assets and
  managed sections that `harness sync` would repair.
- Without state, recommends `harness setup --dry-run`.
- Healthy ecosystems report no managed changes; user-owned content outside markers
  is reported as preserved.
- Read-only: never writes configs or `~/.harness` state.

## 0.15.0 — 2026-07-06

Minor release. Read-only audit command for managed ecosystem changes.

### Explain / audit managed changes

- New `harness explain` and `harness explain --json` show managed adapters, config
  files, installed components, backups, managed markers, and user-owned preserved
  content outside Harness markers.
- Read-only: never writes agent configs or `~/.harness` state.

## 0.14.2 — 2026-07-06

Patch release. Ships the installer smoke fix from `e62b25a` in the npm tarball.

### Fix

- `scripts/installer-smoke-test.sh` runs from an isolated temp workspace so `npx` does
  not resolve the monorepo package when validating post-publish from the harness repo.

## 0.14.1 — 2026-07-06

Patch release. Post-publish smoke for the one-liner installer path.

### Installer smoke

- New `scripts/installer-smoke-test.sh` validates the real user flow:
  `curl .../install.sh | sh` with isolated `HARNESS_HOME` and a temporary npm cache.
- Preview (`--version <x>`) must not write `~/.harness`.
- Apply (`--yes --agents all`) must reach `status --json` with `overall=ok` and clean
  uninstall of managed sections.
- Run manually after publish: `npm run smoke:installer -- --version x.y.z`.

## 0.14.0 — 2026-07-06

Minor release. Installer post-apply guidance and a safe `harness upgrade` command.

### Installer status + upgrade UX

- After `install.sh --yes`, next steps now highlight `harness status`, `harness sync`,
  and `npx @kal-elsam/harness@latest setup --yes`.
- New `harness upgrade --dry-run` previews convergence with the installed CLI and shows
  the latest npm command without writing configs.
- `harness upgrade --yes` applies only with an explicit flag (no silent auto-update).

## 0.13.0 — 2026-07-06

Minor release. Bootstrap installer can apply setup explicitly while keeping the
safe default preview.

### Bootstrap apply mode

- `scripts/install.sh` default unchanged: ends with `harness setup --dry-run`.
- Explicit apply: `curl ... | sh -s -- --yes` runs `harness setup --yes`.
- Passthrough to setup: `--version`, `--agents`, `--components`,
  `--no-default-components`.
- Security unchanged: no `sudo`, no shell profiles, no AI app installation — only
  managed sections.

### Recommended entry

```bash
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --yes
```

## 0.12.1 — 2026-07-04

Patch release. Fixes registry smoke validation for the adapter matrix.

### Fix

- `scripts/registry-smoke-test.sh` sorts expected adapter ids before comparing
  managed agents, so post-publish smoke passes reliably.

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
