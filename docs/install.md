# Installation options

## Quick start

Recommended entry — run Kairo Runtime in your terminal (npm registry; no pnpm
required for end users):

```bash
npx @kal-elsam/kairo-runtime
# or, after a global install:
npm install -g @kal-elsam/kairo-runtime
kairo
```

Contributors clone the repo and use **pnpm** — see [Contributing](contributing.md).

### IDE panel (optional)

A minimal VS Code / Cursor extension lives in `packages/kairo-vscode/`.
It shows status-bar + explorer tree from `kairo status --json` and opens a
terminal for sync/doctor (never writes configs itself). Package a local VSIX:

```bash
cd packages/kairo-vscode && npm run package
code --install-extension ./kairo-0.1.0.vsix
```

**First run** (no `~/.harness/state.json`): semantic Setup (Detect → Agents →
Components → Preview → Confirm) → full-screen Control Center.

**Later runs** (state present): semantic Cockpit — Overview, Governance, Activity,
Orchestration, Usage, Settings — plus Alerts inbox. Layout adapts to terminal size:

| Mode | Size | Layout |
|------|------|--------|
| Wide | ≥100 cols × ≥28 rows | TopBar + nav strip + main panel + footer |
| Compact | ≥72×20 | Same single-panel shell (tighter lists) |
| Minimal | 60–71 cols or short height | Selected section + essential readiness/next |
| Below gate | &lt;60 cols | Explicit TTY fallback (Ink disabled) |

Keys: `↑↓` navigate · `Enter` open/activate · `/` actions palette ·
`Esc` back (exit only from Overview) · `R` refresh/retry · `C` cancel run ·
`?` help. `Tab` switches region when content is interactive (runs, alerts,
Activity, Settings, launch).

Navigation: Overview · Governance · Activity · Orchestration · Usage · Settings.

### Monitor (opt-in)

```bash
kairo monitor enable
kairo monitor status
kairo monitor tick
kairo monitor disable
```

Scans governance drift and orphan/failed runs into the alert store. On macOS,
`enable` can install a LaunchAgent; other OS degrade honestly. Notifications fire
only when a new alert claim succeeds.

### Settings (curated integrations)

Settings browses a curated catalog (pinned `pi-usage-widget@0.2.1`, MIT).
Preview → confirm shows an in-session confirmation receipt (`wroteFiles: false`);
it does not persist or install anything.

### Usage evidence

Usage shows measured budget pairs, profile limits, and finite run `tokenUsage`
fields only. It never invents totals, costs, or savings.

Respects `NO_COLOR`, `HARNESS_ASCII=1`, and `HARNESS_INK=0`. Status is always labeled
in text, never color alone.

Explicit commands and setup flags keep their current behavior (`kairo setup`,
`kairo --dry-run`, `kairo shell`, non-TTY scripts, etc.).

Preview setup without writing anything:

```bash
npx @kal-elsam/kairo-runtime --dry-run
```

One-liner bootstrap (checks Node/npm, previews the plan, writes nothing by default):

```bash
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh
```

Preview the installer plan only (no download, no network package run):

```bash
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --dry-run
```

The bootstrap installer:

- requires Node.js 20.12+ and npm
- installs `@kal-elsam/kairo-runtime` globally (`kairo` CLI)
- runs `kairo setup --dry-run` by default (no agent configs, no `~/.harness` writes)
- never uses `sudo`, never modifies shell profiles, and never installs AI apps

Apply the plan when you are ready:

```bash
kairo setup --yes
# or
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --yes
```

CI, scripts, and advanced non-interactive configure:

```bash
kairo install --agents cursor,codex --yes
kairo setup --yes --agents all
```

Passthrough examples:

```bash
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --agents all --yes
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --components orchestrator,sdd-core --yes
```

Control plane:

```bash
kairo status
kairo sync
kairo upgrade --dry-run
kairo setup --yes
```

After `install.sh --yes`, verify health with `kairo status`, repair drift with `kairo sync`,
and preview upgrades with `kairo upgrade --dry-run`.

### Version and updates

```bash
# Installed CLI version (local package / PATH)
kairo --version
npx @kal-elsam/kairo-runtime --version

# Latest published version on npm
npm view @kal-elsam/kairo-runtime version

# Converge to the latest published package
kairo upgrade --dry-run
npx @kal-elsam/kairo-runtime@latest setup --yes
npx @kal-elsam/kairo-runtime@latest sync
```

### npm alternative

If you prefer npm directly (no curl):

```bash
npx @kal-elsam/kairo-runtime
npx @kal-elsam/kairo-runtime --dry-run
npx @kal-elsam/kairo-runtime install --agents cursor,codex --components orchestrator,sdd-core --yes
```

Optional global install:

```bash
npm i -g @kal-elsam/kairo-runtime
kairo --version
```

Legacy opt-in: scaffold governance files into a repository:

```bash
npx @kal-elsam/kairo-runtime install --scope=workspace
```

## What it installs

The CLI copies and personalizes `repo-template/` into the target project.

Always-installed core depends on the selected mode, and adapter folders are now
filtered separately.

Core examples:

```txt
AGENTS.md
docs/ai/
docs/skills/
docs/specs/
.gentle-ai/
.harness/
setup-agent-links.sh
```

Adapter-specific examples:

```txt
.codex/
.cursor/
.claude/
.pi/
.opencode/
.github/copilot-instructions.md
CLAUDE.md
GEMINI.md
```

Feature/extended examples (mostly `standard`/`enterprise` depending on mode):

```txt
.github/
evals/
scripts/harness/
```

Core rule:

```txt
AGENTS.md governs.
Adapters translate.
MCPs observe and preserve context.
Human approves impact.
```

Engram and Graphify are documented as external integrations: they help with memory and context graphs, but they do not replace the repo as the source of truth.

Built for:

- Cursor-first, but not Cursor-only.
- Gentle AI as the operational reference for SDD/TDD.
- AGENTS.md as the universal source.
- SDD, TDD, evals, checkpoints, review, and human approval.
- Engram/Graphify as external memory, analysis, or context-graph systems without locking the repo to a single tool.

## Key files

```txt
prompts/HARNESS_INSTALLER_MASTER.md
prompts/HARNESS_MINIMAL.md
prompts/HARNESS_STANDARD.md
prompts/HARNESS_ENTERPRISE.md
repo-template/
```

## Recommended usage

Install from the package:

```bash
pnpm dlx @kal-elsam/kairo-runtime install
pnpm dlx @kal-elsam/kairo-runtime detect
pnpm dlx @kal-elsam/kairo-runtime install --scope=workspace --mode standard --adapters codex,cursor
pnpm dlx @kal-elsam/kairo-runtime init --mode enterprise --all-adapters
pnpm dlx @kal-elsam/kairo-runtime doctor
```

Manual fallback for a new Cursor project (without the npm package):

1. Open the project.
2. Copy the contents of `prompts/HARNESS_INSTALLER_MASTER.md`.
3. Paste it into Cursor.
4. Specify the mode:

```txt
Install the harness in standard mode.
```

Or:

```txt
Install the harness in enterprise mode because this project will have AI, API, DB, and external integrations.
```

