---
name: sdd-tasks
description: "Break an accepted design into ordered, reviewable tasks."
---

# SDD Tasks

Use this skill after design to produce a task list that one reviewer can follow without reopening scope.

## References
- [Phase contract](references/contract.md)
## Source of truth

- `AGENTS.md`
- `docs/ai/harness.md`
- `docs/ai/spec-driven-development.md`
- `docs/ai/testing.md`

## Workflow

1. Split the design into independent, reviewable units.
2. Order tasks by dependency and risk.
3. Attach acceptance and validation to each task.
4. Keep persona and SDD contracts out of the task bodies.

## Output

```txt
Task order:
Dependencies:
Acceptance per task:
Validation per task:
Next skill:
```
