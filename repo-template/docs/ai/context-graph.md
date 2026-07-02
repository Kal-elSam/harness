# Context Graph

## Objetivo

Mapear arquitectura, módulos, entidades, flujos, tools y riesgos del proyecto usando Graphify, sin que el grafo se convierta en una segunda fuente de verdad.

## Qué indexar con Graphify

- Carpetas y módulos, y sus límites.
- Dependencias entre módulos: imports, llamadas, contratos.
- Entidades de dominio.
- Endpoints y contratos de API.
- Componentes UI y su árbol de composición.
- Herramientas externas, MCPs e integraciones.
- Agentes, skills y comandos definidos en el repo.
- Specs (`docs/specs/`) y su relación con el código que implementan.
- Tests y evals, y qué código o spec cubren.
- Decisiones registradas en `docs/ai/decision-log.md`.

## Cómo detectar dependencias y riesgos

Señales a las que prestar atención en el grafo:

| Señal | Riesgo | Acción |
|---|---|---|
| Dependencias circulares | Acoplamiento oculto, difícil de testear | Reportar y proponer ruptura del ciclo |
| Nodo con fan-in muy alto ("god module") | Punto único de fallo, cambios riesgosos | Evaluar split o interfaz más estrecha |
| Módulo huérfano, sin referencias | Código muerto o documentación desactualizada | Confirmar antes de borrar |
| Nodo de alta centralidad sin tests/evals | Riesgo de regresión silenciosa | Priorizar cobertura antes de tocarlo |
| Spec sin código asociado | Trabajo pendiente o spec abandonada | Verificar estado con el humano |
| Código sin spec ni decisión asociada | Cambio no gobernado por el harness | Retrofit de spec si el cambio es significativo |

## Reglas

- Cada feature importante debe conectar spec → código → tests/evals → decisión.
- El grafo se regenera desde código y docs; no se edita el grafo a mano.
- Si el grafo y el código divergen, investigar el código primero: el grafo puede estar desactualizado.
- El grafo ayuda a navegar y priorizar; no es fuente de verdad superior al repo.
- No declarar un riesgo "resuelto" solo porque desapareció del grafo; verificarlo en el código y en los tests.
