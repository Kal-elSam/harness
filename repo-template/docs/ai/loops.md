# Loop Engineering

## Objetivo

Definir ciclos controlados de trabajo agéntico para que el agente no dependa de prompts manuales en cada paso.

Loop Engineering no significa dejar que el agente itere sin control. Significa diseñar:

- estado inicial
- objetivo
- ciclo permitido
- herramientas permitidas
- intentos máximos
- presupuesto de costo/tokens
- señales de éxito
- señales de fallo
- escalación
- logs
- rollback
- aprendizaje documentado

## Relación con el harness

```txt
Harness Engineering = infraestructura de control
Loop Engineering    = ciclos de ejecución, reparación y aprendizaje dentro de esa infraestructura
```

## Modelo base

```txt
Plan → Execute → Observe → Evaluate → Repair → Learn → Repeat
```

## Loop de feature

```txt
Spec approved
→ select next task
→ write failing test
→ implement minimum change
→ run test
→ repair if needed
→ run validation
→ review
→ checkpoint
```

## Loop de bug

```txt
Bug report
→ reproduce
→ isolate cause
→ write regression test
→ fix
→ run test
→ repair if needed
→ run full validation
→ document root cause
```

## Loop de IA

```txt
Failed conversation/eval
→ classify failure
→ identify prompt/tool/context issue
→ propose minimal change
→ run evals
→ compare baseline
→ accept/revert
→ document learning
```

## Loop de documentación

```txt
Architecture/spec/code change
→ detect stale docs
→ update docs
→ check contradictions
→ update decision log
→ checkpoint
```

## Regla central

```txt
No autonomous loop without boundaries.
No repair loop without max attempts.
No learning loop without evals.
No production loop without observability.
No critical loop without human approval.
```
