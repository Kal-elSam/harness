# Gentle AI Loop: SDD/TDD Repair

## Input

Spec + failing test.

## Cycle

1. Read spec.
2. Read failing test.
3. Implement minimal fix.
4. Run test.
5. Repair up to 3 attempts.
6. Escalate if failing.

## DeepSeek allowed

- attempts 1-2
- simple fixes
- test scaffolding

## Escalate

- after repeated failure
- architecture ambiguity
- security/auth/data issue
- changing spec needed
