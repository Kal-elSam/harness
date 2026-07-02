# Loop Policy

## Objetivo

Definir límites, escalación y condiciones de salida para loops agénticos.

## Límites globales

| Límite | Default |
|---|---:|
| Repair attempts por task | 3 |
| Archivos modificados antes de review | 8 |
| Iteraciones sin progreso | 2 |
| Cambios de arquitectura sin approval | 0 |
| Cambios de DB destructivos sin approval | 0 |
| Cambios de seguridad/auth sin approval | 0 |
| Evals fallidas aceptables en IA | 0 críticas |

## Señales de éxito

Un loop puede cerrar cuando:

- spec sigue vigente
- tests relevantes pasan
- evals relevantes pasan
- lint/typecheck/build pasan si aplican
- no hay issues críticos en review
- riesgos documentados
- humano aprueba si el impacto es alto

## Señales de fallo

Detener y escalar si:

- se alcanza el máximo de repair attempts
- el agente repite el mismo cambio
- aparecen errores nuevos no relacionados
- aumenta el scope
- se modifican capas no previstas
- falla seguridad/auth/data/infra
- evals degradan comportamiento anterior
- el modelo reporta baja confianza

## Model routing dentro del loop

### DeepSeek / económico

Puede ejecutar:

- intake
- task breakdown
- scaffolding
- tests simples
- repair attempts 1-2
- documentación base
- extracción de contexto

No puede aprobar:

- arquitectura
- seguridad
- auth/pagos
- DB destructiva
- aceptación final crítica
- cambios productivos de alto impacto

### Modelo fuerte

Debe intervenir para:

- spec review crítica
- arquitectura
- debugging complejo
- security review
- eval strategy
- acceptance review

## Rollback

Si el loop degrada el sistema:

1. Detener ejecución.
2. Reportar diff.
3. Identificar último estado válido.
4. Proponer rollback.
5. Esperar aprobación humana si hay cambios destructivos.
