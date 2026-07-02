# Harness Installer — Minimal Mode

Instala un harness mínimo para proyecto pequeño.

Crea o actualiza:

```txt
AGENTS.md
docs/ai/architecture.md
docs/ai/testing.md
docs/ai/git-workflow.md
.cursor/rules/core.mdc
.cursor/rules/testing.mdc
```

Reglas:

- No instalar dependencias.
- No duplicar reglas largas.
- No crear `.cursor/agents` ni `docs/skills` salvo que el usuario lo pida.
- Mantener `AGENTS.md` corto y accionable.
- Documentar comandos reales detectados.
- Bugs requieren regression test primero.
- Features no triviales requieren mini spec.

Flujo:

```txt
Requirement → Mini Spec → Test/Validation → Implementation → Review
```
