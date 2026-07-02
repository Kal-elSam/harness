# Loop Engineering Skill

Use this skill for bounded repair, validation and learning loops in Codex.

## Source of truth

- `AGENTS.md`
- `docs/ai/loops.md`
- `docs/ai/loop-policy.md`
- `docs/ai/loop-observability.md`

## Workflow

1. Identify loop type.
2. Define input and max attempts.
3. Execute one bounded iteration.
4. Validate with tests/evals.
5. Stop if max attempts or no progress.
6. Escalate high-impact issues.
7. Report final status.

## Rule

No autonomous loop without boundaries.
