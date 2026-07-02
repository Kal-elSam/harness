# Harness Installer — Universal Adapter Parity

Use this prompt when the project must support multiple agents/tools without lock-in.

## Goal

Ensure the project uses a universal core and adapter parity.

## Core

```txt
AGENTS.md
docs/ai/
docs/skills/
docs/specs/
evals/
```

## Adapters

```txt
.opencode/
.cursor/
.codex/
.claude/
.github/
.gemini/
.pi/
.gentle-ai/
```

## Rules

```txt
No adapter is primary by authority.
An adapter can be primary only by workflow preference.
The core universal remains governance-primary.
```

## Required output

Create or update:

```txt
docs/ai/adapter-parity.md
docs/ai/governance.md
docs/skills/adapter-parity-review.md
```

Then verify:

- OpenCode supports SDD/TDD/evals/loops/checkpoint.
- Cursor supports SDD/TDD/evals/loops/checkpoint.
- Codex supports SDD/TDD/evals/loops/checkpoint.
- Claude supports SDD/TDD/evals/loops/checkpoint.
- Pi/Gemini/Copilot have at least pointer or prompt support.
