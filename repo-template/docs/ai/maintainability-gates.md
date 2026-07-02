# Maintainability Gates

## Reglas

- Preferir cambios pequeños y localizados.
- No mezclar refactor + feature + bugfix.
- No duplicar lógica de dominio.
- No introducir abstracciones prematuras.
- No crear helpers genéricos sin casos reales.
- No modificar arquitectura sin ADR.
- No aumentar acoplamiento innecesario.
- No cambiar contratos públicos sin tests.
- No esconder errores con catch silencioso.
- No usar any/unknown sin justificación en TypeScript.

## Checklist

- [ ] cumple el spec
- [ ] diff mínimo
- [ ] nombres claros
- [ ] no hay dead code
- [ ] no hay duplicación innecesaria
- [ ] no hay cambios no relacionados
- [ ] tests cubren comportamiento
- [ ] diseño escalable
- [ ] mantenible por otro humano/agente
