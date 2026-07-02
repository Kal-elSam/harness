# Agentic Engineering Harness

## Objetivo

Controlar la ejecución de agentes para que todo cambio sea especificado, probado, validado y revisable.

## Modelo operativo

```txt
Input → Spec → Plan → Tests/Evals → Implementation → Validation → Review → Report
```

## Estados

| Estado | Descripción | Salida esperada |
|---|---|---|
| INTAKE | Entender petición | Resumen de objetivo |
| SPEC | Crear/actualizar spec | `.spec.md` |
| PLAN | Diseñar pasos técnicos | Plan ejecutable |
| TEST_FIRST | Crear tests/evals fallidos | Falla por razón correcta |
| IMPLEMENT | Cambiar código | Diff limitado |
| VALIDATE | Ejecutar pipeline | Lint/type/test/build/evals |
| REVIEW | Revisión técnica | Issues clasificados |
| APPROVAL | Esperar humano | Aprobado/cambios |
| CHECKPOINT | Cierre | Resumen/commit propuesto |

## Reglas de transición

- No pasar de SPEC a IMPLEMENT sin plan.
- No pasar de PLAN a IMPLEMENT en bugs sin regression test.
- No pasar a CHECKPOINT si falla el pipeline.
- Si falla validación, regresar a IMPLEMENT con evidencia.
- Si hay cambio arquitectónico, activar Architect.
- Si hay bug, activar Debugger.
- Si falta cobertura, activar Test Engineer.
- Si hay IA, activar Eval Engineer.

## Límites

El agente debe reportar antes de:

- instalar dependencias
- modificar CI/CD
- modificar infraestructura
- tocar `.env`
- cambiar arquitectura
- eliminar archivos
- borrar tests
- modificar datos persistentes
