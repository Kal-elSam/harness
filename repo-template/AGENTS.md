# AGENTS.md

> Fuente universal para agentes de IA trabajando en este proyecto.

## Proyecto

- **Nombre:** [PROJECT_NAME]
- **Propósito:** [PROJECT_PURPOSE]
- **Stack:** [STACK]
- **Package manager:** [PACKAGE_MANAGER]
- **Arquitectura detectada:** [ARCHITECTURE_PATTERN]

## Primera ley

La fuente de verdad siempre gana sobre el instinto.

Antes de escribir código:

1. Leer este archivo.
2. Leer el documento relevante en `docs/ai/`.
3. Seguir el harness de `docs/ai/harness.md`.
4. Usar SDD para cambios significativos.
5. Usar TDD para cambios de comportamiento.
6. Usar evals para comportamiento IA.
7. Si falta documentación, crearla o actualizarla antes de implementar.

## Context budget

No leas toda la documentación por defecto.

Siempre leer:

```txt
AGENTS.md
docs/ai/harness.md
```

Leer según tarea:

```txt
UI → docs/ai/ui.md
API → docs/ai/api.md
DB → docs/ai/data.md
Tests → docs/ai/testing.md
Evals → docs/ai/evals.md
Arquitectura → docs/ai/architecture.md
Git → docs/ai/git-workflow.md
Memoria → docs/ai/memory.md
Context graph → docs/ai/context-graph.md
```

## Harness obligatorio

Todo cambio no trivial sigue:

```txt
Requirement
→ Spec
→ Plan
→ Tests failing first
→ Implementation
→ Validation
→ Review
→ Human approval
```

## SDD

Specs en:

```txt
docs/specs/<feature-name>.spec.md
```

Toda spec debe incluir objetivo, contexto, alcance, no-alcance, criterios de aceptación, diseño técnico, casos de error, estrategia de testing, riesgos y plan.

## TDD

Reglas:

- Bug fix → regression test que falla primero.
- Nueva función → unit test.
- Nuevo endpoint → integration test.
- Flujo UI → E2E test.
- Refactor → suite existente verde.
- Cambio IA → eval o prompt-regression test.

## AI evals

Para IA, agentes, RAG, tool calling o generación de contenido:

- Crear/actualizar evals.
- Probar tool-call correctness.
- Probar schema adherence.
- Probar safety.
- Probar prompt regression.
- Medir costo/latencia si aplica.

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

1. Revisar diff.
2. Verificar secrets, `.env`, tokens, `console.log`, `debugger`.
3. Ejecutar linter.
4. Ejecutar formatter.
5. Ejecutar typecheck.
6. Ejecutar tests.
7. Ejecutar build.
8. Proponer commit conventional.
9. Esperar aprobación humana antes de commitear.

## Límites absolutos

- No instalar dependencias sin confirmación explícita.
- No modificar `.env`, CI/CD, infra o deploy sin avisar.
- No borrar tests sin justificación.
- No crear patrones nuevos sin documentarlos.
- No mezclar lógica de negocio con UI.
- No hacer llamadas directas desde UI a servicios externos si existe capa de abstracción.
- No hacer commit si el pipeline falla.
- No declarar éxito parcial como éxito total.

## Gentle AI

Si Gentle AI está disponible:

```bash
/sdd-init
gentle-ai skill-registry refresh
gentle-ai doctor
```

Gentle AI puede orquestar SDD/TDD, pero la fuente de verdad del repo sigue siendo:

```txt
AGENTS.md
docs/ai/
docs/skills/
docs/specs/
```

## Engram / Graphify

- Engram puede indexar memoria, decisiones, specs y aprendizajes.
- Graphify puede mapear arquitectura, módulos, dependencias, entidades, herramientas y riesgos.
- Si memoria/grafo contradice el repo, el repo gana.
- Toda decisión importante debe quedar trazable en `docs/ai/decision-log.md` o ADR.

## Fuente de verdad

| Archivo | Propósito |
|---|---|
| `AGENTS.md` | Fuente universal |
| `docs/ai/architecture.md` | Arquitectura |
| `docs/ai/conventions.md` | Convenciones |
| `docs/ai/testing.md` | Testing |
| `docs/ai/evals.md` | AI evals |
| `docs/ai/harness.md` | Flujo agéntico |
| `docs/ai/spec-driven-development.md` | SDD |
| `docs/ai/test-driven-development.md` | TDD |
| `docs/ai/agent-workflow.md` | Roles y handoffs |
| `docs/skills/` | Procedimientos operativos |
| `docs/specs/` | Specs vivas |

## Regla final

El agente puede proponer, implementar y validar, pero la decisión de impacto arquitectónico pertenece al humano.

## Universal-first adapters

Este repo no depende de una sola herramienta.

Core universal:

```txt
AGENTS.md
docs/ai/
docs/skills/
docs/specs/
evals/
```

Adapters:

```txt
.cursor/
.codex/
.claude/
.github/
.gemini/
.gentle-ai/
CLAUDE.md
GEMINI.md
```

Los adapters no deben contradecir el core.

Todo adapter debe leer `AGENTS.md` primero, como constitución común, antes de cualquier archivo propio (`.cursor/`, `.codex/`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, etc.). Si un archivo de adapter contradice `AGENTS.md`, gana `AGENTS.md`.

## Model routing

Leer:

```txt
docs/ai/model-policy.md
docs/ai/provider-routing.md
```

Usar modelos económicos para tareas verificables y de bajo riesgo.  
Usar modelos fuertes para arquitectura, seguridad, debugging complejo, specs críticas y aceptación final.

## Loop Engineering

El repo soporta loops agénticos controlados.

Leer:

```txt
docs/ai/loops.md
docs/ai/loop-policy.md
docs/ai/loop-observability.md
```

Reglas:

```txt
No autonomous loop without boundaries.
No repair loop without max attempts.
No learning loop without evals.
No production loop without observability.
No critical loop without human approval.
```

## OpenCode primary adapter

Para este workflow, OpenCode puede ser el runtime principal:

```txt
OpenCode executes.
Gentle AI structures SDD/TDD.
DeepSeek iterates cheaply.
Harness governs.
Loops repair with boundaries.
```

OpenCode adapter:

```txt
.opencode/
.opencode/agents/
.opencode/loops/
opencode.json.sample
```

Gentle AI loops:

```txt
.gentle-ai/loops/
```

## Adapter Parity

No adapter is primary by authority.

```txt
OpenCode can be workflow-primary.
Cursor can be IDE-primary.
Codex can be execution/review-capable.
Claude can be reasoning/review-strong.
Pi can be CLI-optional.
AGENTS.md remains governance-primary.
```

Read:

```txt
docs/ai/adapter-parity.md
docs/ai/governance.md
docs/ai/tool-adapters.md
```

If adapters disagree:

```txt
Current user instruction
→ AGENTS.md
→ docs/ai/
→ docs/skills/
→ adapter file
→ model output
```

## Enforcement-first rules

The harness is not only documentation.

Read:

```txt
docs/ai/enforcement.md
docs/ai/quality-gates.md
docs/ai/trust-policy.md
docs/ai/eval-strategy.md
docs/ai/maintainability-gates.md
```

Rules:

```txt
If it is important, it must be enforceable.
If it cannot be enforced, it must be reviewed.
If it cannot be reviewed, it must not be automated.
```

Required before completion:

- relevant tests pass
- relevant evals pass
- quality gates pass
- no trust-policy violations
- maintainability risks reported
- human approval for critical impact

## Spec sizing

Before implementing non-trivial work, classify the required spec level.

Read:

```txt
docs/ai/spec-sizing.md
docs/ai/spec-intake.md
docs/ai/spec-escalation.md
```

Spec levels:

```txt
basic
standard
complex
```

Rule:

```txt
Start with the smallest safe spec.
Escalate when risk or ambiguity increases.
Never use a basic spec for critical work.
```
