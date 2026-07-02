# Spec Escalation Review

## When to use

Use when implementation reveals higher risk than expected.

## Triggers

- More files touched than expected
- Architecture decision needed
- API contract changed
- Database/auth/security/AI behavior touched
- Tests/evals are more complex than expected
- Rollback is no longer trivial

## Procedure

1. Stop implementation.
2. Compare current work to original spec level.
3. Identify new risks.
4. Recommend upgrade or continue.
5. If upgraded, update spec before more implementation.

## Output

```txt
Original level:
Current risk:
Escalation needed:
New level:
Reason:
Required spec updates:
Next action:
```
