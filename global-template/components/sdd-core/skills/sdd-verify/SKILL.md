---
name: sdd-verify
description: "Validate applied work against acceptance and pipeline gates."
---

# SDD Verify

Use this skill after implementation to prove the task is done with evidence, not claims.

## References
- [Phase contract](references/contract.md)
## Source of truth

- `AGENTS.md`
- `docs/ai/harness.md`
- `docs/ai/quality-gates.md`
- `docs/ai/testing.md`

## Workflow

1. Re-read acceptance criteria for the completed task.
2. Run the relevant lint, type, test, and smoke checks.
3. Record failures, skips, and residual risk honestly.
4. Hand off to archive only when the evidence is complete.

## Output

```txt
Acceptance checked:
Commands run:
Results:
Residual risk:
Next skill:
```
