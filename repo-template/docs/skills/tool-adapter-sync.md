# Tool Adapter Sync

## Cuándo usar

Cuando se agreguen o actualicen instrucciones para Cursor, Codex, Claude, Gemini, Copilot, Gentle AI, Engram o Graphify.

## Fuente de verdad

- `AGENTS.md`
- `docs/ai/tool-adapters.md`

## Procedimiento

1. Actualizar primero el core universal.
2. Revisar si el adapter necesita puntero, regla, skill o subagente.
3. Evitar duplicación larga.
4. Confirmar que no contradice `AGENTS.md`.
5. Validar rutas y nombres esperados por la herramienta.

## Checklist

- [ ] Core actualizado primero
- [ ] Adapter no contradice core
- [ ] No hay duplicación larga
- [ ] Punteros delgados listos
- [ ] Rutas correctas

## Output esperado

```txt
Adapter:
Archivos modificados:
Fuente core:
Duplicación:
Riesgos:
```
