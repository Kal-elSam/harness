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
kairo team roles sync --host claude-code --yes
```

Connect Claude Code once (routing, quota pacing and the status display):

```bash
claude plugin marketplace add Kal-elSam/harness
claude plugin install kairo-router@kairo
```

Choose a model ID or row number from `analysts`; Kairo never picks it for you.
Omit `--yes` to preview. Analysis names your analyst and spends provider usage
only when confirmed. Review the draft with `kairo team show`; approval validates
assignments before activation. Add `--json` for machine-readable output.
Use `kairo team plan` to see quota phases with local dates, changed roles and
reset waits. It recomputes from stored analysis and today's quota without model
calls or writes; `--json` prints the forecast. `kairo team show` adds the current
phase and next team change when a stored plan exists. Routing prefers a changed
phase model only while it remains qualified, eligible and affordable.
See the [CLI reference](docs/cli-reference.md) for details.

## What Kairo does today

- **No model hoards project roles.** Analysis and `kairo team rebuild` enforce a strict maximum of `ceil(assignable roles / qualified models)` roles per model, excluding the host orchestrator. Qualified models pass eligibility and at least one role’s quality floor. A cap-driven move stays above the role floor and is explained; a model may exceed the cap only when it is the role’s only qualified option, or when every qualified model for that role is already full; then the best qualified model with the fewest roles takes it. Both cases are explained. For 12 roles and 7 qualified models, the cap is 2.

- **Learns role quality from task outcomes.** `kairo team verdict --agent NAME --result pass|fail [--retry]` records the orchestrator’s checks/review verdict on the latest unresolved outcome. `kairo team verdict --pending` lists agent, model, and finished time; add `--json` for structured output. Claude Code’s kairo-router reminds on each prompt when verdicts are pending, silently skipping failed lookups. Inline `record-outcome --result` remains supported. After five attributed results per model and role, measured success rate replaces public role fit; below-floor models are excluded. Completion without an explicit result does not imply quality.
- **Compares models for team roles.** Team selection weighs capability evidence, model cost, provider eligibility, and quota capacity. Role-specific aptitude probes have a dry-run plan and an authorization-gated run path. Public benchmarks only nominate candidates: a model that passes its role probe wins that role over public scores, and a model that fails it is dropped from that role until a later pass.
- **Routes approved project assignments.** The project router checks strategy, model entitlement, and provider eligibility; quota pressure can select an eligible fallback. Tasks for a role are spread across every qualified, executable model of every available provider (new keys, subscriptions and models join automatically), in proportion to each provider's remaining quota headroom and never below the role's quality floor. Unsupported automatic execution produces a manual handoff, not a promise that every provider can execute every task.
- **Tracks provider capacity.** Kairo reads remaining quota and reset windows for Claude, Codex, and OpenCode Go when available. Cursor contributes access/pool evidence, not readable remaining quota; OpenCode Zen usage comes from local session history, not a provider quota balance. Missing signals stay unknown.
- **Makes cost tradeoffs explicit.** Model comparisons use Artificial Analysis per-task costs or token prices, with quota pacing based on remaining capacity and reset time. These are comparison weights and estimates—not a guaranteed bill for your task.
- **Keeps the orchestrator yours.** The orchestrator is the model you selected in the host you are working in (for example Opus 5.5 in Claude Code). Team analysis detects it from the host session and never assigns or replaces it.
- **One team per repository.** Project identity comes from the Git common directory, so the main checkout, every branch and every worktree share one team, its routes and its ledgers.
- **Exposes operational evidence to tools.** MCP tools expose status, fleet, runs, alerts, and context summaries. The control-plane report combines work, team, attention, and gentle-ai workflow status; gentle-ai remains the workflow authority.

These are repository capabilities, not an implemented gentle-ai external-router integration. Kairo does not yet implement the external router contract discussed in gentle-ai issue #4786.

## Planned (not built yet)

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


### Running delegated work

Use `kairo team running` to see each active role, model, provider, agent name,
and elapsed time. Add `--watch` for two-second updates (Ctrl+C stops), or
`--json` for machine-readable snapshots; both flags can be combined.
Launches without outcomes after two hours appear as **possibly abandoned**,
not running, and are reported once per watch session.

Claude Code's Kairo status entry shows up to three active delegated agents and
counts any others. It shows the final routed model and clears when work ends.
When `showStatus` is disabled, the enabled `showBand` surface shows the work;
disabling both hides it. Quota values from `kairo team pacing` expire after two
minutes; other routing inputs retain their thirty-minute freshness limit.
