---
name: sdd-explore
description: "Gather focused repository context before proposing a spec."
---

# SDD Explore

Use this skill to collect only the context needed to define scope, constraints, and affected files.

## References
- [Phase contract](references/contract.md)
## Source of truth

- `AGENTS.md`
- `docs/ai/context-budget.md`
- `docs/ai/architecture.md`
- `docs/ai/spec-driven-development.md`

## Workflow

1. Read the minimum relevant code and docs.
2. Identify affected modules, contracts, and existing tests.
3. Capture unknowns, dependencies, and rollout or rollback constraints.
4. Stop exploration once the next decision is clear.

## Output

```txt
Context read:
Files analyzed:
Existing contract:
Unknowns:
Next skill:
```
