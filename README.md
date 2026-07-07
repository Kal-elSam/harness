# Kairo Runtime

[![npm version](https://img.shields.io/npm/v/@kal-elsam/kairo-runtime.svg)](https://www.npmjs.com/package/@kal-elsam/kairo-runtime)

**Kairo Runtime** is a local agent operating system — not a template dumper and not an
installer for AI apps. It detects agents you already use (Cursor, Codex, OpenCode,
Claude), writes managed sections into their configs, installs coordination components
under `~/.harness`, and keeps that ecosystem healthy with status, sync, backups,
and rollback.

The npm package (`@kal-elsam/kairo-runtime`) is how Kairo Runtime is distributed. The
product identity is the local control plane: setup, status, sync, doctor (with `update`
as a technical alias).

Terminal UX aims for Pi-like clarity (clear modes, non-interactive flags, extensible
commands) without depending on Pi as a runtime or adding a Pi adapter.

- **npm:** https://www.npmjs.com/package/@kal-elsam/kairo-runtime
- **repo:** https://github.com/Kal-elSam/harness

## Quick start

Recommended entry — run Kairo Runtime in your terminal (interactive setup wizard in a TTY):

```bash
npx @kal-elsam/kairo-runtime
```

Preview without writing anything:

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
- runs `@kal-elsam/kairo-runtime` via `npx` (or `npm exec`)
- ends with `kairo setup --dry-run` by default (no agent configs, no `~/.harness` writes)
- never uses `sudo`, never modifies shell profiles, and never installs AI apps

Apply the plan when you are ready:

```bash
npx @kal-elsam/kairo-runtime --yes
# or
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --yes
```

CI, scripts, and advanced non-interactive configure:

```bash
npx @kal-elsam/kairo-runtime install --agents cursor,codex --yes
npx @kal-elsam/kairo-runtime setup --yes --agents all
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
npx @kal-elsam/kairo-runtime@latest setup --yes
```

After `install.sh --yes`, verify health with `kairo status`, repair drift with `kairo sync`,
and move to the latest package with `npx @kal-elsam/kairo-runtime@latest setup --yes`.

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

## CLI commands

| Command | Description |
|---|---|
| `kairo` | Primary — short and direct |
| `kairo-runtime` | Descriptive alias |
| `harness` | Legacy alias (prefer `kairo`) |
| `agentic-harness` | Legacy descriptive alias |

```bash
kairo --version
kairo
kairo --dry-run
kairo setup
kairo setup --dry-run
kairo setup --agents all
kairo install --agents cursor,codex --yes
kairo status
kairo status --json
kairo adapters
kairo adapters --json
kairo sync
kairo sync --dry-run
kairo sync --dry-run --json
kairo policy
kairo policy --json
kairo policy set profile safe
kairo policy reset
kairo install
kairo install --agents all
kairo install --agents cursor,codex --components orchestrator,sdd-core
kairo doctor
kairo doctor --json
kairo update   # technical alias; prefer sync
kairo detect
kairo components
kairo components validate
kairo components init <id> --label "<label>"
kairo components pack <id> --out <file>    # advanced
kairo components import <file>             # advanced
kairo backups
kairo history
kairo history --command sync --action repaired
kairo history last --json
kairo report
kairo report --json
kairo report --out ./diagnostics.txt
kairo rollback --to <snapshot> [--apply]
kairo uninstall
kairo install --scope=workspace   # opt-in / legacy
```

Legacy CLI aliases (backward compatible): `harness`, `agentic-harness`, `sgs-harness`, `harness-sgs`

`kairo help` lists commands and JSON support; longer examples live in this README.

To try locally from this repo:

```bash
node ./bin/kairo.js setup --dry-run
node ./bin/kairo.js status
node ./bin/kairo.js sync --dry-run
node ./bin/kairo.js adapters --json
node ./bin/kairo.js install --dry-run
```

## Supported adapters (agent-global)

Kairo Runtime does **not** install Cursor, Codex, OpenCode, or Claude Code. It detects
their home-directory roots and writes managed sections into their config files.

| Adapter | Label | Root | Config file |
|---|---|---|---|
| `cursor` | Cursor | `~/.cursor` | `~/.cursor/AGENTS.md` |
| `codex` | Codex | `~/.codex` | `~/.codex/AGENTS.md` |
| `opencode` | OpenCode | `~/.config/opencode` | `~/.config/opencode/AGENTS.md` |
| `claude` | Claude Code | `~/.claude` | `~/.claude/CLAUDE.md` |

Inspect detection and managed state:

```bash
kairo adapters
kairo adapters --json
```

Agent selection defaults:

- If agent roots are detected → configure detected agents only.
- If none are detected → safe fallback to all four supported adapters.
- Force all four explicitly:

```bash
kairo setup --agents all
kairo install --agents all
```

Primary flow remains `kairo` → `status` → `sync` (or `kairo setup` explicitly).

## Install scopes

| Scope | Default for | Behavior |
|---|---|---|
| `agent-global` | bare `kairo`, `setup`, `install`, `update`, `doctor`, `status`, `uninstall` | Primary path. Configures local agent roots, managed sections, `~/.harness` state. No project folders. |
| `workspace` | `init` only (opt-in/legacy) | Explicit `--scope=workspace`. Copies `repo-template/` into the current repo. |

### `kairo` / `kairo setup`

Bare `kairo` opens the Ink setup UI (**Local Agent Operating System**) in a TTY. `kairo setup --simple` uses the Clack wizard instead. `kairo setup`
is equivalent. Detects agents, shows a plan, and lets you choose agents/components before
applying. Use `--dry-run` to preview without writing, or `--yes` / flags to skip prompts.
Use `kairo install` for explicit non-interactive configure in CI and scripts.

```bash
kairo
kairo --dry-run
kairo setup
kairo setup --dry-run
kairo setup --agents cursor,codex --components orchestrator,sdd-core --yes
kairo install --agents cursor,codex --yes
```

### `kairo status`

Control panel for the local ecosystem: detected vs managed agents, installed
components, check counts (ok/missing/stale), backups, overall status, and the
recommended next action.

```bash
kairo status
kairo status --json
```

`--json` prints a stable machine-readable envelope for CI, tooling, and debugging
(`ok`, `overall`, `agents`, `components`, `checks`, `backups`, `nextAction`,
`cliVersion`). Human text remains the default. Exit code is non-zero when
`overall` is not `ok`.

### `kairo sync`

Primary convergence command. Detects managed state, repairs drift with the same
safe engine as `update` (managed content only, backups before config changes,
user content preserved), then prints a status summary.

```bash
kairo sync
kairo sync --dry-run
kairo sync --dry-run --json
```

- No state → recommends `kairo setup`, writes nothing.
- Already OK → writes nothing.
- Drift/missing/stale → repairs, then shows status.
- `--json` uses the same stable envelope as `status`, plus sync fields
  (`action`, `wrote`, planned/applied repairs when present).
- `kairo update` remains as a technical alias.

### `kairo history`

Read-only audit log of managed operations under `~/.harness/history.jsonl`.
Use it to investigate what Kairo Runtime applied without parsing JSONL manually.

```bash
kairo history
kairo history --command sync
kairo history --action repaired --limit 10
kairo history last
kairo history last --json
kairo history last --command sync
```

- Filters: `--command`, `--action`, `--limit` (combine before limiting).
- `history last` prints the most recent matching event; exit 0 when empty.
- Queries never write to `~/.harness`.

### `kairo report`

Read-only local diagnostics bundle for support and debugging. Combines status,
policy, adapters, diff/drift preview, and recent history without modifying
`~/.harness` or agent configs.

```bash
kairo report
kairo report --json
kairo report --out ./diagnostics.txt
kairo report --limit 10
```

- Default stdout is human-readable; `--json` is stable for CI.
- `--out <file>` writes only to the path you specify (text or JSON per flags).
- `--limit <n>` controls history events included (default 20).
- Corrupt `history.jsonl` lines appear as warnings; valid events still display.
- No telemetry and no full config contents — paths, states, and summaries only.

### `kairo policy`

Optional local operation preferences under `~/.harness/policy.json`. Use this
when your team wants consistent apply/preflight defaults without repeating CLI
flags on every `setup`, `sync`, or `upgrade`.

```bash
kairo policy
kairo policy --json
kairo policy set profile ci
kairo policy set preflight true
kairo policy set agents detected
kairo policy set components orchestrator,sdd-core
kairo policy reset
```

Profiles:

| Profile | Behavior |
|---|---|
| `safe` | Preflight on; interactive terminal prompts before apply (default). |
| `ci` | Preflight on; non-interactive apply allowed via policy (`applyMode: confirm`). |
| `fast` | Same as `ci` — preflight on, confirmation via policy instead of a prompt. |

Precedence: **CLI flags > policy file > internal defaults**. Without a policy
file, behavior matches 0.18.0. `policy reset` deletes only `policy.json`; it
does not touch `state.json`, managed adapters, or installed components.

Keys: `profile`, `applyMode` (`prompt` \| `confirm`), `preflight`, `agents`
(`detected`, `all`, or a comma-separated list), `components`.

Visibility (0.20.0+): `kairo status`, `kairo explain`, and apply preflight on
`setup`/`sync`/`upgrade` show the effective policy and consent source (`cli`,
`policy`, `interactive`, or `none`). `status --json` includes a stable `policy`
field.

### `kairo install` (agent-global)

Non-interactive configure. Same engine as `setup`.

```bash
kairo install --dry-run   # preview the plan, writes nothing
kairo install             # apply
kairo install --agents cursor,claude
```

What it does:

- Detects local agents: `cursor`, `codex`, `opencode`, `claude`. If none are
  detected, it targets all supported agents.
- Installs the orchestrator/conductor contract to `~/.harness/core/`.
- Adds a managed marker section to each agent config
  (for example `~/.cursor/AGENTS.md`):

```md
<!-- harness:managed:start -->
...managed content, refreshed by kairo sync...
<!-- harness:managed:end -->
```

- Everything outside the markers is user-owned and always preserved.
- Before modifying any existing config it snapshots the file to
  `~/.harness/backups/<timestamp>/`.
- Records everything in `~/.harness/state.json`.
- Set `HARNESS_HOME=/some/dir` to redirect the whole managed root (useful for
  testing and sandboxed environments).

### `kairo update` (agent-global)

Technical/compatibility alias for the repair engine used by `sync`. Prefer
`kairo sync` for day-to-day use. Requires an existing `~/.harness/state.json`.

### `kairo doctor` (agent-global)

Reports installed agents, managed state, backups, and missing configs.
Exits non-zero when managed state or a tracked config is missing.

```bash
kairo doctor
kairo doctor --json
```

`--json` uses the same stable control-plane envelope as `status`, including the
detailed `checks` array.

### `kairo uninstall` (agent-global)

Removes managed sections from agent configs (with a fresh backup first),
deletes `~/.harness/state.json` and `~/.harness/core/`. Backups are preserved.

### Workspace components

Opt-in custom components live in the current repo under `.harness/components/`.
They never override bundled IDs (`orchestrator`, `sdd-core`) and install copies
assets into `~/.harness/components/<id>/` only when you pass `--components`.

Create, validate, and install:

```bash
kairo components init team-rules --label "Team Rules"
# edit .harness/components/team-rules/README.md
kairo components validate
kairo install --components team-rules
```

Advanced: share a workspace component between repos (no remote registry):

```bash
kairo components pack team-rules --out team-rules.tgz
# copy team-rules.tgz into another repo
kairo components import team-rules.tgz
kairo components validate
kairo install --components team-rules
```

- `kairo components` lists bundled and workspace catalogs.
- `kairo components validate [--cwd <path>]` runs the same loader used by install/doctor.
- `kairo components init <id> --label "<label>"` scaffolds `catalog.json`,
  `.harness/components/<id>/README.md`, and a catalog entry (`version: "0.1.0"`).
  It refuses existing IDs and bundled IDs, and does not write to `~/.harness`.
- `kairo components pack <id> --out <file>` builds a portable `.tgz` (partial catalog + assets).
- `kairo components import <file>` installs declared assets only; no overwrite by default,
  no `~/.harness` writes, no package scripts.

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

## Modes

| Mode | Use case |
|---|---|
| minimal | scripts, technical spikes, landing pages, small prototypes |
| standard | real frontend/backend apps, simple SaaS, medium products |
| enterprise | AI agents, critical workflows, API/DB/auth/evals, multi-agent |

## Publishing

Published on npm as `@kal-elsam/kairo-runtime`. Releases use **npm Trusted Publishing/OIDC** from GitHub Actions — no `NPM_TOKEN`.

Before tagging a new version:

```bash
npm test
npm run smoke
npm pack --dry-run
```

After the release commit, verify attribution was not added to the message:

```bash
npm run release:check
git log -1 --format=%B
```

CI also scans commit ranges for attribution trailers:

```bash
npm run release:check -- --range origin/main...HEAD
```

Release commits must **not** include `Co-authored-by` or other AI attribution
trailers. Do not rewrite published tags; ship a corrective patch version instead.

`npm run smoke` packs the current source into a tarball, installs it in a
throwaway temp project with a fake `HARNESS_HOME`, and exercises both scopes end
to end:

- **agent-global:** `setup --dry-run`, `status`, `install`, `doctor`, drift
  simulation, `sync` repair, `backups`, rollback preview (no writes),
  rollback apply (with safety backup), `uninstall`.
- **workspace:** `install --scope=workspace`, `doctor`, `update --dry-run`.

Release flow:

```bash
# bump version in package.json and package-lock.json
git add .
git commit -m "chore: release 0.5.0"
npm run release:check
git tag v0.5.0
git push origin main
git push origin v0.5.0
```

After npm publishes the tag, verify published provenance against git and the registry:

```bash
git fetch --tags origin
git fetch origin main
npm run release:published -- --version 0.1.0
npm run smoke:registry -- --version 0.1.0
npm run smoke:installer -- --version 0.1.0
```

`release:published` checks npm `version`, npm `gitHead`, local tag `v*`, remote tag on `origin`, and `origin/main`. Override the package with `--package @kal-elsam/kairo-runtime` when needed.

`smoke:registry` installs `@kal-elsam/kairo-runtime` from the npm registry (not the local tarball) into a throwaway workspace with a fake `HARNESS_HOME` and npm cache, then runs the recommended flow via `kairo`: `setup --dry-run`, `setup --yes`, `status`, drift simulation, `sync`, `status --json` (expects `overall=ok`), and `uninstall`. Use `latest` by default, pin with `--version x.y.z`, or override with `--package`.

`smoke:installer` validates the public one-liner path: `curl .../install.sh | sh` against GitHub `raw` and the npm registry with isolated `HARNESS_HOME`. Preview must not write `~/.harness`; `--yes --agents all` must reach `kairo status --json` with `overall=ok`, then `kairo uninstall` must remove managed sections. Pin with `--version x.y.z` after publish.

Suggested first publish tag: `kairo-runtime-v0.1.0` (or `v0.30.0` if you prefer repo version continuity).

The `publish.yml` workflow runs on `v*` tags and publishes to npm using the `npm-publish` environment.
It runs `npm run release:check` on `HEAD` immediately before `npm publish`.

See the full policy in `SECURITY.md`.

## Base rule

The agent must not operate as a free-form programmer.

```txt
Requirement
→ Spec
→ Plan
→ Tests failing first
→ Implementation
→ Validation
→ Review
→ Human approval
```

## Gentle AI integration

After installing the harness in a repo, run:

```bash
/sdd-init
gentle-ai skill-registry refresh
gentle-ai doctor
```

`/sdd-init` detects stack and testing.  
`skill-registry refresh` updates the skill registry.  
`doctor` checks ecosystem health.

## Engram/Graphify integration

This pack does not assume a specific implementation. It defines integration points in:

```txt
docs/ai/context-graph.md
docs/ai/memory.md
docs/skills/context-graph.md
```

The rule:

- The repo keeps the source of truth in Markdown.
- Engram can index decisions, specs, memory, and conventions.
- Graphify can build the architecture graph: modules, dependencies, features, and risks.
- No external memory replaces `AGENTS.md`, `docs/ai/`, or the code.

## v2 — Universal-first, adapter-based

This version adds:

- `docs/ai/model-policy.md`
- `docs/ai/provider-routing.md`
- `docs/ai/tool-adapters.md`
- `docs/ai/context-budget.md`
- `docs/skills/model-selection.md`
- `docs/skills/tool-adapter-sync.md`
- Adapters for Codex, Claude, Gemini, GitHub Copilot, Cursor, and Gentle AI
- Codex skills: SDD, TDD, evals, checkpoint
- Claude agents/skills pointers
- Gemini pointer
- SDD subagents per phase
- Explicit policy for cost-efficient models such as DeepSeek

v2 principle:

```txt
Universal core first.
Tool adapters second.
Model providers third.
```

Cursor remains the primary editor, but not the source of truth.

## v3 — Loop Engineering + OpenCode-first execution adapter

This version adds Loop Engineering as a formal harness layer and positions OpenCode + Gentle AI + DeepSeek as the primary execution adapter for this flow.

```txt
OpenCode executes.
Gentle AI structures SDD/TDD.
DeepSeek iterates cheaply.
Harness governs.
Loops repair with boundaries.
Evals validate.
Graphify observes dependencies.
Engram preserves learning.
Human approves impact.
```

New modules:

```txt
docs/ai/loops.md
docs/ai/loop-policy.md
docs/ai/loop-observability.md
docs/ai/loop-log.md
docs/skills/loop-design.md
docs/skills/loop-debugging.md
docs/skills/loop-review.md
docs/skills/loop-retrospective.md
.opencode/
.gentle-ai/loops/
evals/loop-regression/
```

## v4 — Universal Adapter Parity

This version corrects the interpretation that the harness is OpenCode-based.

v4 rule:

```txt
AGENTS.md governs.
docs/ai defines.
docs/skills operationalize.
docs/specs specify.
evals validate.
Adapters translate.
Models execute.
Humans approve impact.
```

OpenCode may be the user's preferred runtime because Gentle AI + DeepSeek live there, but it has no higher authority than Cursor, Codex, Claude, Gemini, or Pi.

Key new document:

```txt
docs/ai/adapter-parity.md
```

New rule:

```txt
No adapter is primary by authority.
An adapter can be primary only by workflow preference.
The core universal remains the governance layer.
```

## v5 — Enforcement-first Harness

This version moves the harness closer to a real control plane — beyond methodology and documentation.

```txt
Docs guide.
Policies constrain.
CI gates enforce.
Evals measure.
Hooks block unsafe actions.
Trust policy protects skills/tools.
Installer manages lifecycle.
```

New modules:

```txt
docs/ai/enforcement.md
docs/ai/quality-gates.md
docs/ai/eval-strategy.md
docs/ai/trust-policy.md
docs/ai/installer-cli.md
docs/ai/observability-runtime.md
docs/ai/rollback-runtime.md
docs/ai/maintainability-gates.md
.github/workflows/harness-quality-gate.yml
.github/workflows/harness-security-gate.yml
.github/dependabot.yml
scripts/harness/
evals/golden/
evals/tool-calls/
evals/schema/
evals/regression/
```

## v6 — Spec Sizing and Complexity Classification

This version adds explicit feature/task spec sizing.

The harness already had installation modes:

```txt
minimal
standard
enterprise
```

But those describe harness installation size, not the complexity of a feature spec.

v6 adds:

```txt
basic spec
standard spec
complex spec
```

Rule:

```txt
Do not force complex SDD on simple tasks.
Do not allow basic specs for high-impact work.
Spec complexity must match risk, ambiguity, architecture impact, testability and blast radius.
```

New core files:

```txt
docs/ai/spec-sizing.md
docs/ai/spec-intake.md
docs/ai/spec-escalation.md
docs/specs/templates/basic-spec.md
docs/specs/templates/standard-spec.md
docs/specs/templates/complex-spec.md
docs/skills/spec-complexity-classifier.md
docs/skills/spec-intake.md
docs/skills/spec-escalation-review.md
```
