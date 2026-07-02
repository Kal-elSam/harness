# Memory

## Objetivo

Definir cómo se maneja memoria persistente del proyecto.

## Fuentes

| Fuente | Rol |
|---|---|
| Repo | Fuente primaria |
| AGENTS.md | Instrucciones universales |
| docs/ai | Documentación técnica |
| docs/specs | Intención/versionado de features |
| Engram | Memoria/indexación externa |
| Graphify | Grafo contextual externo |

## Reglas

- La memoria externa no reemplaza el repo.
- Si Engram contradice `AGENTS.md`, gana `AGENTS.md`.
- Si Graphify contradice código/documentación, reportar y actualizar grafo.
- Decisiones importantes deben registrarse en `decision-log.md` o ADR.
