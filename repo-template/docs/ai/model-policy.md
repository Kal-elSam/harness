# Model Policy

## Objetivo

Definir qué tipo de modelo debe ejecutar cada clase de tarea.

El harness debe funcionar con cualquier proveedor: DeepSeek, OpenAI/Codex, Claude, Gemini, modelos locales u otros modelos vía Gentle AI/OpenRouter.

## Principio

```txt
Use the cheapest model that can safely complete the task.
Escalate when ambiguity, risk, architecture, security or multi-file reasoning increases.
```

## Clases de modelos

| Clase | Uso recomendado |
|---|---|
| Economic | Scaffolding, docs, tests simples, tareas mecánicas |
| Standard | Implementación normal, refactors moderados, análisis local |
| Strong | Arquitectura, debugging complejo, specs críticas, review |
| Specialist | Seguridad, performance, evals, RAG, data, infra |
| Local/private | Análisis sensible, privacidad, preprocesamiento |

## Modelos económicos

Ejemplos: DeepSeek u otros modelos de bajo costo.

Usar para:

- scaffolding
- task breakdown
- documentación base
- generación de tests simples
- extracción de contexto
- refactors mecánicos
- limpieza de archivos
- primeras hipótesis de debugging

No usar sin revisión para:

- decisiones arquitectónicas críticas
- seguridad
- auth/payment/data loss
- cambios de DB sin migration plan
- specs críticas de negocio
- debugging multiarchivo de alto riesgo
- cierre final de cambios importantes

## Modelos fuertes

Usar para:

- arquitectura
- diseño de specs críticas
- revisión de seguridad
- debugging complejo
- razonamiento multiarchivo
- diseño de evals complejas
- aceptación final de cambios críticos

## Escalation policy

Escalar a modelo fuerte o humano si:

- hay contradicciones entre docs y código
- el cambio afecta auth, pagos, datos, seguridad o infra
- hay más de 5 archivos críticos involucrados
- el agente propone nueva arquitectura
- tests/evals fallan repetidamente
- el modelo reporta baja confianza
- hay riesgo de pérdida de datos
- se requiere decisión de producto

## Regla final

El modelo ejecuta. El harness controla. El humano aprueba impacto.

## Loop-aware model policy

Los modelos económicos pueden iterar dentro de loops solo si:

- hay max attempts
- hay tests/evals
- el scope está definido
- el rollback es posible
- no hay impacto crítico

Los modelos fuertes deben cerrar o revisar loops de alto impacto.

## Adapter-independent model policy

This policy applies regardless of where the model is used:

- OpenCode
- Cursor
- Codex
- Claude
- Gemini
- Pi
- any future CLI or IDE agent

Do not encode model safety rules only inside one adapter.
The source must live here and be referenced by adapters.
