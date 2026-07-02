# Agentic Engineering Harness Pack

[![npm version](https://img.shields.io/npm/v/@kal-elsam/harness.svg)](https://www.npmjs.com/package/@kal-elsam/harness)

Paquete reutilizable para instalar un harness de ingeniería agéntica en proyectos nuevos o existentes.

- **npm:** https://www.npmjs.com/package/@kal-elsam/harness
- **repo:** https://github.com/Kal-elSam/harness

Nombre del paquete:

```txt
@kal-elsam/harness
```

## Instalación rápida

Sin instalar globalmente, desde cualquier proyecto:

```bash
npx @kal-elsam/harness init --mode enterprise
```

```bash
pnpm dlx @kal-elsam/harness init --mode enterprise
```

## Comandos CLI

Instalación global opcional:

```bash
npm i -g @kal-elsam/harness
```

| Comando | Descripción |
|---|---|
| `harness` | Principal — corto y directo |
| `agentic-harness` | Alias descriptivo |

```bash
harness init --mode enterprise
harness init --mode standard --dry-run
harness doctor
```

Alias legacy (compatibilidad): `sgs-harness`, `harness-sgs`

Para probar localmente desde este repo:

```bash
node ./bin/harness.js init --mode enterprise --dry-run
node ./bin/harness.js doctor
```

## Qué instala

El CLI copia y personaliza `repo-template/` en el proyecto destino:

```txt
AGENTS.md
docs/ai/
docs/skills/
docs/specs/
.codex/
.cursor/
.claude/
.github/
.gentle-ai/
.opencode/
evals/
scripts/harness/
```

Regla central:

```txt
AGENTS.md governs.
Adapters translate.
MCPs observe and preserve context.
Human approves impact.
```

Engram y Graphify se documentan como integraciones externas: ayudan con memoria y grafo contextual, pero no reemplazan al repo como fuente de verdad.

Diseñado para:

- Cursor-first, pero no Cursor-only.
- Gentle AI como referencia operativa para SDD/TDD.
- AGENTS.md como fuente universal.
- SDD, TDD, evals, checkpoints, review y aprobación humana.
- Engram/Graphify como sistemas externos de memoria, análisis o grafo contextual, sin acoplar el repo a una sola herramienta.

## Archivos principales

```txt
prompts/HARNESS_INSTALLER_MASTER.md
prompts/HARNESS_MINIMAL.md
prompts/HARNESS_STANDARD.md
prompts/HARNESS_ENTERPRISE.md
repo-template/
```

## Uso recomendado

Para instalar desde paquete:

```bash
pnpm dlx @kal-elsam/harness init --mode standard
pnpm dlx @kal-elsam/harness init --mode enterprise
pnpm dlx @kal-elsam/harness doctor
```

Para proyecto nuevo en Cursor sin usar el paquete npm (fallback manual):

1. Abre el proyecto.
2. Copia el contenido de `prompts/HARNESS_INSTALLER_MASTER.md`.
3. Pégalo en Cursor.
4. Indica el modo:

```txt
Instala el harness en modo standard.
```

O:

```txt
Instala el harness en modo enterprise porque este proyecto tendrá IA, API, DB e integraciones externas.
```

## Modos

| Modo | Uso |
|---|---|
| minimal | scripts, pruebas técnicas, landing pages, prototipos pequeños |
| standard | apps reales frontend/backend, SaaS simple, productos medianos |
| enterprise | Kairo, agentes IA, workflows críticos, API/DB/auth/evals, multiagente |

## Publicación

Publicado en npm como `@kal-elsam/harness`. La release se hace con **npm Trusted Publishing/OIDC** desde GitHub Actions — sin `NPM_TOKEN`.

Antes de taggear una nueva versión:

```bash
npm test
npm pack --dry-run
```

Flujo de release:

```bash
# actualizar version en package.json
git tag v0.2.0
git push origin v0.2.0
```

El workflow `publish.yml` corre en tags `v*` y publica a npm usando el environment `npm-publish`.

Ver política completa en `SECURITY.md`.

## Regla base

El agente no debe operar como programador libre.

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

## Integración con Gentle AI

Después de instalar el harness en un repo, ejecuta:

```bash
/sdd-init
gentle-ai skill-registry refresh
gentle-ai doctor
```

`/sdd-init` detecta stack y testing.  
`skill-registry refresh` actualiza el registro de skills.  
`doctor` revisa salud del ecosistema.

## Integración con Engram/Graphify

Este pack no asume una implementación específica. Define puntos de integración en:

```txt
docs/ai/context-graph.md
docs/ai/memory.md
docs/skills/context-graph.md
```

La regla es:

- El repo conserva la fuente de verdad en Markdown.
- Engram puede indexar decisiones, specs, memoria y convenciones.
- Graphify puede construir el grafo de arquitectura, módulos, dependencias, features y riesgos.
- Ninguna memoria externa reemplaza `AGENTS.md`, `docs/ai/` o el código.

## v2 — Universal-first, adapter-based

Esta versión agrega:

- `docs/ai/model-policy.md`
- `docs/ai/provider-routing.md`
- `docs/ai/tool-adapters.md`
- `docs/ai/context-budget.md`
- `docs/skills/model-selection.md`
- `docs/skills/tool-adapter-sync.md`
- Adapters para Codex, Claude, Gemini, GitHub Copilot, Cursor y Gentle AI
- Codex skills: SDD, TDD, evals, checkpoint
- Claude agents/skills pointers
- Gemini pointer
- Subagentes SDD por fase
- Política explícita para modelos económicos como DeepSeek

Principio v2:

```txt
Universal core first.
Tool adapters second.
Model providers third.
```

Cursor sigue siendo el editor principal, pero no es la fuente de verdad.

## v3 — Loop Engineering + OpenCode-first execution adapter

Esta versión agrega Loop Engineering como capa formal del harness y convierte OpenCode + Gentle AI + DeepSeek en el adapter principal de ejecución para este flujo.

```txt
OpenCode executes.
Gentle AI structures SDD/TDD.
DeepSeek iterates cheaply.
Harness governs.
Loops repair with boundaries.
Evals validate.
Graphify observes dependencies.
Engram preserves learning.
Human approves impact.
```

Nuevos módulos:

```txt
docs/ai/loops.md
docs/ai/loop-policy.md
docs/ai/loop-observability.md
docs/ai/loop-log.md
docs/skills/loop-design.md
docs/skills/loop-debugging.md
docs/skills/loop-review.md
docs/skills/loop-retrospective.md
.opencode/
.gentle-ai/loops/
evals/loop-regression/
```

## v4 — Universal Adapter Parity

Esta versión corrige la interpretación de que el harness está basado en OpenCode.

Regla v4:

```txt
AGENTS.md governs.
docs/ai defines.
docs/skills operationalize.
docs/specs specify.
evals validate.
Adapters translate.
Models execute.
Humans approve impact.
```

OpenCode puede ser el runtime preferido del usuario porque ahí vive Gentle AI + DeepSeek, pero no tiene autoridad superior sobre Cursor, Codex, Claude, Gemini o Pi.

Nuevo documento clave:

```txt
docs/ai/adapter-parity.md
```

Nueva regla:

```txt
No adapter is primary by authority.
An adapter can be primary only by workflow preference.
The core universal remains the governance layer.
```

## v5 — Enforcement-first Harness

Esta versión convierte el harness de metodología/documentación a una base más cercana a un control plane real.

```txt
Docs guide.
Policies constrain.
CI gates enforce.
Evals measure.
Hooks block unsafe actions.
Trust policy protects skills/tools.
Installer manages lifecycle.
```

Nuevos módulos:

```txt
docs/ai/enforcement.md
docs/ai/quality-gates.md
docs/ai/eval-strategy.md
docs/ai/trust-policy.md
docs/ai/installer-cli.md
docs/ai/observability-runtime.md
docs/ai/rollback-runtime.md
docs/ai/maintainability-gates.md
.github/workflows/harness-quality-gate.yml
.github/workflows/harness-security-gate.yml
.github/dependabot.yml
scripts/harness/
evals/golden/
evals/tool-calls/
evals/schema/
evals/regression/
```

## v6 — Spec Sizing and Complexity Classification

This version adds explicit feature/task spec sizing.

The harness already had installation modes:

```txt
minimal
standard
enterprise
```

But those describe harness installation size, not the complexity of a feature spec.

v6 adds:

```txt
basic spec
standard spec
complex spec
```

Rule:

```txt
Do not force complex SDD on simple tasks.
Do not allow basic specs for high-impact work.
Spec complexity must match risk, ambiguity, architecture impact, testability and blast radius.
```

New core files:

```txt
docs/ai/spec-sizing.md
docs/ai/spec-intake.md
docs/ai/spec-escalation.md
docs/specs/templates/basic-spec.md
docs/specs/templates/standard-spec.md
docs/specs/templates/complex-spec.md
docs/skills/spec-complexity-classifier.md
docs/skills/spec-intake.md
docs/skills/spec-escalation-review.md
```
