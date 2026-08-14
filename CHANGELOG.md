# Changelog

All notable changes to `@kal-elsam/kairo-runtime` are documented here.
Historical entries below may reference the legacy `@kal-elsam/harness` package name.

## Unreleased

### Changed

- MCP snapshot writes require an explicit workspace binding
  (`kairo mcp --workspace-bound --cwd .`). The global `kairo` MCP stays
  read-only until a later consented removal. See [MCP](docs/mcp.md).

## 0.16.0 — 2026-08-13 (Kairo Runtime)

Minor release. Public `kairo control-plane` command and
`kairo.control-plane/v1` Gentle companion report. Publish tag:
`kairo-runtime-v0.16.0`. Extension VSIX stays out of this unit.

### Added

- `kairo control-plane [--json] [--client cursor]`: atomic panel report
  (work + Gentle workflow + team + attention) as `kairo.control-plane/v1`.
- Negotiate `gentle-ai.review-integration/v2` (protocol 2.0 and 2.1) before
  any workflow fetch. Provider states: `connected`, `upgrade_required`,
  `unavailable`, `incompatible`.
- Official `review status` from Gentle's announced bootstrap argv; pass
  `next_transition` through unaltered. Receipt/gate only when Gentle publishes
  them.
- `sdd-status --json` projection copies `changeName` / `nextRecommended` only.

### Docs

- Gentle companion boundary: Kairo observes `gentle-ai.review-integration/v2`
  and projects official `next_transition` / `sdd-status --json`. Freeze
  `kairo review`, Cockpit receipts, orchestrator, and intelligence routing so
  they do not feed the panel Workflow. Propose upstream `gentle-ai observe --json`
  in Kairo docs only (`docs/gentle-companion.md`).

## 0.15.0 — 2026-08-12 (Kairo Runtime)

Minor release. Declared Fleet board + model configure, and the Cursor
observable companion (work snapshots, MCP publish, `kairo next`, managed
rule, honest panel). Publish tag: `kairo-runtime-v0.15.0`. Extension
marketplace delivery stays out of this unit.

### Added

- Contract `kairo.work-snapshot/v1` and MCP tool `kairo_publish_work_snapshot`
  to enroll the current Cursor conversation with Goal / Progress / Now /
  Constraints / Next.
- `kairo next` / `kairo.next/v1`: selected work snapshot plus integration
  state (`active` / `enrolled` / `showRepair`) for the IDE panel.
- `kairo mcp install [--yes]`: consent-gated registration of Kairo MCP in
  `~/.cursor/mcp.json` (plan first; atomic write + backup) and managed
  Cursor rule `~/.cursor/rules/kairo-work-snapshot.mdc` (`alwaysApply`).
- Panel **0.7.0**: honest companion surface — Repair only when integration
  is broken; otherwise active/enrolled without false prompts.
- MCP workspace binding: prefer Cursor env (`VSCODE_CWD` /
  `WORKSPACE_FOLDER_PATHS`) over process cwd; canonicalize macOS `/tmp` vs
  `/private/tmp` before hashing `projectKey`.
- Panel **0.6.5**: One **Configure all** for multi-agent (Claude + OpenCode +
  Cursor agents). **Codex aparte** (`--codex-model`). `kairo fleet models`
  shows available vs enabled per tool. Cursor desk: open agents/skills/rules.
  Profile at `~/.harness/fleet-models.json` (seeded from disk; preserves
  tuned OpenCode). `--from gentle` remaps OpenCode tiers when you want that.
- Panel **0.6.4**: Fleet Details puts configure buttons first (Edit per
  minion on Claude/OpenCode; Cursor offers Claude/OpenCode configure +
  optional Pixel Agents). `fleet configure` defaults to Claude only (no
  surprise OpenCode overwrite).
- `kairo fleet configure`: Gentle-style model assignments across OpenCode +
  Claude (+ Codex when `codex_default` set). Plan / `--yes` + backups. Panel
  **Models** button. Cursor Auto remains IDE-managed.
- Panel **0.6.2**: Fleet floor (compact platform desks). Working floor only
  shows live agents — no idle OpenCode wall. CLI `kairo fleet` compact by
  default (`--verbose` for full minion list).
- Panel **0.6.3**: Configure models toolbar + desk actions for sync/set.
- `kairo fleet [--json]`: declared orchestrator→minion fleet topology from
  OpenCode config (Gentle + SDD models); Cursor Auto marked opaque.
  MCP tool `kairo_fleet`; `kairo connections --json` includes `fleets`.
- Panel **0.5.0**: Fleet tree under connections (platform · orchestrator ·
  model, indented minions). Details note: declared config, not live tokens.
- `kairo connections [--json]`: Gentle / Hermes / Engram / Graphify / Agent
  connection chips for the IDE panel (companion probes + MCP registration).
- VS Code / Cursor panel **0.3.0**: connection chips, Connect Agent button,
  Entries + Details webview. Docs: `docs/mcp.md`.
- Panel **0.3.1**: soften "not installed / unconfigured" entries to `note`;
  fix false Engram conflict when Claude uses `~/.claude/mcp/engram.json`
  without `mcpServers.engram` in settings.json.
- Panel **0.3.2**: **Setup** button + per-connection actions (Configure /
  How to install / Update graph). Optional tools labeled; Kairo never
  auto-installs Gentle/Hermes/Graphify.
- Panel **0.3.3**: every Entry shows resolve buttons in Details (Fix SDD,
  Repair, Update graph, Why optional?). Hermes chip offers **Start Hermes
  gateway**. Conflicts sort first so buttons are visible immediately.
- Panel **0.3.4**: Hermes tip documents `API_SERVER_ENABLED=true` — gateway
  alone without API Server does not expose :8642.
- Check **resolutions[]** contract + panel **0.4.0**: status checks can declare
  clickable fix buttons. For `sdd-core:skills` conflicts:
  - `kairo components diff sdd-core` (read-only)
  - `kairo components adopt sdd-core` (keep disk; record adopted hashes)
  - `kairo components configure sdd-core --overwrite-conflicts` (backup + replace)
  Destructive overwrite asks for a modal confirm in the IDE panel.
- Panel **0.4.1**: adopt/overwrite buttons apply with `--yes` (click = consent).
  Previous `--dry-run` left CONFLICT unchanged after clicking Conservar el mío.
- Panel **0.4.2**: status/connections/terminal use the open workspace folder as
  `cwd`, so graphify-out/ is detected (was falsely "not found" from IDE cwd).

### Fixed

- Cockpit Home opened with focus on the tab bar, so the two Home buttons never
  showed a selection mark and the arrow keys moved between tabs instead. Home
  now starts on the buttons.

### Changed

- Home buttons render as `› [1] Label` with `← Press Enter` on the focused
  option; press `1` / `2` to run a button without arrow navigation.
- Home footer names each key (`1·2 Select · Enter Run · ? Help · Esc Exit`)
  instead of listing bare keys.
- Home shows at most two plain-language needs; the rest collapse into the
  `More info (n)` disclosure, which absorbs the duplicated "n more" line.

## 0.14.0 — 2026-08-07 (Kairo Runtime)

Minor release. Simpler Cockpit, one-command CLI self-update, pnpm for
contributors, and a minimal IDE status panel. Publish tag:
`kairo-runtime-v0.14.0`.

### Added

- Cockpit Home with three tabs (Home · Settings · History) and two clear
  actions (prepare/repair + Configure). Secondary destinations stay in `/`.
- `kairo update`: update the Kairo CLI from npm (`--yes` applies). Workspace
  template refresh stays at `kairo update --scope=workspace`.
- VS Code / Cursor extension scaffold in `packages/kairo-vscode`: status bar +
  explorer tree from `kairo status --json`; sync/doctor/cockpit open a terminal
  (no silent writes). Local VSIX via `npm run package`.

### Changed

- Local development and CI use **pnpm 10.x** (`packageManager` pinned). End-user
  installs and `npm publish` (OIDC Trusted Publishing) stay on npm.
- Install scripts blocked by default (`pnpm.onlyBuiltDependencies: []`);
  `.npmrc` sets `strict-dep-builds` and `minimum-release-age=1440`.

## 0.13.1 — 2026-08-07 (Kairo Runtime)

Patch release. Docs/UX/license polish for npm adoption. Publish tag:
`kairo-runtime-v0.13.1`.

### Changed

- Cockpit Overview: plain-language purpose + one next step; companion system
  dumps moved off the first screen (Details only).
- License: `UNLICENSED` → **MIT** (root `LICENSE`; also `@kal-elsam/harness` bridge).
- npm README trimmed to a short product page; long reference moved under `docs/`.
- `kairo help` shows four day-to-day commands; `kairo help --all` lists the rest.

## 0.13.0 — 2026-08-07 (Kairo Runtime)

Minor release. Obsidian Knowledge Hub: human knowledge surface under `Kairo/`
with consent-gated publish and Cockpit status (no auto-sync). Publish tag:
`kairo-runtime-v0.13.0`.

### Added

- Obsidian vault adapter: absolute vault path only; access limited to `Kairo/`;
  refuses escaping symlinks, `.obsidian`, attachments, and secret basenames.
- Knowledge preview from injectable Engram/Graphify *export* adapters (never
  internal DBs); Markdown proposals with frontmatter + wikilinks.
- Consent-gated publisher: atomic write, backups under `.kairo-backups/`,
  refuse overwrite of manual notes; dry-run / missing consent never writes.
- Knowledge views: projects / decisions / architecture / sessions / reviews
  index helpers + index-note proposals (publish via consent only).
- Cockpit companion `signals.obsidian.vault` + display lines (wide/compact/
  minimal). Unconfigured without absolute `obsidianVaultPath`; no write CTAs.

### Compatibility

- Obsidian is a human UI — not a fourth authority beside Engram/Graphify/Kairo.
- No automatic vault sync; no silent writes.
- Companion overlays remain secondary to governance health/CTA.

## 0.12.0 — 2026-08-07 (Kairo Runtime)

Minor release. Observe-and-recommend companion surfaces: Hermes activity,
local system resources + advisor, pinned agent-skills bundle, and read-only
ecosystem update checks. Publish tag: `kairo-runtime-v0.12.0`.

### Added

- HermesProvider companion: loopback probe, session activity signal, Cockpit
  overlay lines (wide/compact/minimal). Observe-only — no start/stop control.
- Local Resource Advisor: macOS system resource sampling (memory/swap/disk/
  processes), deterministic recommendations, Cockpit display. No mutators.
- Pinned complementary agent-skills component under
  `global-template/components/agent-skills/` (rev `d2478bf0…`).
- Ecosystem Update Advisor (check surface): `loadEcosystemUpdates`,
  `kairo updates check`, companion `signals.ecosystem.updates`, Cockpit
  Updates lines. Read-only — consent-gated apply deferred.

### Compatibility

- Auto-detect only; apply/publish still requires explicit consent.
- Companion overlays remain secondary to governance health/CTA.
- No permanent daemon; no silent writes from these surfaces.

## 0.11.0 — 2026-07-31 (Kairo Runtime)

Minor release. Cockpit visual identity: amber/ice brand palette, borderless
shell composition, responsive ASCII wordmark on Overview, and operational
panel titles with ice focus. Publish tag: `kairo-runtime-v0.11.0`.

### Changed

- Brand theme: amber for brand chrome, ice for interactive focus — replaces
  cyan/magenta nested frames.
- Borderless Cockpit shell: compact header, segmented nav, single-line footer
  without nested panel borders.
- Overview product cover: static Kairo ASCII wordmark beside status on
  wide/compact layouts; textual brand line on minimal.
- Shared `ViewTitle` / section labels on Governance, Activity, Orchestration,
  Usage, Settings, and Alerts with ice focus affordances.
- Loading/error splash colors respect `NO_COLOR` via terminal capabilities.

### Compatibility

- No models, keys, CLI, or public API contract changes.
- Keyboard-first, local, single-user; Ink + React retained.
- `NO_COLOR`, ASCII glyph fallbacks, and existing shell chrome contracts preserved.
- README unchanged for this slice.

## 0.10.0 — 2026-07-31 (Kairo Runtime)

Minor release. Terminal-first Ink UX Control Plane: semantic primitives across
the six primary Cockpit surfaces, Setup, Alerts, and NO_COLOR-safe shell chrome.
Publish tag: `kairo-runtime-v0.10.0`.

### Added

- Semantic Ink primitives (ActionList, Callout, Confirm, Details, Receipt, KeyBar,
  Stepper) with clear ownership: Callout=status · section owns data · footer/KeyBar=keys.
- Six primary surfaces on the shared model: Overview, Governance, Activity,
  Orchestration, Usage, Settings.
- Semantic SetupApp (Detect → Agents → Components → Preview → Confirm) with real
  handoff from Overview setup CTA.
- Semantic Alerts inbox with windowed focus (compact 3 / wide 8); Enter resolve /
  D dismiss unchanged.
- Semantic Settings browse → preview → confirm → receipt (`wroteFiles: false`);
  confirm records intent only — does not install packages.
- Semantic Usage / Tokens: measured budget pairs, profile limits, finite run
  tokenUsage fields only; never invents totals, costs, or savings.

### Changed

- Cockpit shell chrome respects `NO_COLOR` and ASCII glyph fallbacks.
- Progressive disclosure: paths/IDs stay in Details; lists keep domain navigation
  beyond visual caps with honest remainders (`… N more`).

### Compatibility

- Keyboard-first, local, single-user; Ink + React retained.
- Bare `kairo` and explicit CLI commands unchanged.
- Web loopback / `kairo ui` deferred out of this milestone.
- IDEs / Modules / Diagnostics lists and Launch/detail remain legacy string panels
  for a follow-up 0.10.x or next milestone.

## 0.9.0 — 2026-07-30 (Kairo Runtime)

Minor release. Local AI Control Plane: task-oriented Cockpit, alerts inbox,
opt-in monitor, curated Settings. Publish tag: `kairo-runtime-v0.9.0`.

### Added

- Responsive single-panel Cockpit (TopBar + nav strip + main panel + full-width
  footer); wide / compact / minimal; SYSTEM side column retired.
- Six destinations: Overview, Governance, Activity, Orchestration, Usage, Settings.
- Action palette (`/`) for destinations and refresh.
- Alert contracts + store + Cockpit inbox (resolve / dismiss).
- `kairo monitor enable|disable|status|tick` with macOS LaunchAgent autostart;
  drift / orphan / failed runs → alerts; notify only on new claims.
- Settings curated catalog (`pi-usage-widget@0.2.1`, MIT): browse → preview →
  confirm shows an in-session confirmation receipt; does not persist or install
  anything.

### Compatibility

- Keyboard-first, local, single-user; Ink + React retained.
- Monitor autostart is opt-in; unsupported OS degrade without false “installed”.
- Settings confirm shows an in-session receipt only; neither persists nor installs.
- Orchestration / Usage stay summaries; Cockpit does not drive Pi orchestration.

## 0.8.0 — 2026-07-28 (Kairo Runtime)

Minor release. Context Orchestration for Pi: durable DAG, isolated minions,
budgets, cancel cascade, recovery receipts. Publish tag: `kairo-runtime-v0.8.0`.

### Added

- `kairo run --agent pi --strategy orchestrated` with managed minion extension.
- Ephemeral Pi minions (read-only tools, path allowlist, no nested depth > 1).
- Context budgets at 70% compact / 90% stop; task retries (max 2); cascade cancel.
- Durable orchestration state under `~/.harness/runs/<root>/orchestration/state.json`
  and write-once `receipt.json` (secret-free; `recovered` on interrupt).
- Supervisor-injected `KAIRO_ORCH_*` identity; root lineage from persisted state.

### Compatibility

- Orchestrated requires Pi + managed extension; direct strategy unchanged.
- No same-root resume; Cockpit does not drive orchestration in this release.

## 0.7.0 — 2026-07-27 (Kairo Runtime)

Minor release. Bounded native review via explicit Codex or Pi agent, Git-scoped
snapshots, fail-closed limits, secret-free receipts, CLI, and a read-only Reviews
subview inside Cockpit Runs. Publish tag: `kairo-runtime-v0.7.0`.

### Added

- Git snapshot contracts for working-tree / `--base` / `--commit` with fingerprints,
  fail-closed limits, private-path consent, and binary exclusion.
- Atomic write-once receipts under `~/.harness/reviews/<id>/receipt.json` (no prompt,
  diff, or transcript persistence).
- Bounded Codex (`exec review`) and Pi (JSON mode, ephemeral session, tools
  `read,grep,find,ls`) drivers.
- CLI: `kairo review --agent codex|pi` and `kairo reviews list|show` with `--json`
  and `--fail-on high|medium|low`.
- Cockpit Runs hub item **Reviews** with read-only list and receipt detail.
- Public adapter field `reviewCompatible` (true for Codex and Pi; false for Cursor,
  Claude, and OpenCode until audited).

### Compatibility

- One reviewer per run; Codex + Pi only in v1; Git required; `--agent` always explicit.
- No Intelligence routing, auto-fix, background reviews, or dual review.
- Receipts remain secret-free; Cockpit never launches reviews in this release.

## 0.6.0 — 2026-07-21 (Kairo Runtime)

Minor release. First-class Pi managed adapter and auditable runtime while Kairo
remains the control plane. Publish tag: `kairo-runtime-v0.6.0` (leave any legacy
`v0.6.0` tag untouched).

### Added

- Pi managed adapter at `~/.pi/agent/AGENTS.md` with opaque auth and separate
  config-dir vs CLI detection. Setup/status/doctor/sync/uninstall/JSON/Control
  Center now surface five agents.
- Pi in SDD managed/shared destinations: nine skills materialize once under
  `~/.agents/skills` (shared with Cursor/Codex/OpenCode); teaching persona gates
  through the Pi managed AGENTS.md section.
- Engram slug `pi` via official `engram setup pi`. Positive evidence requires
  `settings.json` packages (`npm:gentle-engram`, `npm:pi-mcp-adapter`) and
  `mcp.json` `mcpServers.engram`. Success reports `restart_required`; Pi-installed
  packages remain provider-owned residue on rollback.
- Runtime: `kairo run --agent pi --task "…" [--permissions read-only] [--follow]`
  launches `pi --mode json --no-session`, maps official NDJSON tool/usage/lifecycle
  events without persisting full args/results/secrets, and probes `pi --help` for
  `--mode` / `--no-session` compatibility.

### Compatibility

- Custom `PI_CODING_AGENT_DIR` is out of scope: config plan/apply/uninstall fail
  before writes; runtime launches remain available.
- Auth stays unknown/opaque — Kairo never reads credentials or asserts
  subscription/entitlement/balance.
- Pi is not an Intelligence backend and is never auto-installed.
- Adding `pi` to existing state v4 agent arrays needs no migration.

## 0.5.1 — 2026-07-21 (Kairo Runtime)

Patch release. Atomic JSON replacement for run coordination files so the main
process and detached supervisor never observe truncated state. Publish tag:
`kairo-runtime-v0.5.1`.

### Fixes

- Write `state.json`, `cancel.signal.json`, and `supervisor.lock.json` via
  temp + `O_EXCL` + fsync + atomic rename (cleanup temp on any failure).
- Readers only ever see the previous or next complete JSON; concurrent writers
  leave parseable JSON with no residual temps.
- Preserve in-process write ordering and cancel-signal + fresh read before
  terminal state so `stopRun` against a concurrent supervisor ends `CANCELLED`.

### Compatibility

- No schema, path, event JSONL, handoff, or public API changes.
- Atomic replace only — not distributed locking or compare-and-swap.

## 0.5.0 — 2026-07-20 (Kairo Runtime)

Minor release. Governance-first control plane: read-only scan, evidence-backed
proposals, strict context budgets, Control Center presentation, and confirmed
preview/apply/recovery. Publish tag: `kairo-runtime-v0.5.0`.

### Added

- Control-plane snapshot + Control Center cockpit (health, coverage, CTA, notes).
- Evidence-backed `proposals[]` derived only from status, checks, diff, adapters,
  and policy (no proposal without evidence; optional intelligence absence is neutral).
- Changes preview → confirm → apply → re-scan → receipt/rollback (managed assets only).
- Activity & recovery snapshot restore with safety backups.
- Operational SDD Core: `kairo components configure|verify|rollback sdd-core`
  materializes nine canonical skill directories (`SKILL.md` + `references/contract.md`),
  optional `--persona teaching` per managed agent (`personaAgentIds`, off by default),
  real verify health (`configured|missing|drifted|conflict`), receipts under
  `~/.harness/integrations/sdd-core/`, and bounded rollback that refuses incomplete
  evidence and never clobbers mismatched `afterHash` destinations.
- Lifecycle auto-materialization: when `sdd-core` is selected/installed,
  `install` / `setup` / `sync` / `upgrade` reuse `sdd-core.apply` with
  `preservePersona` (no second consent prompt; teaching never auto-activates).
  Results expose `integrations.sdd` (partial/conflicts/receipt) and aggregated
  `sessionRefreshRequired`.
- SDD state v4: durable `state.sdd` with explicit `personaAgentIds`, tracked files
  (relativePath + skillHash), fail-closed future `stateVersion`, and partial
  receipt reconciliation (track only applied/verified-noop; rollback mutates
  then reconciles even when global `ok=false`).
- Engram Operational Lifecycle: `kairo components configure|rollback engram-memory`
  delegates to official `engram setup <agent>` with dry-run, consent, receipts under
  `~/.harness/integrations/engram/`, and bounded rollback. Supported Engram range
  `>=1.19.0 <2.0.0`; older binaries get upgrade guidance only (no silent update).
  Doctor/status show binary/version and per-agent config evidence; Engram issues
  degrade only `engram-memory`.
- Component Manifest v2: `schemaVersion`, `kind`, `capabilities`, `dependencies`,
  `healthChecks`, with validation (IDs, versions, safe paths, duplicates, cycles)
  and deterministic topological resolution.
- Public component health states (`healthy` / `degraded` / `drifted` / `missing`)
  on `status`, `doctor`, components listing, and JSON (`componentHealth`).
  Engram/Graphify/SDD integration warnings degrade the component without failing
  global doctor when only that component is affected.
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

- Context compiler: `stableBudgetTokens` covers AGENTS.md + stable docs as one
  budget; `requestBudgetTokens` is shared across requested files; truncation
  markers stay inside the limit; evidence records `excluded_budget` and usage.
- Control Center / Changes show proposals with severity, destination links, and
  evidence sources (no sensitive dumps; Runs remain secondary).
- Bundled component catalog migrated to Manifest v2; workspace v1 catalogs
  continue to normalize in-memory. SDD catalog assets ship full skill directories
  (including `references/`) plus `personas/teaching.md`.
- SDD configure/rollback use the shared apply-confirmation policy: non-interactive
  apply without `--json` requires `--yes`/`--confirm`/`--no-preflight`; `--json`
  skips the prompt/consent gate. Conflicts are never overwritten.
- Default cloud routing precedence: Ollama → OpenCode Go → OpenCode Zen →
  OpenRouter. Go limit failures never auto-spend Zen credits.
- Health guidance treats API-key presence as configured credentials, not proven
  authentication, and recommends Ollama, OpenCode CLI, `OPENCODE_API_KEY`, and
  `OPENROUTER_API_KEY`.
- Engram and Graphify remain external integrations: proposals only when config,
  version, or freshness evidence exists; never claim active runtime.

### Compatibility

- Additive snapshot/context fields only (`proposals`, budget usage,
  `excluded_budget`). Existing CLI commands and state formats remain compatible.
- No autonomous writes; preview/apply still require confirmation.

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

## 0.5.0 — 2026-07-03 (legacy `@kal-elsam/harness` package)

Historical minor release under the legacy package name (not Kairo Runtime 0.5.0).
Adds a public component catalog and inspection command.

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
