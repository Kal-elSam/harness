# Adapter Parity

## Objetivo

Garantizar que el harness no dependa de una sola herramienta.

OpenCode, Cursor, Codex, Claude, Gemini, Pi y otros agentes deben poder operar sobre el mismo core universal.

## Regla principal

```txt
No adapter is primary by authority.
An adapter can be primary only by workflow preference.
The core universal remains the governance layer.
```

## Core universal

La fuente real siempre es:

```txt
AGENTS.md
docs/ai/
docs/skills/
docs/specs/
evals/
```

## Adapters

| Adapter | Rol | Autoridad |
|---|---|---|
| OpenCode | Runtime CLI, Gentle AI + DeepSeek, loops | No superior |
| Cursor | IDE, edición interactiva, rules, commands, subagents | No superior |
| Codex | Ejecución puntual, specs, tests, reviews, skills | No superior |
| Claude | Reasoning fuerte, arquitectura, review, debugging complejo | No superior |
| Gemini | Alternativa de reasoning/modelo | No superior |
| Pi | CLI alternativo/harness experimental | No superior |
| GitHub Copilot | Asistencia IDE/PR | No superior |

## Capability parity matrix

| Capability | OpenCode | Cursor | Codex | Claude | Pi |
|---|---|---|---|---|---|
| Leer core universal | `AGENTS.md` | `AGENTS.md` | `AGENTS.md` | `CLAUDE.md` pointer | `AGENTS.md` |
| SDD | `.opencode/agents`, loops | `.cursor/commands`, subagents | `.codex/skills/sdd` | `.claude/skills/sdd` | `.pi/prompts/sdd-*` |
| TDD | agents/loops | commands/rules | `.codex/skills/tdd` | `.claude/skills/tdd` | `.pi/skills/tdd` |
| Evals | agents/loops | commands/rules | `.codex/skills/evals` | `.claude/skills/evals` | `.pi/skills/evals` |
| Loop Engineering | `.opencode/loops` | `loop-*` commands | loop skill/prompt | loop skill/agent | prompt templates |
| Checkpoint | checkpoint agent | `/checkpoint` | checkpoint skill | checkpoint skill | `/checkpoint` |
| Model routing | model-router agent | docs/rules | skill/prompt | skill/prompt | model-routing skill |
| Review | checkpoint/reviewer | `/review` | review prompt/skill | reviewer agent | `/review` |
| Human approval | policy | policy | policy | policy | policy |

## Adapter responsibilities

Each adapter must:

1. Read the universal core.
2. Avoid duplicating long instructions.
3. Avoid contradicting `AGENTS.md`.
4. Support SDD/TDD/evals/checkpoint in its native way.
5. Report limitations when it cannot support a capability.
6. Escalate high-impact decisions.

## When an adapter cannot implement a capability

Use this fallback order:

```txt
1. Use AGENTS.md instruction directly.
2. Use docs/skills/ procedure.
3. Use natural-language prompt.
4. Use another adapter.
5. Ask human for approval.
```

## OpenCode positioning

OpenCode may be the user's primary execution runtime.

That means:

```txt
OpenCode is workflow-primary.
OpenCode is not governance-primary.
```

## Cursor positioning

Cursor may be the user's primary IDE.

That means:

```txt
Cursor is IDE-primary.
Cursor is not governance-primary.
```

## Codex positioning

Codex may be used for focused implementation, reviews and remote/CLI tasks.

That means:

```txt
Codex is execution/review-capable.
Codex is not governance-primary.
```

## Claude positioning

Claude may be used for strong reasoning.

That means:

```txt
Claude is reasoning/review-strong.
Claude is not governance-primary.
```

## Final rule

If adapters disagree, do not choose the most convenient adapter.

Apply precedence:

```txt
Current user instruction
→ AGENTS.md
→ docs/ai/
→ docs/skills/
→ adapter file
→ model output
```
