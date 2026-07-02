# Loop Design

## Cuándo usar

Cuando se diseña un workflow repetible para agentes.

## Fuente de verdad

- `docs/ai/loops.md`
- `docs/ai/loop-policy.md`
- `docs/ai/provider-routing.md`

## Procedimiento

1. Definir objetivo del loop.
2. Definir input y estado inicial.
3. Definir pasos permitidos.
4. Definir herramientas permitidas.
5. Definir intentos máximos.
6. Definir señales de éxito/fallo.
7. Definir escalación.
8. Definir rollback.
9. Definir logs.
10. Validar con humano si toca producción, DB, auth, pagos o seguridad.

## Output esperado

```txt
Loop:
Input:
Steps:
Tools:
Max attempts:
Success:
Failure:
Escalation:
Rollback:
Observability:
```
