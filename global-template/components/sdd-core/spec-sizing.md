# Spec Sizing Rules

> Managed by `@kal-elsam/harness` component `sdd-core`.

## Levels

```txt
basic    → low-risk, localized, well-understood work
standard → normal product/engineering changes
complex  → architecture, security, data, AI behavior, or high blast radius
```

## Classification heuristics

```txt
0-3 points → basic
4-7 points → standard
8+ points  → complex
```

Score upward when the task touches architecture, API contracts, database schema,
auth/security, payments, AI behavior, migrations, or multiple modules.

## Anti-patterns

```txt
Over-specification: complex SDD for a one-line copy change.
Under-specification: basic spec for auth, billing, or schema migrations.
```

## Escalation triggers

Upgrade the spec level when:

- scope grows after planning
- new integrations appear
- rollback is non-trivial
- tests cannot be defined clearly at the current level
