# Agentic Engineering Harness Pack

[![npm version](https://img.shields.io/npm/v/@kal-elsam/harness.svg)](https://www.npmjs.com/package/@kal-elsam/harness)

Reusable package to install an agentic engineering harness into new or existing projects.

- **npm:** https://www.npmjs.com/package/@kal-elsam/harness
- **repo:** https://github.com/Kal-elSam/harness

Package name:

```txt
@kal-elsam/harness
```

## Quick install

From any project, without a global install:

```bash
npx @kal-elsam/harness init --mode enterprise
```

```bash
pnpm dlx @kal-elsam/harness init --mode enterprise
```

## CLI commands

Optional global install:

```bash
npm i -g @kal-elsam/harness
```

| Command | Description |
|---|---|
| `harness` | Primary — short and direct |
| `agentic-harness` | Descriptive alias |

```bash
harness init --mode enterprise
harness init --mode standard --dry-run
harness doctor
```

Legacy aliases (backward compatible): `sgs-harness`, `harness-sgs`

To try locally from this repo:

```bash
node ./bin/harness.js init --mode enterprise --dry-run
node ./bin/harness.js doctor
```

## What it installs

The CLI copies and personalizes `repo-template/` into the target project:

```txt
AGENTS.md
docs/ai/
docs/skills/
docs/specs/
.codex/
.cursor/
.claude/
.github/
.gentle-ai/
.opencode/
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
pnpm dlx @kal-elsam/harness init --mode standard
pnpm dlx @kal-elsam/harness init --mode enterprise
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
npm pack --dry-run
```

Release flow:

```bash
# bump version in package.json
git tag v0.2.0
git push origin v0.2.0
```

The `publish.yml` workflow runs on `v*` tags and publishes to npm using the `npm-publish` environment.

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
