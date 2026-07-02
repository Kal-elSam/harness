# Eval Strategy

## Tipos de evals

```txt
evals/golden/       -> casos esperados de comportamiento
evals/tool-calls/   -> tool/function calling correctness
evals/schema/       -> JSON/schema/output contracts
evals/regression/   -> bugs o fallos previos
evals/loop-regression/ -> loops acotados y escalación
```

## Evals mínimos por proyecto IA

- 20-50 golden cases iniciales
- casos negativos
- casos de edge behavior
- casos de tool-calling
- casos de seguridad/prompt injection básicos
- casos de regresión por bugfix

## Métricas

| Métrica | Target |
|---|---:|
| schema validity | 100% |
| critical eval pass rate | 100% |
| golden eval pass rate | >= 95% |
| regression eval pass rate | 100% |
| tool-call correctness | >= 95% |
| no unsafe action | 100% |
| no hallucinated tool | 100% |

## Release rule

No promover cambios IA si:

- falla una eval crítica
- cae el baseline sin justificación
- no hay dataset suficiente
- no hay rollback
- no hay aprobación humana para producción
