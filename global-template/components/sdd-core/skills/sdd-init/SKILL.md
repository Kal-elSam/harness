---
name: sdd-init
description: "Classify the request and open the right SDD path."
---

# SDD Init

Use this skill at the start of non-trivial work to classify the request before planning or implementation.

## Source of truth

- `AGENTS.md`
- `docs/ai/harness.md`
- `docs/ai/spec-driven-development.md`
- `docs/ai/spec-sizing.md`

## Workflow

1. Read the current user request and repository constraints.
2. Classify the work as `basic`, `standard`, or `complex`.
3. State the main risk, the expected validation, and whether a spec is required.
4. Route to `sdd-explore`, `sdd-propose`, or `sdd-spec` as the next skill.

## Output

```txt
Classification:
Why:
Primary risk:
Validation:
Next skill:
```
