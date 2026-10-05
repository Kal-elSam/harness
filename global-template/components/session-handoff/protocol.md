# Session handoff

El contexto largo degrada la precisión de forma gradual. No hay un corte universal al 60%. El porcentaje es un presupuesto de calidad: importa más el ruido y el conflicto del historial que la cifra exacta.

## Presupuesto

- **0–50%:** planear, explorar y cambios complejos.
- **50–70%:** cerrar la unidad de trabajo y escribir el handoff.
- **Por encima de 70%:** no tomar decisiones de arquitectura ni refactors grandes. Compactar o abrir una sesión nueva.

Señales para traspasar aunque el porcentaje sea menor:

- el agente ignora una restricción ya dicha
- el historial se contradice
- hay volcados largos de herramientas
- la tarea cambió

## Qué hacer

1. Misma tarea y presupuesto holgado: seguir en la sesión actual.
2. Al entrar en 50–70%, al cambiar de tarea, o antes de compactar: escribir `handoff.md` en la raíz del repo.
3. La sesión nueva arranca con el objetivo, `handoff.md`, los archivos relevantes y `git status` / `git diff`. No pegar la conversación anterior.
4. Las decisiones durables van a un ADR, `README`, un issue o `docs/ai/decision-log.md`. La conversación no es la base de conocimiento del proyecto.
5. El resumen automático no sustituye este archivo. Puede omitir decisiones, restricciones o bugs pendientes.

## Plantilla de `handoff.md`

```md
# Session handoff

## Objective

## Current state
- Implemented:
- In progress:
- Not started:

## Decisions and constraints
- ...
- Do not change ...

## Files / entry points
- src/...
- tests/...

## Validation
- Commands run:
- Results:

## Next exact step
```

## Medición

`kairo context` lee el llenado de la ventana en las sesiones del home (Codex, Claude, OpenCode). No mira el repo y sirve para cualquier proyecto (`--cwd`).

## Reglas de escritura

- Conciso. Hechos verificables, no el transcript.
- Una sola fuente vigente: `handoff.md` en la raíz. El historial queda en git.
- Si el repo tiene `docs/ai/session-handoff.md`, seguir ese documento. Debe coincidir con este protocolo.
