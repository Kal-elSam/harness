# Context Budget

## Objetivo

Evitar que los agentes carguen documentación innecesaria.

## Siempre leer

```txt
AGENTS.md
docs/ai/harness.md
```

## Leer por tarea

| Tarea | Documentos |
|---|---|
| UI | `docs/ai/ui.md`, `docs/skills/ui-design.md` |
| API | `docs/ai/api.md`, `docs/skills/api-design.md` |
| DB | `docs/ai/data.md` si existe |
| Testing | `docs/ai/testing.md`, `docs/ai/test-driven-development.md` |
| IA/Evals | `docs/ai/evals.md`, `docs/skills/evals.md` |
| Arquitectura | `docs/ai/architecture.md`, `docs/skills/architecture.md` |
| Git/checkpoint | `docs/ai/git-workflow.md`, `docs/skills/git-workflow.md` |
| Session handoff | `docs/ai/session-handoff.md` |
| Memoria | `docs/ai/memory.md` |
| Graph | `docs/ai/context-graph.md`, `docs/skills/context-graph.md` |
| Model selection | `docs/ai/model-policy.md`, `docs/ai/provider-routing.md` |
| Tool adapter | `docs/ai/tool-adapters.md` |

## Reglas

- No leer todo si el cambio es trivial.
- No cargar specs no relacionadas.
- No cargar archivos grandes sin necesidad.
- Reportar qué contexto fue usado.
- Si falta contexto, pedir solo lo mínimo.
- En modo plan (cualquier modelo): AGENTS.md + el docs/ai relevante, máximo 10 archivos, sin auditoría general. Si falta contexto, máximo 3 preguntas.
- Cerca del 60% de la ventana, al cambiar de tarea o antes de compactar, escribir `handoff.md` según `docs/ai/session-handoff.md`. No pegar la conversación anterior.

## Adapter parity context rule

Every adapter should use the same context budget.

Adapters may load context differently, but should follow:

```txt
Always:
- AGENTS.md
- relevant docs/ai file

Only when needed:
- docs/skills
- docs/specs
- evals
- adapter-specific instructions
```
