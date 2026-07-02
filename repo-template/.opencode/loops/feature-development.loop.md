# Loop: Feature Development

## Input

Approved spec in `docs/specs/`.

## Cycle

1. Select next task.
2. Write failing test.
3. Implement minimum change.
4. Run related test.
5. Repair up to 3 attempts.
6. Run lint/typecheck/build if configured.
7. Run evals if AI behavior changed.
8. Review diff.
9. Checkpoint.

## Exit criteria

- Tests pass.
- Evals pass if applicable.
- No critical review issues.
- No scope creep.
- Human approval if high impact.
