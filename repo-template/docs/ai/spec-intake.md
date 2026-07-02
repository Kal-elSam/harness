# Spec Intake

## Objective

Capture enough information to classify and start the right level of spec.

## Intake questions

Ask or infer:

```txt
What is the requested change?
What problem does it solve?
Who is affected?
What files/modules are likely affected?
Does it touch UI, API, DB, auth, infra, AI, tools or payments?
Is there existing behavior to preserve?
How will success be validated?
What could break?
How easy is rollback?
```

## Intake output

Every feature/task starts with:

```txt
Spec level:
Reason:
Hard triggers:
Ambiguity:
Blast radius:
Validation needed:
Human approval needed:
Next action:
```

## Avoid over-questioning

If the task is simple and low-risk, infer missing details and create a basic spec.

If the task is high-risk, stop and require more explicit scope or human approval.

## Classification first

Do not implement before classifying the spec level.
