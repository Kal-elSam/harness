# Handoff Expectations

> Managed by `@kal-elsam/harness` component `sdd-core`.

Every agent handing off work must include:

```txt
context read
files analyzed
decision taken
risks
suggested next action
```

## Spec handoff

When handing off after spec work, also include:

```txt
spec level (basic | standard | complex)
spec path or summary
open questions
acceptance criteria
validation plan
```

## Implementation handoff

When handing off after implementation, also include:

```txt
tests run
pipeline status
remaining risks
rollback notes
```

Human approval is required for critical or architectural impact.
