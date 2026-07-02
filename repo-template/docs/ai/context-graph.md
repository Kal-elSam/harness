# Context Graph

## Objetivo

Mapear arquitectura, módulos, entidades, flujos, tools y riesgos del proyecto.

## Uso con Graphify

Graphify puede indexar:

- carpetas y módulos
- dependencias
- entidades de dominio
- endpoints
- componentes UI
- herramientas externas
- agentes
- specs
- tests/evals
- decisiones

## Reglas

- Cada feature importante debe conectar spec → código → tests/evals → decisión.
- Si el grafo muestra dependencias circulares, reportar.
- Si el grafo detecta módulos huérfanos, revisar antes de borrar.
- El grafo ayuda a navegar; no es fuente de verdad superior al repo.
