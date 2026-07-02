# Estrategia de testing

## Estado actual

- Tests configurados: [TESTING_EXISTS]
- Herramientas detectadas: [TESTING_TOOLS]
- Herramientas propuestas: [TESTING_PROPOSED]
- Comando: [TEST_COMMAND]
- Cobertura mínima recomendada: 80% líneas y branches

## Por tipo de tarea

| Tarea | Test requerido |
|---|---|
| Función nueva | Unit |
| Endpoint nuevo | Integration |
| Bug fix | Regression |
| Flujo UI | E2E |
| Refactor | Suite existente verde |
| Cambio IA | Eval/prompt regression |

## Reglas

- Factories en `tests/factories/` si aplica.
- Mocks solo para dependencias externas.
- Regression test antes del fix.
- No borrar tests sin justificación.
- No cambiar assertions para ocultar bugs.
