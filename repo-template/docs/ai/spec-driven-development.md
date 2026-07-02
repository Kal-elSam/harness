# Spec-Driven Development

## Cuándo crear una spec

Crear spec para:

- nueva feature
- cambio de flujo
- endpoint nuevo
- integración externa
- cambio de modelo de datos
- refactor estructural
- automatización agéntica
- prompt/agente de producción

No es obligatorio para cambios triviales de copy, estilos menores o fixes pequeños, salvo riesgo alto.

## Ubicación

```txt
docs/specs/<feature-name>.spec.md
```

## Plantilla

```md
# Spec: [Nombre]

## Objetivo

## Contexto

## Alcance

## No alcance

## Criterios de aceptación

- [ ] Comportamiento observable
- [ ] Caso de error
- [ ] Validación técnica

## Diseño técnico

### Capas afectadas

- UI:
- API:
- DB:
- Servicios:
- Jobs:
- Agentes:
- Evals:

### Contratos

#### Request

```json
{}
```

#### Response

```json
{}
```

## Estados y errores

| Caso | Resultado esperado |
|---|---|
| Happy path | |
| Error externo | |
| Input inválido | |
| Sin permisos | |

## Testing

- Unit:
- Integration:
- E2E:
- Regression:

## Evals

- Dataset:
- Prompt regression:
- Tool calling:
- Safety:

## Riesgos

## Plan de implementación
```

## Reglas

- La spec debe ser suficientemente clara para que otro agente implemente.
- Los criterios de aceptación deben convertirse en tests/evals.
- Si cambia la implementación, actualizar la spec.
- Si la spec contradice arquitectura, resolver antes de codificar.

## Spec sizing requirement

Before writing a spec, classify it as:

```txt
basic
standard
complex
```

Use:

```txt
docs/ai/spec-sizing.md
docs/specs/templates/basic-spec.md
docs/specs/templates/standard-spec.md
docs/specs/templates/complex-spec.md
```

Do not force complex SDD on tiny safe tasks.
Do not use basic specs for high-risk or high-ambiguity tasks.
