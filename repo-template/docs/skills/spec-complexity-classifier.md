# Spec Complexity Classifier

## When to use

Use before creating or implementing a spec.

## Source of truth

- `docs/ai/spec-sizing.md`
- `docs/ai/spec-intake.md`
- `docs/ai/spec-escalation.md`

## Procedure

1. Summarize the requested change.
2. Score the task using the complexity scoring table.
3. Check hard triggers.
4. Choose basic, standard or complex.
5. Explain why.
6. Select the right spec template.
7. Identify validation requirements.
8. Identify approval requirements.

## Output

```txt
Requested change:
Score:
Hard triggers:
Recommended spec level:
Reason:
Template:
Validation required:
Approval required:
Next action:
```

## Rule

Use the smallest safe spec.
Escalate immediately when risk increases.
