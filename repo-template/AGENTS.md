# AGENTS.md

> Fuente universal para agentes de IA trabajando en este proyecto.

## Proyecto

- **Nombre:** [PROJECT_NAME]
- **Propósito:** [PROJECT_PURPOSE]
- **Stack:** [STACK]
- **Package manager:** [PACKAGE_MANAGER]
- **Arquitectura detectada:** [ARCHITECTURE_PATTERN]

## Primera ley

La fuente de verdad siempre gana sobre el instinto, la memoria externa o la conveniencia del adapter.

Antes de escribir código:

1. Leer este archivo.
2. Leer el documento relevante en `docs/ai/` (ver `docs/ai/context-budget.md`).
3. Seguir `docs/ai/harness.md`.
4. Usar SDD para cambios significativos (`docs/ai/spec-driven-development.md`).
5. Usar TDD para cambios de comportamiento (`docs/ai/test-driven-development.md`).
6. Usar evals para comportamiento IA (`docs/ai/evals.md`).
7. Si falta documentación, crearla o actualizarla antes de implementar.

## Context budget

No leas toda la documentación por defecto.

Siempre leer:

```txt
AGENTS.md
docs/ai/harness.md
```

Lectura por tarea: `docs/ai/context-budget.md`

## Harness obligatorio

Todo cambio no trivial sigue:

```txt
Requirement → Spec → Plan → Tests failing first → Implementation → Validation → Review → Human approval
```

Detalle: `docs/ai/harness.md`

## Comandos

```bash
# Install
[INSTALL_COMMAND]

# Dev
[DEV_COMMAND]

# Lint
[LINT_COMMAND]

# Format
[FORMAT_COMMAND]

# Type check
[TYPE_CHECK_COMMAND]

# Test
[TEST_COMMAND]

# Build
[BUILD_COMMAND]
```

## Pipeline pre-commit

Seguir `docs/ai/git-workflow.md`. No commitear si el pipeline falla.

## Límites absolutos

- No instalar dependencias sin confirmación explícita.
- No modificar `.env`, CI/CD, infra o deploy sin avisar.
- No borrar tests sin justificación.
- No crear patrones nuevos sin documentarlos.
- No mezclar lógica de negocio con UI.
- No hacer llamadas directas desde UI a servicios externos si existe capa de abstracción.
- No declarar éxito parcial como éxito total.

## Engram / Graphify

- Engram indexa memoria y decisiones (`docs/ai/memory.md`).
- Graphify mapea arquitectura y riesgos (`docs/ai/context-graph.md`).
- Si memoria o grafo contradice el repo, el repo gana.
- Decisiones importantes en `docs/ai/decision-log.md` o ADR.

## Universal-first adapters

Este repo no depende de una sola herramienta.

```txt
Core:     AGENTS.md, docs/ai/, docs/skills/, docs/specs/, evals/
Adapters: .cursor/, .codex/, .claude/, .github/, .gemini/, .gentle-ai/, .opencode/, .pi/, CLAUDE.md, GEMINI.md
```

Todo adapter lee `AGENTS.md` primero, como constitución común, antes de cualquier archivo propio. Si un adapter contradice `AGENTS.md`, gana `AGENTS.md`.

Leer: `docs/ai/tool-adapters.md`, `docs/ai/adapter-parity.md`, `docs/ai/governance.md`

Si los adapters discrepan:

```txt
Current user instruction → AGENTS.md → docs/ai/ → docs/skills/ → adapter file → model output
```

## Temas avanzados

Leer solo cuando aplique:

| Tema | Documentos |
|---|---|
| Model routing | `docs/ai/model-policy.md`, `docs/ai/provider-routing.md` |
| Loop engineering | `docs/ai/loops.md`, `docs/ai/loop-policy.md`, `docs/ai/loop-observability.md` |
| Enforcement | `docs/ai/enforcement.md`, `docs/ai/quality-gates.md`, `docs/ai/trust-policy.md`, `docs/ai/eval-strategy.md`, `docs/ai/maintainability-gates.md` |
| Spec sizing | `docs/ai/spec-sizing.md`, `docs/ai/spec-intake.md`, `docs/ai/spec-escalation.md` |
| Gentle AI / OpenCode | `docs/ai/tool-adapters.md` |

Reglas de loops (resumen):

```txt
No autonomous loop without boundaries.
No repair loop without max attempts.
No learning loop without evals.
No production loop without observability.
No critical loop without human approval.
```

Reglas de enforcement (resumen):

```txt
If it is important, it must be enforceable.
If it cannot be enforced, it must be reviewed.
If it cannot be reviewed, it must not be automated.
```

## Fuente de verdad

| Archivo | Propósito |
|---|---|
| `AGENTS.md` | Constitución universal |
| `docs/ai/harness.md` | Flujo agéntico |
| `docs/ai/architecture.md` | Arquitectura |
| `docs/ai/conventions.md` | Convenciones |
| `docs/ai/testing.md` | Testing |
| `docs/ai/evals.md` | AI evals |
| `docs/ai/spec-driven-development.md` | SDD |
| `docs/ai/test-driven-development.md` | TDD |
| `docs/ai/agent-workflow.md` | Roles y handoffs |
| `docs/ai/memory.md` | Engram |
| `docs/ai/context-graph.md` | Graphify |
| `docs/skills/` | Procedimientos operativos |
| `docs/specs/` | Specs vivas |

## Regla final

El agente puede proponer, implementar y validar, pero la decisión de impacto arquitectónico pertenece al humano.
