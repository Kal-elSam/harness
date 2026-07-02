# Adapter Parity Review

## Cuándo usar

Cuando agregues, modifiques o evalúes soporte para OpenCode, Cursor, Codex, Claude, Gemini, Pi o cualquier otro adapter.

## Fuente de verdad

- `docs/ai/adapter-parity.md`
- `docs/ai/tool-adapters.md`
- `docs/ai/governance.md`
- `AGENTS.md`

## Procedimiento

1. Verificar que el core universal no se duplique.
2. Verificar que el adapter apunte a `AGENTS.md`.
3. Confirmar soporte para SDD.
4. Confirmar soporte para TDD.
5. Confirmar soporte para evals si aplica.
6. Confirmar soporte para checkpoint/review.
7. Confirmar soporte para loop engineering si aplica.
8. Confirmar que el adapter no se declara fuente principal.
9. Documentar limitaciones.

## Checklist

- [ ] No contradice `AGENTS.md`
- [ ] No duplica reglas largas
- [ ] Tiene path claro para SDD
- [ ] Tiene path claro para TDD
- [ ] Tiene path claro para evals
- [ ] Tiene path claro para checkpoint
- [ ] Tiene path claro para model routing
- [ ] Tiene path claro para human approval
- [ ] Limitaciones documentadas

## Output

```txt
Adapter:
Capabilities:
Missing capabilities:
Conflicts:
Recommended changes:
```
