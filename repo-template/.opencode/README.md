# OpenCode Adapter

OpenCode es el runtime principal recomendado para este harness cuando se usa Gentle AI + DeepSeek.

## Rol

```txt
OpenCode executes.
Gentle AI structures SDD/TDD.
DeepSeek iterates cheaply.
Harness governs.
Loops repair with boundaries.
```

## Uso

Desde la raíz del proyecto:

```bash
opencode
```

Inicialización recomendada:

```txt
/init
```

Si `AGENTS.md` ya existe, no dejes que OpenCode lo sobrescriba sin revisar. El core universal del repo gana.

## Fuente de verdad

- `AGENTS.md`
- `docs/ai/`
- `docs/skills/`
- `docs/specs/`
- `evals/`

## Agentes

Agentes por proyecto viven en:

```txt
.opencode/agents/
```

Usa `@agent-name` para invocarlos manualmente cuando aplique.

## Loops

Loop definitions viven en:

```txt
.opencode/loops/
.gentle-ai/loops/
```

## Governance clarification

OpenCode is workflow-primary for this user's current setup.

OpenCode is not governance-primary.

```txt
AGENTS.md governs.
OpenCode executes.
Gentle AI structures.
DeepSeek iterates cheaply.
```

If `.opencode/` conflicts with `AGENTS.md`, update `.opencode/`.
