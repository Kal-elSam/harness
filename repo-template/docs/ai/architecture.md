# Arquitectura del proyecto

## Stack

- Lenguaje: [LANGUAGE]
- Framework: [FRAMEWORK]
- Package manager: [PACKAGE_MANAGER]
- Inicializado: [DATE]

## Propósito

[PROJECT_PURPOSE]

## Estructura de carpetas

```txt
[REAL_TREE_MAX_DEPTH_3]
```

## Patrón de arquitectura

- Patrón principal: [ARCHITECTURE_PATTERN]
- Presentación: [UI_DIRECTORIES]
- API: [API_DIRECTORIES]
- Datos: [DATA_DIRECTORIES]
- Tests: [TEST_DIRECTORIES]
- Evals: [EVAL_DIRECTORIES]

## Decisiones de arquitectura

### ADR-001 — Stack inicial detectado

**Estado:** aceptado  
**Fecha:** [DATE]

#### Contexto

El proyecto usa [STACK].

#### Decisión

Mantener la arquitectura detectada salvo que una spec o ADR proponga cambio.

#### Consecuencias

Toda nueva capa debe respetar la estructura existente.

## Reglas estrictas

- No mezclar lógica de negocio con presentación.
- No introducir dependencias sin ADR o justificación.
- No crear nuevas capas sin documentarlas.
- No romper contratos públicos sin migration plan.
