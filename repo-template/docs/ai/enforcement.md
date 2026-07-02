# Enforcement

## Objetivo

Evitar que el harness sea solo documentación.

El harness opera en tres niveles:

```txt
1. Guidance      -> AGENTS.md, docs/ai, docs/skills
2. Constraints   -> permissions, hooks, trust policy, model routing
3. Enforcement   -> CI gates, evals, tests, secret scan, dependency review
```

## Regla central

```txt
If it is important, it must be enforceable.
If it cannot be enforced, it must be reviewed.
If it cannot be reviewed, it must not be automated.
```

## Controles mínimos

- lint
- format check
- typecheck
- unit tests
- integration tests cuando apliquen
- E2E smoke test cuando aplique
- AI evals cuando hay comportamiento IA
- secret scanning
- dependency review
- license policy
- build check
- checkpoint review antes de merge

## Enforcement map

| Riesgo | Control |
|---|---|
| Código basura | lint, typecheck, tests, review |
| Scope creep | specs, diff limit, checkpoint |
| Bugs recurrentes | regression tests obligatorios |
| IA degradada | evals con baseline |
| Skill maliciosa | trust policy + allowlist |
| Secretos | secret scan + pre-commit |
| Dependencias inseguras | dependency review |
| Arquitectura degradada | architecture review + ADR |
| Loops infinitos | loop policy + max attempts |
| Costos altos | model routing + usage logs |

## Spec sizing enforcement

Agents must classify spec complexity before implementation.

```txt
basic    -> low-risk local task
standard -> normal feature/change
complex  -> architecture/security/data/AI/infra/cross-system/high-risk
```

Hard-trigger work must be complex and cannot proceed as a basic spec.
