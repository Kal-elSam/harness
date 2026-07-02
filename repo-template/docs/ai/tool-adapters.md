# Tool Adapters

## Objetivo

Definir cómo cada herramienta consume el core harness sin duplicar reglas.

## Constitución común

Todo adapter — Cursor, Codex, Claude, Gemini, GitHub Copilot, OpenCode, Gentle AI, Pi — lee `AGENTS.md` primero, antes de cualquier archivo específico del adapter.

```txt
AGENTS.md is the constitution.
Adapter files are translations, never replacements.
If an adapter file and AGENTS.md disagree, AGENTS.md wins.
```

Ningún adapter puede:

- Declarar una regla que no exista en `AGENTS.md` o `docs/ai/` como si fuera gobernanza propia.
- Saltarse SDD, TDD, evals o aprobación humana porque su formato nativo no lo soporta bien.
- Tratar su propia sintaxis, rules, skills o prompts, como más autoritativa que el core.

## Core universal

La fuente principal siempre es:

```txt
AGENTS.md
docs/ai/
docs/skills/
docs/specs/
evals/
```

## Cursor adapter

Rutas:

```txt
.cursor/rules/
.cursor/commands/
.cursor/agents/
.cursor/skills/
```

Uso:

- reglas persistentes
- comandos de workflow
- subagentes especializados
- skills nativas de Cursor

No debe contradecir `AGENTS.md`.

## Codex adapter

Rutas:

```txt
AGENTS.md
.codex/skills/
```

Uso:

- Codex App
- Codex CLI
- skills reutilizables para SDD/TDD/evals/checkpoint

Codex debe leer `AGENTS.md` como fuente universal.

## Claude adapter

Rutas:

```txt
CLAUDE.md
.claude/agents/
.claude/skills/
.claude/commands/
```

Uso:

- subagentes de arquitectura/review/debugging
- skills de workflow
- comandos reutilizables

`CLAUDE.md` debe ser puntero delgado salvo necesidad explícita.

## Gemini adapter

Rutas:

```txt
GEMINI.md
.gemini/
```

Uso:

- puntero delgado a `AGENTS.md`
- comandos o contexto específico si la herramienta lo requiere

## GitHub Copilot adapter

Rutas:

```txt
.github/copilot-instructions.md
.github/instructions/
```

Uso:

- instrucciones compactas
- no duplicar reglas largas
- apuntar al core

## Gentle AI adapter

Gentle AI usa el core como fuente de verdad y puede ejecutar:

```bash
/sdd-init
gentle-ai skill-registry refresh
gentle-ai doctor
```

Debe alinearse con:

```txt
docs/ai/spec-driven-development.md
docs/ai/test-driven-development.md
docs/ai/evals.md
docs/skills/
```

## Engram / Graphify adapter

- Engram indexa memoria y decisiones.
- Graphify indexa grafo contextual.
- Ninguno reemplaza el repo.
- Si hay contradicción, gana el repo.

## OpenCode adapter

Rutas:

```txt
.opencode/
.opencode/agents/
.opencode/loops/
opencode.json.sample
```

Uso:

- runtime principal CLI
- ejecución con Gentle AI + DeepSeek
- agentes por proyecto
- loops acotados
- plan/build separation
- escalación por permisos y límites de pasos

Reglas:

- OpenCode ejecuta, pero `AGENTS.md` gobierna.
- `Plan` debe preferirse para análisis sin cambios.
- `Build` puede implementar con permisos controlados.
- Subagentes se invocan con `@agent-name`.
- Loops deben respetar `docs/ai/loop-policy.md`.

## Adapter parity rule

No adapter is primary by authority.

```txt
OpenCode can be primary by workflow preference.
Cursor can be primary by IDE preference.
Codex can be primary by task execution.
Claude can be primary by reasoning task.
But AGENTS.md remains governance-primary.
```

Read `docs/ai/adapter-parity.md` before adding or changing adapters.
