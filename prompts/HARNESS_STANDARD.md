# Harness Installer — Standard Mode

Instala un harness estándar para app real.

Crea:

```txt
AGENTS.md
docs/ai/
docs/skills/
.cursor/rules/
.cursor/commands/
```

Debe incluir:

- `docs/ai/architecture.md`
- `docs/ai/conventions.md`
- `docs/ai/testing.md`
- `docs/ai/git-workflow.md`
- `docs/ai/harness.md`
- `docs/ai/spec-driven-development.md`
- `docs/ai/test-driven-development.md`
- `docs/ai/agent-workflow.md`
- `docs/ai/decision-log.md`
- `docs/ai/ui.md` si hay UI
- `docs/ai/api.md` si hay API

Flujo obligatorio:

```txt
Requirement → Spec → Plan → Tests failing first → Implementation → Validation → Review → Human approval
```

No crear agentes especializados salvo que el proyecto lo justifique.
