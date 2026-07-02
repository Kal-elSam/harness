# Spec Escalation

## Objective

Define when to upgrade a spec level during work.

## Upgrade from basic to standard when

- more than 3 files are affected
- behavior is broader than expected
- tests require integration setup
- state management is touched
- API contract is touched
- ambiguity appears
- the agent needs to make design choices

## Upgrade from standard to complex when

- architecture boundaries are touched
- auth/security/privacy appears
- database migration appears
- production AI behavior appears
- a new vendor/tool/MCP appears
- rollback becomes hard
- multiple systems/services are affected
- failure modes are not obvious
- human approval becomes necessary

## Stop conditions

Stop implementation and escalate if:

```txt
The current spec level no longer matches risk.
The agent is making architecture decisions not captured in the spec.
The implementation requires changing the original scope.
The task touches hard-trigger areas.
```

## Downgrade

Downgrading requires explicit review.

Do not silently downgrade from complex to standard/basic.
