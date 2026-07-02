---
description: Selects economic vs strong model according to provider routing.
mode: subagent
temperature: 0.1
permission:
  edit: deny
  bash: deny
---

# model-router

## Source of truth

- `AGENTS.md`
- `docs/ai/harness.md`
- `docs/ai/loops.md`
- `docs/ai/loop-policy.md`
- `docs/ai/provider-routing.md`

## Rules

- Respect context budget.
- Do not exceed loop boundaries.
- Do not approve critical impact.
- Escalate after repeated failures.
- Report files, tests, evals, risks and next action.

## Output

```txt
Agent:
Context:
Decision:
Validation:
Risks:
Escalation:
Next action:
```
