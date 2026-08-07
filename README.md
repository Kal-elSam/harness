# Kairo Runtime

[![npm version](https://img.shields.io/npm/v/@kal-elsam/kairo-runtime.svg)](https://www.npmjs.com/package/@kal-elsam/kairo-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Kairo finds the AI agents you already use — Cursor, Codex, Claude, OpenCode — and keeps
their configuration under control. One place to see what's set up, repair what drifted,
and roll back when something breaks.

It does not install AI apps and it does not dump templates. It manages marked sections
inside the configs you already have, and it never writes without asking.

## Start

```bash
npx @kal-elsam/kairo-runtime
```

That's it. The first run walks you through setup; after that it opens the cockpit:

```
KAIRO

Needs attention · 4/4 agents · drift pending
Kairo coordinates installed AI agents for this project.

→ Fix drift
  Run "kairo sync" to repair managed content.
  Enter → preview in Governance

  Last activity · codex · failed
  Obsidian not connected · open Settings to choose your vault
  Update available · run kairo updates check
  9 more in Details · Space
```

`↑↓` move · `Enter` open · `Space` details · `R` refresh · `Esc` back · `?` help

## The four commands

| Command | What it does |
|---|---|
| `kairo` | Open the cockpit |
| `kairo status` | See how your setup is doing |
| `kairo sync` | Repair what drifted |
| `kairo doctor` | Deeper health checks |

Run `kairo help --all` for everything else, or read the
[CLI reference](https://github.com/Kal-elSam/harness/blob/main/docs/cli-reference.md).

## What it guarantees

- **Your files stay yours.** Kairo writes only between
  `<!-- harness:managed:start -->` / `<!-- harness:managed:end -->` markers.
  Everything outside them is preserved untouched.
- **Every write is reversible.** Configs are snapshotted first; `kairo rollback`
  restores a prior snapshot.
- **Nothing happens without consent.** Previews are the default; applying requires
  an explicit `--yes` or a confirmation in the UI.
- **No permanent daemons.** Background monitoring is opt-in via `kairo monitor enable`.

## Install

Requires Node.js 20.12 or newer.

```bash
# Run without installing
npx @kal-elsam/kairo-runtime

# Install globally
npm i -g @kal-elsam/kairo-runtime && kairo

# Preview the setup plan, write nothing
npx @kal-elsam/kairo-runtime --dry-run
```

There is also a bootstrap script that checks Node, installs the CLI, and previews the
plan without writing anything — see
[installation options](https://github.com/Kal-elSam/harness/blob/main/docs/install.md).

## Docs

| Guide | Contents |
|---|---|
| [CLI reference](https://github.com/Kal-elSam/harness/blob/main/docs/cli-reference.md) | Every command, flag, and `--json` output |
| [Agents & adapters](https://github.com/Kal-elSam/harness/blob/main/docs/adapters.md) | Supported agents, config roots, Pi runtime, reviews |
| [Components](https://github.com/Kal-elSam/harness/blob/main/docs/components.md) | Orchestrator, Engram memory, SDD Core skills |
| [Intelligence](https://github.com/Kal-elSam/harness/blob/main/docs/intelligence.md) | Local-first routing, budgets, cloud consent |
| [Integrations](https://github.com/Kal-elSam/harness/blob/main/docs/integrations.md) | Gentle AI, Engram, Graphify, Obsidian |
| [Workspace scope](https://github.com/Kal-elSam/harness/blob/main/docs/workspace.md) | Opt-in per-repo scaffolding and manifests |
| [Contributing](https://github.com/Kal-elSam/harness/blob/main/docs/contributing.md) | Release process, tags, branch chains |

## Links

- npm: https://www.npmjs.com/package/@kal-elsam/kairo-runtime
- Repo: https://github.com/Kal-elSam/harness
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- License: [MIT](LICENSE)
