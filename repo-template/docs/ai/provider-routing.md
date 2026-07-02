# Provider Routing

## Objetivo

Definir cómo enrutar tareas entre modelos/proveedores.

## Matriz de routing

| Tarea | Economic / DeepSeek | Strong / GPT-Claude-Gemini | Humano |
|---|---|---|---|
| Intake inicial | Sí | Opcional | No |
| Spec simple | Sí | Review opcional | No |
| Spec crítica | Borrador | Sí | Aprobación |
| Plan técnico simple | Sí | Opcional | No |
| Arquitectura | No | Sí | Aprobación |
| Task breakdown | Sí | Opcional | No |
| Tests simples | Sí | Opcional | No |
| Tests críticos | Borrador | Sí | No |
| Evals IA | Borrador | Sí | Aprobación si negocio |
| Scaffolding | Sí | Opcional | No |
| Refactor mecánico | Sí | Review | No |
| Debugging complejo | Hipótesis | Sí | Si riesgo |
| Security review | No | Sí | Sí si crítico |
| Checkpoint final | No | Sí | Sí |

## Gentle AI

Gentle AI puede usar modelos económicos para fases de bajo riesgo.

Recomendación:

```txt
DeepSeek:
- intake
- task breakdown
- scaffolding
- tests simples
- docs base

Modelo fuerte:
- spec review
- architecture
- eval strategy
- security review
- acceptance review
```

## Codex App / Codex CLI

Usar Codex para:

- ejecución puntual con `AGENTS.md`
- refactors acotados
- generación de tests
- revisión con skills
- checkpoints

Codex debe respetar `AGENTS.md` y skills en `.codex/skills/` cuando existan.

## Cursor

Usar Cursor para:

- edición interactiva
- navegación del repo
- subagentes por fase
- comandos de workflow
- integración rápida con reglas del editor

## Claude/Gemini

Usar para:

- razonamiento fuerte
- arquitectura
- review
- debugging complejo
- análisis de ambigüedad
- redacción/refinamiento de specs críticas

## Regla de costo

Preferir modelo económico cuando el output sea verificable con tests/evals.  
Preferir modelo fuerte cuando el output sea una decisión difícil de verificar automáticamente.

## OpenCode + Gentle AI + DeepSeek

Este es el execution path principal recomendado.

```txt
OpenCode session
→ Gentle AI SDD/TDD workflow
→ DeepSeek for low-risk iterations
→ Strong model/human for critical review
```

### DeepSeek dentro del loop

Permitido:

- intake
- task breakdown
- scaffolding
- tests simples
- repair attempts 1-2
- documentación base

Escalar después de:

- 2 intentos sin progreso
- scope creep
- fallo de arquitectura
- fallo de seguridad
- error de auth/pagos/DB/infra
- eval crítica fallida

## Provider routing is adapter-independent

Model routing must not depend on one tool.

The same model policy applies in:

```txt
OpenCode
Cursor
Codex
Claude
Gemini
Pi
```

Adapter-specific syntax may change, but routing policy does not.

```txt
Economic models = low-risk, verifiable execution.
Strong models = ambiguous, high-risk, architectural or security-sensitive work.
Human = impact approval.
```
