# Governance

## Objetivo

Definir quién manda dentro del sistema agéntico.

## Orden de autoridad

```txt
1. Instrucción explícita del usuario en la tarea actual
2. AGENTS.md
3. docs/ai/
4. docs/skills/
5. docs/specs/
6. evals/
7. adapter files
8. model/provider preferences
9. previous model outputs
```

## Principio

```txt
The repo governs.
Adapters translate.
Models execute.
Humans approve impact.
```

## Ningún adapter gobierna

No gobiernan:

- `.opencode/`
- `.cursor/`
- `.codex/`
- `.claude/`
- `.pi/`
- `.github/`
- `.gentle-ai/`

Todos deben apuntar al core universal.

## Decisiones de alto impacto

Requieren humano:

- cambios de arquitectura
- auth
- pagos
- datos persistentes
- migraciones destructivas
- seguridad
- infraestructura
- comportamiento IA productivo
- cambios de costo significativo
- automatizaciones autónomas

## Escalación

Si un modelo o adapter intenta aprobar impacto crítico, detener y reportar.
