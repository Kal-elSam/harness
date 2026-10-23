# Kairo Runtime

[![npm version](https://img.shields.io/npm/v/@kal-elsam/kairo-runtime.svg)](https://www.npmjs.com/package/@kal-elsam/kairo-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Kairo is the cost and quota layer on top of gentle-ai: choose who handles each task, with which model and provider, while keeping available quota in view.

Kairo complements [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai); it does not replace it. Agent configuration, ODD workflow, review, skills, and memory belong to gentle-ai, which defines **how your team works**. Kairo adds evidence for **who should do the work and at what cost**, using model capability, provider access, and quota signals.

## Start

Requires Node.js 22.19 or newer.

```bash
npx @kal-elsam/kairo-runtime
```

The standalone terminal UI and Pi host were retired. Bare `kairo` prints a notice; use `kairo status` or `kairo setup`.

## Team setup

From your Git project:

```bash
kairo team analysts
kairo team analyze --analyst MODEL --yes
kairo team approve --yes
kairo team roles init --yes
```

Choose a model ID or row number from `analysts`; Kairo never picks it for you.
Omit `--yes` to preview. Analysis names your analyst and spends provider usage
only when confirmed. Review the draft with `kairo team show`; approval validates
assignments before activation. Add `--json` for machine-readable output.
See the [CLI reference](docs/cli-reference.md) for details.

## What Kairo does today

- **Compares models for team roles.** Team selection weighs capability evidence, model cost, provider eligibility, and quota capacity. Role-specific aptitude probes have a dry-run plan and an authorization-gated run path.
- **Routes approved project assignments.** The project router checks strategy, model entitlement, and provider eligibility; quota pressure can select an eligible fallback. Tasks for a role are spread across every qualified, executable model of every available provider (new keys, subscriptions and models join automatically), in proportion to each provider's remaining quota headroom and never below the role's quality floor. Unsupported automatic execution produces a manual handoff, not a promise that every provider can execute every task.
- **Tracks provider capacity.** Kairo reads remaining quota and reset windows for Claude, Codex, and OpenCode Go when available. Cursor contributes access/pool evidence, not readable remaining quota; OpenCode Zen usage comes from local session history, not a provider quota balance. Missing signals stay unknown.
- **Makes cost tradeoffs explicit.** Model comparisons use Artificial Analysis per-task costs or token prices, with quota pacing based on remaining capacity and reset time. These are comparison weights and estimates—not a guaranteed bill for your task.
- **Keeps the orchestrator yours.** The orchestrator is the model you selected in the host you are working in (for example Opus 5.5 in Claude Code). Team analysis detects it from the host session and never assigns or replaces it.
- **One team per repository.** Project identity comes from the Git common directory, so the main checkout, every branch and every worktree share one team, its routes and its ledgers.
- **Exposes operational evidence to tools.** MCP tools expose status, fleet, runs, alerts, and context summaries. The control-plane report combines work, team, attention, and gentle-ai workflow status; gentle-ai remains the workflow authority.

These are repository capabilities, not an implemented gentle-ai external-router integration. Kairo does not yet implement the external router contract discussed in gentle-ai issue #4786.

## Planned (not built yet)

- **No model hoards roles.** A model will hold no more roles than its fair share of the qualified models, unless it is the only qualified option, and the team will say why.
- **Teams per reset phase.** Kairo will plan an ideal team, split time at each provider's quota exhaustion and reset points, and pick a team per phase that fits the remaining budget without dropping below each role's quality floor.

Team analysis reads this README first to understand the project. To override the product goal for one analysis, pass `--goal "TEXT"` or add `.kairo/goal.md`.

## Artificial Analysis

Model intelligence uses data from [Artificial Analysis](https://artificialanalysis.ai).
Each user brings their own free API key through the `ARTIFICIAL_ANALYSIS_API_KEY` environment variable; Kairo never ships a key.

```bash
export ARTIFICIAL_ANALYSIS_API_KEY="your-own-key"
```

Without a key, Kairo uses its last cached snapshot or reports `unknown` if no valid snapshot exists. It never invents Artificial Analysis scores.

The free API is limited to **1,000 requests per day**. Create your own key and check the access terms in the [Artificial Analysis API documentation](https://artificialanalysis.ai/api-reference).

## Day-to-day commands

| Command | What it does |
|---|---|
| `kairo` | Show the terminal UI retirement notice |
| `kairo status` | Inspect local agent and integration health |
| `kairo fleet` | Inspect the declared fleet and working activity |
| `kairo fleet models` | Inspect available versus enabled models per tool |
| `kairo control-plane --json` | Read the combined work, team, attention, and Gentle workflow report |
| `kairo sync` | Repair drift in Kairo-managed content |
| `kairo update` | Preview updating the Kairo CLI from npm; `--yes` applies |
| `kairo doctor` | Run detailed managed-state and configuration health checks |

Run `kairo help --all` for everything else, or read the [CLI reference](docs/cli-reference.md).
Setup and repair commands support Kairo's adapter integration; they are not a replacement for gentle-ai's agent configuration and methodology.

## Docs

| Guide | Contents |
|---|---|
| [CLI reference](docs/cli-reference.md) | Commands, flags, and JSON output |
| [Intelligence](docs/intelligence.md) | Routing, context budgets, and cloud consent |
| [Gentle companion boundary](docs/gentle-companion.md) | Ownership between Kairo and gentle-ai |
| [Installation](docs/install.md) | Installation options |
| [Contributing](docs/contributing.md) | Contribution and release guidance |

## Links

- npm: https://www.npmjs.com/package/@kal-elsam/kairo-runtime
- Repo: https://github.com/Kal-elSam/harness
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- License: [MIT](LICENSE)
