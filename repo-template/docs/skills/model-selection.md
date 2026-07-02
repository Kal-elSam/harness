# Model Selection

## Cuándo usar

Cuando una tarea pueda ejecutarse con diferentes modelos o proveedores.

## Fuente de verdad

- `docs/ai/model-policy.md`
- `docs/ai/provider-routing.md`

## Procedimiento

1. Clasificar riesgo de la tarea.
2. Determinar si el resultado es verificable con tests/evals.
3. Usar modelo económico para tareas mecánicas/verificables.
4. Usar modelo fuerte para decisiones ambiguas, críticas o arquitectónicas.
5. Escalar a humano si hay impacto crítico.

## Checklist

- [ ] Riesgo clasificado
- [ ] Modelo seleccionado
- [ ] Validación automática disponible
- [ ] Escalación definida si falla

## Output esperado

```txt
Tarea:
Riesgo:
Modelo recomendado:
Razón:
Validación:
Escalación:
```
