# Memory

## Objetivo

Definir cómo se maneja memoria persistente del proyecto y cuándo Engram debe intervenir.

## Fuentes

| Fuente | Rol |
|---|---|
| Repo | Fuente primaria |
| AGENTS.md | Instrucciones universales |
| docs/ai | Documentación técnica |
| docs/specs | Intención/versionado de features |
| Engram | Memoria/indexación externa |
| Graphify | Grafo contextual externo |

## Qué guardar en Engram

Guardar:

- Decisiones de arquitectura y su razonamiento, no solo el resultado.
- Bugs recurrentes y su causa raíz.
- Convenciones descubiertas que no estaban documentadas.
- Aprendizajes de retrospectivas de loops (`docs/ai/loop-log.md`).
- Enfoques descartados y por qué se descartaron.
- Contexto de decisiones de modelo/routing que resultaron caras o incorrectas.

No guardar:

- Secrets, tokens, credenciales o datos personales.
- Volcados completos de código fuente; el repo ya es la fuente.
- Output de debug efímero sin valor de largo plazo.
- Cualquier cosa que ya esté documentada en `AGENTS.md` o `docs/ai/`. No dupliques la fuente de verdad.

## Cuándo buscar memoria

Buscar en Engram antes de:

- Iniciar una tarea no trivial o una spec `standard`/`complex`.
- Diagnosticar un bug que "se siente familiar".
- Proponer una decisión de arquitectura o convención nueva.
- Retomar trabajo después de una compactación de contexto o nueva sesión.
- Repetir una tarea de loop (ver `docs/ai/loop-retrospective.md`).

No es necesario buscar memoria para:

- Cambios triviales (typos, formato, comentarios).
- Tareas ya completamente especificadas en una spec activa.

## Cuándo el repo gana sobre la memoria externa

```txt
Current user instruction
→ AGENTS.md
→ docs/ai/
→ docs/specs/
→ Engram (memoria)
→ Graphify (grafo)
```

Reglas explícitas:

- Si Engram contradice `AGENTS.md` o `docs/ai/`, gana el archivo del repo. Actualizar o descartar la memoria obsoleta.
- Si Engram sugiere una convención que el código actual ya no sigue, verificar el código primero: la memoria puede estar desactualizada.
- Si Graphify contradice código o documentación, reportar la discrepancia y regenerar el grafo; no editar el grafo a mano.
- Ninguna memoria externa autoriza saltarse SDD, TDD, evals o aprobación humana.

## Registro de decisiones

Las decisiones importantes deben quedar trazables en `docs/ai/decision-log.md` o un ADR, no solo en Engram. Engram indexa; el repo certifica.
