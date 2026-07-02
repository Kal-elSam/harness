# Loop Observability

## Objetivo

Registrar la ejecución de loops para auditar costo, calidad, fallos, escalación y aprendizaje.

## Eventos mínimos

Cada loop debe registrar:

```txt
loop_id
loop_type
task/spec
model/provider
started_at
ended_at
iterations
files_changed
tests_run
evals_run
failures
repairs
escalations
final_status
```

## Métricas recomendadas

| Métrica | Uso |
|---|---|
| iterations_per_task | detectar loops costosos |
| repair_attempts | detectar fallos recurrentes |
| test_failures_by_type | priorizar deuda técnica |
| eval_regressions | detectar degradación IA |
| model_cost_estimate | controlar gasto |
| files_changed | detectar scope creep |
| escalation_rate | medir autonomía segura |
| rollback_rate | medir calidad del loop |

## Logs recomendados

```txt
docs/ai/loop-log.md
```

## Engram

Engram puede indexar resultados de loops, fallos recurrentes, decisiones, aprendizajes y cambios de prompts/evals.

## Graphify

Graphify puede mapear archivos tocados por loop, módulos afectados, dependencias impactadas y relación spec → code → tests → evals.

## Regla

La observabilidad del loop no reemplaza tests/evals. Solo ayuda a entender y mejorar el sistema.
