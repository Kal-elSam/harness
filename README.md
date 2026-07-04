# Agentic Engineering Harness Pack

[![npm version](https://img.shields.io/npm/v/@kal-elsam/harness.svg)](https://www.npmjs.com/package/@kal-elsam/harness)

**Harness is a local AI ecosystem configurator** — not a template dumper and not an
installer for AI apps. It detects agents you already use (Cursor, Codex, OpenCode,
Claude), writes managed sections into their configs, installs coordination components
under `~/.harness`, and keeps that ecosystem healthy with status, sync, backups,
and rollback.

The npm package (`@kal-elsam/harness`) is how Harness is distributed. The product
identity is the local control plane: setup, status, sync, doctor (with `update`
as a technical alias).

Terminal UX aims for Pi-like clarity (clear modes, non-interactive flags, extensible
commands) without depending on Pi as a runtime or adding a Pi adapter.

- **npm:** https://www.npmjs.com/package/@kal-elsam/harness
- **repo:** https://github.com/Kal-elSam/harness

## Quick start

Recommended entry — one-liner bootstrap (checks Node/npm, previews the plan, writes nothing):

```bash
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh
```

Preview the installer plan only (no download, no network package run):

```bash
curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --dry-run
```

The bootstrap installer:

- requires Node.js 18.18+ and npm
- runs `@kal-elsam/harness` via `npx` (or `npm exec`)
- ends with `harness setup --dry-run` (no agent configs, no `~/.harness` writes)
- never uses `sudo` and never modifies shell profiles

Apply the plan when you are ready:

```bash
npx @kal-elsam/harness setup
```

Control plane:

```bash
npx @kal-elsam/harness status
npx @kal-elsam/harness sync
```

### Version and updates

```bash
# Installed CLI version (local package / PATH)
harness --version
npx @kal-elsam/harness --version

# Latest published version on npm
npm view @kal-elsam/harness version

# Converge to the latest published package
npx @kal-elsam/harness@latest sync
```

### npm alternative

If you prefer npm directly (no curl):

```bash
npx @kal-elsam/harness setup --dry-run
npx @kal-elsam/harness setup
npx @kal-elsam/harness install --agents cursor,codex --components orchestrator,sdd-core
```

Optional global install:

```bash
npm i -g @kal-elsam/harness
harness --version
```

Legacy opt-in: scaffold governance files into a repository:

```bash
npx @kal-elsam/harness install --scope=workspace
```

## CLI commands

| Command | Description |
|---|---|
| `harness` | Primary — short and direct |
| `agentic-harness` | Descriptive alias |

```bash
harness --version
harness setup
harness setup --dry-run
harness status
harness status --json
harness sync
harness sync --dry-run
harness sync --dry-run --json
harness install
harness install --agents cursor,codex --components orchestrator,sdd-core
harness doctor
harness doctor --json
harness update   # technical alias; prefer sync
harness detect
harness components
harness components validate
harness components init <id> --label "<label>"
harness components pack <id> --out <file>    # advanced
harness components import <file>             # advanced
harness backups
harness rollback --to <snapshot> [--apply]
harness uninstall
harness install --scope=workspace   # opt-in / legacy
```

Legacy aliases (backward compatible): `sgs-harness`, `harness-sgs`

To try locally from this repo:

```bash
node ./bin/harness.js setup --dry-run
node ./bin/harness.js status
node ./bin/harness.js sync --dry-run
node ./bin/harness.js install --dry-run
```

## Install scopes

| Scope | Default for | Behavior |
|---|---|---|
| `agent-global` | `setup`, `install`, `update`, `doctor`, `status`, `uninstall` | Primary path. Configures local agent roots, managed sections, `~/.harness` state. No project folders. |
| `workspace` | `init` only (opt-in/legacy) | Explicit `--scope=workspace`. Copies `repo-template/` into the current repo. |

### `harness setup`

Interactive wizard for the local ecosystem. Detects agents, shows a plan, and
lets you choose agents/components before applying. Use `--dry-run` to preview
without writing, or `--yes` / flags to skip prompts.

```bash
harness setup
harness setup --dry-run
harness setup --agents cursor,codex --components orchestrator,sdd-core --yes
```

### `harness status`

Control panel for the local ecosystem: detected vs managed agents, installed
components, check counts (ok/missing/stale), backups, overall status, and the
recommended next action.

```bash
harness status
harness status --json
```

`--json` prints a stable machine-readable envelope for CI, tooling, and debugging
(`ok`, `overall`, `agents`, `components`, `checks`, `backups`, `nextAction`,
`cliVersion`). Human text remains the default. Exit code is non-zero when
`overall` is not `ok`.

### `harness sync`

Primary convergence command. Detects managed state, repairs drift with the same
safe engine as `update` (managed content only, backups before config changes,
user content preserved), then prints a status summary.

```bash
harness sync
harness sync --dry-run
harness sync --dry-run --json
```

- No state → recommends `harness setup`, writes nothing.
- Already OK → writes nothing.
- Drift/missing/stale → repairs, then shows status.
- `--json` uses the same stable envelope as `status`, plus sync fields
  (`action`, `wrote`, planned/applied repairs when present).
- `harness update` remains as a technical alias.

### `harness install` (agent-global)

Non-interactive configure. Same engine as `setup`.

```bash
harness install --dry-run   # preview the plan, writes nothing
harness install             # apply
harness install --agents cursor,claude
```

What it does:

- Detects local agents: `cursor`, `codex`, `opencode`, `claude`. If none are
  detected, it targets all supported agents.
- Installs the orchestrator/conductor contract to `~/.harness/core/`.
- Adds a managed marker section to each agent config
  (for example `~/.cursor/AGENTS.md`):

```md
<!-- harness:managed:start -->
...managed content, refreshed by harness sync...
<!-- harness:managed:end -->
```

- Everything outside the markers is user-owned and always preserved.
- Before modifying any existing config it snapshots the file to
  `~/.harness/backups/<timestamp>/`.
- Records everything in `~/.harness/state.json`.
- Set `HARNESS_HOME=/some/dir` to redirect the whole managed root (useful for
  testing and sandboxed environments).

### `harness update` (agent-global)

Technical/compatibility alias for the repair engine used by `sync`. Prefer
`harness sync` for day-to-day use. Requires an existing `~/.harness/state.json`.

### `harness doctor` (agent-global)

Reports installed agents, managed state, backups, and missing configs.
Exits non-zero when managed state or a tracked config is missing.

```bash
harness doctor
harness doctor --json
```

`--json` uses the same stable control-plane envelope as `status`, including the
detailed `checks` array.

### `harness uninstall` (agent-global)

Removes managed sections from agent configs (with a fresh backup first),
deletes `~/.harness/state.json` and `~/.harness/core/`. Backups are preserved.

### Workspace components

Opt-in custom components live in the current repo under `.harness/components/`.
They never override bundled IDs (`orchestrator`, `sdd-core`) and install copies
assets into `~/.harness/components/<id>/` only when you pass `--components`.

Create, validate, and install:

```bash
harness components init team-rules --label "Team Rules"
# edit .harness/components/team-rules/README.md
harness components validate
harness install --components team-rules
```

Advanced: share a workspace component between repos (no remote registry):

```bash
harness components pack team-rules --out team-rules.tgz
# copy team-rules.tgz into another repo
harness components import team-rules.tgz
harness components validate
harness install --components team-rules
```

- `harness components` lists bundled and workspace catalogs.
- `harness components validate [--cwd <path>]` runs the same loader used by install/doctor.
- `harness components init <id> --label "<label>"` scaffolds `catalog.json`,
  `.harness/components/<id>/README.md`, and a catalog entry (`version: "0.1.0"`).
  It refuses existing IDs and bundled IDs, and does not write to `~/.harness`.
- `harness components pack <id> --out <file>` builds a portable `.tgz` (partial catalog + assets).
- `harness components import <file>` installs declared assets only; no overwrite by default,
  no `~/.harness` writes, no package scripts.

## Workspace lifecycle: init, update, doctor

The workspace harness is not a one-shot copy. Every `init` writes a manifest
that later `update` and `doctor` runs rely on. All workspace commands accept
`--scope=workspace`; `init` implies it.

### `harness init` / `harness install --scope=workspace`

Installs `repo-template/` into the target project and writes
`.harness/manifest.json` with the installed mode, CLI version, and a content
hash for every file the harness created.

```bash
harness init --mode enterprise --all-adapters
harness install --scope=workspace --mode standard --adapters codex,cursor
```

By default it never overwrites a file that already exists. Pass `--force` to
overwrite, or `--dry-run` to preview without writing anything.

Important behavior:

- Running just `harness` (or `npx/pnpm dlx @kal-elsam/harness`) now runs the
  **agent-global** install, not the workspace scaffold.
- Within workspace scope, `mode=standard` remains the default.
- `--adapters` installs only the requested adapters.
- `--all-adapters` keeps the previous “install everything” behavior.

Supported adapters:

```txt
codex, cursor, claude, gemini, copilot, opencode, pi
```

### `harness detect`

Read-only inspection command. It reports the global agents detected on this
machine, then the current project stack and adapter markers, and prints the
recommended install command.

```bash
harness detect
```

### `harness update --scope=workspace`

Reapplies the current harness templates to an already-installed project.

```bash
harness update --scope=workspace --dry-run   # preview: created / updated / unchanged / skipped
harness update --scope=workspace             # apply
harness update --scope=workspace --force     # also overwrite files you modified locally
```

`update` is conservative by design:

- Files unchanged since install are safely refreshed to the latest template.
- Files you edited locally are **skipped** unless `--force` is passed.
- Files that exist but were never tracked by the harness are left alone.
- New files added in newer harness releases are created.
- `.harness/manifest.json` is rewritten with the new hashes, CLI version, and adapter selection.

### `harness doctor --scope=workspace`

Read-only health check. Never modifies files.

```bash
harness doctor --scope=workspace
```

Reports each check as `OK`, `WARNING`, or `MISSING`:

- **Required** files missing (`AGENTS.md`, `docs/ai/harness.md`,
  `docs/ai/memory.md`) fail the check (non-zero exit code).
- **Recommended** files missing are reported as warnings.
- If `.harness/manifest.json` is missing, doctor warns and suggests
  `harness init`.
- If a file tracked in the manifest was deleted after install, doctor
  reports manifest drift.

### `.harness/manifest.json`

```json
{
  "packageName": "@kal-elsam/harness",
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
pnpm dlx @kal-elsam/harness install
pnpm dlx @kal-elsam/harness detect
pnpm dlx @kal-elsam/harness install --scope=workspace --mode standard --adapters codex,cursor
pnpm dlx @kal-elsam/harness init --mode enterprise --all-adapters
pnpm dlx @kal-elsam/harness doctor
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

Published on npm as `@kal-elsam/harness`. Releases use **npm Trusted Publishing/OIDC** from GitHub Actions — no `NPM_TOKEN`.

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
npm run release:published -- --version 0.5.0
npm run smoke:registry -- --version 0.5.0
```

`release:published` checks npm `version`, npm `gitHead`, local tag `v*`, remote tag on `origin`, and `origin/main`.

`smoke:registry` installs `@kal-elsam/harness` from the npm registry (not the local tarball) into a throwaway workspace with a fake `HARNESS_HOME` and npm cache, then runs the recommended flow: `setup --dry-run`, `setup --yes`, `status`, drift simulation, `sync`, `status --json` (expects `overall=ok`), and `uninstall`. Use `latest` by default or pin with `--version x.y.z`. This step is manual post-publish only; it is not part of normal CI because it requires registry network access.

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
