# Quality Gates

## Gates mínimos

| Gate | Required | Bloqueante |
|---|---:|---:|
| format check | yes | yes |
| lint | yes | yes |
| typecheck | yes | yes |
| unit tests | yes | yes |
| integration tests | when applicable | yes |
| E2E smoke | when UI/API critical | yes |
| AI evals | when AI behavior changes | yes |
| build | yes | yes |
| dependency review | yes | yes |
| secret scan | yes | yes |
| license policy | yes | yes |
| architecture review | high-impact | yes |
| human approval | critical impact | yes |

## Definition of Done

Un cambio está listo solo si:

- cumple el spec
- no expande scope silenciosamente
- incluye pruebas o evals relevantes
- pasa quality gates
- documenta tradeoffs relevantes
- actualiza ADRs si cambia arquitectura
- no introduce dependencias inseguras o no aprobadas
- tiene rollback path si toca producción

## Reglas

```txt
Every fixed bug must add or update a regression test.
Every AI behavior change must add or update evals.
Every architecture-changing decision must add or update an ADR.
```

## Spec-level quality gates

| Spec level | Required gates |
|---|---|
| basic | lint/typecheck/relevant test or manual check |
| standard | lint/typecheck/unit/integration/build/checkpoint |
| complex | all standard gates + ADR/security/evals/rollback/human approval when applicable |
