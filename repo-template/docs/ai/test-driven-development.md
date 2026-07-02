# Test-Driven Development

## Regla central

Antes de implementar cambios de comportamiento, escribir el test que define el comportamiento esperado.

## Por tipo de tarea

| Tarea | Test obligatorio |
|---|---|
| Función nueva | Unit test |
| Bug fix | Regression test que falla primero |
| Endpoint nuevo | Integration test happy path + errores |
| Flujo de usuario | E2E test |
| Refactor | Tests existentes deben seguir pasando |
| Cambio IA | Eval o prompt regression |

## Proceso

```txt
1. Identificar comportamiento esperado
2. Escribir test/eval que falla
3. Confirmar que falla por la razón correcta
4. Implementar mínimo necesario
5. Ejecutar test/eval
6. Ejecutar suite completa
7. Refactorizar si aplica
```

## Prohibiciones

- No mockear lógica de negocio propia.
- No borrar tests para hacer pasar el pipeline.
- No cambiar assertions para ocultar un bug.
- No usar snapshots como sustituto de comportamiento crítico.
