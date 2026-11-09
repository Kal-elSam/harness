Objective: the Router has effective authority over provider selection, independence is per task, no silent fallback.
Branch: feat/router-provider-authority.
Delivery: ask-on-risk. Test runner: `npm test` (node --test); plugin tests under `integrations/claude-code/kairo-router`.
Status: T1 closed; T2 ACCEPTED WITH KNOWN LIMITATIONS; T3 design authorized, T3-R1 ACCEPTED, T3-R2a ACCEPTED, R2b STOPPED, not accepted; provenance kept; Codex credit disabled, R3/T4 authority contract approved as design (S85, S86), OD-R3-1 resolved (L57), level semantics open (L58), R3 code not authorized; OD-R3-2 canary recorded (L59), OBSERVED design approved (S87, L60) and written, native Claude OBSERVED approved (S88, L61), implementation not authorized, independent design review CONDITIONAL_PASS, FINDINGS_ADDRESSED_IN_DESIGN (S90, L63); OBSERVED authority policy approved (S91, L64), UNLINKED execution approved (S92, L65), minimal cut approved as sequence, U1_IMPLEMENTED_REVIEWED_REPO (S93, L66), not validated in the installed plugin, U2 to U5 not authorized; T5 specified, not implemented (S95, L68); plugin installation not authorized (S64); T4-T10 not authorized; T11 design approved, implementation pending; pilot suspended, including the Luna run. U2-U5 specified per S96, not implemented; S125 scope fixed: governable execution scope, MVP release contract, T6-T11 not release-blocking, D's 13 files historical backup only; MVP plan in odd/tasks/kairo-runtime-mvp.md; no implementation authorized.

## Specs

- S1. “S5 — Independencia por tarea. Cada Builder puede utilizar cualquier proveedor elegible. El Reviewer de esa tarea debe pertenecer a un proveedor distinto al que generó el cambio. No debe existir una restricción global Builder/Reviewer por equipo.”
- S2. “Router — Sin fallback silencioso. Si no existe una ruta válida, debe buscar alternativas elegibles según capacidades, cuotas y restricciones. Si ninguna cumple, debe detener o encolar la tarea e informar el bloqueo. Nunca ejecutar automáticamente con el agente predeterminado.”
- S3. “Eliminar asignaciones rígidas. Revisar `team-builder`, `team-builder-codex` y cualquier configuración que imponga un proveedor o modelo ignorando al Router. La selección concreta debe resolverse dinámicamente.”
- S4. “Distribución de carga. Considerar cuota disponible, costo, capacidad, calidad histórica y saturación. Sin porcentajes fijos ni alternancia artificial entre proveedores.”
- S5. “Trazabilidad y pruebas. Registrar proveedor seleccionado, alternativas descartadas, motivo de selección, consumo observado y resultado. Probar agotamiento de cuotas, ausencia de rutas, revisión cruzada y asignación simultánea de Builders a proveedores diferentes.”
- S6. “Claude y Codex pueden implementar tareas simultáneamente; cada implementación tiene revisión independiente y ninguna tarea cambia silenciosamente de proveedor por un fallback implícito.”
- S7. “Diseñar desde ahora las interfaces necesarias para la segunda etapa, evitando implementar las células antes de resolver el problema actual.”
- S8. “antes de modificar código, quiero que se identifiquen todos los puntos donde una configuración fija pueda sobrescribir al Router, no solamente los tres archivos o agentes que ya encontramos.”
- S9. “La spec debe contener diagnóstico, decisiones arquitectónicas, contratos, tareas con dependencias, criterios de aceptación, pruebas de regresión y estrategia de migración.”

- S10 (OD1 decision): "Mi decisión es OD1 = `ALLOW_BOUNDED_FRONTIER_EXCEPTION`." Selection order, verbatim: "1. Builder elegible no frontier. Calidad validada + cuota disponible + presupuesto. 2. Evaluar alternativas y recalibración. Comprobar si las restricciones de calidad están correctamente definidas. 3. Excepción frontier. Activación limitada, justificada y registrada. 4. BLOCKED. Si no hay ruta segura, presupuesto o revisión independiente."
- S11: "Primero corregir la causa B. T1 debe identificar exactamente qué pisos de calidad rechazan a los modelos no frontier. Si están mal calibrados, corregirlos con evidencia; si el modelo realmente no cumple, conservar la restricción."
- S12: "Frontier como excepción, no fallback predeterminado. Sólo podrá ejecutar una tarea Builder cuando no exista una alternativa elegible, exista presupuesto suficiente y la ejecución esté justificada."
- S13: "Presupuesto por tarea. Cada delegación tendrá un límite de consumo y de intentos. Si lo supera, debe escalar; nunca continuar gastando cuota indefinidamente."
- S14: "Independencia S5 obligatoria. Si el Builder utiliza Claude, la revisión corresponde a Codex, o viceversa. Si no hay Reviewer elegible de otro proveedor, la tarea se bloquea o requiere una excepción humana explícita."
- S15: "Sin modelos fijos. Ni siquiera las excepciones frontier deben depender de nombres escritos manualmente. El Router seleccionará entre las capacidades disponibles."
- S16: "Trazabilidad y medición. Registrar por tarea proveedor, capacidad utilizada, razón de selección, consumo estimado y observado cuando esté disponible, intentos, resultados y retrabajo. La meta es optimizar el costo y consumo por cambio aceptado, no simplemente repartir solicitudes."
- S17 (amends approved S21 of odd/tasks/team-formation-integrity.md): "S21: documentar expresamente que el pool frontier puede realizar implementación excepcional cuando lo autorice la política OD1. No permitirlo como asignación ordinaria."
- S18: "S9: agregar criterios de aceptación verificables para cada una de las 10 tareas, no solamente criterios globales."
- S19: "Ahorro de cuota: incorporar pruebas y métricas que permitan comparar la distribución anterior contra la nueva. No declarar ahorro hasta demostrarlo."
- S20: "También hay que alinear el CLAUDE.md global y los puntos fijos fuera del repositorio mediante un plan de migración separado, sin violar la regla de no registrar contenido privado de ~/.claude en la documentación versionada."
- S21-local: "Calidad mínima garantizada → diversificación real → optimización de cuota → escalamiento controlado."
- S22 (OD2 decision): "Decisión OD2: `FAIL_CLOSED_WITH_HUMAN_OVERRIDE`. Apruebo la segunda opción: bloquear automáticamente la delegación cuando Kairo no responda, pero permitir un override humano puntual, explícito, limitado y auditable."
- S23 (override rules): "1. Sin fallback automático. Una falla de CLI, timeout o respuesta inválida de Kairo nunca autoriza ejecutar el agente predeterminado. 2. Autorización humana explícita. El sistema debe solicitar tu aprobación, indicando tarea, proveedor, alcance y motivo del bloqueo. 3. Alcance mínimo. El override autoriza una delegación específica, no toda la sesión ni las tareas posteriores. 4. Sin desactivar la seguridad. Los permisos de herramientas, aislamiento, operaciones destructivas y aprobaciones críticas siguen vigentes. 5. Revisión cruzada obligatoria. Una implementación autorizada mediante override sigue requiriendo revisión independiente antes de considerarse aceptada. 6. Registro auditable. Registrar motivo, proveedor seleccionado manualmente, tarea, autorización, resultado y consumo cuando esté disponible. 7. Sin persistencia del override. Una vez terminada o cancelada la tarea, la autorización expira. No debe convertirse en una preferencia permanente. Si la infraestructura no permite verificar o registrar la autorización de forma confiable, el override no debe ejecutarse automáticamente."
- S24 (A1): "Para A1, cada autorización frontier debe consumir una unidad del presupuesto de escalamiento. Esto requiere verificar que dicho presupuesto represente correctamente los eventos de escalamiento y no pueda eludirse mediante intentos repetidos."
- S25 (failure classes): "Provider unavailable: Codex no puede ejecutar ninguna ruta elegible. Model at capacity: el modelo seleccionado está saturado, pero podrían existir alternativas dentro de Codex. Quota exhausted: el proveedor no tiene capacidad suficiente según los límites conocidos. El Router no debería tratar las tres como equivalentes. Cuando un modelo está saturado, debe intentar seleccionar otro modelo elegible del mismo proveedor, después evaluar otros proveedores y finalmente bloquear si no existe ninguna ruta válida. Siempre respetando la independencia de revisión y el presupuesto. El 97 % de consumo es una señal de presión sobre la cuota, no necesariamente una prueba de agotamiento. La política debe utilizar el estado real que las herramientas permitan observar y tratar la información desconocida explícitamente."
- S26 (T1 gate): "Primero quiero cerrar T1: inventario completo, diagnóstico de elegibilidad de Builders, propuesta de límites por tarea y comprobación de que los overrides y excepciones frontier no pueden eludir la gobernanza."
- S27 (T1 decision): "Mi decisión es `T1_CONTROLLED_EVALUATION_ONLY`, con estas condiciones: 1. Sin reformación automática del equipo. Deshabilitar los efectos secundarios o ejecutar la evaluación en un entorno aislado. 2. Snapshot previo. Respaldar todos los archivos y estados que el comando pueda modificar, no solamente project-strategy.json. 3. Medición acotada. Evaluar los tres candidatos con tareas representativas, presupuesto conocido y límites de ejecución. 4. Sin asignación automática. Los resultados deben generar una propuesta de calibración, no modificar los pisos de calidad directamente. 5. Sin autorización de implementación. Los hallazgos siguen siendo evidencia para cerrar T1; no habilitan T2–T10."
- S28 (T1 scope): "Autorizado: inventario completo, diagnóstico de los pisos de calidad, consulta de Artificial Analysis y evaluación aislada de Terra, Luna y Haiku con un presupuesto previamente definido. No autorizado: ejecutar el --refresh actual si puede reformar el equipo, modificar estado operativo o consumir cuota sin límites aprobados."
- S29 (external evidence): "Incorpora Artificial Analysis como fuente complementaria de T1, mantén OD1 y OD2, y deja los resultados de P1–P6 pendientes de validación." "La ausencia de una puntuación no debe convertirse automáticamente en una calificación insuficiente." "El Router debe diferenciar el costo de API publicado por Artificial Analysis del consumo real de tus suscripciones."
- S30 (T1 output): "El resultado que espero es una matriz comparativa con evidencia externa, pruebas locales, causas concretas de rechazo, consumo medido y recomendaciones de calibración. Sin cambios automáticos de elegibilidad y sin implementación de T2–T10."
- S31 (objective): "Nuestro objetivo no es minimizar el costo de una API, sino maximizar la cantidad de trabajo de ingeniería que podemos completar con las cuotas incluidas en nuestras suscripciones." "Presupuesto principal: Cuotas incluidas en Claude y Codex. Costo en dólares por millón de tokens: Referencia informativa, no presupuesto. Objetivo de optimización: Más tareas aceptadas antes de agotar las cuotas. Restricción: Sin consumo adicional de API."
- S32 (shared allocation): "varios modelos dentro de una misma suscripción normalmente comparten una asignación de uso. No representan necesariamente cuotas independientes." "utilizar modelos más ligeros puede conservar capacidad, pero no crea una cuota adicional."
- S33 (Governor): "El Governor debe vigilar el uso por ventana y semanal, los próximos restablecimientos y la disponibilidad de modelos. Cuando no pueda leer una métrica, debe tratarla como desconocida y no inventar una cifra." "También debe reservar capacidad para revisión e integración: agotar Codex implementando puede impedir revisar después los cambios de Claude."
- S34 (T1 changes): "Eliminar los equivalentes económicos de API como criterio de autorización." "Crear una matriz de elegibilidad por subtarea. Terra, Luna y Haiku no necesitan demostrar que pueden hacer cualquier trabajo de Builder, sino identificar qué tipos de tareas ejecutan confiablemente." "Medir el consumo observable de la suscripción. Estado antes y después de cada ejecución, ventana de restablecimiento, resultado, retrabajos y cuota restante." "Aprovechar las capacidades locales. CI, TypeScript, linters, scripts y búsqueda determinista deben resolver todo lo posible sin invocar modelos." "Evaluar las células como unidad de trabajo. Medir cuántas tareas aceptadas produce una célula, cuántas delegaciones necesita y qué proveedor limita el rendimiento."
- S35 (pilot condition): "El piloto de seis ejecuciones continúa condicionado. No lo aprobaría automáticamente sólo porque ahora queremos aprovechar más modelos: primero hay que aislar el refresh automático y poder medir el consumo sin alterar el equipo activo."
- S36 (no artificial work): "aprovechar todos los modelos no significa obligar a utilizar todos. Cada modelo debe tener oportunidades de participar cuando sea elegible y eficiente. No debemos crear trabajo artificial para repartir cuota."
- S37 (order): "La prioridad sigue siendo terminar T1 sin modificar código y corregir después la autoridad del Router. Esta política de suscripciones debe incorporarse a la spec antes de iniciar esa implementación."
- S38 (quiet window): "Decisión: APPROVE_OPTION_A — QUIET_WINDOW. Sí, aprobamos la opción A (ventana quieta) como condición para ejecutar el piloto." "1. Cerrar todas las sesiones activas de Claude Code y Codex, incluyendo agentes en segundo plano. 2. Verificar que no existan procesos activos capaces de disparar el refresh automático. 3. Ejecutar el preflight desde una terminal independiente, sin iniciar una sesión interactiva adicional. 4. Utilizar HARNESS_HOME aislado y HOME aislado únicamente si no interfiere con la autenticación. 5. Verificar que el script del piloto no active hooks, statusline ni procesos capaces de modificar el equipo. 6. Obtener snapshots y hashes antes y después de la ejecución. 7. No permitir reintentos automáticos ni modificación de las rutas operativas." "cerrar las sesiones no garantiza por sí solo el aislamiento. El script podría iniciar nuevos procesos que ejecuten hooks. Eso debe comprobarse antes del piloto."
- S39 (measurement): "La medición debe registrar cuota disponible, ventana de restablecimiento, hora de observación, actividad concurrente conocida y confiabilidad de la atribución. No debemos transformar porcentajes observados en supuestos tokens consumidos ni en costos API."
- S40 (authorization state): "Opción A — Ventana quieta: Aprobada. Preflight sin ejecución de modelos: Autorizado. Primera ejecución del piloto: Pendiente de validar preflight. Cinco ejecuciones restantes: Pendientes. P10 — Pisos contextuales: Propuesta. P12 — Medición de cuota: Pendiente de validación. T2–T10 — Implementación: No autorizada."
- S41 (preflight gate): "procede con el preflight de la opción A. Si demuestra que no existen efectos secundarios sobre el estado operativo y que la autenticación sigue funcionando, presenta la evidencia para autorizar la primera ejecución."
- S42 (preflight decision): "Apruebo el preflight como evidencia válida de aislamiento en reposo. Sin embargo, todavía no autorizo ejecutar el primer modelo, porque encontramos una limitación importante en la autenticación aislada." "registrar PREFLIGHT_PASS_WITH_C7_FINDING, adjuntar las evidencias de C1–C9 y mantener T1 abierto. No convertir C7 PASS en una afirmación de que la autenticación aislada funciona."
- S43 (preparation phase): "1. Autenticación aislada: investigar si podemos autenticar Claude y Codex mediante sus suscripciones en directorios de configuración independientes, sin copiar secretos manualmente ni utilizar credenciales API. 2. Aislamiento de hooks: verificar con evidencia que las ejecuciones automatizadas no puedan activar el refresh o modificar el equipo operativo. 3. Protección del estado: conservar los snapshots y comprobar que los procesos secundarios tampoco alteren las rutas. 4. Medición de suscripción: establecer observaciones antes y después, documentando que los porcentajes compartidos sólo permiten estimaciones de consumo cuando no hay otra actividad."
- S44 (next gate): "la siguiente decisión será autorizar exactamente una corrida controlada, no el piloto completo."
- S45 (dry run decision): "Ejecución real de Luna: Pendiente de revisión del validador. Cinco ejecuciones adicionales: No autorizadas. T2–T10: No autorizadas." "un resultado sin evidencia de identidad deberá etiquetarse UNVERIFIED y no considerarse una validación completa de Luna." "preferiría que el experimento real se ejecute después del restablecimiento, para evitar competir con el trabajo de ingeniería."
- S46 (authorization): "Decisión T1: `APPROVE_SINGLE_LUNA_RUN`." "La autorización cubre exactamente una ejecución. No habilita cambios en el Router, reformación de células, modificaciones de modelos elegibles ni nuevas pruebas." "Si falla cualquier comprobación, se aborta sin fallback." "Si la ejecución comienza y falla, el intento queda consumido y no se repite automáticamente."
- S47 (result classes): "PASS: Fixture aprobado, identidad confirmada y sin modificaciones operativas no autorizadas. FAIL: Falló calidad, seguridad, ejecución o alguna comprobación obligatoria. UNVERIFIED: No hay evidencia suficiente para confirmar la identidad efectiva del modelo u otro criterio." "Un resultado UNVERIFIED no debe registrarse como prueba concluyente de capacidad de Luna." "Tampoco consideraremos que un solo éxito demuestra que Luna puede realizar todas las tareas de Builder."
- S48 (experiment questions): "1. ¿Puede Luna resolver correctamente un fixture real de implementación? 2. ¿Cuánto afecta una corrida de este tipo a la cuota observable de Codex? 3. ¿Se mantienen intactas las configuraciones operativas de Kairo? 4. ¿Podemos utilizar esta metodología para evaluar modelos ligeros y distribuir mejor el trabajo entre las células?"
- S49 (provider scope): "cualquioer que no sea claude y codex etan fuera del alcance por ahora"
- S50 (scope change): "Suspender el piloto de seis corridas, incluida la ejecución de Luna que había autorizado. Ya no lo considero indispensable para avanzar." "Utilizar Artificial Analysis como fuente inicial de evidencia, complementada con otros benchmarks publicados cuando falten datos." "Mantener la política de calidad y riesgo; un puntaje general no debe otorgar automáticamente permisos de Builder para cualquier tarea." "Corregir los problemas reales: independencia por equipo, elegibilidad, fallback silencioso y refresh con efectos secundarios." "Validar el Router con pruebas deterministas y proveedores simulados, sin consumir cuotas." "Recopilar métricas de las tareas reales que ejecuten nuestras células, sin abrir campañas de evaluación separadas."
- S51 (test classes): "conservaría las pruebas técnicas de seguridad e integración, pero dejaría de exigir benchmarks propios de cada modelo como condición para construir Kairo Runtime."
- S52 (catalog coverage): "Completar un inventario exhaustivo de los modelos que Claude Code y Codex realmente exponen con las suscripciones actuales, incluyendo versiones anteriores, modelos frontier, modelos ocultos y modelos restringidos." "Separar descubrimiento, acceso, elegibilidad y asignación. Identificar modelos omitidos por filtros de rol, generación, puntuación o proveedor." "No ejecutar modelos, no modificar configuraciones, no activar refresh ni reformar el equipo." "Incorporar Artificial Analysis para enriquecer capacidades, nunca para determinar acceso. Presentar la matriz completa antes de recalibrar el Router."
- S53 (principles): "mantener P14 y P15 aprobadas como principios, pero posponer la elección del Builder ordinario hasta conocer el inventario completo."
- S54 (information versus decisions): "Actualizar información no es lo mismo que modificar decisiones operativas." "Automático para descubrir, medir y comparar. Gobernado para decidir y ejecutar."
- S55 (P6): "Apruebo P6 como criterio de clasificación estable, con una condición: utilizar una referencia congelada y versionada, en lugar de permitir que pequeñas oscilaciones del índice en vivo cambien diariamente el estado frontier." "También incluiría una regla de estabilidad (hysteresis) para evitar cambios continuos cerca del umbral." "Y T8 deberá evitar que Sonnet vuelva a concentrar todas las implementaciones cuando Terra u otros modelos sean alternativas adecuadas."
- S56 (new and lost models): "No debe reemplazar automáticamente al Builder actual por ser más reciente." "Y si un modelo pierde disponibilidad, el Router debe dejar de asignarle tareas nuevas hasta recuperar una ruta válida."
- S57 (cadence): "Una consulta semanal, con caché, es suficiente como punto de partida." "Cuando no exista una consulta segura, la disponibilidad se marca como pendiente de verificación." Own benchmarks: "No periódicamente", "Sólo si hay una necesidad concreta".
- S58 (shape and order): "No crearía otro sistema de agentes ni un servicio que continuamente consulte modelos." "Estos comandos serían interfaces propuestas, no comandos que ya existan." "podemos incorporar el diseño del registro y el descubrimiento dentro de la especificación del Router, y programar su implementación una vez corregidos los bloqueos P0 actuales."
- S59 (T1 closure): "Doy T1 por validado como fase de diagnóstico y autorizo comenzar T2 en modo exclusivamente observación." "Esta aprobación se basa en la evidencia que me presentaste. No constituye una revisión independiente del código ni de la spec." "Cerrar T1 no significa que todos los problemas estén resueltos."
- S60 (T2 restrictions): "No alterar el Router. Ninguna modificación al algoritmo de selección, ranking, elegibilidad o fallback." "No modificar el equipo activo." "Sin consumo adicional de modelos. Las trazas deben generarse con información existente, sin invocar Claude, Codex ni Artificial Analysis adicionalmente." "Sin nuevos servicios persistentes." "Sin registrar secretos ni prompts completos. Utilizar identificadores, metadatos y resultados resumidos." "Un error al registrar una traza no debe modificar el comportamiento actual del Router. Debe ser detectable, no silenciado como un registro exitoso."
- S61 (T2 fields): taskId, traceId, role, cell, candidates, selectedProvider, selectedModel, rejectionReasons, routingDecision, effectiveLaunch, fallbackDetected, quotaSnapshot, policyVersion. "Es especialmente importante registrar la diferencia entre la decisión del Router y la ejecución efectiva."
- S62 (T2 acceptance): "Una ruta válida genera una traza correcta." "Una ruta inválida queda registrada con su motivo." "Una ejecución sin ruta identifica el fallback actual." "Las trazas distinguen selección prevista de ejecución observada." "Los datos sensibles no aparecen en los registros." "Los errores de telemetría no cambian las decisiones de routing." "No se ejecutan modelos reales ni se modifican archivos operativos durante las pruebas." "No corregir todavía los fallbacks detectados." "presenta el resultado para revisión cruzada antes de considerarla aceptada."
- S63 (design points): Histéresis: "Pendiente. Debe calcularse con evidencia y no bloquear T2". Scheduler: "Preferir mecanismo externo bajo demanda; sin daemon propio". TTL: "Conservar por ahora; TTL y frecuencia del job son conceptos distintos". API limit: "Verificar documentación y respuesta real antes de fijarlo". Codex app-server: "Auditar efectos secundarios antes de reutilizarlo para discovery". Claude Discovery: "Mantener registro manual hasta disponer de una fuente verificable". T11: "debe quedar detrás de la estabilización de las rutas P0. Eso comprende la independencia por tarea, la autoridad efectiva del Router y la eliminación del fallback silencioso, junto con sus pruebas de regresión. No necesariamente requiere completar todas las tareas T2–T9 si alguna es independiente."
- S64 (T2 deployment gate): "Acepto T2 como implementación funcional revisada, pero todavía no autorizo actualizar el plugin instalado." Conditions: "Warnings recuperados y sin bloqueantes abiertos." "Suite completa pasando sobre el estado final." "Telemetría sin bloqueo significativo sobre delegaciones." "Semántica de ejecución corregida." "Confirmación de que instalar el plugin no aplica rutas, reforma equipos ni introduce nuevas decisiones de routing." "No exigiría resolver ahora el bypass [no-redirect], siempre que quede registrado como una limitación temporal y no se convierta en política definitiva."
- S65 (T2 installation conditions): "corrige los cinco hallazgos relevantes, ejecuta las pruebas y prepara el manifiesto de instalación con rollback." "No quiero que una instalación de observabilidad active accidentalmente otras políticas sin aprobación." "La instalación puede realizarse localmente, sin push y sin modificar decisiones de routing." Known limitations kept documented: "El cierre inesperado de team exec antes de registrar la traza y el bypass [no-redirect] deben permanecer documentados como limitaciones conocidas."
- S66 (T2 session validation): "Sí. Autorizo validar T2 mediante --plugin-dir, aceptando temporalmente la guarda de entrega y el árbol de células." "la prueba queda autorizada, no la aceptación definitiva de T2." "Si aparece un duplicado de hooks, una reformación de equipo o una divergencia inesperada de routing, detendría la validación." "Actualizar plugin 0.7.5: No autorizado." "Push / merge: No autorizado."
- S67 (T2 model identity, L28): "Sí, acepto registrar T2 como PARTIAL — MODEL_IDENTITY_MISMATCH. No acepto cerrarla como completada ni trasladar este defecto a T3 sin corregirlo primero." "La solución no puede ser simplemente cambiar fallbackDetected a true cuando aparezca una diferencia. Necesitamos distinguir un cambio de proveedor, un cambio de versión dentro de la misma familia y una ejecución cuya identidad no se haya podido comprobar." "Identidad solicitada: Registrar ID completo y alias enviado. Identidad observada: Registrar versión efectiva sólo cuando exista evidencia. Divergencia: Distinguir proveedor, familia y versión. Ledger: No atribuir ejecución comprobada a un modelo solamente solicitado. Verdict: No acreditar resultados a una versión incorrecta. Pruebas: Cubrir explícitamente el caso Haiku 4.5 → Haiku 5.5." "Si el runtime no puede identificar el modelo durante el lanzamiento, debe dejarlo unverified hasta disponer de evidencia posterior." "Autorizo corregir este defecto dentro de T2, agregar pruebas deterministas y realizar revisión cruzada. No autorizo merge, actualización permanente del plugin ni comenzar T3 todavía." Contract fields: requestedModelId string; dispatchedModelAlias optional string; observedModelId optional string; identityStatus one of matched, mismatch, unverified.


- S68 (T2 single-session validation): “Sí, autorizo una sesión temporal con --plugin-dir y una única delegación real para validar la corrección de identidad de T2.” Delegaciones: “Máximo una, justificada por trabajo real”. No autorizado: “Ejecución de modelos adicionales para pruebas”, “Modificaciones del Router”, “Reformación del equipo”, “Push, merge o instalación permanente”, “Actualización de veredictos históricos”. Precondition: “Antes de abrir la sesión, confirmar que el último commit de corrección de identidad tenga revisión independiente aprobada y que claude plugin validate pase sobre ese estado. Si alguna condición sigue pendiente, se detiene la validación.” Caso sin evidencia: “Si no existe evidencia del modelo ejecutado, debe quedar unverified; no debemos inventar una coincidencia.” “No es necesario provocar artificialmente este caso. Si la delegación real no produce una divergencia, validaremos lo observable y mantendremos pendiente la comprobación del mismatch en ejecución real.” “También debemos confirmar que el ledger no atribuye resultados a una versión incorrecta, que las trazas no se duplican y que el rollback conserva el estado operativo.”
- S69 (ADAPTIVE_SUBSCRIPTION_EFFICIENCY, deferred): “Registra estas decisiones como parte de ADAPTIVE_SUBSCRIPTION_EFFICIENCY, pero mantén su implementación pendiente hasta estabilizar el Router.” Principles: “La capacidad disponible determina cómo se ejecuta el trabajo, pero no cambia los estándares de calidad.” “Un plan superior debe permitir hacer más trabajo o hacerlo más rápido, no ser un requisito para que la arquitectura funcione correctamente.” “No implica añadir otra capa de agentes: el Governor y el Router existentes deben implementarla.”
- S70 (unknown quota): “UNKNOWN_QUOTA ≠ UNLIMITED_QUOTA”. “Un proveedor sin información de cuota debe seguir siendo elegible si cumple los requisitos técnicos y de calidad.” “Una única ejecución concurrente.” “Sin reintentos automáticos por fallos de cuota.” “Sin asumir disponibilidad infinita.” “Ante una señal verificable de agotamiento, marcarlo temporalmente como no disponible.” “Recuperar elegibilidad cuando exista evidencia de disponibilidad.” “El límite de concurrencia es una medida conservadora inicial, no una estimación inventada de cuota.”
- S71 (role compatibility within one task): Explorer + Planner is permitted; Planner + Builder is “Permitida, con contrato aprobado”; Builder + Documenter is permitted. Prohibited: Builder + Reviewer; Builder + independent Verifier; Reviewer + independent approver of its own review; Integrator + independent checker of its own integration. “La prohibición se aplica a una misma tarea o artefacto, no permanentemente al agente.” “La separación por proveedor exigida en S5 sigue vigente. Los tests deterministas pueden ejecutarse localmente, pero no sustituyen una revisión cruzada obligatoria.”
- S72 (risk floor): “El riesgo y los requisitos técnicos determinan la calidad mínima. La cuota determina cuándo y con qué proveedor elegible se ejecuta.” Flow: “Clasificación de riesgo de la tarea”, “Requisitos mínimos de capacidad y calidad”, “Filtrado de modelos y proveedores elegibles”, “Evaluación de cuota y disponibilidad”, “Ejecutar · Posponer · Escalar conforme a OD1”. “La clasificación no podrá reducirse unilateralmente para elegir un modelo económico. Cualquier reclasificación que reduzca requisitos debe estar justificada y pasar los controles de gobernanza.”
- S73 (PRO_EFFICIENT and metrics): PRO_EFFICIENT “fue una propuesta conversacional descartada y nunca existió como configuración del repositorio.” “Las métricas de productividad por cuota quedan diferidas hasta contar con identidad y veredictos confiables. No hay que recalcularlas utilizando los ocho veredictos pendientes o atribuciones históricas incompletas.”
- S74 (definitive order): “1. T2: última validación de identidad mediante una delegación real; cerrar solamente si la evidencia lo permite.” “2. T3: independencia por tarea y contratos de delegación.” “3. Router: autoridad efectiva, eliminación de fallbacks silenciosos y selección dinámica.” “4. Governor: eficiencia adaptativa por suscripción.” “5. Células: coordinación dinámica, paralelismo y presupuestos según recursos disponibles.”
- S75 (T2 acceptance with known limitations): “Sí. Acepto T2 y autorizo su cierre formal, con las limitaciones de observación real registradas explícitamente.” “La aceptación no significa que hayamos comprobado todos los escenarios en producción. Significa que los controles implementados, las pruebas y la evidencia disponible son suficientes para avanzar.” Pending items: “Haiku 4.5 solicitado → Haiku 5.5 ejecutado”: “Validar en la siguiente delegación Claude que produzca una discrepancia, sin forzarla”. “Trailer agentId: en foreground”: “Verificar cuando aparezca naturalmente una ejecución compatible”. “Lanzamiento Claude sin observación”: “Conservar atribución provisional a la versión solicitada, marcada como no verificada”. “la atribución provisional no debe confundirse con identidad comprobada.” “Para el futuro Governor, las métricas de calidad por modelo deberán distinguir resultados verificados de atribuciones provisionales. No deberíamos utilizar estas últimas como evidencia de la misma confianza.”
- S76 (T3 design authorization): “Autorizo preparar T3 a nivel de diseño y desglose de implementación, pero todavía no modificar su código.” “La prioridad será introducir identidad persistente de tarea, procedencia del Builder y selección independiente del Reviewer, sin mantener las restricciones globales que actualmente impiden distribuir Builders entre Claude y Codex.” “No añadiría más infraestructura de observabilidad ni nuevas células hasta resolver esos problemas.” Constraints: “Conservar intactos los diez veredictos pendientes.” “No hacer push, merge ni instalación permanente del plugin.” “Mantener tsconfig.json y los directorios temporales fuera de los commits hasta revisar su procedencia.”
- S77 (separación proveedor/modelo): “Apruebo la separación proveedor/modelo.” “No aceptaremos una identidad desconocida como si estuviera verificada. Pero la falta de evidencia de la versión exacta del modelo no debe invalidar automáticamente un cambio de código cuya procedencia, pruebas y revisión sean confiables.” “Esto sustituye expresamente la regla anterior que exigía verificar la versión exacta del modelo para aceptar cualquier tarea. La independencia se comprueba por proveedor; la calidad, mediante pruebas y revisión; y la atribución de modelo tiene su propia exigencia.” Guarantees: identidad del proveedor ejecutor, “Obligatoria para S5”, “Bloquear revisión independiente”; identidad exacta del modelo servido, “Obligatoria para atribución por modelo”, “No acreditar a ese modelo”; autoría del cambio, “Obligatoria para revisión”, “Bloquear aceptación”; calidad del resultado, “Tests y revisión correspondiente”, “No aceptar la tarea”. “Un backend personalizado o un transporte cuya identidad no podamos establecer no debe adquirir esa confianza automáticamente.” “El modelo sin identidad comprobable queda excluido de las métricas verificadas por modelo.”
- S78 (ExecutionEvidence contract): ExecutionEvidence fields: taskId, executionId; provider with id, verified, source; model with requestedId, servedId nullable, verified; quality with testsPassed, independentReviewPassed.
- S79 (T3 decisions): “T3 — Proveedor verificable por evidencia de ejecución”: “Aprobada”. “T3 — Modelo exacto para métricas por modelo”: “Obligatorio; sin crédito cuando no se compruebe”. “OD-T3-2 — Eliminar veto global al formar equipos”: “Aprobada como dirección de diseño”. “OD-T3-3 — Activación coordinada T3/T4”: “Aprobada como estrategia de migración, no como autorización de código”. “Células dinámicas”: “Mantener, sin activación obligatoria”. “Optimización de subagentes”: “Incorporar al futuro Governor”. “Uso de APIs de pago”: “Excluido”.
- S80 (T3 scope): “Mi recomendación es reducir el alcance de T3 a tres componentes: identidad de tarea reutilizando Architect, evidencia verificable del ejecutor y validación cruzada por tarea. No implementaría de entrada las seis unidades ni un registro adicional de procedencia.”
- S81 (deferred context policy, after Router): “No crear un Context Agent, un Memory Orchestrator ni otro servicio nuevo.” “Utilizaría una política de selección de contexto dentro del Master y de los líderes de célula”. Rules: “Contexto bajo demanda.” “Fuentes especializadas.” “Sin duplicación de memoria.” “Permisos por rol.” “No quitaría instrucciones críticas de seguridad o gobernanza para ahorrar tokens.” Delegation questions: “¿Es necesaria la delegación?” “¿Qué capacidad mínima cumple la tarea?” “¿Cuántas instancias son necesarias?”

- S82 (OD-T3-4 UNKNOWN_DELTA_REQUIRES_HUMAN_CONFIRMATION): “Si aparece un cambio de autor desconocido entre la implementación del Builder y la revisión, Kairo debe bloquear la aceptación hasta que confirmemos su procedencia.” “bloqueamos el artefacto afectado, no todo el equipo ni las demás células.” Reglas: “Diff sin cambios inesperados”: “Revisión normal”. “Modificación humana reconocida”: “Registrar declaración y revisar el diff completo”. “Modificación de otro agente identificado”: “Comprobar independencia respecto de todos los proveedores autores”. “Modificación de origen desconocido”: “Bloquear aceptación”. “Modificación ajena al alcance”: “Aislar o revertir mediante procedimiento autorizado”. “Tarea independiente en otra célula”: “Puede continuar”. “La confirmación humana no convierte una autoría desconocida en autoría técnicamente verificada. Debe registrarse como una declaración explícita.” “Si ambos proveedores han escrito el mismo artefacto, ninguno puede considerarse su revisor independiente bajo S5.” “un hash de git diff demuestra cambios en el contenido, no quién los realizó.” Costo: “Comparación de hashes mediante herramientas locales.” “Sin nuevos agentes.” “Sin llamadas a modelos.” “Sin solicitudes de aprobación cuando no existen diferencias inesperadas.” “Bloqueo limitado exclusivamente a la tarea afectada.” “No agregues nuevas capas de agentes ni registros persistentes mientras los mecanismos existentes puedan satisfacer el contrato.” Estado: “Registro adicional provenance.jsonl”: “No necesario inicialmente”. “Optimización de contexto Gentle AI”: “Pendiente de diseño y cambios en origen”. “Implementación T3”: “No autorizada todavía”.
- S83 (T3-R2b provider states, T3-R2B_IMPLEMENTATION_APPROVED): "trusted binary, controlled environment, allowed configuration and linked rollout = controlled. Incomplete evidence without demonstrated contradiction = none-detected. Disallowed, inconsistent or untrusted configuration = untrusted. Only controlled with linked execution evidence may produce providerVerified true. none-detected is never promoted. A rollout found by date or proximity is never credited."
- S84 (T3-R2b conditions A-E): "(A) non-governed executions keep their behavior; the allowlist must not become a global restriction. (B) Check layers, arguments, profiles and environment actually applicable; a pre-existing app-server, unknown configuration or relevant discrepancy prevents crediting. (C) Preserve ChatGPT subscription access, copy no credentials to the trace, print no secrets, add no API keys. (D) Observability grants no authority: R2b records evidence and does not change selection, admission, quota distribution or verdicts. (E) Deterministic preflight, no extra model, no persistent processes of our own, no repeated checks within one execution. TOCTOU is a documented operational limitation." Scope: env allowlist only for governed and verified Codex executions; effective-config preflight; binary, signature and version check; detection of overrides, profiles and proxies; mandatory link thread_id to rollout to executionId; evidence in routing-trace.jsonl. Not authorized: new persistence files; credit for an exact Codex version without a proven servedModelId; team-builder-codex migration; R3/T4.
- S85 (R3/T4 authority contract, R3/T4_AUTHORITY_DESIGN_APPROVED_WITH_CONDITIONS): Evidence levels: DECLARED (provider recorded in the ledger; authority: exclude reviewers and guide routing), OBSERVED (evidence linked to a real execution without complete transport verification; authority: support decisions and risk assessment), VERIFIED (identity proven under the provider trust contract; authority: credit review independence). "la evidencia declarada puede utilizarse para negar independencia, pero no para concederla." Acceptance states (corrected in L57): Codex DECLARED builder with Claude DECLARED reviewer gives REVIEWED_PENDING_PROVENANCE; Claude DECLARED builder with Codex DECLARED reviewer gives REVIEWED_PENDING_PROVENANCE; both with the same declared provider does not satisfy S5; any combination without an effective review gives WAIT_FOR_INDEPENDENT_REVIEW; a review with sufficient independence evidence from a different provider is eligible for acceptance according to policy; explicit human exception S23 is a documented exceptional closure. "El estado provisional exige que exista una revisión real con resultado registrado, vinculada a la tarea y al artefacto. No basta con que el ledger declare dos proveedores diferentes." "REVIEWED_PENDING_PROVENANCE permite avanzar en desarrollo y pruebas; no equivale a una aceptación final ni autoriza automáticamente entrega, merge o despliegue." "No habrá una promoción automática de provisional a aceptado." Routing, review and acceptance are separate decisions. Limits: (1) providerVerified false is never turned into true by comparison with the ledger; (2) provisional states do not feed metrics of successful independent reviews; (3) a marker in user text, including [no-redirect], does not grant authorization or skip admission; (4) identity is evaluated per task and artifact, respecting S5 and the real contribution of each Builder; (5) S23 is an explicit, traceable and limited human exception, not an automatic fallback; (6) a verification failure affects the corresponding credit and does not cause a global block of all tasks or providers. Current provider assignments do not change because Codex lacks providerVerified. Implementation is not authorized.
- S86 (host-agnostic execution identity, design only): "Claude y Codex deben poder intercambiar los papeles de host, Builder y Reviewer sin cambiar las reglas de Kairo." Three identities: hostProvider controls the session, executionProvider runs the task, reviewProvider performs the review. "El host no debe contarse automáticamente como autor de todo el código producido por sus plugins." Independence is checked on real contributions, not on hostProvider; if the host also modified the same artifact, independence is re-evaluated. Desired contract, not an existing capability: ExecutionIdentity with taskId, executionId, hostProvider and executionProvider (each claude, codex or other), identityLevel (DECLARED, OBSERVED or VERIFIED) and optional evidenceSource. The rules apply to all four combinations: Claude host with Codex executor, Codex host with Claude executor, Claude host with Claude executor, Codex host with Codex executor. L56 is the approved design base for Codex observability, not an implemented or validated mechanism; Claude needs an equivalent observation source, using the transcript and the identity of the real process or subagent. Implementation is not authorized, and installing the community plugins is not authorized.
- S87 (OD-R3-2, OBSERVED_DESIGN_APPROVED, design only): "Autorizo diseñar OBSERVED para Claude y Codex bajo un contrato común, independiente del host. No autorizo todavía su implementación ni cambios de autoridad en R3/T4." "OBSERVED acredita que Kairo observó una ejecución local atribuible a un CLI determinado; no acredita qué proveedor remoto atendió la solicitud." providerVerified is not reused for local provenance. Signature and lifecycle evidence keep a reduced auditable form, "no sólo como booleanos calculados", without sensitive arguments, credentials, prompts or full rollout content. "No autorizo crear otro archivo, ledger o servicio de persistencia. Reutilizaremos la estructura existente." "El diseño no debe exigir que ambos CLI emitan los mismos eventos. Debe exigir evidencia equivalente de ciclo de vida y correlación, usando adaptadores específicos." For Claude native subagents: "No inventar un PID o un evento inexistente." OBSERVED "debe vincularse al taskId, al artefacto y a la contribución real antes de participar en S5." OD-R3-1 is unchanged. Codex observed plus Claude observed is potentially eligible for future operational acceptance, not yet authorized. "No autorizo nuevas canaries, modificaciones al Router ni cambios de configuración global. C3 sigue pendiente de medición y los veredictos pendientes permanecen intactos."
- S88 (OD-R3-3, NATIVE_CLAUDE_OBSERVED_APPROVED, design only): "Apruebo que un subagente nativo de Claude alcance OBSERVED sin identidad de ejecutable, utilizando la fila de lanzamiento, SubagentStop y el transcript vinculado." "OBSERVED represente una ejecución efectivamente observada por el host, no una declaración recibida mediante un payload." Requirements: launch row recorded by Kairo and bound to executionId; coherent session_id, agent_id and subagent type; SubagentStop of the same subagent; transcript existing, linked and inspected by core; hash and size recorded when the transcript is stable; evidence rebuilt from the host, not accepted directly from record-trace --payload; process null. Three independent dimensions: executionObserved, contributionLinked, providerVerified. "Si no existe taskId válido en Architect o la contribución es ambigua por escrituras paralelas, se conserva la observación de ejecución, pero no se acredita autoría de un artefacto ni independencia según S5." Retention is blocking for durable authority: "El diseño debe vincular la retención de evidencias necesarias al ciclo de vida de la tarea, evitando conservar indefinidamente transcripts completos." "No autorizo crear otra base de datos ni archivo para resolverlo." Not authorized: "implementar executionObservation, modificar hooks, migrar team-builder-codex, ejecutar nuevas canaries o conceder autoridad adicional en R3/T4." "El diseño todavía necesita una revisión independiente antes de implementar."
- S89 (OD-R3-4, INDEPENDENT_DESIGN_REVIEW_APPROVED): one independent review of S85-S88 and the OBSERVED section, read only. "Si encuentra bloqueantes, no autorizo correcciones automáticas. Primero evaluaremos si requieren cambiar el diseño o si pertenecen a una limitación ya aceptada." Same-user local attackers stay out of scope, but the review must identify "cualquier caso donde un evento ordinario, mal correlacionado o no confiable pueda producir autoridad indebidamente." Retention: 90 days is a provisional limit only for records of tasks whose state cannot be resolved; it "no debe provocar la eliminación silenciosa de evidencia de una tarea confirmada como abierta. Al vencimiento, debe señalarse para revisión o resolución, no convertirse automáticamente en tarea finalizada." Architect states: "deben inspeccionarse en el contrato real antes de definir cuáles son terminales." Multiple SubagentStop events: "deben tratarse como segmentos distintos de ejecución o reanudación." agent_transcript_path: "su estabilidad queda como hipótesis pendiente de verificación."
- S90 (OD-R3-5, DESIGN_CORRECTIONS_APPROVED, design only): F1 to F4 applied to the design without code. F1: "A los 90 días, una tarea sin estado de cierre autoritativo se marca para revisión o resolución. No se elimina su evidencia automáticamente." F2: "No inferir el cierre de una tarea a partir de PLAN_STATES." F3: "Cada segmento de ejecución necesita un intervalo de bytes propio, correlacionado con su parada." "El diseño debe exigir un límite inicial confiable, un límite final verificable y correlación con el evento de parada correspondiente." "Si el archivo cambia, se trunca, se reemplaza o no podemos delimitar el segmento con confianza, la ejecución permanece en DECLARED." "No autorizo construir un mecanismo nuevo de sincronización ni introducir archivos adicionales para resolverlo." F4: "Excluir de OBSERVED los agentId extraídos de texto generado por el modelo. Exigir una relación estructurada con el lanzamiento." Claude background with a structured agentId and proven correlation is an OBSERVED candidate; Claude foreground without a structured link, or with an ID parsed from text, is DECLARED; a subagent without a correlated launch does not credit OBSERVED. The sidecar toolUseId "no debe convertirse en requisito obligatorio ni en fundamento de autoridad hasta verificar su estabilidad y procedencia." "La ausencia de observabilidad suficiente en foreground no debe obligarnos a reemplazar sus subagentes nativos por procesos externos." Unlinked records keep the ordinary 8 days "siempre que no exista una dependencia activa que requiera esas evidencias." Result recorded as CONDITIONAL_PASS, FINDINGS_ADDRESSED_IN_DESIGN, not as a new independent PASS. Criterion for R3/T4: "La falta de evidencia puede impedir acreditar independencia, pero no debe impedir que un agente ejecute una tarea permitida." Execution, review and acceptance stay separate. R3/T4 implementation, hooks, Router, wrappers and canaries are not authorized.
- S91 (OD-R3-6, OBSERVED_AUTHORITY_POLICY_APPROVED, design only): "Apruebo utilizar OBSERVED como evidencia de procedencia operativa para R3/T4, pero no como autorización automática de aceptación." "OBSERVED confirma la ejecución local. Sólo puede apoyar la independencia cuando también existe una contribución inequívocamente vinculada a la tarea y al artefacto." "No introduciremos todavía ACCEPTED_OPERATIONAL ni reinterpretaremos providerVerified." "La falta de acreditación no debe bloquear el trabajo normal, pero una tarea provisional tampoco debe contarse como aceptada, ni habilitar automáticamente merge o despliegue." Trace growth: "No autorizaría implementar esa retención sin un criterio de rendimiento verificable." "Antes de elegir índices, bases de datos o archivos adicionales, quiero medir las operaciones existentes con tamaños representativos de traza." Engram: "El documento del repositorio debe ser la referencia completa; Engram debería contener decisiones, estado, rutas y un resumen compacto." Next: "un corte mínimo de implementación centrado en la admisión por tarea, que resuelva primero el defecto no-redirect, elimine el veto global y mantenga explícitamente los estados provisionales." Advanced observability may come later and is not a prerequisite. "No agregaría un watcher, daemon o servicio nuevo." R3/T4 implementation and hook, wrapper or routing changes are not authorized.
- S92 (OD-R3-7, UNLINKED_EXECUTION_APPROVED, design only): "Apruebo permitir lanzamientos sin taskId, clasificándolos como UNLINKED, sin crédito de autoría ni independencia y con vinculación explícita posterior." "permitir ejecutar no significa permitir aceptar." "La vinculación posterior tampoco debe conceder crédito retroactivo automáticamente. Requiere comprobar que el lanzamiento, el intervalo de ejecución y la contribución pertenecen realmente a esa tarea. Cuando no pueda comprobarse, permanece provisional." U1: the no-redirect marker "no puede depender de un marcador dentro de ningún prompt." "La redirección sólo debería poder controlarse mediante metadatos estructurados de una fuente confiable del host. Si hoy no existe ese mecanismo, el marcador debe tratarse como texto ordinario y no ejercer autoridad." U2 to U5 "deben integrarse como una unidad de gobernanza." "eliminar el veto no significa ignorar restricciones reales de acceso, entitlements o capacidad de los modelos." S82 is deferred "únicamente mientras U1–U5 no concedan aceptación definitiva." "ninguna tarea debe alcanzar ACCEPTED por esta ruta." "La confirmación S23 tampoco puede sustituirse por una decisión implícita del Router." "No quiero que UNLINKED se convierta en una manera de evadir la admisión." "El contrato debe distinguir entre una ejecución legítimamente no vinculada y una ejecución que debería estar vinculada, pero cuya identidad falló. Ambas pueden continuar trabajando cuando sea seguro, pero ninguna puede obtener aceptación por esa omisión." Lock losses "deben medirse y reportarse"; "Una pérdida silenciosa sería un defecto." Entitlement refresh, wrapper changes, S82 and implementation are out of this authorization.
- S93 (OD-R3-U1 and U1_LOCAL_CLOSURE_APPROVED): U1 removes the authority of the no-redirect marker over routing. "No agregaremos un nuevo marcador, variable ambiental o mecanismo de override." Closure approved with one wording fix: documentation "debe reflejar que la re-delegación pasa por el Router, pero no garantiza evitar al proveedor agotado cuando falla la selección." Classified U1_IMPLEMENTED_REVIEWED_REPO, not as validation of the installed integration. Two pre-existing limits stay as blockers for U2 to U5. U1-F1: "El valor subagent_type no constituye autenticación de origen cuando el modelo puede seleccionarlo. Una excepción por coincidencia de nombre no puede seguir siendo fundamento de autoridad una vez implementada la admisión por tarea." U1-F2: "Que el core devuelva WAIT_FOR_PROJECT_TEAM mientras el hook conserva el lanzamiento original significa que el estado de routing no equivale a un bloqueo de ejecución." Plugin update, U2 to U5 and recording pending verdicts are not authorized.
- S94 (ANALYST_ELIGIBILITY_RECOVERED, separate from U1 and R3/T4, design only): the defect ENTITLEMENT_STALE to analyst_unknown stays open. "Una autorización vencida no debe tratarse como una denegación real." Desired states: ALLOWED_FRESH, model eligible; DENIED_FRESH, model not eligible; ENTITLEMENT_STALE, shown as a candidate pending revalidation; ACCESS_UNKNOWN, access not credited and the reason explained. "Esto no significa permitir ejecutar un modelo sin comprobar el acceso." Verification stays on demand: "sólo comprobar el modelo que realmente se necesita, sin repetir sondas semanales de todo el catálogo." Token counts stay separate from provider quota: "Debemos separar tokens procesados, escritura de caché, reutilización de caché y cuota del proveedor." No further model probes for now; the other 11 Claude models stay unverified.
- S95 (OD-T5-1, DESIGN_UPDATE_APPROVED, design only): T5 is specified with four points, and "No autorizo ajustar los puntajes, el umbral 54.5 ni el requisito de capacidad 0.55 para conseguir artificialmente un Builder elegible." The Luna comparison seeks "el primer punto donde dos evaluaciones del mismo candidato dejan de coincidir, incluyendo versión de datos y configuración efectiva." "Tampoco autorizo todavía reconstruir el equipo ni invalidar la caché." For unselected executions, "la traza debe conservar el hecho del lanzamiento sin incorporarlo como una selección válida al ledger de distribución." "evita que U2 interprete la ausencia de una fila como prueba de que no hubo Builder." "No autorizo crear otro archivo de procedencia." "T5 no debe convertirse en un requisito para implementar la admisión mínima por tarea." Order: U2 to U5 first, then T5. Next criterion: "demostrar por qué las rutas de cálculo discrepan utilizando datos equivalentes, no ajustar reglas hasta que el resultado parezca correcto." Not authorized: code, hooks, wrappers, configuration, assignments, caches, entitlements, model probes, plugin changes, push or merge.
- S96 (OD-R3-U2-U5, specification only): "Autorizo avanzar con la especificación coordinada de U2–U5." "U2 — Autoría: Consultar ledger y traza por `taskId`. La ausencia de registro nunca demuestra ausencia de ejecución. Distinguir autoría declarada, observada y no vinculada." "U3 — Admisión: Evaluar cada Reviewer por tarea, antes de lanzarlo y antes de aceptar su resultado. Excluir conflictos conocidos según S5." "U4 — Estado provisional: Permitir `REVIEWED_PENDING_PROVENANCE`, sin acreditar independencia ni aceptación definitiva." "U5 — Eliminación del veto global: Retirar los bloqueos globales únicamente cuando la admisión por tarea esté conectada y probada." "No aceptaría implementar U5 antes de que U2–U4 estén conectadas y sus controles estén probados." "Las tareas `UNLINKED` pueden seguir ejecutándose, pero no obtienen crédito de contribución o independencia. No se inventará un `taskId` automáticamente." "Los 32 veredictos pendientes no deben convertirse en aprobaciones retroactivas para facilitar la entrega." "No autorizados: modificaciones de código, hooks, wrappers, configuración global, instalación del plugin, refresh de modelos, push, merge, rebase ni registro de veredictos."
- S97 (OD-U-1 to OD-U-4 resolved, slice A authorized): "Kairo Runtime es el sistema; kairo es su interfaz de línea de comandos." "El CLI debe ser una interfaz de operación, no la única manera de acceder a las capacidades internas." OD-U-1: "Permitir continuidad de trabajo no gobernado, pero no declararla excepción automática S23". "Ejecución no gobernada: el host puede continuar trabajando, con diagnóstico y sin crédito de routing o independencia." "Admisión gobernada: exige identidad de tarea y validaciones correspondientes." "Proveedor agotado: no debe recibir un fallback automático de Kairo que contradiga el agotamiento registrado." "Reviewer vinculado con conflicto conocido: no puede superar la admisión ni producir un veredicto acreditado." "Si el hook no puede impedir efectivamente un lanzamiento, debe registrar esa limitación. No debe comunicar que el Router lo bloqueó cuando el host realmente lo ejecutó." OD-U-2: "Apruebo kairo team task open como interfaz operativa, no como un sistema nuevo de gestión de tareas." "registrar una tarea nunca concede autoría retroactiva por sí mismo." "El nombre del agente no es una clave de correlación suficiente." OD-U-3: "el orden de lanzamientos no demuestra qué archivos cambiaron, ni resuelve escrituras concurrentes o no vinculadas." "No adelantaremos S82 únicamente para este corte." OD-U-4: "Un nombre elegible para bypass puede evitar la reescritura, pero no debe evitar la admisión por tarea, las restricciones de herramientas del host ni los controles de aceptación." "evitar la selección del Router ya puede alterar el proveedor, el consumo de recursos o las herramientas disponibles." "esta ruta debe quedar registrada como no autenticada, sin crédito y como deuda explícita de procedencia." Deployment: "Apruebo utilizar un worktree aislado para la implementación." "El flag --admission-contract 1 puede servir como mecanismo transitorio de activación, siempre que su valor provenga de configuración operativa confiable y no se interprete como autorización para saltar controles." "No aprobaría mover código del worktree al checkout activo solamente porque el flag esté apagado. Primero debemos demostrar la compatibilidad con el plugin antiguo, especialmente ante errores y fallbacks." "La instalación del plugin permanece como una autorización distinta." Backup: "recomiendo respaldarla en un remoto privado." "No autorizo todavía el push, pero ya no lo dejaría para la última fase." Authorized: "Autorizo actualizar S96 con las cuatro decisiones anteriores y comenzar el corte A — lector de autoría — en un worktree aislado." "Este primer corte debe limitarse a lectura y correlación de evidencia existente. No debe activar admisión, cambiar el Router, modificar hooks instalados ni otorgar crédito nuevo a ningún proveedor." "Los cortes B, C y D quedan pendientes de revisar después de A".
- S98 (OD-BACKUP-1, OD-BACKUP-2, slice B preconditions): "Autorizo crear `Kal-elSam/harness-backup` como repositorio privado y respaldar allí las dos ramas." "`harness-backup` será exclusivamente un respaldo privado, no un segundo repositorio de desarrollo ni una nueva fuente de verdad." "S22 en ese documento corresponde a `FAIL_CLOSED_WITH_HUMAN_OVERRIDE`, no a la elección del host. No volveremos a usar ese identificador para justificar la arquitectura del Master." "Anomalías de autoría: no permitir que una fila anómala con `taskId: null` bloquee indiscriminadamente tareas ajenas. La afectación debe justificarse por una relación o solapamiento concreto." "Activación de admisión: establecer una configuración confiable que no pueda ser manipulada mediante el prompt, sin activar cambios prematuramente en el core global enlazado al checkout." "No autorizo todavía implementar B ni activar `--admission-contract 1`." "Mantener T5 y la instalación del plugin como trabajos independientes."
- S99 (OD-R3-U2U5-B, IMPLEMENTATION_APPROVED): "Apruebo los dos contratos de S98 y autorizo implementar el corte B exclusivamente en el worktree `feat/router-u2-u5`, sin activarlo." "`claimedTaskId` puede utilizarse para negar crédito, nunca para otorgarlo." "`withoutTaskIdentity` debe eliminar también `claimedTaskId`." "El solapamiento debe conservarse como evidencia de ambigüedad para una futura aceptación, aunque hoy no retenga." "La ausencia de una fila en la traza no demuestra que una ejecución no ocurrió." Three configuration states: "Configuración ausente: Contrato inactivo; compatibilidad anterior". "Configuración válida y deshabilitada: Contrato inactivo". "Configuración corrupta o ilegible: Contrato inactivo, error explícito y ningún crédito de aceptación por esa ruta". "Una configuración inválida no debe confundirse silenciosamente con una desactivación voluntaria." "el flag es una declaración de compatibilidad, no una prueba de identidad del host. La ubicación del archivo debe resolverse desde el proyecto confiable, nunca desde una ruta inyectada en el prompt." "Acepto explícitamente que esto no proporciona aislamiento frente a procesos con acceso a la misma cuenta del sistema operativo." "la traza debe registrar si la admisión estaba activa, inactiva o tenía configuración inválida, sin convertir esa declaración en evidencia suficiente para acreditar proveedor o autoría." "La admisión debe volver a comprobarse al evaluar el veredicto, no únicamente antes de lanzar el Reviewer." "No autorizo activar el contrato, cambiar los hooks instalados ni retirar todavía los vetos globales." "basta una revisión cruzada del diff final, acompañada de pruebas deterministas." "No autorizo un nuevo push en este paso." "El estado esperado será `B_IMPLEMENTED_INACTIVE`, no `B_DEPLOYED` ni `ACCEPTED_OPERATIONAL`."
- S100 (OD-R3-C, CONDITIONAL_DENIAL_APPROVED): "Apruebo aplicar la denegación automática por proveedor agotado únicamente cuando el contrato de admisión esté activo." "la denegación por agotamiento requiere evidencia vigente del Router. Un dato `STALE`, una respuesta ausente o una declaración del prompt no equivalen a un agotamiento confirmado." "La continuidad legacy no constituye una excepción S23 ni concede aceptación." "`explicitModelVerdict` no debe convertir `keep` en autorización para saltar una exclusión aplicable." "que una sesión haya visto anteriormente el contrato activo no basta por sí solo para bloquear. Debe existir estado confiable del hook, vigente y asociado al Reviewer y la tarea correspondientes." "sus nombres no constituyen identidad autenticada de Reviewer." "La activación debe exigir confirmación explícita desde una interfaz confiable, no desde un subagente ni mediante instrucciones en el prompt. El requisito TTY es una protección contra activaciones accidentales, no una barrera frente a procesos con acceso al mismo usuario del sistema." "comprobar mediante tests qué ocurre cuando recibe `--admission-contract 1`. No asumir que ignora el argumento." "Un timeout no debe producir una denegación falsa, un bypass acreditado ni un lanzamiento duplicado." "el sistema debe distinguir entre una denegación realmente aplicada al lanzamiento y un simple veredicto del Router que el host no hizo cumplir." "Autorizo implementar C1–C4 en commits separados dentro del worktree aislado, con pruebas focalizadas por unidad y una revisión cruzada del conjunto final." "No debemos activar B+C como sustitutos incompletos de D."
- S101 (OD-R3-C, PROCEED_WITH_RECORDED_RISK): "Registrar como `FLAKY_UNATTRIBUTED`". "Si el fallo reaparece en la versión final durante la validación de D, debemos conservar el log completo, el código de salida, la prueba afectada y las condiciones de ejecución. En ese momento sí correspondería una investigación focalizada antes del merge." "El guard es una protección operativa contra activaciones o desactivaciones accidentales, no un límite de seguridad frente a procesos que ya ejecutan comandos con los permisos del usuario." "Documentamos que `disable` puede invocarse indirectamente." "No concedemos autoridad de aceptación basándonos exclusivamente en el guard." "`enforcement: prevented` continúa siendo una declaración falsificable, no una prueba independiente de bloqueo." "el recheck final no fue un PASS completo sin reservas." Invariants for D: "Independencia: el filtro global de Reviewer desaparece sin permitir que un Reviewer con conflicto S5 obtenga crédito." "Continuidad: Builder puede trabajar normalmente con el contrato inactivo; las ejecuciones `UNLINKED` no obtienen crédito." "Activación: con el contrato activo, los proveedores agotados y los Reviewers vinculados con conflicto conocido reciben la respuesta correspondiente sin fallback indebido." "Consistencia: ningún error, timeout, configuración corrupta o payload de traza falsificado puede elevar el resultado por encima de `REVIEWED_PENDING_PROVENANCE`." "D también debe retirar los vetos de `project-strategy.js` y `project-router.js` de manera coordinada." "Después autorizaremos el código de D como último corte de U2–U5."
- S102 (OD-R3-D, IMPLEMENTATION_APPROVED): "Autorizo implementar D1–D3 en el worktree `feat/router-u2-u5`, sin activar el contrato ni modificar el checkout activo." "Apruebo que `resolveProjectRoute` reciba `admissionActive = false` por defecto, pero ese valor debe derivarse de una fuente confiable, no de argumentos del modelo." "Admisión efectiva: requiere ambas condiciones en las rutas donde interviene el hook." "La aprobación de un equipo y la acreditación de su ejecución son operaciones distintas." "Apruebo que `disable` restaure el comportamiento legacy, incluso si anteriormente se aprobó un equipo dividido." "Pero no debe borrar ni modificar silenciosamente esa aprobación." "La advertencia debe explicar que el equipo sigue registrado, aunque determinadas rutas volverán a bloquearse bajo las reglas anteriores." "La eliminación de vetos globales no significa que cualquier Reviewer pueda revisar cualquier tarea. El predicado U3 conserva la responsabilidad de excluir conflictos conocidos por tarea." "Un proyecto con archivo habilitado pero hook incompatible nunca debe producir crédito de admisión aplicada." "El Router no debe permitir que un caller fuerce `admissionActive: true` mediante parámetros no confiables." "Si aparece un defecto que exige modificar la formación de equipos, los filtros de calificación o el sistema de tareas de Architect, detén esa ampliación y repórtala."
- S103 (OD-R3-D, SECOND_CORRECTION_APPROVED): "Autorizo una segunda y última corrección en el worktree `feat/router-u2-u5`, seguida de un recheck independiente limitado y la suite completa." "D permanece en estado `BLOCKED` hasta superar esa validación." "Todos los candidatos, incluidos modelo aprobado y fallback, deben superar la calificación compartida" "Un error de admisión no puede permitir lanzar un Reviewer vinculado con contrato activo" "Espiar `deps.startRun` y verificar que realmente no se ejecutó" "Si no existe Reviewer apto, devolver `WAIT_FOR_INDEPENDENT_REVIEW`. No alterar el umbral ni introducir excepciones por modelo." "No apruebo tratarlo como una excepción permanente." "La admisión evaluada por el core y la aplicación efectiva del hook son hechos distintos." "`admissionActive`: configuración efectiva." "`ADMITTED`: decisión favorable del predicado de admisión, con su origen identificable." "`enforcement`: evidencia diferenciada de si el control se aplicó realmente, por qué mecanismo o si no puede demostrarse." "Sin evidencia de aplicación suficiente, ninguna elevación de autoridad por encima de `REVIEWED_PENDING_PROVENANCE`." "Lo registramos como requisito de integración previo a una activación operativa con acreditación. No debe presentarse el sello actual como prueba de enforcement del hook." "No autorizo nuevas rondas automáticas de correcciones. Si aparece otro bloqueante, debe quedar identificado para una decisión nueva, no ocultarse bajo un `CONDITIONAL_PASS`." "podremos clasificar D como `D_IMPLEMENTED_INACTIVE_REVIEWED`, manteniendo G2 y los límites de procedencia explícitamente pendientes antes del despliegue."
- S104 (OD-R3-D, UNLINKED_CONTINUITY_APPROVED): "Un Reviewer `UNLINKED` sin candidato calificado debe conservar la continuidad, no quedarse esperando." "Pero con una condición fundamental: Kairo no puede presentar ese modelo como seleccionado, calificado o admitido por su sistema de gobernanza." "La continuidad `UNLINKED` no puede eludir restricciones duras, especialmente el agotamiento confirmado de un proveedor." "Todo Reviewer que Kairo seleccione o admita para una tarea vinculada debe superar el scorer compartido y las exclusiones S5." "`absent`: no existe identidad de tarea; continuidad sin crédito." "`not_found`: se declaró una identidad, pero no se pudo vincular; sin admisión ni crédito." "`task_unreadable`: existe una identidad real, pero la evidencia no puede leerse; fallo de admisión, no permiso." "Un error de lectura transitorio no puede convertirse en autorización para ejecutar un Reviewer vinculado con conflicto potencial." "No autorizo refactors, ajustes del scorer, cambios de umbral ni modificaciones fuera de este alcance." "Si aparece un nuevo bloqueante, detenerse sin iniciar otra corrección automática." "El diff sin commit debe permanecer intacto hasta superar la validación." "Una ejecución permitida por compatibilidad nunca debe confundirse con una selección válida de Kairo." Policy table rows: Reviewer `UNLINKED`, sin candidato calificado: "Continuar con el lanzamiento original del host, sin crédito". Reviewer `UNLINKED`, modelo aprobado pero no calificado: "Continuidad legacy; no selección acreditada de Kairo". Reviewer vinculado, candidato no calificado: `WAIT_FOR_INDEPENDENT_REVIEW`. Reviewer vinculado, scorer devuelve error: "No seleccionar candidato; informar fallo de elegibilidad". Reviewer vinculado, `task_unreadable`: "`ADMISSION_UNAVAILABLE`, sin lanzamiento". `taskId` ausente: "Continuidad `UNLINKED`, sin crédito". `taskId` declarado pero `not_found`: "Sin admisión ni crédito; continuidad legacy únicamente si no existe otra restricción aplicable". Proveedor agotado confirmado, contrato activo: "No lanzar automáticamente al proveedor agotado".
- S105 (OD-R3-D, INTEGRATION_BRIDGE_APPROVED): "Autorizo una última unidad correctiva acotada, ampliando el alcance a `integrations/claude-code/kairo-router/src/register.ts` y los tests correspondientes." "El core decide; el hook aplica la decisión." "Si el resultado del core es contradictorio o incompleto, no debe interpretarse como una selección válida." "Un error obteniendo telemetría no invalida una restricción de agotamiento previamente confirmada y vigente." "Si el contrato está activo y no puede determinarse de forma confiable si un proveedor previamente restringido volvió a estar disponible, Kairo no debe seleccionar automáticamente ese proveedor." "Las pruebas deben inspeccionar el punto real de lanzamiento, no únicamente el resultado calculado por el Router." "Si el recheck encuentra otro bloqueante, no autorizo una nueva corrección automática. En ese caso cambiaremos de estrategia: revisaremos el contrato completo core–hook como una sola frontera de ejecución, en vez de seguir corrigiendo síntomas individuales." Note: the file named in the decision is at hooks/register.ts.
- S106 (OD-R3-D, UNLINKED_ROUTING_WITHOUT_CREDIT): "Apruebo que Kairo enrute un Reviewer `UNLINKED` hacia un candidato calificado, pero sin acreditar selección gobernada, autoría ni independencia." "Routing operativo ≠ admisión gobernada ≠ independencia acreditada." "Importante: enrutar un `UNLINKED` no debe persistirse como `kind: valid` o `governed` si esos valores implican una selección acreditada." "Sí podemos registrar qué proveedor y modelo ejecutaron realmente la ruta, junto con el motivo operativo de selección. Esa telemetría no constituye crédito de gobernanza." "El core toma una decisión, pero cada punto de lanzamiento del hook vuelve a interpretarla." "Autorizo una especificación única del contrato core–hook, sin modificar código todavía." "El contrato será idéntico para lanzamiento inicial, handover, fallback y reintentos." "Una respuesta incompleta nunca se transforma implícitamente en permiso para un Reviewer vinculado bajo contrato activo." "Un proveedor con agotamiento confirmado y vigente no reaparece por una lectura posterior fallida." "Un `UNLINKED` puede recibir routing operativo, pero nunca crédito de independencia." "El hook no recalcula la autoridad de routing: aplica la decisión del core." "Una fila declarada o falsificable en `record-trace` no constituye evidencia de enforcement." "Cuando la evidencia es insuficiente, el resultado debe describir lo que realmente ocurrió, sin afirmar que se impidió un lanzamiento si no ocurrió tal bloqueo." "La aplicación del contrato también debe contemplar el caso de evidencia de agotamiento ilegible." "La validación futura deberá utilizar el código real del core desde una ejecución de prueba aislada y comprobar la decisión aplicada por el hook, sin lanzar modelos ni alterar sesiones activas." "No autorizo todavía otra implementación correctiva. Los 13 archivos sin commit y sus copias verificadas deben conservarse intactos."
- S107 (OD-C1, CONDITIONAL_FAIL_CLOSED): "No apruebo denegar siempre, porque bloquearíamos proyectos que nunca habilitaron la admisión. Tampoco apruebo conservar siempre el lanzamiento, porque permitiríamos que un Reviewer vinculado esquive U3 durante una caída." "Cuando falla el transporte y no existe una directiva válida, el hook debe resolver el estado de admisión mediante evidencia local confiable y limitada al proyecto." "Para lanzamientos sin marca de tarea, se conserva la continuidad permitida, salvo restricciones duras cuya vigencia pueda establecerse localmente." "Origen confiable: el hook lee el archivo directamente desde la ubicación canónica del proyecto. Nunca utiliza rutas proporcionadas por el prompt." "TTL estricto: una respuesta antigua no puede mantener indefinidamente el sistema activo o desactivado." "Aislamiento: el estado observado se vincula como mínimo al proyecto y a la sesión correspondiente; no se reutiliza entre proyectos." "Sin autoridad positiva por caché: el último estado conocido puede justificar una denegación conservadora, pero nunca conceder admisión o independencia." "Desactivación válida: una configuración actual, íntegra y explícitamente deshabilitada tiene prioridad sobre un estado `active` anterior." "Sin infraestructura adicional: no crear una segunda base de datos ni un servicio de estado para resolver este problema." "La mera existencia de un archivo válido con `enabled: false` no debe bloquear." "La comprobación local tampoco autentica a un proceso que comparte los permisos del usuario; conservamos ese límite de seguridad explícito." "No apruebo todavía una denegación universal para cualquier ejecución `UNLINKED`." "Debemos distinguir un agotamiento confirmado que no puede descartarse de una fuente que simplemente no pudo leerse." "Cuando exista una restricción confirmada y vigente, un error posterior no puede eliminarla. Si únicamente tenemos una lectura fallida, la política debe determinar qué proveedor está afectado y si realmente se requiere denegación." "De lo contrario, un EIO temporal podría detener todos los Builders de un proyecto." "Apruebo registrar las ejecuciones `UNLINKED` y de continuidad para mejorar la distribución y la trazabilidad, pero no llamaría proveedor real al proveedor declarado por la directiva." "Proveedor solicitado o seleccionado operativamente." "Lanzamiento intentado." "Proveedor efectivamente observado, cuando exista evidencia." "Ninguno de estos registros concede por sí mismo crédito S5." "La lógica local de OD-C1 será exclusivamente un mecanismo conservador ante fallos de transporte, no un segundo Router."
- S108 (OD-R3-S106-V2, DESIGN_REVISION_APPROVED): "## Decisión: `OD-R3-S106-V2 — DESIGN_REVISION_APPROVED`" "Autorizo una segunda versión de la especificación y un recheck independiente limitado a los ocho bloqueantes." "Sobre el handover, elijo desactivar el handover automático para Reviewers cuando el contrato de admisión esté activo." "Esta vez priorizo reducir la complejidad. Después de varias rondas de corrección, el problema ya no es agregar otra protección: necesitamos disminuir los caminos de ejecución que pueden contradecir la autoridad del core." Handover policy table: Reviewer, contrato inactivo: "Mantener comportamiento legacy". Reviewer `UNLINKED`, contrato activo: "Routing inicial permitido, sin crédito; ante fallo, no hacer handover automático". Reviewer vinculado, contrato activo: "Aplicar admisión U3; ante fallo, terminar el intento sin handover". Reviewer relanzado manualmente: "Nueva evaluación completa, nuevo `executionId`". Builder: "Conservar la política correspondiente a su rol". Proveedor agotado confirmado: "No seleccionarlo automáticamente". "Esto no elimina la posibilidad de cambiar de proveedor." "Un Reviewer puede seleccionarse inicialmente mediante Kairo y volver a ejecutarse después con otro proveedor. Lo que eliminamos es la cadena automática de reemplazos tras un fallo." "La revisión independiente S5 sigue siendo obligatoria para acreditar una revisión vinculada." Resolutions of the eight blockers: 1 "Predicados ordenados, mutuamente excluyentes y con resultado definido para conjuntos vacíos". 2 "Negociación de versión antes de aplicar reglas X1–X3; nunca degradar una restricción conocida". 3 "Desactivar handover automático de Reviewers con contrato activo; conservar identidad de intento y fallo". 4 "Esquema explícito con origen, proyecto, proveedor, vigencia y estado". 5 "Incorporar pacing, alias/modelo no representable y restantes consumidores al inventario". 6 "Estados diferentes, sin deducir `inactive` de errores de transporte". 7 "Separar registros operativos de evidencia válida para autoría, admisión e independencia". 8 "Definir comportamiento por rol y una activación coordinada de consumidores". Condition A: "Acepto conservar sus reglas de compatibilidad previas al routing, pero no dejarlos completamente fuera de las restricciones de autoridad." "Una excepción de reescritura no puede conceder crédito, saltar un agotamiento confirmado ni invalidar la admisión de un Reviewer vinculado." Condition B: "Apruebo utilizarla para restringir, nunca para conceder permisos." "La vigencia debe provenir de información verificable del core. Una declaración falsificable del hook no puede establecer por sí misma que una restricción sigue vigente indefinidamente." Condition C: "Apruebo el valor propuesto: no sustituirlos silenciosamente." "Para un Reviewer vinculado, denegar cuando no se pueda evaluar su elegibilidad. Para `UNLINKED`, conservar el lanzamiento original únicamente si no contradice una restricción dura conocida." Architecture: "Core — `decideLaunch()`" "Única autoridad para seleccionar, conservar o denegar" "Directiva versionada — `kairo.launch-directive/v1`" "`redirect` · `keep` · `deny`" "Integración — `applyDirective()`" "Aplica la decisión sin recalcular elegibilidad ni autoridad" "Registro y evaluación de evidencia" "Contabilidad operativa separada del crédito S5" "Esta debe ser una evolución del core existente, no la creación de otro runtime o framework de agentes." "No autorizo implementar T0–T4 todavía." "Primero necesitamos demostrar que la segunda versión tiene un contrato completo, pero debemos evitar otra revisión abierta que agregue indefinidamente nuevos requisitos." Closure criteria: "Las ocho deficiencias identificadas deben estar resueltas o explícitamente fuera del alcance con una razón comprobable." "Cada decisión debe producir una única acción para las mismas entradas." "No pueden existir estados intermedios que otorguen autoridad." "La activación debe preservar compatibilidad hasta que todos los consumidores relevantes estén preparados." "Si el recheck identifica una nueva contradicción estructural, no haremos una tercera reescritura automática. Evaluaremos reducir aún más el protocolo y su alcance." Astra: "No autorizo nuevas revisiones con Astra mientras esa discrepancia siga sin explicar. Para el recheck de esta especificación, utilizar un Reviewer independiente elegible que respete los límites actuales, sin forzar modelos frontera." "Registraremos el defecto por separado; no ampliaremos S106 para solucionarlo." Authorization: "Actualizar S106 a V2 — Autorizado" "Un recheck focalizado de los ocho hallazgos — Autorizado" "Implementar T0–T4 — Sin autorizar" "Modificar los 13 archivos del worktree — Sin autorizar" "Merge, instalación, activación o push — Sin autorizar" "Conservamos el diff y las copias verificadas." "La dirección es simplificar y cerrar. El routing adaptativo puede seguir siendo sofisticado, pero la admisión y el enforcement tienen que ser pequeños, deterministas y comprobables." "Prefiero un Reviewer que falle y pueda reintentarse explícitamente a una cadena de handovers que termine ejecutando un modelo distinto del autorizado sin que Kairo pueda demostrarlo."
- S109 (OD-R3-S106-V2.1, TARGETED_CORRECTION_APPROVED): Sam's decision, verbatim, applies to S106 V2 and nothing else. One scoped correction of three defects and one independent recheck limited to them. T0-T4, code, the 13 worktree files, merge, install, activation and push stay unauthorized.

> ## Decisión: `OD-R3-S106-V2.1 — TARGETED_CORRECTION_APPROVED`
>
> Elijo la opción 1. Autorizo una corrección acotada de los tres defectos y un único recheck independiente limitado a ellos.
>
> No necesitamos reducir el protocolo ni iniciar una V3 completa. La revisión confirmó que B3–B8 están resueltos y que los problemas restantes son de precedencia, definición de predicados y exclusividad de resultados.
>
> ### 1. Correcciones autorizadas
>
> | Defecto    | Decisión |
> | ---------- | -------- |
> | B1 — P8    | `exhaustion-unknown` aplica cuando la fuente necesaria es ilegible, aunque existan restricciones cacheadas sobre otros proveedores. |
> | B1 — P4    | Un actor `review-*` con tarea vinculada no puede saltarse U3. P4 sólo conserva la compatibilidad para actores Gentle AI sin semántica de Reviewer. |
> | B2 — X2–X7 | Definir precedencia estricta y resultados mutuamente excluyentes, incluidos contrato corrupto, directiva malformada y negociación incompleta. |
>
> ### 2. Condiciones de seguridad
>
> P8 — Evidencia incompleta
>
> Si el ledger es ilegible, una restricción conocida sobre Codex no demuestra que Claude esté disponible.
>
> Para un Reviewer vinculado, la ausencia de evidencia suficiente debe impedir que el sistema conceda admisión o crédito provisional. No debemos convertir una restricción parcial en autorización sobre los proveedores restantes.
>
> P4 — Identidad del Reviewer
>
> El nombre `review-*` puede servir para aplicar controles conservadores, pero no constituye una identidad autenticada ni concede crédito de Reviewer.
>
> Si existe una tarea vinculada y la operación tiene semántica de revisión, debe pasar por U3 antes de cualquier excepción de compatibilidad. Un actor Gentle AI no puede utilizar su nombre para eludir esa comprobación.
>
> X2–X7 — Transporte
>
> El orden debe distinguir primero la compatibilidad del protocolo y el estado efectivo de activación; después, aplicar las reglas de transporte.
>
> En particular:
>
> - Archivo corrupto no equivale a contrato desactivado.
> - Directiva malformada equivale a ausencia de directiva válida, nunca a permiso.
> - X5 debe definir exactamente qué significa una respuesta válida y vigente, incluidos origen, versión y TTL.
> - La mera existencia del archivo no demuestra que todos los consumidores estén preparados.
> - Para una misma entrada debe existir exactamente una acción final.
>
> No introduciremos otra lógica de routing dentro del hook para resolver estos casos.
>
> ## 3. Validación autorizada
>
> El recheck debe comprobar las entradas concretas que reprodujeron los defectos y verificar que no reaparecen contradicciones en sus intersecciones.
>
> El resultado esperado es:
>
> - P8 no concede crédito ante evidencia de agotamiento ilegible.
> - P4 no permite eludir U3.
> - X2–X7 tienen precedencia única y resultados completos.
> - No aparecen estados intermedios que concedan autoridad.
> - B3–B8 conservan los contratos ya aprobados.
>
> No autorizo repetir una revisión general de toda la arquitectura. Un Reviewer independiente elegible puede revisar las modificaciones concretas, sin utilizar Astra mientras la discrepancia de cuota siga abierta.
>
> ## 4. Alcance de esta autorización
>
> | Operación                             | Estado        |
> | ------------------------------------- | ------------- |
> | Corregir S106 V2 → V2.1               | Autorizado    |
> | Commit documental local               | Autorizado    |
> | Un recheck focalizado                 | Autorizado    |
> | Modificar código del worktree         | No autorizado |
> | Implementar T0–T4                     | No autorizado |
> | Merge, instalación, activación o push | No autorizado |
>
> El diff de 13 archivos y sus copias verificadas deben permanecer intactos.
>
> ### Qué haremos después
>
> Si V2.1 supera el recheck, cerramos la fase de diseño y pasamos a T0, cuyo objetivo es demostrar el mecanismo de integración core–hook antes de seguir modificando el producto.
>
> Si vuelve a fallar por un defecto menor de especificación, evaluaremos su impacto real sin reiniciar automáticamente otra ronda de correcciones.
>
> La prioridad ahora es terminar. Tenemos suficientes decisiones arquitectónicas; necesitamos convertirlas en un contrato determinista y comenzar a validarlo con código real, sin seguir ampliando indefinidamente el alcance.

- S110 (OD-R3-S109, REVIEW_IDENTITY_CONSERVATIVE): Sam's decision, verbatim, applies to S109 and S106 V2.1 and nothing else. A documentation-only correction so that S109 and V2.1 state one policy: any review-* actor with a linked task passes through U3, and so does any declared review operation with a linked task. One focused check follows. T0-T4 and worktree code stay unauthorized.

> ## Decisión: `OD-R3-S109 — REVIEW_IDENTITY_CONSERVATIVE`
>
> Elijo la opción 2. Cualquier actor `review-*` con una tarea vinculada debe pasar por U3, aunque no declare explícitamente semántica de revisión.
>
> La razón es que la ausencia de una declaración de revisión no puede utilizarse para evitar la admisión por tarea.
>
> ### Contrato definitivo
>
> | Situación                                         | Comportamiento                                                       |
> | ------------------------------------------------- | -------------------------------------------------------------------- |
> | `review-*` + tarea vinculada                      | Pasa obligatoriamente por U3 (P5–P12)                                |
> | Operación de revisión declarada + tarea vinculada | Pasa obligatoriamente por U3                                         |
> | `review-*` + `UNLINKED`                           | Continuidad según política, sin crédito                              |
> | Actor Gentle AI sin semántica de revisión         | Conserva compatibilidad P4, sujeto a restricciones aplicables        |
> | Identidad de tarea ilegible                       | No se interpreta como `UNLINKED` legítimo; aplicar política de error |
>
> ### Distinción fundamental
>
> El nombre `review-*` constituye una señal conservadora para aplicar restricciones, nunca una prueba de identidad.
>
> Por tanto:
>
> - Puede activar controles adicionales.
> - No acredita que el agente sea un Reviewer legítimo.
> - No demuestra independencia S5.
> - No concede permisos ni autoridad.
> - No permite emitir un veredicto acreditado por sí solo.
>
> Esto también evita que un agente omita su declaración de rol para eludir U3.
>
> ### Qué autorizo ahora
>
> Apruebo una corrección documental mínima para que S109 y V2.1 expresen exactamente la misma política.
>
> No hace falta rediseñar el protocolo ni reabrir B3–B8. Basta con ajustar el predicado de P4/P5 y agregar el caso concreto a la matriz de validación.
>
> La V2.1 conserva su resultado `READY` respecto de los defectos ya revisados, pero este ajuste debe comprobarse de forma focalizada antes de considerar cerrada la especificación.
>
> No autorizo todavía modificar el código del worktree ni implementar T0–T4.
>
> ### Siguiente etapa
>
> Una vez validada esta precisión, cerramos el diseño del protocolo core–hook y pasamos a T0: demostrar que podemos ejecutar el core real y aplicar su directiva desde el arnés de pruebas, sin modelos ni modificaciones de producto.
>
> No necesitamos más rondas de arquitectura si no aparecen contradicciones materiales.
>
> Decisión final: opción 2. El nombre puede restringir, pero jamás acreditar.
- S111 (OD-R3-S106-V2.2, MINIMAL_CLOSURE_APPROVED): Sam's decision, verbatim, applies to S106 V2.2 and nothing else:
>
> ## Decisión: `OD-R3-S106-V2.2 — MINIMAL_CLOSURE_APPROVED`
>
> Elijo la opción 1. Autorizo el cierre mínimo de la especificación, sin otra revisión independiente.
>
> El defecto restante es una inconsistencia documental entre la tabla B8 y la matriz P1–P16, no una contradicción nueva en la política. No justifica otra ronda completa.
>
> ### 1. Decisiones definitivas
>
> | Elemento                      | Decisión                                                                                 |
> | ----------------------------- | ---------------------------------------------------------------------------------------- |
> | P12g                          | Se mantiene sin crédito, incluso si el actor Gentle AI declara una operación de revisión |
> | Actores `review-*` vinculados | Deben pasar por U3; el nombre sólo activa restricciones                                  |
> | Tabla B8                      | Limitar filas 1–3 a actores `non-gentle-owned`                                           |
> | Encabezado                    | Actualizar V2.1 → V2.2                                                                   |
> | P11                           | Aclarar precedencia con P3, sin cambiar comportamiento                                   |
> | Revisión                      | Verificación estructural del diff, sin nuevo Reviewer                                    |
>
> ### 2. Por qué P12g permanece sin crédito
>
> Un actor Gentle AI puede efectuar una revisión válida como parte de su workflow, pero eso no significa que Kairo haya acreditado su independencia.
>
> Debemos distinguir:
>
> - Revisión ejecutada: puede existir.
> - Admisión U3: puede aplicar restricciones.
> - Independencia S5 acreditada: requiere evidencia suficiente.
> - Autoridad de aceptación: no se obtiene automáticamente.
>
> Como Kairo no controla ni verifica completamente ese lanzamiento, P12g no puede otorgar crédito de independencia, aunque el actor declare semántica de revisión.
>
> Esto preserva nuestra separación entre ejecución, evidencia y autoridad.
>
> ### 3. Advertencia importante para T0
>
> El estado `governed-provisional/ROUTED_LINKED` de P12g sigue siendo potencialmente ambiguo.
>
> No autorizo cambiarlo ahora sólo por su nombre. Pero T0 deberá verificar que ningún consumidor lo interprete como autorización, independencia o crédito positivo cuando `credit = none`.
>
> Si algún consumidor concede crédito basándose exclusivamente en ese estado, será un bloqueante para la implementación, no una advertencia menor.
>
> ## 4. Autorización de T0
>
> Autorizo iniciar T0 una vez que la corrección documental mínima supere la lectura estructural.
>
> El alcance será estrictamente experimental:
>
> 1. Construir un arnés aislado que invoque el core real, sin modelos.
> 2. Confirmar que puede capturar la salida y los errores sin modificar el checkout activo.
> 3. Probar inicialmente los escenarios D2 y D6 previstos.
> 4. Verificar cómo se resuelven la raíz canónica, `HARNESS_HOME`, el `commondir` del worktree y la identidad del proyecto.
> 5. Comprobar si el esquema permite representar la versión del protocolo, los sellos y el estado de activación sin atribuir crédito accidental.
>
> Como `decideLaunch` y `kairo.launch-directive/v1` aún no están implementados, T0 debe demostrar la viabilidad del arnés, no afirmar que el core ya produce directivas de ese protocolo.
>
> Si hace falta simular una directiva, deberá identificarse explícitamente como fixture. No se aceptará como prueba de enforcement real.
>
> ### 5. Límites
>
> Corrección documental y commit local — Autorizado
> T0 — Arnés experimental aislado — Autorizado
> T1–T4 — Implementación del protocolo — Sin autorizar
> Modificar los 13 archivos pendientes de D — Sin autorizar
> Instalación, activación, merge o push — Sin autorizar
>
> El resultado esperado es `PROTOCOL_DESIGN_CLOSED`, condicionado a verificar las correcciones mecánicas, y posteriormente un reporte `T0_PASS` o `T0_BLOCKED` con evidencia.
>
> No seguiremos reabriendo la arquitectura por diferencias de redacción que no cambian el comportamiento definido.
>
> Cerramos el diseño y comenzamos la validación técnica.
- S112 (OD-R3-T0, ACCEPTED / T1 AUTHORIZED): Sam's decision, verbatim, applies to T0 closure, T1 and the administrative cleanup and nothing else:
>
> ## Decisión: `OD-R3-T0 — ACCEPTED / T1 — AUTHORIZED`
>
> Acepto T0 como validación del arnés y autorizo avanzar con T1, exclusivamente en un worktree aislado. T2–T4 continúan sin autorización.
>
> Los 19/19 tests repetidos son evidencia suficiente para cerrar el objetivo experimental de T0. Sin embargo, T0 no demuestra todavía que el protocolo core–hook funcione de extremo a extremo. Eso sigue pendiente.
>
> ### 1. Cierre de T0
>
> | Elemento                                | Decisión                                            |
> | --------------------------------------- | --------------------------------------------------- |
> | Arnés aislado y ejecución del core real | PASS                                                |
> | Escenarios D2 y D6                      | PASS                                                |
> | Identidad canónica desde el core        | PASS                                                |
> | Identidad canónica desde el hook        | Parcial; pendiente de T2                            |
> | Esquema de directivas y persistencia    | Parcial; pendiente de T1/T3                         |
> | Consumo indebido de crédito P12g        | Sin defecto detectado en los consumidores revisados |
> | Estado final                            | `T0_PASS_HARNESS_ONLY`                              |
>
> Autorizo corregir la ruta de `register.ts` en la documentación, registrar el estado final y realizar un commit documental local.
>
> También autorizo retirar los directorios temporales identificados como pertenecientes exclusivamente a T0, después de comprobar que no estén en uso y que sus rutas sean las esperadas. No autorizo borrar indiscriminadamente `tmp.*` ni otros archivos temporales.
>
> No necesitas crear una célula nueva para estas tareas administrativas.
>
> ## 2. Decisiones técnicas necesarias para T1–T3
>
> ### A. Activación: el core es la fuente de verdad
>
> El hook no debe calcular por su cuenta dónde está el proyecto ni interpretar los archivos de configuración.
>
> Decisión: utilizar `kairo team admission status --json` para obtener la identidad y el estado confiable de activación cuando sea necesario.
>
> En el flujo normal, la directiva del core incluirá la información de activación relevante. No haremos una segunda consulta de estado por cada lanzamiento si ya existe una respuesta válida y completa.
>
> En fallos de transporte se aplica OD-C1, sin conceder autoridad positiva a información cacheada.
>
> ### B. Identidad de tareas en worktrees
>
> La identidad de la tarea y la evidencia del ledger deben resolverse mediante un mismo proyecto canónico.
>
> Para repositorios Git con worktrees vinculados, utilizaremos la identidad compartida derivada del `commondir` real, respetando el contrato de S111.
>
> No quiero que una tarea pase a `not_found` únicamente porque el agente trabaja desde otro worktree del mismo repositorio.
>
> Esto requiere pruebas de aislamiento entre repositorios diferentes y de correlación entre worktrees. No autoriza migrar ni mezclar automáticamente los registros existentes sin verificar sus claves.
>
> ### C. Tests del arnés
>
> Antes de integrar T0, debe separarse su ejecución de la suite general de producto.
>
> Autorizo ajustar la ubicación o el patrón de descubrimiento para que:
>
> - `npm test` ejecute las pruebas de producto previstas.
> - T0 tenga su comando de prueba explícito.
> - Ninguna prueba experimental se ejecute accidentalmente con el producto instalado.
>
> No necesitamos eliminar las pruebas de T0: serán útiles para T1–T4.
>
> ## 3. Implementación T1 autorizada
>
> Objetivo: hacer que el core produzca una directiva versionada real mediante una única función de decisión, sin cambiar todavía el comportamiento del hook instalado.
>
> Entradas normalizadas
>
> Intento · Tarea · Elegibilidad · Evidencia · Restricciones
>
> `decideLaunch()`
>
> Autoridad central basada en S106 V2.2
>
> `kairo.launch-directive/v1`
>
> `redirect` · `keep` · `deny`
>
> La implementación debe conservar la salida legacy para consumidores que no hayan negociado explícitamente V1.
>
> Los criterios mínimos serán:
>
> 1. Cada entrada válida produce una única directiva conforme a la matriz aprobada.
> 2. Los errores de evidencia y calificación no generan permisos implícitos.
> 3. La directiva distingue routing operativo de crédito.
> 4. El core no depende de campos inventados por el hook.
> 5. El arnés ejecuta el core real y valida respuestas reales, no fixtures duplicados.
> 6. Las rutas legacy mantienen su compatibilidad.
>
> No autorizo que T1 modifique `register.ts` ni sustituya todavía sus decisiones existentes. Esa integración corresponde a T2.
>
> ## 4. Alcance operativo
>
> | Operación                                       | Autorización  |
> | ----------------------------------------------- | ------------- |
> | Cerrar documentalmente T0                       | Autorizada    |
> | Limpieza controlada del scratch T0              | Autorizada    |
> | Separar pruebas experimentales                  | Autorizada    |
> | Implementar T1 en worktree aislado              | Autorizada    |
> | Tests deterministas y revisión focalizada de T1 | Autorizados   |
> | Modificar los 13 archivos pendientes de D       | No autorizado |
> | Implementar T2–T4                               | No autorizado |
> | Actualizar plugin instalado                     | No autorizado |
> | Activar admisión, merge o push                  | No autorizado |
>
> ### 5. Qué espero al finalizar T1
>
> Quiero un reporte breve que responda tres preguntas:
>
> - ¿El core produce correctamente todas las directivas de la matriz?
> - ¿Los consumidores legacy siguen funcionando sin cambios?
> - ¿Qué integración exacta necesita T2 para aplicar esas directivas desde el hook?
>
> Si T1 cumple esos criterios, pasaremos directamente a T2 sin reabrir la arquitectura.
>
> La meta inmediata es dejar de corregir interpretaciones distintas del Router y conseguir que todos los puntos de ejecución utilicen una misma decisión verificable.

- S113 (OD-R3-T2, IMPLEMENTATION_APPROVED): Sam's decision, verbatim, applies to T2 and nothing else:
>
> ## Decisión: `OD-R3-T2 — IMPLEMENTATION_APPROVED`
>
> Sí. Autorizo implementar T2 en un worktree aislado. Acepto los cuatro valores propuestos, con condiciones de seguridad para evitar que introduzcan autoridad implícita.
>
> T1 tiene evidencia suficiente para avanzar: 138/138 pruebas del protocolo, 19/19 del arnés y revisión cruzada favorable. No necesitamos repetir el diseño.
>
> ### 1. Las cuatro decisiones
>
> | Decisión                                   | Resolución                                                |
> | ------------------------------------------ | --------------------------------------------------------- |
> | TTL de directiva: 5 minutos                | Aprobado como vigencia máxima                             |
> | `team task open` desde worktree            | Aprobado: usa el registro canónico del checkout principal |
> | Servicio: proveedor + modelo exactos       | Aprobado; discrepancia implica espera, nunca sustitución  |
> | Restricción cacheada: horizonte de 5 horas | Aprobado como límite máximo de vigencia admitida          |
>
> Condiciones:
>
> TTL: la directiva debe estar vinculada al proyecto, sesión e intento correspondientes. Cinco minutos no significan que pueda reutilizarse para otro lanzamiento. Una directiva expirada, alterada o correspondiente a otra ejecución no autoriza nada.
>
> Worktrees: reutilizar `.ai/tasks` del checkout principal evita identidades divergentes. Sin embargo, las pruebas de T2 deben realizarse en repositorios temporales. No autorizo escribir tareas experimentales en el proyecto activo.
>
> Servicio: si el par proveedor/modelo no coincide exactamente con la directiva, no debe ejecutar otro modelo por conveniencia. Debe informar el motivo y conservar el estado de espera correspondiente.
>
> Caché: sólo se acepta evidencia negativa vigente, vinculada al proyecto y sesión, con vencimiento verificable dentro del horizonte máximo de cinco horas. No se renueva su TTL simplemente porque se volvió a leer. Cuando el ledger sea ilegible, la ausencia de una restricción cacheada no demuestra disponibilidad ni permite conceder admisión a un Reviewer vinculado.
>
> ## 2. Alcance autorizado de T2
>
> La meta es que el hook deje de interpretar por su cuenta las decisiones del Router.
>
> Kairo Core — T1
>
> `decideLaunch()` produce una directiva versionada
>
> T2 — Hook
>
> Negocia protocolo, valida y ejecuta `applyDirective()`
>
> Resultado
>
> `redirect` · `keep` · `deny`, sin reinterpretar autoridad
>
> Autorizo:
>
> 1. Invocar el core real mediante `--launch-protocol kairo.launch-directive/v1` y `--launch-facts`.
> 2. Implementar un único `applyDirective()` para lanzamiento inicial y las demás rutas aplicables.
> 3. Implementar las reglas X1–X7, incluida la negociación con versiones anteriores.
> 4. Conservar las excepciones y restricciones aprobadas para actores Gentle AI, Reviewers vinculados y `UNLINKED`.
> 5. Agregar pruebas integradas core → hook → lanzamiento simulado, sin ejecutar modelos.
> 6. Corregir el arnés para limpiar automáticamente los recursos temporales que cree, incluso cuando falle una prueba.
>
> El hook no debe recalcular scores, independencia, agotamiento ni selección de proveedor. Esas decisiones pertenecen al core.
>
> ## 3. Criterios de aceptación
>
> | Caso                                                   | Resultado obligatorio                                                     |
> | ------------------------------------------------------ | ------------------------------------------------------------------------- |
> | Directiva válida y vigente                             | Se aplica exactamente una vez                                             |
> | Directiva incompleta, malformada o expirada            | Se aplica la política X correspondiente; nunca se interpreta como permiso |
> | Reviewer vinculado, contrato activo y core inaccesible | Se aplica OD-C1 sin conceder crédito                                      |
> | Reviewer `UNLINKED` calificado                         | Puede redirigirse operativamente, sin crédito                             |
> | Actor Gentle AI                                        | Sin reescritura prohibida ni crédito implícito                            |
> | Proveedor agotado confirmado                           | No reaparece mediante fallback                                            |
> | Core antiguo o contrato inactivo                       | Compatibilidad legacy conforme a la matriz                                |
> | Handover de Reviewer con contrato activo               | No hay reemplazo automático                                               |
>
> Las pruebas deben comprobar el lanzamiento efectivo y no únicamente la directiva recibida.
>
> ## 4. Un límite importante
>
> El trabajo pendiente de D contiene 13 archivos sin commit. T2 no debe reemplazar, limpiar ni sobrescribir ese diff.
>
> Debe desarrollarse sobre la base apropiada en un worktree separado, reutilizando T1 y los contratos aprobados. Si alguna modificación requiere reconciliar código de D, se documenta la dependencia antes de modificarlo.
>
> Tampoco autorizo implementar por adelantado los cambios de persistencia de T3. Hasta entonces, las directivas y la traza no deben conferir autoridad adicional.
>
> ## 5. Estado de autorización
>
> | Operación                                           | Estado        |
> | --------------------------------------------------- | ------------- |
> | Implementar T2 en worktree                          | Autorizado    |
> | Pruebas deterministas y revisión cruzada focalizada | Autorizadas   |
> | Commits locales tras validación                     | Autorizados   |
> | Corregir limpieza del arnés                         | Autorizado    |
> | Modificar el plugin instalado 0.7.5                 | No autorizado |
> | Implementar T3–T4                                   | No autorizado |
> | Activar admisión                                    | No autorizado |
> | Merge o push                                        | No autorizado |
> | Registrar veredictos pendientes                     | No autorizado |
>
> Al terminar, el resultado esperado es `T2_IMPLEMENTED_INACTIVE`, condicionado a las pruebas y a la revisión.
>
> Mi prioridad para T2 es comprobar que el core decide y el hook obedece. Si logramos esa garantía sin rutas paralelas de decisión, habremos resuelto la causa estructural que mantuvo bloqueado D durante tantas iteraciones.
- S114 (OD-R3-T2, KNOWN_REVIEWER_FAIL_CLOSED): Sam's decision, verbatim, applies to T2 and nothing else:
>
> ## Decisión: `OD-R3-T2 — KNOWN_REVIEWER_FAIL_CLOSED`
>
> Elijo la opción 2: denegación conservadora para Reviewers conocidos del equipo cuando el core esté inaccesible.
>
> Un Reviewer vinculado a una tarea no debe ejecutarse sin admisión U3 simplemente porque su nombre no comience por `review-*`.
>
> Pero tampoco debemos bloquear a todos los agentes con `taskId`, porque eso afectaría a Builders y otros roles que tienen una política de continuidad diferente.
>
> ### 1. Comportamiento aprobado
>
> | Situación                                                               | Acción                                      |
> | ----------------------------------------------------------------------- | ------------------------------------------- |
> | Reviewer reconocido en el equipo aprobado + `taskId` + core inaccesible | `DENY — ADMISSION_STATE_UNKNOWN`            |
> | Reviewer `review-*` + `taskId` + core inaccesible                       | `DENY — ADMISSION_STATE_UNKNOWN`            |
> | Reviewer con directiva válida                                           | Aplicar `applyDirective()`                  |
> | Builder + `taskId` + core inaccesible                                   | Mantener continuidad permitida, sin crédito |
> | Agente de rol desconocido, sin evidencia previa de revisión             | X7: continuidad sin crédito                 |
> | Contrato explícitamente desactivado                                     | Comportamiento legacy                       |
>
> La restricción debe aplicarse únicamente cuando el contrato corresponda a una activación efectiva o exista evidencia confiable y vigente que justifique una denegación conservadora. No debe afectar proyectos que nunca habilitaron la admisión.
>
> ### 2. Fuente local de identidad
>
> No quiero crear otra base de datos de roles.
>
> Primero debemos reutilizar la estrategia de equipo aprobada que ya persiste Kairo. Si el hook no puede consultarla de forma confiable durante una caída del core, autorizo especificar un snapshot local mínimo generado por el core.
>
> Ese snapshot deberá:
>
> - Identificar el proyecto canónico y los Reviewers del equipo aprobado.
> - Tener versión, vínculo a la aprobación y vigencia definida.
> - Generarse mediante escritura atómica.
> - Utilizarse exclusivamente para restringir ejecuciones.
> - No conceder selección, independencia ni aceptación.
>
> El nombre del agente puede activar una restricción, pero nunca acreditar que una revisión fue ejecutada por un proveedor determinado.
>
> Si el hook no puede identificar de forma confiable el proyecto o el Reviewer, no debe inventar esa identidad. Ese caso conserva el límite de X7 y debe registrarse como cobertura incompleta, no como una denegación exitosa.
>
> ### 3. Qué autorizo
>
> Apruebo una corrección focalizada de T2 para cubrir esta decisión, si puede reutilizarse una fuente local existente sin introducir otro subsistema.
>
> Si requiere crear el snapshot nuevo, primero debe quedar especificado su contrato mínimo y su ciclo de vida; no autorizo implementarlo todavía sin revisar esa dependencia.
>
> Las pruebas deben demostrar el comportamiento ante primera ejecución, caída del core, proyecto equivocado, estado desactualizado y contrato desactivado. Deben verificar si ocurrió realmente un lanzamiento.
>
> ## 4. Estado de T2
>
> T2 continúa como `IMPLEMENTED_INACTIVE`, pero no está aceptado.
>
> La corrección `8d1a95378` todavía necesita un recheck independiente favorable. Además, la suite completa reportó 4902/4903, aunque el test fallido haya pasado aisladamente. Debemos conservarlo como fallo intermitente no atribuido hasta obtener una validación final satisfactoria.
>
> No autorizo instalación, activación, merge, push ni T3.
>
> Objetivo: cerrar la brecha del primer lanzamiento sin ampliar indiscriminadamente el bloqueo, ni volver a distribuir lógica de gobernanza entre el core y el hook.

- S115 (OD-R3-T2, REVIEWED_INACTIVE / SNAPSHOT_APPROVED): Sam's decision, verbatim, applies to T2, the snapshot unit and the /tmp/x cleanup and nothing else:
>
> ## Decisión: `OD-R3-T2 — REVIEWED_INACTIVE / SNAPSHOT_APPROVED`
>
> Acepto la implementación actual de T2 como revisada e inactiva, con una limitación pendiente: la protección del primer lanzamiento de un Reviewer conocido cuando el core está inaccesible.
>
> El recheck favorable, las dos ejecuciones completas limpias y la reproducción de los fallos bajo carga son evidencia suficiente para no seguir bloqueando T2 por esos tests. Sin embargo, la implementación del snapshot sigue siendo necesaria antes de activar el protocolo.
>
> ## 1. Los tres valores quedan aprobados
>
> | Decisión | Resolución |
> |---|---|
> | Vigencia del snapshot | 24 horas como máximo |
> | Ubicación | `<HARNESS_HOME || HOME>/.harness/reviewer-snapshots.json` |
> | Worktree desconocido por el core | X7: continuidad sin crédito, con cobertura incompleta registrada |
>
> ### Vigencia de 24 horas
>
> Apruebo las 24 horas porque el snapshot sólo permite denegar, nunca autorizar una ejecución.
>
> Condiciones: el TTL comienza cuando el core genera evidencia válida, nunca cuando el hook lee el archivo; un cambio de aprobación o una desactivación explícita debe actualizar o invalidar el estado correspondiente; y el hook no puede renovar la vigencia por su cuenta.
>
> Una entrada vencida deja de ser autoridad para denegar. No se interpreta como una autorización positiva.
>
> ### Ubicación global
>
> Apruebo el archivo compartido, con entradas separadas por `projectKey`.
>
> Hay una precaución importante: la escritura atómica con rename no evita que dos procesos sobrescriban actualizaciones entre sí. El contrato debe definir cómo serializar escrituras concurrentes o detectar conflictos sin perder entradas de otros proyectos.
>
> Además, el hook debe utilizar la misma precedencia de `HARNESS_HOME` que el core. Si no puede resolver una entrada de manera inequívoca, no debe adivinar el proyecto basándose en una coincidencia parcial del directorio.
>
> No necesitamos introducir una base de datos adicional.
>
> ### Worktrees desconocidos
>
> Apruebo X7 cuando el core todavía no conoce ese worktree.
>
> Esto significa:
>
> - El lanzamiento puede continuar según la política de compatibilidad.
> - No obtiene crédito de admisión o independencia.
> - Se registra `REVIEWER_SNAPSHOT_COVERAGE_INCOMPLETE`.
> - No se afirma que U3 haya protegido ese lanzamiento.
>
> Es una degradación de cobertura aceptada temporalmente, no un bypass acreditado. Antes de elevar la autoridad operativa habrá que incorporar el registro de nuevas raíces de worktree.
>
> ## 2. Estado real de T2
>
> Core → hook y aplicación de directivas — Implementado y revisado en el entorno aislado
> Recheck de cinco bloqueantes — PASS reportado en 8d1a95378
> Suite completa — Dos corridas finales de 4903/4903, exit 0
> Tests sandbox bajo concurrencia — Interferencia observada en COMMIT_EDITMSG; no está demostrado que sea preexistente
> Snapshot del primer lanzamiento — Especificado, todavía no implementado
>
> Por tanto, el estado correcto es `T2_REVIEWED_INACTIVE_WITH_KNOWN_GAP`, no `T2_DEPLOYED` ni `T2_OPERATIONALLY_ACCEPTED`.
>
> ## 3. Siguiente trabajo autorizado
>
> Autorizo una unidad acotada para implementar `kairo.reviewer-snapshot/v1` en un worktree aislado, sin activar el protocolo. Debe reutilizar la aprobación existente del equipo, validar su vinculación al proyecto, comprobar expiración y concurrencia entre escrituras, y probar el primer lanzamiento con el core inaccesible.
>
> La validación debe cubrir especialmente que un snapshot de otro proyecto, vencido, corrupto o con raíces ambiguas nunca conceda autoridad, y que un Reviewer conocido con snapshot vigente y admisión efectiva sea efectivamente denegado cuando falle el core.
>
> Una revisión independiente focalizada es suficiente.
>
> También autorizo borrar `/tmp/x` si se confirma que es el archivo temporal creado por el test-runner, no es un symlink y no está en uso.
>
> No autorizo todavía T3–T4, modificar el plugin instalado, merge, push, activación ni registrar veredictos pendientes.
>
> Conclusión: T2 ya tiene una base implementada y revisada. Nos falta cerrar una protección concreta, no rediseñar el protocolo. Después de validar el snapshot podremos pasar a T3 y completar la persistencia de evidencia sin seguir ampliando T2.

- S116 (OD-R3-T3, IMPLEMENTATION_APPROVED): Sam's decision, verbatim, applies to the snapshot renewal policy and T3 in an isolated worktree and nothing else:
>
> ## Decisión: `OD-R3-T3 — IMPLEMENTATION_APPROVED`
>
> Confirmo la política de renovación del snapshot y autorizo implementar T3 en un worktree aislado.
>
> El snapshot superó su revisión independiente sin bloqueantes. Podemos dar por cerrada esa unidad como `SNAPSHOT_REVIEWED_INACTIVE` y avanzar hacia la persistencia del protocolo core–hook.
>
> ## 1. Renovación del snapshot — Aprobada
>
> Confirmo el comportamiento propuesto.
>
> | Situación                                       | Comportamiento                           |
> | ----------------------------------------------- | ---------------------------------------- |
> | Entrada vigente e idéntica                      | No se reescribe                          |
> | Entrada inexistente                             | Se crea con evidencia válida del core    |
> | Entrada vencida                                 | Se regenera tras obtener nueva evidencia |
> | Cambia la aprobación, el equipo o la activación | Se actualiza con evidencia nueva         |
> | El hook consulta el snapshot                    | Sólo lectura, sin renovación             |
> | Falla la actualización                          | No se extiende la vigencia anterior      |
>
> El TTL máximo continúa siendo de 24 horas.
>
> Una precisión: habilitar o deshabilitar la admisión debe actualizar o invalidar el snapshot como parte de esa operación exitosa. No debemos depender de una consulta posterior para reflejar una desactivación explícita.
>
> La carrera residual del lock y la llamada Git sin timeout quedan registradas como deuda de robustez. No bloquean T3 porque el snapshot no concede permisos ni crédito.
>
> ## 2. T3 — Alcance autorizado
>
> Objetivo: integrar las directivas de T1/T2 con las estructuras existentes de traza y ledger sin introducir autoridad que todavía no podemos acreditar.
>
> | Unidad                        | Implementación                                                                                                 |
> | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
> | T3.1 — Routing trace          | Persistir la identidad de la directiva, su versión, decisión, contexto de activación y resultado de aplicación |
> | T3.2 — Launch ledger          | Distinguir selección operativa, intento de lanzamiento y evidencia disponible de ejecución                     |
> | T3.3 — Consumidores           | Separar registros contables de evidencia válida para autoría, revisión e independencia                         |
> | T3.4 — Cobertura del snapshot | Registrar `REVIEWER_SNAPSHOT_COVERAGE_INCOMPLETE` como campo estructurado                                      |
> | T3.5 — Compatibilidad         | Admitir registros antiguos sin otorgarles crédito nuevo                                                        |
>
> No autorizo crear otra base de datos, otro archivo de procedencia ni un segundo sistema de observabilidad.
>
> ### 3. Invariantes obligatorios
>
> A. La traza registra hechos; no concede autoridad.
>
> Un registro como `ROUTED_LINKED` o `governed-provisional` no debe conferir crédito si el estado de gobernanza indica `credit: none`.
>
> B. Ledger operativo y autoría acreditada son conceptos distintos.
>
> Una ejecución `UNLINKED` puede registrarse para distribución de trabajo y telemetría, pero no se convierte automáticamente en autoría válida para S5.
>
> Los consumidores deben distinguir explícitamente ambas categorías.
>
> C. La persistencia no demuestra enforcement.
>
> Un payload falsificado de `record-trace`, incluso si declara `prevented`, no demuestra que el hook impidió físicamente un lanzamiento.
>
> D. Los fallos de escritura no desaparecen.
>
> Si un append falla por lock, timeout o archivo ilegible, no debe interpretarse como ausencia de ejecución. La pérdida debe quedar identificada cuando sea observable, y nunca producir crédito positivo.
>
> E. La revisión y la aceptación siguen limitadas.
>
> Ninguna modificación de T3 puede elevar automáticamente una tarea a `ACCEPTED` o `VERIFIED`.
>
> El máximo continúa siendo `REVIEWED_PENDING_PROVENANCE`, bajo las condiciones que ya aprobamos.
>
> ## 4. Validación requerida
>
> T3 deberá demostrar mediante pruebas deterministas que los registros operativos no alteran indebidamente `task-authorship`, que las trazas antiguas conservan su interpretación, que los campos de cobertura no se pierden y que los errores de persistencia no conceden autoridad.
>
> También quiero una prueba explícita de P12g: aunque aparezca `governed-provisional/ROUTED_LINKED`, ningún consumidor debe convertirlo en crédito cuando el estado declarado es `none`.
>
> Será suficiente una revisión independiente focalizada del diff final. Si encuentra bloqueantes, se corrige un lote y se solicita autorización antes de cualquier ampliación adicional.
>
> ## 5. Límites de la autorización
>
> Implementación T3 en worktree aislado — Autorizada
> Tests y revisión cruzada — Autorizados
> Commits locales tras validación — Autorizados
> T4 — Sin autorizar
> Plugin instalado y activación — Sin autorizar
> Merge, push y registro de veredictos — Sin autorizar
>
> Los 13 archivos pendientes de D deben mantenerse intactos, junto con sus copias verificadas.
>
> ## 6. Qué sigue después de T3
>
> Si T3 supera la revisión, avanzaremos a T4: validación integrada y consolidación de A+B+C+D con T1–T3.
>
> Ahí será necesario demostrar que la ejecución completa conserva el mismo contrato desde la decisión del core hasta el registro de evidencia, sin que ningún consumidor vuelva a reinterpretar la autoridad.
>
> Autorización concedida. La prioridad es terminar la integración de las piezas existentes, no ampliar nuevamente la arquitectura.
- S117 (OD-R3-T3, CONDITIONAL_PASS / FINAL_CORRECTION_APPROVED): Sam's decision, verbatim, applies to the 24 h snapshot window, findings F1 and F2 of T3 and nothing else:
>
> ## Decisión: `OD-R3-T3 — CONDITIONAL_PASS / FINAL_CORRECTION_APPROVED`
>
> Elijo la opción 1. Aceptamos la ventana residual del snapshot de hasta 24 horas y autorizo corregir las dos advertencias en un único lote, seguido de una revisión independiente focalizada.
>
> No considero necesario ampliar el mecanismo de locks ni introducir otra estrategia de invalidación.
>
> ### 1. Snapshot: ventana de 24 horas aceptada
>
> Si la invalidación falla después de deshabilitar la admisión:
>
> - El contrato deshabilitado sigue siendo la fuente de verdad.
> - El comando informa `exit 1` y el fallo parcial de sincronización.
> - El snapshot anterior puede permanecer vigente hasta 24 horas, pero solo puede restringir, nunca conceder autoridad.
> - Una desactivación válida comprobada debe prevalecer sobre el snapshot, conforme a OD-C1.
> - Si el core está inaccesible y no puede comprobarse la desactivación, aceptamos una posible denegación conservadora temporal.
>
> Esta es una degradación de disponibilidad conocida, no una vulneración de independencia S5.
>
> No autorizo añadir reintentos adicionales al lock ni modificar el esquema del snapshot.
>
> ### 2. Dos correcciones autorizadas
>
> | Hallazgo                      | Corrección requerida                                                                                                                         |
> | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
> | F1 — Autoría y exclusiones    | Una fila operativa `UNLINKED` no debe provocar la pérdida de una exclusión cuando exista una relación concreta R1/R2 con una tarea vinculada |
> | F2 — Fallo de `record-launch` | El hook debe comprobar el exit code y registrar o comunicar la pérdida del ledger sin tratarla como persistencia exitosa                     |
>
> F1: La evidencia operativa puede restringir cuando existe vinculación comprobable, pero nunca acreditar autoría. No debemos convertir todas las filas `UNLINKED` en exclusiones globales.
>
> F2: Un fallo de escritura no debe detener automáticamente cualquier lanzamiento legítimo ni transformarse en crédito. El resultado debe distinguir lanzamiento intentado, persistencia exitosa y persistencia fallida.
>
> El hook tampoco debe afirmar que existe una fila de ledger cuando el append falló.
>
> ### 3. Validación requerida
>
> Una revisión independiente limitada a:
>
> 1. Exclusiones R1/R2 conservadas ante filas operativas relacionadas.
> 2. Ausencia de exclusiones falsas para tareas ajenas.
> 3. Fallos inyectados de `record-launch` detectados correctamente.
> 4. Ningún crédito nuevo por evidencia incompleta.
> 5. Compatibilidad con los consumidores legacy.
>
> Después, ejecutar los tests focalizados y una suite completa, comprobando el exit code real.
>
> Los cinco fallos de sandbox reportados permanecen como riesgo de concurrencia. No autorizo investigarlos dentro de este lote salvo que aparezca evidencia de una regresión propia de T3.
>
> ## 4. Estado de T3
>
> Implementación T3 — Completada
> Revisión independiente inicial — PASS
> Corrección de dos advertencias — Pendiente
> Aceptación final de T3 — Condicionada
> T4 — Sin autorizar
>
> Autorizo el commit local de este lote únicamente después de su validación favorable. No autorizo merge, push, instalación del plugin, activación del contrato ni registro de veredictos pendientes.
>
> ### 5. Qué haremos después
>
> Si el lote pasa, cerraremos T3 sin otra ronda de diseño y pasaremos a evaluar T4 como integración completa del protocolo.
>
> T4 tendrá que comprobar el flujo real de extremo a extremo, desde la identidad de tarea y la directiva del core hasta el hook, el lanzamiento, la traza, el ledger y el veredicto.
>
> La prioridad ahora es consolidar T1–T3 y dejar de acumular correcciones aisladas. No necesitamos más infraestructura para cerrar los dos hallazgos actuales.

- S118 (OD-R3-T4, INTEGRATION_APPROVED): Sam's decision, verbatim, applies to T4 integration in an isolated worktree and nothing else:
>
> ## Decisión: `OD-R3-T4 — INTEGRATION_APPROVED`
>
> Sí. Autorizo T4: integrar T0–T3, el snapshot y las partes necesarias del corte D en un worktree aislado, con pruebas reales de extremo a extremo.
>
> El objetivo es cerrar U2–U5 y demostrar que el sistema funciona como una unidad. No autorizo trasladar automáticamente los 13 archivos de D, porque ese código quedó bloqueado y parte de su lógica fue sustituida por el protocolo core–hook.
>
> ### 1. Estrategia de integración
>
> T4.0 — Reconciliación
>
> Crear un worktree nuevo basado en `feat/core-hook-t3`. Comparar los 13 archivos pendientes de D con T1–T3 e identificar qué lógica sigue siendo necesaria, cuál fue reemplazada y cuál entra en conflicto.
>
> T4.1 — Consolidación
>
> Integrar únicamente los cambios de D que todavía tengan valor: eliminación coordinada de vetos V1–V6, compatibilidad legacy y admisión por tarea. Toda decisión de lanzamiento debe permanecer centralizada en `decideLaunch()`.
>
> T4.2 — Validación end-to-end
>
> Ejecutar el core real y el hook real con un host simulado. Verificar desde la identidad de tarea hasta la aplicación de la directiva y su persistencia, sin consumir modelos.
>
> T4.3 — Revisión de integración
>
> Ejecutar suites completas, verificar compatibilidad y realizar una revisión cruzada independiente focalizada del diff consolidado.
>
> ### 2. Qué debe demostrar T4
>
> | Escenario                                       | Resultado exigido                                                       |
> | ----------------------------------------------- | ----------------------------------------------------------------------- |
> | Builder y Reviewer en proveedores distintos     | Permitido cuando el contrato esté activo y se cumplan sus restricciones |
> | Reviewer vinculado con conflicto S5             | `DENY` o espera; cero lanzamientos no autorizados                       |
> | Reviewer `UNLINKED`                             | Routing operativo permitido, sin crédito                                |
> | Proveedor agotado confirmado                    | No reaparece mediante fallback                                          |
> | Core inaccesible                                | Se aplica OD-C1 y el snapshot cuando corresponde                        |
> | Directiva alterada, expirada o de otro proyecto | No se ejecuta como directiva válida                                     |
> | Actor Gentle AI                                 | Sin reescritura indebida ni crédito implícito                           |
> | Traza y ledger                                  | Registran el resultado sin inventar ejecución o independencia           |
> | Contrato inactivo                               | Compatibilidad legacy                                                   |
> | Contrato activo y hook incompatible             | No se acredita admisión aplicada                                        |
> | Desactivación                                   | Restaura comportamiento legacy y conserva evidencia histórica           |
>
> La prueba más importante: una decisión de denegación debe llegar hasta el punto efectivo de lanzamiento. No basta con que `decideLaunch()` devuelva el resultado correcto.
>
> ### 3. Qué hacer con D
>
> El diff de 13 archivos debe tratarse como material de reconciliación, no como una unidad aprobada.
>
> Autorizo recuperar sus cambios cuando todavía sean necesarios, pero cada uno debe tener una justificación concreta frente al protocolo actual.
>
> No debemos reintroducir `routeAuthority`, `explicitModelVerdict`, handovers u otras rutas paralelas de decisión en el camino gobernado.
>
> Los 13 archivos originales y sus copias verificadas permanecen intactos. Si surge un conflicto que obliga a cambiar una política ya aprobada, detener esa parte y reportarlo.
>
> ### 4. Validación y criterios de cierre
>
> Para considerar T4 listo:
>
> - Tests focalizados del protocolo y del hook, usando respuestas del core real.
> - Suite completa con código de salida capturado correctamente.
> - Pruebas de compatibilidad legacy con el contrato desactivado.
> - Pruebas de fallos de transporte, persistencia y estado de activación.
> - Verificación del presupuesto de ejecución del hook con el tamaño actual de ledger y traza.
> - Una revisión independiente del diff final, usando un proveedor distinto del Builder.
>
> No necesitamos repetir indefinidamente suites ni lanzar múltiples revisores. Si aparece un bloqueante nuevo, debe quedar reproducido y atribuido antes de autorizar una ampliación.
>
> Los fallos conocidos de sandbox bajo concurrencia no deben ocultarse, pero tampoco obligan a detener T4 sin evidencia de regresión.
>
> ### 5. Límites
>
> | Operación                             | Estado        |
> | ------------------------------------- | ------------- |
> | Crear worktree T4 aislado             | Autorizado    |
> | Reconciliar D con T1–T3               | Autorizado    |
> | Implementar integración y tests       | Autorizado    |
> | Commits locales de unidades validadas | Autorizados   |
> | Revisión cruzada focalizada           | Autorizada    |
> | Modificar los worktrees originales    | No autorizado |
> | Instalar o activar el plugin          | No autorizado |
> | Merge al checkout principal           | No autorizado |
> | Push al remoto                        | No autorizado |
> | Registrar veredictos pendientes       | No autorizado |
>
> ## 6. Qué espero al terminar
>
> El entregable debe ser una sola integración coherente, no otra colección de funcionalidades aisladas.
>
> Quiero que el reporte final indique qué partes de D se conservaron o descartaron, las pruebas realizadas, los defectos encontrados y la evidencia de que los consumidores del protocolo coinciden.
>
> El estado esperado es `T4_INTEGRATED_INACTIVE_REVIEWED`, únicamente si supera las validaciones.
>
> Después de T4, el siguiente paso será preparar un despliegue controlado, con compatibilidad de versiones, instalación del plugin, activación limitada a un proyecto y un procedimiento de reversión.
>
> Autorización concedida. A partir de aquí, la prioridad es integración y estabilidad, no seguir ampliando la arquitectura de Kairo Runtime.
- S119 (OD-R3-T4, REVIEW_DEFERRED_UNTIL_QUOTA_RESET): Sam's decision, verbatim, applies to the deferred independent review of T4 and nothing else:
>
> ## Decisión: `OD-R3-T4 — REVIEW_DEFERRED_UNTIL_QUOTA_RESET`
>
> Elijo la opción 1: utilizar `gpt-6.1-sol` de Codex después del reinicio de cuota del 10 de noviembre de 2026.
>
> No gastaremos el 6% semanal restante ni utilizaremos Astra. Tampoco cambiaremos a un proveedor cuya capacidad para esta revisión todavía no hemos validado.
>
> T4 permanece en `T4_INTEGRATED_INACTIVE — PENDING_INDEPENDENT_REVIEW`.
>
> ### 1. Qué debe revisar Codex
>
> La revisión debe enfocarse en los tres hallazgos de integración, no en volver a examinar toda la arquitectura.
>
> | Hallazgo                              | Prioridad | Criterio                                                                                                 |
> | ------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
> | T4-F1 — Decisiones diferentes         | Alta      | `route`, `exec` y servicio deben interpretar coherentemente la misma directiva y sus restricciones       |
> | T4-F2 — Consumidores sin negociación  | Crítica   | Ningún consumidor debe ejecutar una tarea gobernada eludiendo `decideLaunch()`                           |
> | T4-F3 — Activación prematura de vetos | Crítica   | V1–V6 sólo deben retirarse cuando la admisión sea efectivamente operativa, conforme al contrato aprobado |
>
> Especialmente F2 y F3 podrían impedir el despliegue aunque los 5016 tests hayan pasado.
>
> No aceptaremos T4 simplemente porque los defectos sean conservadores. Un consumidor que espera mientras otro ejecuta evidencia una inconsistencia operativa que debemos comprender.
>
> ### 2. Alcance autorizado de la revisión
>
> Autorizo una revisión independiente de Codex sobre el diff real de `feat/core-hook-t4`, incluyendo las rutas de ejecución relevantes.
>
> Debe comprobar:
>
> - Compatibilidad del core con el hook y los consumidores.
> - Comportamiento legacy cuando la admisión está configurada pero todavía no activada.
> - Riesgos de bypass de autoridad y de acreditación indebida.
> - Los tres hallazgos F1–F3, con casos reproducibles.
> - Comportamiento ante errores y latencia del hook.
>
> El resultado debe clasificar cada hallazgo como `BLOCKER`, `ADVISORY` o `NOT_REPRODUCED`, indicando la evidencia correspondiente.
>
> No autorizo correcciones automáticas durante esta revisión.
>
> ### 3. Dos precauciones adicionales
>
> Rendimiento: los 1357 ms observados bajo carga están por debajo del límite de 2000 ms, pero dejan un margen limitado. Quiero que Codex evalúe el comportamiento ante timeout, no solamente la mediana.
>
> Cambios en `~/.harness`: todavía no tenemos evidencia de que los archivos modificados se deban al refresh de la sesión. Deben quedar registrados como observación no atribuida; no ejecutaremos `kairo sync` ni refrescos adicionales por ahora.
>
> ### 4. Qué sigue
>
> T4 implementado en worktree aislado
>
> Revisión con Codex Sol tras el reset de cuota
>
> Clasificación y resolución de F1–F3
>
> Despliegue, instalación y activación aún bloqueados
>
> Los 11 commits de T4 y los 13 archivos pendientes de D deben permanecer intactos.
>
> Objetivo: conseguir una revisión independiente concluyente de T4, resolver únicamente los bloqueantes demostrados y preparar la consolidación. No iniciaremos otra expansión arquitectónica ni consumiremos cuota adicional antes de esa revisión.
- S125 (OD-R3-T4, GOVERNABLE_EXECUTION_SCOPE / MVP_RELEASE_CONTRACT): Sam's decision, verbatim, applies to T4 boundary scope, the MVP release contract and the MVP delivery plan, and nothing else:
> Coincido con el problema que estás señalando: estamos avanzando técnicamente, pero no estamos convirtiendo ese avance en un producto terminado y utilizable.
>
> Hemos construido bastante infraestructura, encontrado defectos reales y definido buenas reglas. Sin embargo, cada revisión descubre otro escenario, ampliamos el alcance y terminamos revisando las mismas fronteras desde ángulos diferentes.
>
> Necesitamos cambiar el criterio de éxito: dejar de buscar una arquitectura exhaustiva y empezar a cerrar una versión publicable de Kairo Runtime.
>
> ## 1. Mi decisión: opción 1, con alcance delimitado
>
> `OD-R3-T4 — GOVERNABLE_EXECUTION_SCOPE`
>
> Todo lanzamiento que ejecute trabajo delegado para una tarea o un rol gestionado por Kairo debe pasar por la frontera de ejecución.
>
> Pero no toda interacción con un modelo constituye trabajo gobernable.
>
> | Tipo de ejecución                                     | ¿Frontera obligatoria?               |
> | ----------------------------------------------------- | ------------------------------------ |
> | Builder, Reviewer, Architect con trabajo delegado     | Sí                                   |
> | `team exec`, servicio, `startRun` y hooks compatibles | Sí                                   |
> | Planning asociado a una tarea gestionada              | Sí                                   |
> | Review-runner y minions gestionados por Kairo         | Sí, cuando ejecuten trabajo delegado |
> | Continuación de una tarea gestionada                  | Sí                                   |
> | Continuación normal de una conversación interactiva   | No                                   |
> | `quick-ask`                                           | No                                   |
> | Sondas de entitlement y autenticación                 | No                                   |
> | Consultas de metadatos o capacidades                  | No                                   |
>
> Las sondas y consultas auxiliares no necesitan recorrer `decideLaunch()`, pero deben respetar las restricciones de agotamiento confirmadas que sean aplicables. No vamos a construir otro sistema de admisión para ellas.
>
> La frontera gobierna trabajo delegado, no cada llamada a un LLM.
>
> Y hay otra regla: si un adaptador todavía no implementa esa frontera, no puede anunciarse como integración gobernada. Puede seguir funcionando en modo de compatibilidad sin crédito, o quedar fuera de las capacidades habilitadas de esa versión.
>
> Esto evita que T4 se convierta en una reescritura de todas las integraciones.
>
> ## 2. Debemos definir el producto mínimo publicable
>
> Para mí, el primer objetivo debería ser:
>
> ## Kairo Runtime — Primera versión pública funcional
>
> Un runtime de orquestación que pueda instalarse en un proyecto nuevo o existente, utilizar proveedores compatibles, coordinar trabajo delegado y aplicar gobernanza sin reemplazar el host elegido.
>
> Capacidades mínimas
>
> - Instalación y configuración inicial reproducibles.
> - Funcionamiento en proyectos con y sin configuración previa de Kairo.
> - Routing multi-proveedor con disponibilidad y motivos de exclusión explícitos.
> - Delegación de Builders y Reviewers mediante las integraciones soportadas.
> - Independencia por tarea, con estados provisionales cuando falte evidencia.
> - Compatibilidad cuando Kairo esté deshabilitado.
> - Diagnóstico, recuperación y desinstalación sin romper el host.
>
> No incluye acreditación remota `VERIFIED`, compatibilidad universal con todos los hosts ni todas las capacidades avanzadas del roadmap.
>
> Ese sería nuestro MVP publicable. Después podemos mejorar rendimiento, introducir nuevos modelos, agregar adaptadores y fortalecer la procedencia.
>
> No es necesario terminar T6–T11 para publicar, a menos que alguna capacidad de esas etapas resulte indispensable para cumplir el contrato mínimo.
>
> ## 3. Cómo cerrar los defectos actuales sin otra espiral
>
> La auditoría produjo ocho defectos reproducidos dentro de la frontera y otros puntos de ejecución externos.
>
> Propongo clasificarlos así:
>
> | Grupo                            | Hallazgos          | Decisión                                                                 |
> | -------------------------------- | ------------------ | ------------------------------------------------------------------------ |
> | Identidad y reutilización        | F1, F2, F3, F4, F8 | Bloqueantes para activar el protocolo                                    |
> | Fallos de contrato y agotamiento | F5, F6             | Bloqueantes para la gobernanza soportada                                 |
> | Resolución de proyecto           | F7                 | Confirmar en el flujo real; el helper solo no demuestra impacto completo |
> | Otras rutas de ejecución         | F9                 | Clasificar por operación: gobernable o auxiliar                          |
> | Rutas no reproducidas            | F10, F11           | No bloquear publicación únicamente por hipótesis                         |
> | Reportes y rendimiento           | F12, F13           | Corregir afirmaciones y establecer pruebas de rendimiento                |
>
> Esto nos permite distinguir entre fallos de seguridad o comportamiento del producto y mejoras que pueden realizarse después.
>
> También debemos resolver el recorrido del hook que acumuló 3612 ms. No podemos publicar una integración que supere habitualmente su presupuesto de ejecución; pero la solución debe ser reducir consultas redundantes, no crear otro protocolo completo.
>
> ## 4. El punto que debemos evitar: requisitos infinitos
>
> A partir de ahora propongo aplicar una regla de cierre.
>
> Un hallazgo sólo bloquea la primera versión si demuestra una de estas consecuencias:
>
> - Ejecuta un modelo o una tarea en contradicción con una restricción obligatoria del producto.
> - Acredita independencia, admisión o ejecución sin evidencia suficiente.
> - Rompe una ruta principal soportada de instalación, trabajo o recuperación.
> - Provoca una regresión reproducible de compatibilidad, estabilidad o rendimiento que impide el uso normal.
>
> Si no cumple alguna de esas condiciones, se clasifica como deuda conocida, se documenta y no impide publicar.
>
> Esto no significa ignorar defectos de seguridad; significa no convertir cada caso hipotético, cada integración futura y cada mejora posible en un requisito de lanzamiento.
>
> ## 5. Nueva estrategia de entrega
>
> Hito A — Cerrar la frontera mínima
>
> Corregir los defectos reproducidos de las rutas gobernables soportadas. Validar contra entradas reales y un conjunto fijo de pruebas de aceptación. No ampliar automáticamente el alcance ante nuevas hipótesis.
>
> Hito B — Integración instalable
>
> Consolidar worktrees, preparar el paquete y comprobar instalación desde cero, actualización, desactivación y funcionamiento sin Kairo en proyectos existentes.
>
> Hito C — Piloto real
>
> Probar proyectos temporales nuevos y existentes, al menos con las rutas Claude Code y Codex que se anuncien como soportadas. Medir el routing, la independencia, los fallbacks y la latencia con activación controlada.
>
> Hito D — Publicación
>
> Documentación de instalación, compatibilidad, limitaciones, troubleshooting, versión etiquetada y paquete publicado. Después, roadmap de mejoras separado.
>
> ## 6. Qué autorizo ahora
>
> Autorizo registrar esta decisión de alcance y preparar un plan cerrado de entrega del MVP, pero todavía no otra implementación.
>
> El plan debe utilizar los defectos F1–F13 y el código ya construido. Debe identificar qué bloquea realmente la publicación, qué puede quedar fuera, qué integraciones vamos a anunciar inicialmente y qué evidencia necesitamos para declarar cada hito completo.
>
> No quiero más rondas de diseño generales, nuevos subsistemas de seguridad ni infraestructura de observabilidad por anticipado.
>
> Tampoco quiero que los 13 archivos abandonados de D sigan siendo un objetivo de integración. Ya determinamos que el protocolo nuevo reemplaza aquella implementación; deben conservarse como respaldo histórico, no como otra deuda de código que obligatoriamente haya que fusionar.
>
> ## Mi conclusión
>
> Estamos cerca de tener piezas suficientes para un producto funcional, pero no necesariamente cerca de publicarlo mientras no fijemos un alcance y una definición de terminado.
>
> Lo que debemos construir no es un sistema perfecto que gobierne absolutamente todos los procesos de IA.
>
> Es Kairo Runtime: instalable, multi-proveedor, adaptable al proyecto y al host, capaz de trabajar con seguridad y explicar claramente sus límites.
>
> Después vendrán las capacidades avanzadas.
>
> Mi prioridad a partir de ahora sería cerrar el MVP, probarlo, publicarlo y continuar evolucionándolo mediante versiones, en lugar de mantener el producto indefinidamente dentro de una sola feature.
>
> Y sí: debemos dejar de dar vueltas sobre las mismas decisiones. Una vez fijado el contrato de publicación, cada nueva observación deberá evaluarse contra él, no convertirse automáticamente en una ampliación del roadmap.

## Diagnosis

Evidence observed 2026-11-04:

- Builder has no route: `kairo team route --role Builder` returns `WAIT_FOR_PROJECT_TEAM`. `kairo team rebuild --json` fails with code `reviewer_independence`.
- Launch ledger, last 2 days, 84 launches: Builder on claude 47 (`team-builder` 25, `team-builder-codex` recorded as claude 22), Builder on codex 13. Why those 22 are recorded as claude is unverified; probably the Haiku wrapper. Codex 5h window at 100 percent throughout.
- Root cause A, team-wide independence: `src/global/team/project-strategy.js:563-591` and `606-615`; `src/global/team/project-router.js:324-342`; `src/global/intelligence/model-intelligence.js:787-795`, `852-856`, `971-977`, `1225-1233`. All Builders are forced to one provider and reviewers are filtered against every Builder provider.
- Root cause B, empty Builder pool, independent of A: `src/global/team/project-router.js:305-311` and `386-387` with `modelRoleCompatibility` in `src/global/intelligence/role-registry.js`. Labor roles reject models with frontier evidence (reported as outside band: `gpt-6.1-sol`, `gpt-6-astra`, `claude-opus-5-5`, `claude-sonnet-5-5`). The remaining models are reported unqualified (`gpt-6.1-terra`, `gpt-6-luna`, `claude-haiku-5-5`, `claude-haiku-4-5`). Which floor rejects them is not verified yet. **Fixing A alone does NOT give Builder a model.**
- Root cause C, fail-open launcher: `integrations/claude-code/kairo-router/hooks/register.ts:653-666` and `748-763`. A non-ROUTED decision or a route without provider or model launches the original agent unchanged, so the pinned agent runs.

## Override inventory (S8)

Coverage note: bounded map from one explorer run plus a parent spot check, not proof of exhaustiveness; T1 closes the gap. Host configuration outside this repository is deliberately not tracked here and is reported to the user separately.

| Location | Fixed item | Effect on Router | Severity | Handling |
|---|---|---|---|---|
| `register.ts:653-663,749-763` | original agent and model | route failure launches unchanged | P0 | explicit failure, no bypass |
| `register.ts:622-633,731-734` | `[no-redirect]` and gentle actors | skip routing, record own model | P0 | keep only as explicit scoped override with recorded reason |
| `register.ts:42-58,737-746` | explicit Claude model | can replace routed provider and model | P0 | explicit override, surfaced in trace |
| `register.ts:671-689` | fixed-model agent kept | matching agent retained; canLaunch validates strings, not executable identity | P1 | verifiable model execution |
| `register.ts:753-756` | Sonnet downgrade | hook changes the model under constrained pacing | P1 | becomes a Router decision |
| `project-strategy.js:563-591,606-615` | team-wide independence | approval rejects split-provider Builders | P0 | per task |
| `project-router.js:324-342` | provider reservation | constrains all Builders, filters reviewers | P0 | per task |
| `model-intelligence.js:787-795,852-856,971-977,1225-1233` | team-wide independence at formation | reserves a provider, can block Reviewer | P0 | per task |
| `model-intelligence.js:855` | `MAX_TECHNICAL_ROLES_PER_PROVIDER` | caps a provider during formation | P1 | re-evaluate against S4 |
| `project-strategy.js:453-465,600-604`; `project-router.js:386-387,409-414` | band and qualification gates | can eliminate a provider before distribution | P0 for Builder | decision OD1 |
| `pacing-cli.js:32-36`; `claude-hooks.js:82` (both under `src/global/team/`) | `nextWriter` names two fixed agents | advisory that orchestrators follow as authority | P1 | advisory only, or role based |
| `project-router.js:357-361` | manual picks | considered subject to compatibility and independence checks | P1 | keep as explicit user override |

## Architecture decisions

- D1. Independence moves from team formation to task launch. The `independentReview` role flag stays. Formation and approval stop rejecting split-provider teams; they only validate that for each provider able to build there is at least one eligible reviewer candidate on another provider.
- D2. The writer provider of a task is a recorded fact, read from the launch ledger by task identity. A Reviewer route excludes every provider that wrote to that task. If all providers wrote, or only one provider is available, the decision is `WAIT_FOR_INDEPENDENT_REVIEW` and proceeding needs an explicit human exception. The system never claims an independent review that did not happen.
- D3. The Router decision lives in Kairo core; host hooks stay thin callers (Kairo is host-agnostic). Only core decides alternatives and refusals.
- D4. Fail closed on refusal: a non-ROUTED decision first tries eligible alternatives inside core, then returns a blocked decision with reason. The launcher denies the launch and shows the reason, and never launches the original agent. This replaces the current contract that kairo-router never blocks, so it is a contract change.
- D5. A launch carries the model chosen by the Router. Agent definitions are transport; a pinned model in a definition never decides the provider. Explicit human overrides remain, always scoped and recorded.
- D6. Distribution ranks eligible candidates using existing inputs: quota dead time, cost, capacity, historical outcomes, in-flight saturation. No percentages and no round robin.
- D7. Every decision writes one trace record.

- D8. Selection order is S10, evaluated in core. Quality floors are never lowered to fill a seat; a floor changes only with T1 evidence that it is miscalibrated.
- D9. Frontier labor exception. Team formation still never assigns a frontier model to a labor seat (approved S21 stays true for formation). At launch only, core may select from the frontier capability pool for a Builder task when no non-frontier candidate is eligible, budget remains and a justification is recorded. The pool is resolved by capability evidence (`frontierEvidence`), never by model names. The approved S21 sentence that frontier does not implement is amended by S17 for this exception only.
- D10. Each delegation carries a consumption limit and an attempt limit. Exceeding either stops the work and escalates; it never continues spending.
- D11. Success metric is cost and consumption per accepted change, not request share.
- D12. Provider failures are classified, never collapsed: provider_unavailable, model_at_capacity, quota_exhausted, unknown. model_at_capacity tries another eligible model of the same provider, then other providers, then blocks. Unknown state is recorded as unknown and is not treated as exhaustion. All paths keep review independence and budget.
- D13. Router outage (CLI failure, timeout, invalid response) blocks the launch. Only an override meeting S23 can proceed. If the authorization cannot be verified or recorded, the override does not run.
- D14. Subscription quota per provider is the primary budget and metric. Published API prices are informational only and authorize nothing. D11 stands, read as accepted changes before quota runs out.
- D15. Models of one provider are treated as sharing one allocation unless evidence shows otherwise. Each provider is budgeted across its windows, including resets. Unknown metrics stay unknown.
- D16. Quota is reserved so review and integration remain possible; implementation may not spend the capacity that cross review needs. How much to reserve is not set.
- D17. Deterministic local tools run before any model. No artificial work is created to distribute quota. Fixed percentages and API rates as budget are discarded.

## Open decisions

User input needed before implementation:

- OD1. Resolved 2026-11-04: ALLOW_BOUNDED_FRONTIER_EXCEPTION, see S10 and D8-D9.
- OD2. Resolved 2026-11-04: FAIL_CLOSED_WITH_HUMAN_OVERRIDE, see S22, S23 and D13.

- A1. Approved provisionally: the frontier labor exception shares the existing escalation budget (`src/global/team/escalation-budget.js:9-11`, 10 frontier decisions in any rolling 7 days); each frontier authorization consumes one unit (S24); T1 checks that repeated attempts cannot evade it.
- A2. Numeric per-task consumption and attempt limits are not set yet. T1 proposes values from ledger evidence; the user approves them before T5; pending T1 data.
- Engram: related memories are not overwritten until differences are reconciled.

## Contracts

- Route request: role, task identity, active host, optional explicit override with reason.
- Route decision: `ROUTED` with provider and model, or `BLOCKED` with code (`WAIT_FOR_PROJECT_TEAM`, `MANUAL_HANDOFF`, `WAIT_FOR_INDEPENDENT_REVIEW`, `WAIT_FOR_TASK_IDENTITY`) and reason. Existing decision codes keep their meaning. Optional exception object: `kind: frontier_labor`, justification and budget state. Failure class field on Route decision (values from D12). Override record: taskId, delegation identity, manually selected provider, scope, block reason, authorization evidence, expiry at task end or cancel, outcome, consumption when available. An override is single use and never persisted as a preference.
- Task identity: passed on each launch of a Builder or independent review role. Missing identity on an independent review role gives `WAIT_FOR_TASK_IDENTITY`.
- Task budget: consumption limit and attempt limit; exceeding either stops work and escalates.
- Trace record: `at`, `taskId`, `role`, `agent`, selected provider and model, capability used, rejected alternatives with reasons, selection reason, override flag, estimated consumption, observed consumption when available (unknown is recorded as unknown, never zero), attempts, rework, outcome, verdict. Added fields are optional so existing ledger rows stay readable. T2 fields (S61) are added: traceId, cell, candidates, selectedProvider, selectedModel, rejectionReasons, routingDecision, effectiveLaunch, fallbackDetected, quotaSnapshot, policyVersion. Records live in their own file next to the launch ledger, so the ledger format does not change. effectiveLaunch.evidence is requested, dispatched, confirmed or unknown; schema kairo.routing-trace/v2.
- Stage 2 interfaces (S7), design only, nothing is implemented: Cell descriptor with `cellId` (design, implementation, quality, delivery), goal, budget, authorized files, acceptance checks, escalation condition. It reuses the existing handoff fields of `kairo team escalate`. Cell Leader is a role routed like any other, never a fixed provider. `taskId` in the contracts above is scoped so it can later carry a `cellId`. Leaders return synthesized results, not transcripts.

## Regression tests

Each test must fail first:

- Quota exhaustion: one provider exhausted moves work to the other eligible provider, with trace.
- No route: blocked decision, and the launcher does not run the original agent.
- Cross review: a task written on codex gets a claude reviewer, and the reverse.
- Simultaneous Builders on different providers in one team: approved and routed.
- One provider available: `WAIT_FOR_INDEPENDENT_REVIEW`, no false independent review.
- Explicit override: honored, scoped, recorded.
- Legacy strategy without pools still loads and routes.
- Kairo CLI failure, timeout and invalid response: each blocks; the default agent does not run.
- Override: without verifiable human authorization it does not run.
- Override scope: authorizes one delegation; the next delegation in the same session is blocked again.
- Override expiry: gone after the task ends or is cancelled; no preference persisted.
- Override does not relax tool permissions, isolation or critical approvals.
- Implementation under override is not accepted without independent review.
- Unrecordable override audit: the override does not run.
- model_at_capacity: another same-provider model is selected before other providers, then BLOCKED.
- quota_exhausted and provider_unavailable each take their own path, with the class in the trace.
- High usage percentage with quota remaining is not classified as exhausted; unknown stays unknown.
- Frontier budget: each authorization consumes one unit; repeated attempts cannot avoid consumption.

- Non-frontier eligible: a frontier model is never selected.
- No eligible non-frontier and budget available: frontier exception selected, justified and traced.
- Exception budget exhausted: `BLOCKED`.
- Task consumption or attempt limit exceeded: work stops and escalates.
- Fixture with renamed frontier models: selection result unchanged, proving no hard-coded names.
- Formation: a frontier model is never assigned to a labor seat.

## Quota measurement

- Metrics per accepted change (verdict pass): consumption, cost, attempts, rework; plus provider split of writes and frontier exception rate.
- Baseline: the launch ledger gives provider split and verdicts for the previous distribution, but has no consumption per task. Consumption baseline therefore comes from T2 running in observe mode, before any enforcement change.
- Comparison: same metrics after T6-T8, over comparable work, reported with sample size. Deterministic replay of recorded routing inputs against old and new logic proves the decision change, not savings.
- Rule: no savings claim until this comparison shows it. An inconclusive result is reported as inconclusive. No numeric target is set.

## Migration

- Stored `project-strategy.json` files keep loading; nothing rewrites them automatically.
- Team-wide checks are removed only after per-task enforcement is live, so there is never a window with no independence check.
- Trace ships first, in observe mode, before enforcement changes.
- The pending team proposal `1a2134ba7d5307f274593983` is not approved as part of this work; the user decides after OD1.
- Help text and `docs/cli-reference.md` update alongside the behavior.
- Rollback: revert the work-unit commits; stored strategies stay compatible.
- Host configuration outside this repository is aligned through a separate migration plan kept outside version control; this document holds no private host content.
- Approved S21 stays in its document; the amendment is recorded here and T10 cross-references it.


## Proposed spec changes

- P1. Human authorization needs a mechanism: host-originated, bound to task, delegation, provider, scope, reason and expiry, consumed once; agent-written text never counts. No such mechanism was found; host events are possible integration points, unverified. Per S23 the override does not run until one exists.
- P2. Choose the enforcement boundary: cooperative callers only, or a broker mediating provider execution.
- P3. Acceptance requires review evidence bound to task and revision, reviewer provider distinct from every writer.
- P4. Frontier authorization: a task-bound, single-use record that debits the shared budget atomically, with defined charging for failures, retries, cancellation and crash recovery.
- P5. Audit admission before launch, fail closed on recording failure; replace unverified `--no-record`.
- P6. Decided (S55): frontier is classified from a frozen, versioned reference value, never the live index, with a hysteresis rule near the cutoff; band value open. Sonnet 5.5 (frozen 54.2, cutoff 54.5) starts non-frontier and still passes the usual quota, quality and independence checks. A model absent from the reference has no frozen value and stays not eligible until an approved snapshot adds it (P18, P20).
- P7. Owned evidence strength: decide how many passes across how many fixtures an owned path needs before it can qualify a Builder.
- P8. Distinguish insufficient evidence from measured insufficient quality in routing output, per S29.
- P9. Automatic refresh must not be able to re-form the team during evaluation.
- P10. Contextual eligibility: the user proposes replacing the single Builder floor with floors by task type and risk (light, intermediate, advanced, critical), backed by local evaluations. Parent notes to resolve first: (a) this must reconcile with the OD1 statement that floors are not lowered only to make models eligible; (b) whoever classifies a task's tier could under-classify risky work to reach a cheaper model, so classification needs its own governance and a route for reclassifying; (c) no local evidence per task type exists yet.
- P11. Reservation for review: define how much per-provider quota is held back, in observable units.
- P12. Attribution limit: subscription metrics are provider percentages shared across every concurrent session, so before and after deltas can only be attributed in a quiet window; resolution and refresh delay of those percentages are not yet verified.
- P13. Kairo must not probe or start processes for providers outside the team. Changing teamProviders can trigger a re-form, so `kairo team providers --disable` is not used during T1. Out of scope for now per S49; recorded, not worked on.
- P14. Approved as principle (S53): a signal no candidate has must not penalize anyone. The code already does this (model-intelligence.js:459-468 poolWideAbsent), but only relative to the pool it is given, so the result depends on which pool qualification uses; see evidence.
- P15. Approved as principle (S53): a single owned pass must not outrank public evidence or move a model onto the owned-only path, per the risk recorded at model-intelligence.js:2297-2300. Related to P7.
- P16. Model Capability Registry separate from Router and scoring, with states Discovered, Accessible, Runnable, Eligible, Assigned (user proposal). Discovery is read-only and never re-forms. Note: model-capability-registry.js already exists as an evidence store without these states; extend it, no second registry.
- P17. The superseded filter (model-candidate-catalog.js:544) must stop being a hard exclusion for accessible models; age alone does not disqualify.
- P18. Blocking prerequisite of P17: a missing intelligence index must not pass the frontier gate. modelRoleCompatibility rejects labor only when status is frontier (role-registry.js:500-503), so capability_unverified models are treated as allowed. Lifting P17 alone would make claude-opus-4-7 the top ordinary Builder.
- P19. Comparable evidence: terminal benchmark versions are not comparable. claude-opus-4-8 has terminalBenchV2 .846 and terminalBenchV4 .217. claude-opus-4-7 scores .798 only from an older terminal benchmark.
- P20. Model Discovery (S54-S58), design only: Model Discovery, then Capability Registry, then Versioned Snapshot, then Router. Proposed interfaces, not existing commands: kairo models sync --dry-run discovers, compares and proposes without changing the team; kairo models apply snapshot-id applies an approved version. The weekly job runs only sync. Apply needs authorization when it changes eligibility, frontier class, policy or assignments. The Router reads only the last approved snapshot; known unavailability blocks new assignments without waiting for apply. Keep version history and scoring methodology (P19). Trigger: external on-demand mechanism, no daemon (S63). Open: hysteresis band. Code constraints: evidence file, Model Discovery check.

## T1 findings

Moved to odd/tasks/router-provider-authority-evidence.md.

## T3 design

Proposal for user approval, not implementation authorization. S1, S14, S67, S71, S72 and S75-S76 govern this design; S5 requires traceability and deterministic cross-review tests. T2 remains accepted with its recorded limitations. No new agents, cells, telemetry service, quality-floor changes, historical verdict updates, or operational re-formation.

### Verified reference map

Line references describe the code inspected on 2026-11-04, before this documentation edit. MI = `src/global/intelligence/model-intelligence.js`; all other abbreviated filenames are under `src/global/team/` unless qualified.

| Claim from starting map | Corrected path and lines | Result |
|---|---|---|
| Formation excludes Builder providers from independent seats | MI:787-797,852-856,1706-1712,2459-2464 | Confirmed; last two ranges render failure, not the originating filter. Model/provider concentration caps at 854-855 are separate constraints. |
| Formation map covers every reservation | MI:966-980,1110-1117,1143-1166,1178-1187,1223-1241,1300-1316,1330 | Wrong if treated as exhaustive: shared-Builder selection, independent ladder, strict-cap reassignment and evidence rendering also propagate the restriction. |
| Strategy construction rejects missing independent seats | `project-strategy.js`:596-617 | Confirmed; combines both formation outputs and missing-review detection. |
| Auto-reform checks team independence | `project-strategy.js`:563-591; `service.js`:1593-1609 | Confirmed; shared validator rejects split Builders and Reviewer overlap; reform calls it. |
| Approval rejects split teams and overlapping reviewers | `service.js`:2368-2373,2385-2390,2414-2416,2455-2465 | Confirmed; 2368-2373 introduces activationBlockers, 2455-2465 invokes it. |
| Router reserves Builder provider and filters review | `project-router.js`:304-314,324-359,387-412,459-481 | Confirmed; 338-345 is the candidate-filter seam, but insufficient as the sole launch guard. Independence currently turns off with one configured provider. |
| Cached STALE path skips resolver | `routing-input-cache.js`:180-195,235-240 | Confirmed; STALE returns the approved assignment without resolveProjectRoute. |
| Gentle-owned actors skip Kairo routing | `routing-input-cache.js`:131-138,152-155 | Confirmed; NOT_ROUTED is ownership, not independent-review proof. |
| Precomputed plans are covered by cited cache range | `routing-input-cache.js`:254-275; `team-plan.js`:8-23; `service.js`:2690-2698,2716-2750 | Wrong/incomplete: bulk routes have no task identity; executePlan rechecks routing but does not pass taskId into that call. Its existing-execution branch returns before the recheck. |
| Hook/ledger prove writer identity | `integrations/claude-code/kairo-router/hooks/register.ts`:762-779,867-903; `launch-ledger.js`:33-49,187-201 | Wrong as proof: hook sends selected provider; ledger readers discard identity detail. Native-Claude transcript observation is conditional; bridge transport is explicitly excluded. |
| Handoff carries task identity | `delegation-contract.js`:18-31; `routing-trace.js`:67 | Wrong: handoff has no required taskId; trace hardcodes null. |
| No reusable task store exists | `src/global/architect/architect-types.js`:36-46; `architect-manager.js`:27-39; `architect-store.js`:75-101,303-347 | Wrong: task allocation, safe task directories and task/run execution links already exist. Link provider is selected adapter identity, not executor attestation. |
| Exec confirms effective model | `team-exec.js`:157-204; `src/global/runtime/execution-adapters/codex.js`:37-66 | Wrong: adapter builds argv, child is spawned, exit zero selects confirmed; model response identity is not checked. |

### Core contract and task lifecycle

Proposed flow: approved task contract → core allocates taskId → Router selects Builder → core records launch attempt → Builder runs → provider/model evidence and artifact delta recorded → Reviewer requests taskId plus artifact revision → core verifies provenance and excludes authors → eligible independent review → verdict bound to that revision and reviewer run.

- Reuse Architect task ID validation/allocation and safe task-directory primitives, exposing a core task-registration operation for an approved delegation handoff without running an Architect model or requiring a new planning workflow. Existing Architect tasks keep their IDs. Fresh tasks get collision-safe IDs, not trace IDs, role names or hashes guessed by hooks. Registration validates the existing authorizedFiles and acceptance contract; it does not grant approval.
- Proposed host-neutral envelope: `{taskId, runId, parentRunId?, contractDigest, role, artifactRefs?}`. Core owns validation, allocation and admission. Native tools carry an opaque envelope reference through supported metadata; where none exists, a core-rendered reference travels in the task payload and is resolved against persisted core state, never trusted as authorization text. CLI/wrapper entrypoints forward the same reference; host hooks only extract, call core, and transport results. Do not key concurrent tasks through a shared “current task” environment value.
- Persistence proposal: task contract and append-only provenance events under the existing `.ai/tasks/<taskId>/` directory, using a separately versioned `provenance.jsonl` rather than changing Architect status semantics. Extend launch/outcome rows and trace payloads with optional taskId/runId/parentRunId references; use existing ledger locking/atomic-write helpers. The task record preserves governance evidence beyond the launch ledger's retention window. This is task state, not a second observability pipeline.
- Resume reads the original task contract and provenance, verifies project and artifact revision, and reuses taskId. Retry creates a new runId/attempt under the same task; bridge transport and actual worker have linked run IDs, not two credited writers. Replaying one completion must be idempotent. A new task ID must not erase authorship of a reused artifact: bind child tasks to parent/artifact lineage and union contributing writer runs.
- Missing, unknown, cross-project or mismatched task identity returns WAIT_FOR_TASK_IDENTITY before any Builder/review launch. A known task with missing/unreliable authorship returns WAIT_FOR_INDEPENDENT_REVIEW. Review admission does not depend on the number of configured providers. Same-task role conflicts in S71 are checked against participating runs, not permanent agent bans; deterministic tests remain allowed but are not independent review.

### Provider evidence and authorship

Keep three independent facts: requested/dispatched/observed model identity; requested/dispatched/observed provider identity; authorship of a specific artifact revision. Proposed additive fields: requestedProvider, dispatchedProvider, observedProvider, providerEvidenceStatus and providerEvidenceSource, alongside S67 model fields. Preserve legacy adapterId/modelId meanings for compatibility; neither becomes observed evidence automatically. Candidate predicate uses the set of reliable authoring providers, not Router selectedProvider or team seats.

| Launch path | Evidence today and strength | Proposed admission rule |
|---|---|---|
| Native Claude subagent | Hook has requested model/alias; own linked transcript can supply observed model (`register.ts`:888-903). Foreground linkage and real mismatch retain S75 limitations. | A host-linked native-Claude execution/transcript is provider evidence when it identifies this worker, not an enclosing wrapper. Missing exact version alone does not block if provider evidence is reliable; unknown or conflicting worker linkage does. Host resolvedModel is a possible additional source, not yet implemented or independently verified here. |
| kairo-codex and other generated bridges | `src/global/hosts/claude-code.js`:8-33 runs a Haiku transport and instructs team exec with --no-record. Hook deliberately ignores its transcript for worker identity. | Transport Claude is not authoring provider unless it edits the artifact. Require the linked actual executor's evidence; preserve transport→worker IDs through detached execution/polling. Other bridge providers get the same contract but no new eligibility outside S49. |
| Direct team exec, including bridge child | `team-exec.js`:170-204 proves which adapter command was dispatched and its exit result, not which model/backend answered. The current confirmed row is NOT sufficient reliable provider evidence by itself: it copies the supplied provider, has no trusted-runtime identity binding, and Codex launch inherits configuration/environment. | Record dispatchedProvider from the executed adapter; set observedProvider only from a run-bound runtime observation or an explicitly accepted trusted-executor boundary (OD-T3-1). Exit zero never upgrades requested model to observed. Under an accepted stock-provider executor boundary, process execution can reliably identify provider while model version remains unverified; custom backend/configuration weakens that claim. |
| Pinned *-codex wrappers | Hook `register.ts`:737-745 retains an agent when name/provider and declared model match; `launchPayload`:872-880 uses naming and definitions. Repository aliases exist in `src/global/intelligence/role-catalog.js`:36-38; installed wrapper bodies were not inspected. | Names/frontmatter are intent only. Require the same core envelope and linked executor evidence; a direct external CLI bypass has no independent-review credit until imported evidence is verified. Do not infer Codex authorship from the suffix or treat its Claude host as the author. |
| Precomputed/service execution | `service.js`:2690-2698,2716-2750 already knows taskId; execution link stores the chosen adapter (`architect-store.js`:325-347). | Carry taskId into governance and bind actual runtime completion to the run. An execution link alone proves association/selection, not authoring provider. |

- Proposed artifact record: `{taskId, artifactId, baseDigest, resultDigest, pathsAndModes, writerRunIds, evidenceStatus}` with a deterministic diff/content digest (including deletions, binary/untracked artifacts and modes). Before/after snapshots establish what changed; executor linkage establishes who could have changed it. Store references/digests, not prompts or private source contents in the ledger.
- Record deltas at each contributing run, including partial writes before failure. A new edit invalidates review of the old digest. Review and verdict reference the exact artifact digest and reviewer run/provider; model-level quality credit stays provisional when model identity is unknown, independently of provider-level independence.
- Snapshot timing alone cannot prove exclusive authorship in a shared writable tree. Parent edits, concurrent overlapping writers, wrapper edits, missing completion evidence or external changes make provenance incomplete. Union every known contributor; if any contributor is unverified, refuse independent acceptance. Recommend existing isolated run/worktree facilities or verified disjoint scopes; never claim isolation from prompt instructions alone. No new sandbox implementation is authorized by this design.
- Claude and Codex contributions can be reviewed separately only where subtask/diff boundaries and dependencies genuinely isolate the artifact under review. An indivisible artifact authored by both excludes both providers; WAIT_FOR_INDEPENDENT_REVIEW. A human exception may permit explicitly governed continuation under S23, but cannot manufacture independence or accept an implementation without its required independent review.

### Global restriction replacement and cutover

| Existing restriction | Removal/transformation | Stored/approved-team impact |
|---|---|---|
| MI sharedBuilderProvider, builderAdapters filtering, independenceLadder, strict-cap path and reviewer_independence failures (map above) | Remove team-wide provider reservation/exclusion and its derived labels from both capability and efficient formation. Keep role flags, capability floors, non-independence concentration rules and quota logic. | Team seats remain preferred assignments, not task author facts. No automatic rebuild; previously approved identity remains until an authorized route chooses an eligible alternative. |
| `project-strategy.js`:565-571,587-591,606-617 | Remove split-provider and “different from every Builder” vetoes. Replace independence feasibility with candidate availability information, not a global Builder lock (OD-T3-2). | Legacy strategy reads remain byte-identical. Do not relabel persisted blocked seats as approved or fabricate missing candidates; explicit existing approval/rebuild workflow handles genuinely unusable teams. |
| `service.js`:2385-2390,2414-2416 and auto-reform validator | Remove duplicated global vetoes; shared validator retains role/capability/availability checks. Auto-reform must not restore old reservation through formation. | No change to team approval status or operational state on read; no refresh/reform during migration. |
| `project-router.js`:304-314,324-340 and downstream predicates | Remove builderProvider reservation; replace builderProviders-from-team with artifact writerProviders from core provenance. Apply independentAllowed to primary, manual picks, pool, catalog alternatives, fallback, admission and distribution. | Approved model is not guaranteed executable for every task. One-provider teams still require independent review; stale or legacy records never imply an empty author set. |

Stage additive identity/evidence and the core guard first while existing checks still protect old entrypoints; this staging is not completed T3 acceptance. Wire and test every launch entrypoint before a coordinated activation/removal unit. Only then remove global checks and enable per-task behavior together; do not ship final T3 with both policies or remove global gates while old hosts can bypass the guard. Unsupported/old launchers must fail closed for governed launches. Roll back the coordinated cutover as a whole, never just its task guard. New optional ledger fields require compatibility tests and explicit approval of the Contracts paragraph's T2 “ledger format does not change” scope; no historic row rewrite or pending-verdict recalculation.

### Launch boundary coverage

- One core governance operation resolves task/run/artifact state and validates the concrete launch immediately before invocation. Router filtering at 338-345 is necessary but not sufficient. Recheck artifact digest/provenance generation at review launch and verdict; concurrent changes invalidate the admission rather than silently accepting old evidence.
- Fresh cached routes and bulk/precomputed route plans are candidate suggestions only. Re-read task provenance on each launch; do not cache the independence verdict with routing inputs. STALE cannot launch the embedded approved assignment: return the identity block first if missing, otherwise WAIT_FOR_INDEPENDENT_REVIEW when independent eligibility cannot be established. Do not auto-refresh. Builder STALE remains non-launchable under its routing block, not a false independence decision.
- planExecution/executePlan pass taskId and artifact target into the same guard, including retry/new execution and any resume that actually launches work. A read-only return of an already-running execution is not a new launch or new approval. Persisted confirmationTarget must also bind the artifact/provenance revision; stale confirmation requires a new preview.
- Gentle-owned NOT_ROUTED preserves native provider binding and lifecycle authority: Kairo must not redirect or invent native consent. Run the task/artifact compatibility check before handing off an independent actor, and verify its returned provider/revision evidence before Kairo accepts a verdict. If the native binding cannot be safely supplied or verified, block Kairo's review/acceptance instead of guessing from actor names.
- no-redirect is a transport choice, never governance exemption. Guard runs before bypass branches, including missing subagent_type; an unauthenticated marker cannot authorize a review. team exec --no-record may suppress duplicate accounting only, never required provenance/admission. Retry/handover re-enters the guard for each attempt. Broader fallback/model-selection cleanup remains T6/T7 except the minimum launch denial required to make T3 independence real.

### Ordered implementation units (proposal only)

Approximate authored additions + deletions include tests/docs; estimates are not caps. Every unit starts with the named deterministic failing public-interface test, then GREEN and focused regression tests; no live providers. Every changed command updates `src/cli.js` help and `docs/cli-reference.md` in its owning unit. Existing shared behavior gets baseline differential stdout/stderr/exit checks. Full `npm test` and plugin suite follow integration; no tests were run for this design-only edit.

| Unit / task mapping | RED first and acceptance | Proposed edit surfaces | Estimate / dependencies / risk |
|---|---|---|---|
| U1 / T3: persistent identity and envelope | Register/reuse task across resume; retry gets distinct run; unknown/cross-project ID refused before spawn. | `src/global/team/delegation-contract.js`, new `src/global/team/task-provenance.js`, `src/global/architect/{architect-types,architect-manager,architect-store}.js`, `src/cli.js`, `test/{delegation-contract,architect-store}.test.js`, new `test/task-provenance.test.js`, CLI reference. | 300-450; first; items 1,2,3,4 (persistence, safe binding, contracts, idempotent allocation). |
| U2 / T3: provider evidence | Requested-only and exit-zero rows never prove model; linked bridge child provider differs from transport; reliable provider plus unknown version remains reviewable. | `src/global/team/{launch-ledger,routing-trace,team-exec}.js`, `test/{team-launch-ledger,routing-trace,team-exec}.test.js`, CLI reference/help if flags change. | 250-400; U1 and OD-T3-1; items 1,3,4. |
| U3 / T3: artifact provenance | Parent/overlapping edit invalidates authorship; failed run's delta remains; two-provider indivisible artifact blocks; disjoint artifact retains its own author set. | new `src/global/team/task-authorship.js`, new `test/task-authorship.test.js`; consume U1 API without editing U1/U2 files. | 250-400; U1; items 1,2,3,4. Safely parallel with U2 after the envelope/event API is agreed; U2 owns common help/docs. |
| U4 / T3: all launch boundaries | Missing ID, same author, stale cache/plan, no-redirect, NOT_ROUTED, --no-record and retry cannot start an unqualified reviewer; opposite provider succeeds in both directions. | `src/global/team/{project-router,routing-input-cache,service,team-plan,team-exec}.js`, `src/global/hosts/claude-code.js`, `integrations/claude-code/kairo-router/hooks/{register.ts,register.test.ts}`, `test/{team-route,team-plan,team-exec,host-adaptive-delegation}.test.js`, new `test/task-independence.test.js`, CLI reference/help. | 450-650; U2+U3; items 2,3,4,5. One behavior spans transports; split reviewable slices only with guard coverage preserved. |
| U5 / T4 with T3 cutover | Split Claude/Codex Builders form, approve and route; same-provider review still denied per artifact; legacy strategy read unchanged; auto-reform cannot restore global veto. | `src/global/intelligence/model-intelligence.js`, `src/global/team/{project-strategy,project-router,service}.js`, `test/{team-compatibility,team-rebuild,team-reform-integration,team-route}.test.js`, CLI reference. | 300-450; U4 verified, OD-T3-2/3 approved; items 1,2,3. Coordinate deployment with U4, not independently parallel. |
| U6 / T3+T4 evidence and verdict binding | Review of old digest cannot accept new edits; verified provider/unknown model allowed without false model credit; ten historical pending verdicts unchanged. | `src/global/team/launch-ledger.js`, `src/cli.js`, `test/{team-verdict,team-launch-ledger}.test.js`, new `test/task-independence-integration.test.js`, CLI reference and feature evidence document. | 200-350; U4+U5; items 1,2,3,4. Complete before T3/T4 acceptance. |

All U1-U6 need independent cross-vendor review for their authored change under S14/S71, with S5 trace/test evidence; deterministic tests do not replace that review. They also touch named high-risk items: native risk assessment and native review when due/enabled, with its own candidate consent, plus applicable independent verification. Do not count a relaying wrapper as the reviewer. U2/U3 are the only safely parallel implementation pair; all other dependencies and shared files require ordering. This document-only proposal needs structural readback, not an implementation review verdict.

Proposed task-line replacements, text only: T3 → “S1,S5,S14,S67,S71,S72,S75,S76; U1-U4,U6; persistent task/run/artifact identity, reliable writer-provider evidence and every-path independent admission; acceptance includes reliable provider with unknown model, resume/retry and stale/bypass tests; completed only with coordinated T4 cutover.” T4 → “S1,S14,S71,S76; U5; remove/transform all global formation/approval/reform/routing restrictions after every-path task guard is proven; split-provider teams valid, legacy bytes preserved, no unguarded activation window.” Keep both pending and preserve their current task lines until user approval.

### Failure scenarios and open decisions

| Scenario | Required outcome |
|---|---|
| Codex-authored artifact / Claude-authored artifact | Only eligible Claude / Codex independent reviewers respectively; neither quota nor manual pick restores author provider. |
| Both providers authored one indivisible artifact | WAIT_FOR_INDEPENDENT_REVIEW; neither provider alone is independent. |
| Missing task identity or mismatched task reference | WAIT_FOR_TASK_IDENTITY; no governed launch. |
| Only one provider available | WAIT_FOR_INDEPENDENT_REVIEW if it is the author or cannot supply eligible independent review; no team-size bypass. |
| Writer provider declared but not verified | Exclude the declared provider from review; acceptance state per S85, never ACCEPTED by declaration alone. |
| No writer provider declared, or artifact provenance missing | WAIT_FOR_INDEPENDENT_REVIEW; selected route, naming and successful exit alone cannot repair missing evidence. |
| Reliable writer provider, exact model unknown | Apply provider exclusion normally; keep model identity unverified and its quality credit provisional. |
| Stale cache, stale plan or artifact changed after preview | Revalidate at launch; no STALE assignment execution or stale review acceptance; identity/review block as above, new preview for changed artifact. |

- OD-T3-1 — Provider trust boundary: may an authenticated, known stock provider executor establish provider identity without a model-version observation? Recommend yes only with run-bound executor/configuration evidence and explicit scope; otherwise require runtime observation. Tradeoff: more usable reviews versus stronger backend attestation. Current team exec trace alone meets neither proof standard. User decision pending; no new attestation infrastructure presumed.
- OD-T3-2 — D1 currently retains a formation feasibility veto (“for each provider able to build…”), potentially conflicting with S76 and one-provider blocked review. Recommend nonblocking feasibility diagnostics and task-time enforcement only; preserve quality/availability checks. Tradeoff: teams can form when some tasks must wait for review. Requires approving D1 wording, not silently changing it here.
- OD-T3-3 — Authorize T3/T4 as a coordinated governance cutover, including minimal launch denial and future task-bound verdict changes now scheduled under T6/T7? Recommend yes to prevent cache/bypass gaps; do not pull in unrelated dynamic selection or fallback work. This is approval of scope/order, not permission granted by this design.

Superseded by the specs above: OD-T3-1 is resolved as provider and model evidence kept separate; adapter dispatch alone proves neither. U1-U6 and provenance.jsonl remain a proposal only and need re-scoping to the three approved components before any code. Codex evidence checked on codex-cli 0.166.0 with no model run: rollout model fields echo the request and no served model was found (openai/codex issues 47779, 47354, 46632). codex exec --json and live INFO logs were not tested.

Verification limits: source inspection and T2's recorded final result only; no installed pinned-wrapper inspection, real executor/backend attestation, live Claude observation or test execution. Existing stale Engram preferences were not used as current authority. No claim of exhaustive support for external launchers that bypass Kairo; those cannot produce accepted independent-review evidence through this design.

### Reduced T3 specification
Approved direction per S77-S81 and S82. This replaces U1-U6 as the plan of record; the text above stays as the verified map and rationale. No new agents, cells, services or persistent registries. Implementation is not authorized.

Component R1, task identity. Reuse Architect task ID validation and allocation. Launch, outcome and trace rows carry optional taskId and executionId through the existing ledger and trace. Retry gets a new executionId under the same taskId. Missing or mismatched identity on a Builder or Reviewer launch returns WAIT_FOR_TASK_IDENTITY. Other roles are not governed by this check unless the user decides otherwise.

Component R2, executor evidence. ExecutionEvidence per S78, recorded on existing ledger rows. Provider is verified only from evidence bound to the execution: Claude from the linked subagent transcript of this worker; Codex from the linked rollout with model_provider openai, originator codex_exec, a response_id, and no custom base_url or transport override. Adapter dispatch alone verifies nothing. A wrapper transport model never counts. servedId stays null when unproven, and such a model gets no verified model credit; existing provisional credit from b434ffdab stays marked unverified.
Amendment per L38: routing-trace is the execution evidence record and the Launch Ledger is routing accounting only; ExecutionEvidence is stored on trace rows, not ledger rows.

Component R3, per-task review admission. One core check runs immediately before every Builder and Reviewer launch, including cached, STALE and precomputed paths, and again at verdict. It excludes every authoring provider at any evidence level, because declared evidence can deny independence but never grant it (S85). No declared provider or both providers on one indivisible artifact returns WAIT_FOR_INDEPENDENT_REVIEW; acceptance states follow S85. Global restrictions are removed in the same coordinated cutover as this check, never before it, per OD-T3-2 and OD-T3-3.

Authorship check per S82. Evidence on the ledger: taskId, executionId, provider, base commit, diff hash, affected file scope, including staged, unstaged and relevant new files. At review preparation, recompute with local tools only. Same hash means normal review. A different hash blocks that task only, until resolved. A hash proves content, not author.

Human confirmation is a recorded declaration, never verified authorship, and the whole diff is then reviewed. Open point for implementation: the confirmation must come from the human and not from an agent running the same command. This is the existing P1 authorization mechanism question; do not ship the confirmation path until it is answered.

Known consequence of using the ledger: rows are pruned after 8 days. Evidence older than that returns WAIT_FOR_TASK_IDENTITY, failing closed, and needs a new review.

Required deterministic tests, RED first, no model runs, through public interfaces, asserting output, exit code and persisted rows:
1. No delta: normal review with no prompt and no model call.
2. Recognized human delta: declaration recorded as declared, not verified; full diff reviewed.
3. Delta from another identified agent: every authoring provider excluded; if both providers authored one indivisible artifact, WAIT_FOR_INDEPENDENT_REVIEW.
4. Unknown delta: WAIT_FOR_INDEPENDENT_REVIEW; acceptance blocked; another task in the same team continues.
5. Delta outside scope: blocked until isolated or reverted by an authorized procedure.
6. Staged, unstaged and new-file changes each change the hash.
7. Codex-written task gets only Claude reviewers, and the reverse.
8. Codex rollout with a custom base_url does not verify the provider.
9. STALE route and precomputed plan cannot skip the check.
10. Review of an old hash cannot accept newer edits.
11. Legacy rows and the ten pending verdicts are unchanged.

Rough size, an estimate and not a cap: 1300-1900 changed lines including tests and docs, against 1750-2700 for U1-U6. Slice into reviewable commits of about 400 lines with each slice keeping the guard coverage. Each slice needs cross-provider review under S14.

## R3/T4 execution observation design (S87)

Design only; nothing in this section is implemented. It reuses S85, S86, L56 and the existing routing trace. Evidence base: L59 and the code locations named here.

### Where it lives

One optional object, executionObservation, on existing kairo.routing-trace/v2 rows. There is no ledger row kind called observation. Codex evidence sits on rows with source exec (providerEvidence), and only native Claude transcript observation uses source observation, so the contract spans both sources instead of extending one. Trace rows feed no routing, admission, quota or verdict today (routing-trace.js:37), and this design keeps that. Ledger rows do feed routing accounting and are not extended.

### Contract

- Identity: existing taskId, taskIdStatus and executionId, plus hostProvider, executionProvider, executionRoute (child-process or host-subagent), sessionId.
- Models: requestedModelId and clientReportedModelId. The second is what the client recorded, never the served model. providerVerified stays false and servedModelId stays null.
- process, null on host-subagent: executablePath, version, signature (checked, valid, teamIdentifier, cdHash), pid, exitCode. PID is correlation only, since PIDs are reused.
- lifecycle: source (child-pipe or host-hook), startedCount, completedCount, firstEventAt, lastEventAt, toolCallCount.
- sessionArtifact: kind (codex-rollout or claude-transcript), linked, path relative to the provider home, fileId, startOffset, endOffset, sha256 of that byte range.
- reasons: fixed vocabulary, with transport reasons kept apart from local provenance reasons.
- contribution: null until a task binding exists (see below).

Never persisted: argv, prompts, environment, credentials, rollout or transcript content, tool arguments, file contents.

Differences from the sketch in the S87 decision: process is nullable because a native subagent has no Kairo child; rolloutLinked becomes sessionArtifact.linked because it is Codex-specific; provenanceLevel is derived by one pure core function from the stored evidence and is never accepted from input; an unknown host or any other executionProvider stays DECLARED, which keeps the other value of S86 without crediting it.

### Evidence per route

| Requirement | Codex child (team exec) | Claude child (team exec) | Claude native subagent | Codex native host turn |
|---|---|---|---|---|
| Recorded before work | Ledger row before spawn, seen in L59 | Same path | Hook launch row before the host call | No source |
| Local executable | Path, signature, cdHash; pinned Team ID | Signed Mach-O, Team ID Q6L2SF6YDW seen locally, not pinned | Not available: host process, declared only | No source |
| Lifecycle | Child pipe: thread.started, turn.completed, exit code | stream-json events and exit code, fields to validate | Hook launch and SubagentStop for the same agent_id; foreground has no structured link | No source |
| Correlation | thread_id to rollout by file name; executionId only through the trace | --session-id can carry the executionId, so the session file would hold it; unproven | Background: structured agentId, then agent_id to agent_transcript_path (register.ts:576-583). Foreground: none accepted | No source |
| Session artifact | Rollout checks of inspectRollout | Transcript, checks to define | Transcript, checks to define | Own rollout, no reader |
| Who classifies | Kairo parent process, in process | Same | Hook through a CLI payload (see trust boundary) | Nothing |
| Status today | OBSERVED candidate per L59, fields not yet persisted | team-exec.js:160 refuses --verify-provider; needs a future authorized canary | Background: OBSERVED candidate under S88 and S90, not implemented. Foreground: DECLARED | DECLARED |

Bridge launches (kairo-* agents) take worker evidence from the exec row, linked by the execution marker; the bridge and the worker are linked runs, never two credited writers. Codex as host launching Claude uses the Claude child route. No Codex-host hook or observation source exists in this repository.

### Trust boundary

Codex evidence reaches the trace only as an object classified in process (routing-trace.js:37-38). Native Claude rows do not: the hook calls kairo team record-trace with a JSON payload (register.ts:681), and any local process can run that command. The symmetric design therefore keeps the hook thin: it passes only execution id, agent_id and transcript path to a core operation, core reads and classifies the transcript itself, and record-trace drops any executionObservation in a payload.

Threat model: the trace, rollouts and transcripts are local files writable by the same user. An unsandboxed Claude subagent with shell access could write them; whether the write guard stops that is not checked. A Codex child runs in workspace-write, which should keep it away from those paths, also not checked. OBSERVED protects against misattribution, silent fallback and routing errors, not against a malicious local agent. Any policy that uses OBSERVED must say so, and it can never grant VERIFIED (S85).

### Auditable reduced evidence

cdHash identifies the executable, event counts and timestamps replace raw events, and the artifact hash lets an auditor re-read the rollout or transcript while it exists and re-derive the lifecycle and tool calls. A hash covers exactly the validated byte range of one segment, since a transcript can grow after a stop event and a subagent can resume. Recording stays best effort: a busy trace lock skips the row after 200 ms (routing-trace.js:121), so the level stays DECLARED, with no retry and no blocked work.

Retention: see Retention tied to the task below.

### Task and contribution binding

OBSERVED describes one execution. S5 needs three more links, none proven by L59.

1. Task: taskIdStatus is linked only when an Architect task record exists (task-identity.js:18-32), so feature-document IDs such as T3 resolve to not_found today. A registered task is a precondition.
2. Artifact revision: the reviewed bytes must match the result of the observed execution.
3. Contribution, one object: baseHead, baseTreeDigest, resultTreeDigest, changedPathCount, changedPathsDigest, contributionStatus (linked, ambiguous, none or task-unresolved). Core computes it before launch and after finish with read-only git operations that do not touch the index.

contributionStatus is linked only when the task resolves and no other open execution or main-session write overlaps the interval on that root. Otherwise it is ambiguous and credits nothing, and a host write to the same artifact re-evaluates independence per S86. Parallel units in one tree will often be ambiguous unless a later design narrows attribution to declared edit surfaces.

The earlier T3 proposal of a separate provenance.jsonl under the task directory conflicts with S87 for this contract, so contribution stays on the trace row. Reviews use the same contract with reviewProvider and the artifact revision. The stale-result defect of team-reviewer-codex (L58) keeps that reviewer out of this evidence until fixed.

### team-builder-codex migration

The wrapper calls codex exec directly, so its work stays DECLARED. It cannot switch as is: checkCodexArgv accepts only exec, --json, --approve-for-me, --model, the effort override and the task, so the wrapper's sandbox, work-directory, git-check and output-file flags would read as argv-disallowed, and the verified path uses --approve-for-me instead of an explicit sandbox.

Candidate: keep the wrapper's reduced context and replace only its single call with kairo team exec --verify-provider for work inside a repository. Work outside a repository stays direct and DECLARED. C1 measured the Claude wrapper's first-request cache write (63165 to 7768, L40), so changing the inner call should not lose it. That is an inference: repeat the same measurement and require no regression. Also measure the automatic approval route against the current sandbox, tool-shell behavior under the environment allowlist, and returning the final message through stdout. The wrapper definition is global configuration, and changing it is not authorized.

### Native Claude OBSERVED (S88)

Native Claude reaches OBSERVED with executionRoute host-subagent and process null. The route stays visible so a later policy can distinguish it. Official hooks documentation (code.claude.com/docs/en/hooks) states that not every SubagentStop comes from a subagent Claude spawned, since internal agents such as prompt suggestions also fire it, with agent_type set to the session agent name or empty. It also states that transcript_path is written asynchronously and may lag. Stability of agent_transcript_path is a hypothesis pending verification (S89), with no guarantee inherited from that statement.

All of these must hold, otherwise the level stays DECLARED with a fixed reason:

1. Launch correlation: a Kairo launch row for an Agent tool launch with its executionId exists first. A SubagentStop without a correlated launch is ignored, which excludes internal agents.
2. Identity: session_id matches the launch, agent_type equals the launched subagent type, and agent_id comes from a structured, host-owned launch result or background launch key. An ID parsed from result text never qualifies, because reportedAgentId falls back to model-adjacent text (register.ts:265-274), so that parser stays informational for existing accounting. A foreground launch without a structured link stays DECLARED. Plugin-scoped names need a defined comparison. Local transcripts showed 19 of 19 background results with a structured agentId and no structured result on the 8 others (L62); what the hook receives is still unverified.
3. Transcript location: core derives the expected path from project, session_id and agent_id (the documented nested subagents folder) and requires the host path to match. It opens the file without following symlinks and takes no path on trust.
4. Transcript content: every row carries the same sessionId and agentId, isSidechain is true and cwd matches the project. Field names were read from one local transcript, not from a documented schema, so they bind to a checked CLI version.
5. Segment: one open execution per session_id and agent_id, and each stop closes at most one. A stop with no open execution is ignored. Overlapping or contradictory executions for that key are ambiguous and stay DECLARED. The byte range of the segment must have three proofs:
   - Trusted start: offset 0 only for a genuinely new artifact that was empty at launch, or the endOffset of the previous segment's retained row for a resumed subagent. The previous range must still hash to its recorded sha256 with the same fileId. A resumed subagent without that row has no trusted start. Emptiness at launch cannot be observed directly, because agent_id and the path are unknown until after the launch. A first row timestamp not before launchRecordedAt, with no earlier segment, is a temporal indication only and is not enough for OBSERVED (S92), so a first segment has no trusted start today and stays DECLARED. Proposed source, pending verification and user approval: at the documented SubagentStart event, which carries agent_id before work begins and also fires on resume, core records whether the artifact is absent or empty, or its current size for a resume. The repository does not handle that event today, and whether the file is absent at that moment is unverified.
   - Verifiable end: the end of a complete line holding the last assistant row of the segment, with no later assistant row after it and a row uuid not seen in an earlier segment, which helps against reuse and is insufficient alone. Two reads within the existing bounded re-read must return the same size, fileId and range digest. Equal reads do not prove the host finished writing, so they never replace stop correlation.
   - Stop correlation: that assistant row's text equals last_assistant_message from this stop event. This equality is necessary and never sufficient: it proves neither that the segment is new nor that it is stable.

   If the file changed, was truncated or replaced, or the range cannot be delimited with confidence, sessionArtifact.linked stays false, no digest is written and the level stays DECLARED. Hash and offsets are taken only after all three proofs hold. No new synchronization mechanism or file is added: the offsets live on the trace row.

SubagentStop does not prove successful work, so completion status stays a separate field and a failed run can be OBSERVED. Multiple stops for one agent_id are distinct segments and one record per agent_id never proves one continuous execution; the current maps in register.ts keep only one transcript per agent_id, so they cannot serve this contract as they are. The sidecar agent-ID.meta.json next to the transcript exposes agentType, toolUseId and finished. It appears undocumented, so it is a complementary signal only: never required and never a basis for authority until its stability and origin are verified. Without enough observability a foreground subagent stays DECLARED and keeps running natively; no external process replaces it.

### Trusted event sources

| Source | Trust | Use |
|---|---|---|
| Codex child pipe and exit code, read by the Kairo parent | Direct, in process | Lifecycle evidence |
| Host hook event inside the plugin | Host origin, reaches core only through a local command | Pointers: session_id, agent_id, last-message digest, launch id |
| Session artifact read by core | Written by the CLI, same-user writable | Re-derived identity, lifecycle, tool count |
| record-trace or record-launch payload | Any local process | Never evidence; rows may be written, levels never derive from their fields |
| Agent prompt or result text | Model controlled | Never evidence, including any marker (S85) |

The hook stays thin: it sends pointers to one core operation, and core rebuilds the observation. Gap for the independent review: core cannot authenticate that the caller is the host hook, because plugin and core are separate processes and any same-user process can invoke the same operation with a fabricated transcript. S88 is met against accidental or careless payloads, not against that forger, which matches the threat model above.

### Dimensions

executionObserved means provenanceLevel OBSERVED. contributionLinked means contributionStatus linked. providerVerified stays false. They are not stored as separate flags, to avoid duplicates that can disagree, and each is derived by core. A native Claude row can be OBSERVED with contributionStatus ambiguous or task-unresolved; it then credits no artifact authorship and no independence under S5.

### Retention tied to the task

Today the routing trace and the ledger prune at 8 days (routing-trace.js:18, launch-ledger.js:19), which is shorter than a task can live, so this blocks durable authority (S88). Storage policy must never decide which tasks were completed. Criteria, all within the existing routing trace file:

- Closure source: retention depends on a real task state source, and none exists today. PLAN_STATES in architect-types.js holds draft, awaiting_approval, approved, rejected and failed, which are plan states, so task closure is never inferred from them. Execution and run results describe a run and are not established as task closure. No terminal state is invented.
- Linked rows: a row with executionObservation and taskIdStatus linked is kept while no authoritative closure exists. Once such a source exists, the 8-day window starts at closure.
- 90 days: a provisional threshold, not a deletion cap. A linked row older than 90 days with no authoritative closure is flagged for review or resolution. The flag is derived when read, deletes nothing and never marks the task finished.
- Other rows: rows without a linked task keep the 8-day rule unless an active dependency needs them, meaning a retained review or contribution that cites the row, directly or through references needed to rebuild the evidence. Such observations never serve S5 after that window. A resumed subagent whose previous row was pruned has no trusted start and stays DECLARED.
- Launch ledger: it keeps 8 days because its rows feed routing accounting. Its launch time is copied into executionObservation as launchRecordedAt.
- Content: no transcript or rollout content is copied. Providers clean their own files under their own policy, so after that the stored hash can no longer be re-checked, while the reduced row survives. A review that needs re-derivation must happen before that point.
- Performance gate: with no closure source, linked rows accumulate in one file that appendRoutingTrace reads whole under a lock whose waiters give up after 200 ms (routing-trace.js:121,127). This retention is not implemented until the existing operation is measured on scratch copies at representative trace sizes, with concurrent writers. Evaluation target, not an approved guarantee (S92): at the size projected for one year of linked rows, lock hold time stays under 100 ms at p95 and fewer than 1 percent of appends skip. Every lock loss is measured and reported, and a silent loss is a defect. Index, database or new file options are not chosen before that measurement. A skipped row or failed read stays DECLARED; evidence is never invented.

### Still open

What the hook actually receives on background and foreground results; stability of agent_transcript_path; stability and origin of the sidecar; a real task closure source; Codex native host source; every Claude stream-json field, which needs a future authorized canary; Architect registration for delegated work. Independent review: CONDITIONAL_PASS on S85-S88 (L62), findings addressed in design without a new independent PASS (L63). Codex startup context, about 42.5k input tokens per request (L59), is a separate optimization line after this contract.

## R3/T4 authority policy and minimal cut (S91)

Prepared only. No code, hook, wrapper or routing change is authorized by this section.

### Authority policy

| Stage | Minimum evidence | Behavior |
|---|---|---|
| Admission | Valid task and eligible provider | Allow execution |
| Execution | Launch record | Record declared authorship |
| Review | Reviewer different from the declared author, and an effective review | Allow the review, stating its limits |
| Acceptance | Independence credited under the policy in force | Close or stay provisional |

| Builder | Reviewer | Result |
|---|---|---|
| Codex DECLARED | Claude DECLARED | REVIEWED_PENDING_PROVENANCE |
| Codex OBSERVED, ambiguous contribution | Claude OBSERVED | REVIEWED_PENDING_PROVENANCE |
| Codex OBSERVED, linked contribution | Claude OBSERVED, linked review | Candidate operational independence; acceptance still pending policy and validation |
| Claude foreground DECLARED | Codex OBSERVED | REVIEWED_PENDING_PROVENANCE |
| Contradictory identity or known conflict between contributors | Any provider | WAIT_FOR_INDEPENDENT_REVIEW |
| Explicit human exception S23 | Not applicable | Documented exceptional closure |

### Findings that shape the cut

1. The Router denies no launch today. The Builder route returned WAIT_FOR_PROJECT_TEAM while team-builder launches ran in the same session, and T6 is not implemented. The veto lives at approval (project-strategy.js:565-571,587-591; service.js:2385-2390,2414-2416) and at route selection (project-router.js:314,333,338-340).
2. Removing the veto may not clear the current Builder wait. Its stated reason is a stale Claude Sonnet 5.5 entitlement, with Codex models rejected as outside band or unqualified. kairo team verify-access --refresh was not run, because it may spend quota. Whether outside band derives from the reservation is unverified.
3. Per-task admission has no input yet. T3 is pending, src has no reader of writer providers by task, and writeTaskArtifacts is called only from the Architect flow (architect-manager.js:111). Without a way to link delegated work to a task, admission stays inert and removing the veto would lose the current protection.
4. Component R1 returned WAIT_FOR_TASK_IDENTITY on any Builder or Reviewer launch with missing identity, which would have been a new global block. S92 replaces that behavior for launches; see the identity contract below. The T3 acceptance line predates this and must be read accordingly.
5. OD-T3-2 requires removing global restrictions in the same cutover as the per-task check, never before it, so U2 to U5 ship together.

### Units

- U1, marker defect, first and alone. See U1 specification below.
- U2, declared authorship reader. One core reader returns the declared writer providers for a taskId from ledger launch rows. Rows older than the 8-day ledger window return WAIT_FOR_TASK_IDENTITY for credit purposes only.
- U3, review admission. One core predicate runs before every Reviewer launch and again at verdict. It excludes every declared writer provider, is scoped to that task and never reads a global state. Builder launches stay allowed.
- U4, provisional states. Results carry REVIEWED_PENDING_PROVENANCE or WAIT_FOR_INDEPENDENT_REVIEW explicitly. They do not count as accepted or as successful independent reviews, and they enable no merge or deploy. A review must be real and tied to task and artifact. Existing pending verdicts are not migrated or recorded.
- U5, veto removal in the same cutover. Remove the split-provider and different-from-every-Builder checks at approval and the Builder reservation at route selection. Legacy strategy reads stay byte-identical. Formation in model intelligence is left as it is, so suggested teams do not change.

Tests first, through public interfaces, with no model runs: a marker in user text changes nothing; a marker in a prompt skips the rewrite and not admission; a codex-written task gets only claude reviewers and the reverse; both providers on one artifact give WAIT_FOR_INDEPENDENT_REVIEW; a team with Builders on two providers is approved and routed; a legacy strategy read is unchanged; a provisional result is never counted as accepted. An independent verifier applies, since U1 and U5 name high-risk items.

Excluded from this cut: executionObservation and all OBSERVED implementation, retention and its measurement, the diff-hash delta and human confirmation of S82, team-builder-codex migration, T5 to T10, model intelligence formation, entitlement refresh. Without observation, every result in this cut is DECLARED and at most REVIEWED_PENDING_PROVENANCE, so no task reaches ACCEPTED through it. S82 is deferred only while that holds (S92). Exceptional closure stays explicit human S23, never an implicit Router decision. Entitlement problems stay visible as access problems: they are neither reinterpreted as independence failures nor skipped.

### Identity contract (S92)

| Situation | Execution | Review | Acceptance |
|---|---|---|---|
| No taskId | Allowed, UNLINKED | Allowed as feedback | Not credited |
| Valid taskId, DECLARED authorship | Allowed | Allowed with S5 exclusions | REVIEWED_PENDING_PROVENANCE at most |
| Nonexistent or contradictory taskId | Allowed only as unlinked, anomaly recorded | Cannot credit independence | Blocked |
| Identity and contributions sufficiently credited | Allowed | Evaluated per task | Per authority policy |
| Explicit human S23 exception | Per authorization | Per scope | Explicit exceptional closure |

Classification uses the existing taskIdStatus: absent is UNLINKED; invalid, not_found, unreadable and conflicting markers are anomalies with a fixed reason; linked is a linked task. Later linking grants no retroactive credit. It needs proof that launch, interval and contribution belong to the task, which this cut cannot produce, so linked-later work stays provisional.

Limit of the distinction: a task marker removed on purpose or lost before the launch looks like absent, so it cannot always be detected at launch. Detectable cases are invalid or conflicting markers and a retry whose parent execution was linked. Consequences stay safe in this cut because of the REVIEWED_PENDING_PROVENANCE cap: a hidden Builder could leave a provider out of the U3 exclusions, and that review still earns no acceptance. Before any later slice grants acceptance, contribution evidence must treat an unlinked write that overlaps an open task as ambiguous for that task. Linking in this cut covers Architect tasks only; a lighter explicit registration operation is not specified here.

### Blockers for U2 to U5 (S93)

- U1-F1, actor identity. The gentle-ai exception matches a name. subagent_type is an Agent tool input the model chooses and nothing verifies it (register.ts:62,668; role-catalog.js:28-32), and an exact name skips routing, enforcement, ledger and trace. A name match cannot remain a basis for authority once per-task admission exists.
- U1-F2, fail-open fallback. With no alternative, core returns WAIT_FOR_PROJECT_TEAM and the hook launches the original agent unchanged (register.ts:820-825,933-939); stale inputs and routing errors do the same. A routing state is not an execution block, so an exhausted provider can still be reached.

Both predate U1 and are not worsened by it.

### U1 specification

Implemented and reviewed in the repository (S93, L66), not validated in the installed plugin. Risk items 2 and 3, because the marker is a documented contract.

Behavior: the no-redirect marker becomes ordinary text everywhere. Remove detection in user text (register.ts:590), in every string field of the launch (register.ts:691-693) and in the prompt (register.ts:21). No structured host metadata for this was found in the Agent tool input read here, so no replacement is added. gentle-ai actors keep their structural bypass by agent type. Pacing, admission and enforcement apply to every other launch, and the bypassed branches become unreachable and are removed.

Consequences accepted by S92 and to be stated in the change:
- No launch can opt out of the provider rewrite, including one a human chose.
- Re-delegating after a wrapper returns a fallback now goes through routing. It must not route back to the exhausted provider; the existing exhaustion markers should cover that, and a test must prove it.

Surfaces: integrations/claude-code/kairo-router/hooks/register.ts and its register.test.ts and parity.test.ts, integrations/claude-code/kairo-router/README.md, src/global/hosts/claude-kit.js with test/claude-kit.test.js, docs/cli-reference.md, plus the plugin version.

Tests first, through the public hook interface: the marker in user text, in a prompt and in another string field changes no route, label, ledger row or trace override field; a gentle-ai actor still passes untouched; a re-delegation after a fallback does not return to an exhausted provider. Existing marker tests are rewritten to these expectations.

Outside the repository and not authorized: global user instructions and user agent definitions still tell the orchestrator to use the marker, and they become stale when U1 ships. Delivery gap: the installed kairo-router is 0.7.5 and the repository holds 0.8.0, so U1 has no effect in live sessions until a plugin install is authorized.

## T5 Builder eligibility design (S95)

Specified, not implemented. T5 does not block U2 to U5.

### Observed

- Routing input cache regenerated at 23:02:40Z with claude-opus-5-5 and claude-sonnet-5-5 allowed, and Builder still returned WAIT_FOR_PROJECT_TEAM.
- The cached roles.Builder.pool holds only kimi-k3, glm-5.3, qwen3.8-max and glm-5.3-flash, all opencode-go, a provider not configured for team roles. Filtering at read time (routing-input-cache.js:204) leaves it empty.
- The rejection labeled outside band comes from isModelCompatibleWithRole (project-router.js:386), the frontier gate for labor roles, not a price band. Cutoff 54.5. Indexes: claude-sonnet-5-5 54.5, gpt-6.1-sol 54.6, gpt-6-astra 56.9, claude-opus-5-5 59.1. The grandfathering at project-router.js:289-294 does not cover frontier_labor.
- A local recalculation with qualifiedRolePool over cached models, the hydrated registry, account key default and the strategy role capabilities returned only codex/gpt-6-luna, with and without opencode-go models. The default route lists gpt-6-luna as unqualified. kairo team route --role Builder --provider codex returned provider_unavailable; with claude it returned unqualified_provider.
- A team-builder launch around 23:03Z, with Builder waiting, left no ledger row, matching the conditional recordLaunch call at register.ts:929-930. Installed plugin 0.7.5 contains no record-trace call, and the trace holds no observation or launch row for that launch; its latest rows have source exec. Repository plugin 0.8.0 does write trace rows on that path, by code reading, not observed live.

### Hypotheses, not established

- Why the cached pool holds only opencode-go. The recalculation used cached models, while the cache was built from teamSelectionPool, so it does not reproduce the original input. It gives no support to the idea that disabled providers displace configured ones, and it does not rule it out.
- Why gpt-6-luna differs between evaluations. Candidates: different inputs, account key, owned evidence, or a stricter check at routing. T1 recorded a public score of .363 and an owned pass of 1, and pool-dependent values for gpt-6.1-terra (.519 and .553). No defect in qualifiedRolePool is concluded.
- Whether claude-haiku-5-5 is viable. T1 measured .437 and .471, below the .55 floor, and its entitlement is unverified.

### T5.1 Evaluation comparison, first

Compare the same candidate at five points, each recording data version and effective configuration: candidates and scores when the pool is built; results persisted in the cache; filters at read time; the builderQuotaPool result; the final project-router decision. The output is the first point where two evaluations of one candidate diverge. It uses existing data and no models, and it does not rebuild the team or invalidate the cache. No rule changes until this is explained with equivalent data.

### T5.2 Label

outside band becomes frontier_labor conceptually in this design. Code and criterion stay unchanged. Its use of priceBandExclusions, a name broader than its content, is part of that later rename.

### T5.3 NO_ELIGIBLE_BUILDER

When the eligible set is empty the state is NO_ELIGIBLE_BUILDER, with a reason per candidate and the alternatives considered. It does not block ordinary work.

| Event | Record |
|---|---|
| Builder selected by Kairo | Launch eligible for Router accounting |
| Builder run with no valid selection | Observed or declared execution, not selected by Kairo |
| Builder with no task identity | UNLINKED, no contribution credit |
| Builder with contradictory selection | Explicit anomaly, no selection credit |

Unselected executions stay in the existing trace and out of the distribution ledger. No new provenance file is added.

### T5.4 Frontier boundary

The 54.5 cutoff and the .55 floor stay. claude-sonnet-5-5 at 54.5 and gpt-6.1-sol at 54.6 justify no move. Frontier use goes through the approved S10 order and the S17/D9 bounded launch-time exception, which T5 reuses. That exception needs a justified and recorded task, so it follows U2 to U5.

### Open points for U2 to U5

- The authorship reader of U2 was specified over ledger launch rows, which miss unselected Builders, so it must also read the trace for them. Trace rows feed no admission today (routing-trace.js:37). This use can only deny: S85 allows declared evidence to deny independence, never to grant it.
- The trace row depends on plugin 0.8.0. With 0.7.5 installed, those launches leave no record, so U2 cannot work in live sessions until a plugin install is authorized.
- A trace row skipped by a busy lock also loses the fact, which must be reported rather than read as no Builder.

## U2 to U5 implementable specification (S96)

Specified, not implemented except where a task line says otherwise. Governs the coordinated cut. Reuses S85, S91, S92 and S93, and the Units, Identity contract and Blockers sections above. OD-U-1 to OD-U-4 are resolved by S97. Line anchors were read at 182576478.

### Delivery inventory (S96 step 1)

Read-only. Separation was simulated with git merge-tree against throwaway object storage: no ref, history or worktree changed. A clean merge is textual only: no test suite ran on any simulated tree.

| Unit | Commits | Size (added/removed) | State in this document | Depends on |
|---|---|---|---|---|
| D1 T2 trace | 099824150 7e2d5f47b 00a7f7247 c59f25a35 256ae4855 e06ec0453 | +622/-77 | Accepted with limitations | main |
| D2 T2 model identity | bd34aa0ba b434ffdab f5cd6733d | +854/-93 | Accepted with limitations | D1 |
| D3 T3-R1 and R2a correlation | aae75cc95 2fda46f26 | +690/-99 | Accepted | D2 |
| D4 R2b provider evidence | ee93bad29 e3b4e30af ae5ef70b2 | +1397/-152 | STOPPED, not accepted | D3 |
| D5 U1 marker removal | 604923dfe | +219/-121 | Implemented and reviewed in the repository, not validated installed; risk items 2 and 3 | D1 to D3 |
| Docs only | the other 24 commits | odd/ only | Decisions and evidence | none |

- 15 code commits, 24 docs-only commits, 39 in total.
- Dropping D4 leaves no conflict outside odd/, so R2b is textually separable. Recommendation: keep D4 out of the first deliveries; its fate stays a user decision.
- D5 alone on main conflicts in register.ts and register.test.ts, so U1 cannot ship ahead of D1 to D3.
- Conflicts in odd/tasks/router-provider-authority.md were ignored by the simulation. That file needs one delivery of its own, or one final slice.
- D1 to D4 each exceed the 400-line heuristic. The chain strategy stays open under ask-on-risk.
- Backup: nothing was created. A local git bundle protects only against repository damage, never against disk loss.

### Findings that change the cut

- F-A, live core. ~/.local/lib/node_modules/@kal-elsam/kairo-runtime is a symlink to this checkout, so every edit under src/ in this checkout reaches every live session at once, uncommitted edits included. The plugin stays at the cached 0.7.5. Removing the veto here would go live with a hook that sends no task to route: exactly the state OD-T3-2 forbids. Implementation must therefore happen in a separate worktree at agentic-harness-worktrees/u2-u5, with its own CodeGraph index, and the core change must not depend on install order (see U5).
- F-B, U5 list incomplete. The Units section omits the team-wide Reviewer filter at project-router.js:337-349. With Builders on two providers that filter empties the Reviewer pool, so it must become task scoped in the same cutover.
- F-C, formation. U5 leaves formation unchanged, yet project-strategy.js:606-616 still throws reviewer_independence during formation. The T4 acceptance sentence about kairo team rebuild cannot hold as written. Corrected acceptance: a two-provider Builder team reaches approval and routing through carried assignments or a fixture; formation output and its errors stay identical.
- F-D, explicit model bypass. register.ts:801-809 keeps an explicit Claude model whenever the route gives no proof against it, so a linked Reviewer could reach Claude after core excluded Claude. U3 must close this.
- F-E, verdict binding. runVerdictCli selects the latest pending outcome by agent name (launch-ledger.js:277-278), and attributedOutcomes strips task and execution identity (launch-ledger.js:218,227). Today a verdict cannot be bound to one task.
- F-F, role flags. independentReview is true for Reviewer, Security Reviewer and Quality Lead, and false for Verifier, while S71 speaks of an independent Verifier. In this cut Verifier earns no independence credit. No registry field marks writing roles.
- Unverified: whether route rejects an unknown flag; whether the live Reviewer pool holds both providers, without which a linked task honestly stops at WAIT_FOR_INDEPENDENT_REVIEW; whether any consumer of role-telemetry.js:90 treats pass as independent review.

### U2 contract: authorship reader

New core module src/global/team/task-authorship.js, read-only: readTaskAuthorship(home, root, taskId, now).

Sources, as a union by executionId:
- Ledger launch rows with this taskId and taskIdStatus linked.
- Routing trace rows with source hook or exec and this taskId, which adds launches that have no ledger row (register.ts:930 records only routed launches). Trace rows may only deny, per S85. The reader never reads providerEvidence (routing-trace.js:37).

Writing roles: registry builder true plus Documenter, DevOps and Test Designer, as one tested core constant. An agent that resolves to no role counts as writing, because this use can only deny.

Result:

| Field | Meaning |
|---|---|
| writers[] | provider, executionId, source, level, at. level is DECLARED; observedEvidence true marks an existing observation row with the same executionId and adds no authority in this cut |
| unknownProviderWriters | launches whose provider could not be read |
| excludedProviders | distinct declared writer providers |
| coverage | window (task created inside the 8-day retention), truncated (created earlier), unreadable (a source failed or held unparseable lines) |
| anomaliesInInterval | count of launches since the task was created with taskIdStatus invalid, not_found or unreadable. Persisted rows hold taskId null for those statuses (task-identity.js:30), so an anomaly cannot be attributed to one task; visibility only |
| unlinkedInInterval | count of UNLINKED launches since the task was created; visibility only |

Rules:
- Absence never proves absence. An empty writers[] means authorship unknown, never no author.
- UNLINKED rows are never attributed to a task, and no taskId is generated (S92).
- Known unrecorded cases stay limits, not findings: host inline writes, a trace append skipped by a busy lock, a silent record-launch failure, and an append still in flight when the reader runs. The second check at verdict and the provisional cap keep them safe.

### U3 contract: per-task admission

New core predicate in src/global/team/task-governance.js, called at two points.

Before launch: kairo team route --agent NAME --task-id ID --admission-contract 1. Only for a role with independentReview:

| Task identity | Route result | Hook action |
|---|---|---|
| linked, a candidate remains outside excludedProviders | ROUTED, response lists excludedProviders | Launch |
| linked, no candidate remains, or both providers wrote | WAIT_FOR_INDEPENDENT_REVIEW | Deny and show the reason (S14) |
| linked, route fails, times out or is invalid | none | Deny with ADMISSION_UNAVAILABLE (S23 rule 1) |
| absent | ROUTED per U5 | Launch as UNLINKED feedback, no credit |
| invalid, not_found, unreadable, conflicting | ROUTED per U5 | Launch as unlinked, anomaly recorded, no credit |

- Builder launches are never denied by admission.
- Removing a marker gains nothing, because the launch earns no credit (S92).
- The hook passes the task to every readRoute call, so the exhaustion handover cannot reach an excluded provider.
- explicitModelVerdict cannot keep a model whose provider is in excludedProviders.
- kairo team exec applies the same predicate when --role names an independentReview role and the task is linked.
- The predicate lives in core and hooks stay thin callers (S86). Native subagents of a Codex host remain unobserved, which is a recorded limit.

At verdict: kairo team verdict gains an optional --execution-id. Verdict rows gain an additive admission field holding the decision recomputed from current authorship. A verdict is never refused and result never changes. attributedOutcomes keeps its keys. A verdict without --execution-id behaves as today and earns no task credit.

### U4 contract: provisional states

Computed, never stored, by a read-only kairo team task-state --task-id ID --json. Nothing consumes the state for delivery.

| State | Condition |
|---|---|
| WAIT_FOR_TASK_IDENTITY | writers empty, unknownProviderWriters above zero, coverage not window, or a related anomaly per the section Slice B contracts (S98) |
| WAIT_FOR_INDEPENDENT_REVIEW | Writers known and no effective review, or the latest review failed its verdict or admission, or a writer launched after the review started |
| REVIEWED_PENDING_PROVENANCE | At least one declared writer; a review launched after the latest writer ended; independentReview role; provider outside excludedProviders; admitted at launch and at verdict; outcome completed; pass verdict bound by executionId |

- No code path in this cut returns ACCEPTED, and a test pins that.
- S23 closure stays an explicit human act outside this command.
- The 32 pending verdicts are neither migrated nor recorded, and verdicts recorded before this cut earn no credit because they have no executionId binding.
- Limit: record-outcome and verdict can be called by anything with shell access, so this state is not proof. That is why it caps at provisional.

### U5 contract: coordinated veto removal

Remove the split-provider and different-from-every-Builder checks at project-strategy.js:570-572 and 587-590, and at service.js:2390-2392 and 2416-2418. Remove the Builder reservation at project-router.js:325-336 and the builderProvider branch at 314. Make the Reviewer filter at project-router.js:337-349 task scoped.

Coexistence gate: the route changes apply only when both conditions in the section Slice B contracts (S98) hold. Otherwise route behaves byte-identically, so an old hook on the live core keeps today's protection. The gate grants nothing and cannot skip a control, so it is not the override S93 rejects. It is removed once no supported hook needs it.

UNLINKED Reviewers: the strategy's Builder providers stay a preference. They are excluded while a candidate remains, otherwise the pool stays open. No denial and no credit follow.

Not touched: model-intelligence.js and formation, entitlement and capability gates (S92), legacy strategy bytes.

### Decisions and treatment (S97)

OD-U-1, fail-open, modified. A launch without a valid selection is not an S23 exception, because S23 requires explicit human authorization. It is ungoverned execution:

| Case | Behavior |
|---|---|
| Ungoverned execution: no valid route, not a linked Reviewer | The host may continue, with diagnosis, and earns no routing or independence credit. When linked, it counts as a writer, which can only deny |
| Governed admission | Requires task identity and the U3 validations |
| Exhausted provider | Kairo never offers it as an automatic fallback. The hook denies when it can |
| Linked Reviewer with a known conflict | Cannot pass admission and cannot produce a credited verdict |
| Hook cannot prevent a launch | The trace records that limit as not prevented. No message may say the Router blocked a launch the host actually ran |

S22 and S23 stay in force for T6, after T5: this treatment waives neither. It recognizes that execution continues without governance until then.

OD-U-2, task registration, approved. kairo team task open is an operating interface over the canonical identity already shared with Architect. It adds no task states, no database and no automatic creation. A launch may start UNLINKED. Linking later needs sufficient evidence, and registering a task never grants retroactive authorship. Verdict correlation uses executionId, together with the task identity when one exists, because an agent name is not a sufficient correlation key.

OD-U-3, artifact binding, approved. Launch order is a provisional control: a writer appearing for a task after a review makes that review no longer current for later acceptance. Order does not prove which files changed and does not resolve concurrent or unlinked writes, so REVIEWED_PENDING_PROVENANCE remains the cap. It never replaces the S82 digest, and S82 is not brought forward for this cut.

OD-U-4, gentle-ai name exception (register.ts:668), modified, temporary and for compatibility only. A bypass-eligible name may avoid the rewrite. It does not avoid per-task admission, host tool restrictions or acceptance controls:
- The route is recorded as unauthenticated, with no credit, and as explicit provenance debt.
- Avoiding Router selection is itself a gain, since it can change the provider, resource consumption or available tools. The earlier statement that a forged agent gains nothing is withdrawn.
- A launch with such a name and a linked task counts as a writer, deny only. The name is not an authenticated Reviewer identity, so the U3 predicate does not treat it as a review (corrected by S100).
- The name never counts as a Reviewer for U3 or U4. This matches task-result.js, where a gentle receipt never proves a task was reviewed.
- Provenance from gentle-ai beyond the name was not found in this reading and is not assumed.

Runtime boundary: Kairo Runtime is the system and kairo is its command-line interface. New capabilities live in core modules usable by hosts, with the CLI as one interface over them. No second master orchestrator is added.

Backup: before implementation accumulates further on this branch, a private remote backup is recommended by the user. Push is not yet authorized.

### Slice B contracts (S98)

Approved by S99. Slice B is authorized in the worktree only; activation is not.

Anomaly scope. Persisted anomaly rows hold taskId null, so today only a link between executions can relate them to a task. A row affects a task only through one of these concrete relations:

| Relation | Condition | Effect on that task |
|---|---|---|
| R1 execution link | The row's executionId or parentExecutionId matches an execution linked to this task | WAIT_FOR_TASK_IDENTITY. A writing role also adds its provider to excludedProviders, since this can only deny |
| R2 claimed task | A new optional row field claimedTaskId equals this taskId | Same as R1 |
| O overlap | No R1 or R2, and a writing launch that is anomalous or UNLINKED overlaps the interval from the first writer start to the review start. A launch with no outcome counts as still open | Reported as overlappingUnattributed. No hold in this cut, because the REVIEWED_PENDING_PROVENANCE cap already prevents acceptance. S92 requires treating it as ambiguous before any later slice grants acceptance |
| None | Anything else | Counted in anomaliesInInterval only. Never holds a task |

- claimedTaskId is written only for status not_found or unreadable, where the value already passed assertTaskId. It is never written for status invalid, so no arbitrary marker text is persisted. Rows written before this field exist can relate through R1 only.
- withoutTaskIdentity in launch-ledger.js must also strip claimedTaskId, otherwise outcome keys change and existing verdict attribution breaks. A test pins the keys.
- Registering a task later can create a hold through R2, never credit, consistent with S97.

Trusted activation. Two independent conditions, both required:

| Condition | Source | Meaning |
|---|---|---|
| Capability | The hook sends --admission-contract 1 on route | This hook can honor admission. It authorizes nothing, and an old hook never sends it |
| Authorization | A per-project file admission-contract.json beside the launch ledger, under the harness home | A human chose to activate this project |

- File content: schema, contract 1, enabled, activatedAt, coreCommit, pluginVersion. Three states, never merged: absent gives inactive with earlier behavior; valid with enabled not true gives inactive; corrupt, unreadable, or an unknown schema or contract gives inactive with an explicit error and no acceptance credit through that route. Its location resolves from the trusted project root, never from a path in a prompt.
- Prompts and Agent inputs have no path to it: core reads the file itself and never accepts the value from a prompt, an Agent input or an environment variable.
- It lives outside the repository, so no worktree, merge or checkout can carry it. Merging code into the linked checkout activates nothing, and the file does not exist until a separately authorized activation creates it.
- Writing it: kairo team admission enable requires --yes, previews otherwise, and records coreCommit and pluginVersion. kairo team admission disable is the rollback. The commands are built in slice B and never run by it. The orchestrator guard that denies them from the main session lives in register.ts, so it moves to slice C, since S99 excludes hook changes from B.
- Rejected sources: an environment variable, because it varies per process and any launcher can set it; a repository file, because agents edit it and git carries it; the global policy.json, because it is not per project.
- Limit, accepted by S99: this is no isolation against processes under the same operating system account, and no containers, artificial permissions or control service are added for it. The trace records whether admission was active, inactive or invalid on each governed route. That record is not evidence sufficient to credit a provider or authorship.

### Slice C contract (S100)

Authorized in the worktree only. Expected state C_IMPLEMENTED_INACTIVE.

| Situation | Behavior |
|---|---|
| Contract inactive | Legacy behavior; the risk is recorded when possible |
| Contract active, confirmed exhausted provider | Launch to that provider denied |
| Contract active, eligible alternative | Redirected through the Router |
| Contract active, no eligible alternative | WAIT_FOR_AVAILABLE_PROVIDER; the exhausted provider is not launched automatically |
| Contract active, linked Reviewer with an S5 conflict | Admission denied |
| CLI fails and state cannot be established | not_prevented unless reliable evidence suffices to deny; never credit |

- Confirmed exhaustion means a current Router marker. Stale data, an absent response or a prompt statement never confirm it.
- A hook may deny on a failed route only with fresh hook-held state from a route response for the same Reviewer and task while the contract was active. Having once seen an active contract is not enough, and nothing from the model counts.
- The trace distinguishes a denial actually applied to the launch (prevented) from a Router decision the host did not enforce (not_prevented).
- C0 proves compatibility before C1: the prior core receiving --admission-contract 1, hooks 0.7.5 and 0.8.0 against the new core including errors and fallbacks, and the route budget against the 2-second hook limit. A timeout must not cause a false denial, a credited bypass or a duplicate launch.
- Parts: C0 compatibility evidence, C1 task on route and handover plus explicit model guard, C2 denials and ADMISSION_UNAVAILABLE, C3 gentle-ai trace, C4 enable guard and TTY. One commit per part.
- D removes the global vetoes. B and C must not be activated as incomplete substitutes for D.

### Slice D contract (S101)

Specified, code not authorized. Line anchors read at cd531a250 on feat/router-u2-u5. This corrects the U5 contract above, whose line list is older and incomplete.

Vetoes to retire, only when the contract is active:

| ID | Site | Today |
|---|---|---|
| V1 | project-strategy.js:570-572 | Approval refuses Builders on two providers |
| V2 | project-strategy.js:587-590 | Approval refuses a Reviewer on any Builder provider |
| V3 | service.js:2390-2392 | Approval readiness repeats V1 |
| V4 | service.js:2416-2418 | Approval readiness repeats V2 |
| V5 | project-router.js:333-344, with builderProvider at 312 and 321 | Pins Builders to one provider, blocks a split team |
| V6 | project-router.js:345-357, 366, 394, 419, 466-471, 587 | Team-wide Reviewer filter across pool, model, manual pick, rejection, frontier and wait paths |

Not touched: formation errors at project-strategy.js:606-616 and model-intelligence.js, so suggested teams do not change; entitlement, capability, band and price gates; legacy strategy bytes.

Coordination:
- resolveProjectRoute gains one input, admissionActive, default false. With false, every path stays byte-identical. V5 and V6 consult only it.
- All callers supply it from one reader: readTeamRoute by file and capability; team exec, the service paths at service.js:2667 and 2674, and read-only team routes by file alone, since they are core-owned. Otherwise Architect and hook routes would contradict each other under one contract.
- V1 to V4 read the file alone, because approval has no hook caller.
- V6 becomes: a linked Reviewer excludes excludedProviders, already present from slice B; an UNLINKED Reviewer prefers providers outside the strategy's Builder providers while a candidate remains, otherwise the pool stays open, with no denial and no credit.

Findings:
- Rollback: formation never seats a split team, so V5 removal stores nothing and disabling restores today's routes. Only a split team approved by hand under an active contract persists. After disable, V5 returns All Builders must use one provider, which is ungoverned continuity. team admission disable must name that case and advise a rebuild.
- Reviewer pool: the stored pool holds only the provider formation reserved. A Codex-written task needs a Claude Reviewer, which enters only if the shared scorer qualifies one (project-router.js:381-385). Unverified against live data; without one the task honestly stops at WAIT_FOR_INDEPENDENT_REVIEW. D must not relax any score to avoid this, per S95.
- WAIT_FOR_AVAILABLE_PROVIDER stops over-blocking Builders once V5 is gone, which is why B and C must not be activated without D.
- Documentation: test/team-compatibility.test.js:140 pins the sentence that Reviewers must use a different provider than every Builder. It stays true with the contract inactive, so the document gains the active case rather than losing it. Corrected inventory, observed at cd531a250 with git grep -lE "every Builder|different provider than|reviewer_independence|use one provider" cd531a250 -- "test/*.js": the literal sentence is pinned only in test/team-compatibility.test.js, and 11 test files match that pattern by code including it, so 10 others. The match is a line match of any of those four alternatives in a test/*.js file; it is not a count of files pinning the sentence. The 10 others pin formation or legacy behavior and must stay green unchanged.
- D also documents that disable can be invoked indirectly, and that the guard and enforcement prevented are operational declarations, not proof (S101).

Acceptance tests, without models:
| Invariant | Test |
|---|---|
| Independence | Active: a Builder-on-Claude team reviews a Codex-written task with Claude when one qualifies; same-provider Reviewer still denied per task; both providers give WAIT_FOR_INDEPENDENT_REVIEW; no qualified candidate gives WAIT_FOR_INDEPENDENT_REVIEW with no fallback |
| Continuity | Inactive, disabled and corrupt: route and approval byte-identical to cd531a250 across the role catalog, compared in a mktemp copy; two-provider team refused as today; UNLINKED launches run and earn nothing |
| Activation | Active: a Builder routes to either provider; split team approved and routed; exhausted provider denied or redirected; no eligible provider gives WAIT_FOR_AVAILABLE_PROVIDER; conflicted Reviewer never reaches the original fallback, explicit model or handover |
| Consistency | For errors, timeouts, corrupt configuration and forged trace payloads, computeTaskState never leaves its three states; ACCEPTED unreachable |
| Coordination | With one contract state, team route, team exec, service route and team routes agree on the same inputs; a legacy strategy file is byte-identical after a read |
| Rollback | Enable, approve split, disable: routes return to legacy, disable names the split team |

Planned parts, about 150, 80 and 100 lines, one commit each: D1 router with admissionActive and its callers; D2 approval sites; D3 rollback message and documents. One cross review of the final set. Activation, merge and install stay separately authorized.

### Implementation slices

Written in the worktree from F-A, one commit each, tests first through public interfaces, no model runs. Rough estimate, not a cap: 1000-1400 changed lines including tests.

| Slice | Content | Files | Live effect once merged |
|---|---|---|---|
| A | U2 reader only: read and correlate existing evidence. Not wired to any command, route, hook or verdict | src/global/team/task-authorship.js (new), test/task-authorship.test.js (new) | None: nothing calls it |
| B | kairo team task open (moved from A, because it writes), U3 predicate, U4 state, route and verdict flags, exec check, gate configuration source | src/global/team/task-governance.js (new), project-router.js, routing-input-cache.js, launch-ledger.js, team-exec.js, src/cli.js, test/task-governance.test.js (new), test/team-verdict.test.js, test/team-exec.test.js, docs/cli-reference.md | None while the gate is disabled |
| C | Hook: task to route, explicit model guard, F1, F2, denial handling, version bump. Risk items 2 and 4 | integrations/claude-code/kairo-router/hooks/register.ts, register.test.ts, parity.test.ts, README.md, plugin.json | None until a plugin install |
| D | U5 removal behind the flag. Risk items 2 and 3, own commit | project-strategy.js, project-router.js, service.js, test/team-compatibility.test.js and any approval or routing test that pins the veto. Formation tests must stay green unchanged | None without the flag |

Slices B, C and D are reviewed after A and are not yet authorized. No code moves from the worktree to the linked checkout merely because the gate is off: compatibility of the new core with hook 0.7.5 and with hook 0.8.0 must be shown first, including errors and fallbacks. Deployment then takes explicit activation, an integrity check and a rollback. The plugin install stays a separate authorization. Merge into the linked checkout precedes the install, because the reverse order would send an unknown input to the old core. An independent cross-vendor verifier applies to C and D (S14, S71).

### Acceptance criteria

Each runs without a model:
1. Authorship: a linked Codex launch present only in the trace excludes Codex; a linked task with no rows gives WAIT_FOR_TASK_IDENTITY, never admission credit; a task older than 8 days reports truncated; an UNLINKED write is never attributed.
2. Admission: a Codex-written task routes Reviewers only to Claude, and the reverse; both providers give WAIT_FOR_INDEPENDENT_REVIEW and a hook denial; the original Reviewer never starts on route failure when linked; an explicit claude model cannot override an exclusion; the exhaustion handover respects exclusions.
3. UNLINKED: a launch without a marker runs and earns no credit; removing the marker does not reach a provisional state; invalid and not_found markers record an anomaly.
4. States: every row of the U4 table has a test; a writer launched after the review returns the task to WAIT_FOR_INDEPENDENT_REVIEW; a pass verdict without --execution-id earns nothing; ACCEPTED is unreachable; the two identical-provider cases fail S5.
5. Defects: a gentle-ai name passes its input byte-identical, writes one trace row and earns no credit; WAIT_FOR_PROJECT_TEAM launches a non-Reviewer only with fallback and degraded marked; an exhausted original provider is denied.
6. Veto: with the flag, a team with Builders on two providers is approved and routed; without the flag, route output is byte-identical to the base commit across the role catalog; a legacy strategy file is byte-identical after a read; formation tests pass unchanged; a same-provider Reviewer stays refused per task; an entitlement block stays an access block.
7. Seam: a test spawns the real CLI from the worktree under a temporary HOME, using the exact argv the hook emits. Hook tests mock kairo, so they cannot prove this.
8. Differential: every existing route, verdict and record-launch form compared against a copy of the base commit in a mktemp scratch directory.

### Integration validation (plugin 0.8.0, then the cut)

None of this is authorized yet, and no plugin is installed by it.

- Level 1, no session and no model: claude plugin validate and claude plugin test on the repository plugin, npm test, and criterion 7.
- Level 2, 0.8.0 before any U2 to U5 code: one temporary claude --plugin-dir session under S66 and S68 rules, at most one justified real delegation. Evidence to collect: the hook row with task and execution identity in routing-trace.jsonl, ledger and trace agreeing on executionId, and what foreground and background results actually deliver. Stop on duplicate hooks, team reformation or unexpected routing divergence. Rollback is closing the session.
- Level 3, the cut before activation: the same temporary session with a PATH entry whose kairo points at the worktree, because the global kairo resolves to this checkout. One linked Builder and one linked Reviewer on real work, read back with kairo team task-state.
- Permanent install: a separate decision, with the rollback taken from the installation manifest in router-provider-authority-evidence.md.

Excluded from this cut, per S96: T5, advanced OBSERVED implementation, team-builder-codex migration, context optimization, the knowledge Gateway, and reopening R2b. Codex verified credit stays disabled.

### Core-hook decision protocol (S106, V2.2 per S108-S110)

Specified, code not authorized. Line anchors read on feat/router-u2-u5 at 62a9dd6f8 plus 13 uncommitted files. Facts apart from design below. V2 replaces the version at 7e1d69430. V2.1 (S109) corrects three defects found by the recheck of V2 at 8a2944523 and changes nothing else; B3 to B8 keep their approved contracts. Its goal is fewer execution paths: the core decides, and every launch point applies.

Why this exists. Recheck four found four P1 blockers with one cause: the core decides and each launch point reinterprets. Later ledger read errors lose exhaustion (routing-input-cache.js:271, :290). Handovers bypass routeAuthority (register.ts:1103-1137). A qualified UNLINKED route regains credited selection (project-router.js:255-260). A task-bound answer without an excludedProviders array fails open (register.ts:884-894). All full suites were green while these existed.

Review findings at 7e1d69430. An independent review returned NOT_READY with eight specification blockers.

- B1. The matrix lacks ordered predicates: mixed S5 and exhaustion sets match no row, D6 and D8 overlap, and D10b can bypass D9. Resolution: Ordered predicate matrix.
- B2. Transport rows X1, X2 and C1 conflict with S107 and omit task-marked non-Reviewers. Resolution: Protocol negotiation and no-directive rows.
- B3. Handover needs failure category, budget, prior target, and a meaning for keep after a finished attempt. Resolution: Handover.
- B4. Cached restrictions need expiry, stamp and binding on the wire. Resolution: Cached restrictions.
- B5. The reinterpretation list misses the pacing downgrade, the unmappable Claude model fallback, the gentle-owned bypass, agent enforcement and service candidate checks. Resolution: Reinterpretation sites, with rule A and rows P6 and P7.
- B6. Inactive legacy output cannot be told from malformed output, so protocol version negotiation is required. Resolution: Protocol negotiation and no-directive rows.
- B7. Authorship reads every ledger row by adapterId, so operational rows can create false exclusions and mixed traces can satisfy credit. Resolution: Persistence split.
- B8. Non-Reviewer outcomes and staged activation are undefined. Resolution: Outcomes per role and Coordinated activation.

V2.1 changes (S109). The recheck of V2 at 8a2944523 found NOT_READY with no new structural contradiction and three defects. Each changed row, term or table, and the defect it fixes:

- P8 and the term Exhaustion-unknown (hole 1). A linked Reviewer with an unreadable ledger, a verified cached restriction on codex and qualified {claude-x, codex-y} matched no row before P12, which redirected to claude-x with provisional credit. Exhaustion-unknown is now defined per required provider, so the unreadable source decides whatever is cached on other providers. P8 is unchanged in order and still precedes P12.
- P13a (new) and P13. P13 is now stated as source unreadable only. P13a, placed before it, denies when the original provider has a known restriction, so no redirect and no keep on a known-restricted provider. This writes down the existing rule that a known restriction on the original provider itself denies.
- P4 and the terms gentle-owned actor, review semantics and admission-bound (hole 2). A review-* actor with a linked task marker and a known S5 conflict got P4 keep and launched without U3 admission. P4 now excludes admission-bound actors, which go through P5 to P12. P3 stays first.
- P2 (advisory). It now lists every no-directive state, including transport_error and negotiation_incomplete.
- Channel states, Cached last valid directive, Effective activation, stage 1 states S1 to S7 and stage 2 rows X1 to X7 (B2). X rows were not exclusive with the role table, X5 had undefined predicates, and X2 denied on the file alone. They are now one ordered two-stage table. Stage 1 gives exactly one local state; stage 2 gives exactly one action.
- X2 now needs an activation record (S3); a configured file alone is S5 and keeps legacy. X3 stays deny for corrupt (S107 C3), now defined by S2. X4 (S6) and X5 (S4) have exact predicates.
- Role table and Compatibility. The role table lists the exact rows each set of hook facts selects. The Compatibility sentence now matches X3 to X6.
- Directive schema, Coordinated activation and the test matrix. The directive carries the stamps projectKey, sessionId, protocolVersion, issuedAt and expiresAt. Activation writes the record. The matrix adds the concrete recheck inputs and state exclusivity.
- Terms (advisory). task_unreadable is named as a third identity class, and P5 is listed in the role table for Reviewers.

V2.2 changes (S110, with an orchestrator reconciliation of S20 pending Sam's confirmation). Documentation only; B3 to B8 and the order of the rows are unchanged. Rows and terms touched:

- Term admission-bound. It is now exactly the S110 table: a review-* name with a linked task, or a declared review operation (role independentReview or marker kind review) with a linked task, and task_unreadable under the same name or declared operation. The name alone is enough, so omitting the role declaration cannot skip U3 (point 4).
- P4. It covers only gentle-owned actors that are not admission-bound, still after P3 and subject to every restriction that applies.
- P5 to P12, and the terms Reviewer and linked Reviewer (A1). They are keyed on admission-bound, not on the declared role, so every admission-bound launch reaches U3 whatever role it declares.
- P12, plus rows P10 and P11 for gentle-owned actors, and the new row P12g (orchestrator reconciliation of S20 with S108 to S110, pending Sam's confirmation). See Gentle-owned actors under U3.
- Stage 2 term TR and the role table rows for Reviewers, Builders and gentle-owned actors use the same admission-bound facts.
- Test matrix. Five cases added.

Reinterpretation sites, all to be removed as decision points:

| Site | Decision the hook makes today |
|---|---|
| register.ts:36-45 routeAuthority | Validates continuity, independence and exclusion fields |
| register.ts:72-85 explicitModelVerdict, :912-920 | Decides whether an explicit Claude model qualifies |
| register.ts:870-898 admissionRefusal | Infers linked denial and exhaustion from field shapes |
| register.ts:926-945 | Rejects a selected provider listed as excluded or exhausted |
| register.ts:1103-1116 nextCandidate | Orders alternates and chooses a replacement |
| team-exec.js:111-134, :180-215 nextExecRoute and capacity switch | Own acceptance rules over readTeamRoute, with no hook authority check |
| service.js:2628-2687 routeProjectExecution | Own admission and exhaustion handling |
| register.ts:9, :102-103, :941 (read at the u2-u5 worktree) | Pacing downgrade: opus becomes sonnet under CONSERVE or CRITICAL, applied by the hook outside the core |
| register.ts:63-68 claudeModelAlias | Maps a model id to an alias by substring; an id with no alias has no defined result, so the launch may continue on an unmapped model |
| register.ts:8, :736-740, :935 | Gentle-owned actor names (review-*, jd-*) bypass routing, rewrite and accounting before any restriction is read |
| check-agent and agent enforcement | Compatibility rules before routing; file and anchor to verify in T0 |
| service.js candidate checks beyond routeProjectExecution | Service-side candidate validation; anchors to verify in T0 |

Design.

1. One decision function in the core. decideLaunch(facts, evidence) is the only authority. readTeamRoute, team exec and the service route all call it. No caller interprets a route's fields to decide.
2. One evidence snapshot per decision. Identity, authorship, exhaustion markers, qualification inputs and contract state are read once, before deciding, each with a typed state: ok, absent or unreadable. Optional telemetry can only add information. It cannot remove a restriction, and no later read in the same decision can change it. This closes blocker 1 of recheck four by construction.
3. Facts in, directive out. The launch point declares facts and never conclusions: role, agent, original provider, explicit model if any, task marker, attempt kind (initial, handover, fallback, retry), and, on a handover, the Handover facts below. The attempt kind changes the inputs, never the rules, so handovers and retries follow the same table. This closes blocker 2 of recheck four by construction.
4. A closed directive. The core answers one versioned object, kairo.launch-directive/v1, with: action, one of redirect, keep or deny; target provider, model and agent, only on redirect; reasonCode from a closed list; identity state; qualification state; restriction evidence; credit, separately for selection and independence, each none or provisional; and traceClass; plus the stamps projectKey, sessionId, protocolVersion, issuedAt and expiresAt, all set by the core and used by the hook only in rows X4 and X5. Any answer failing the schema, or carrying a combination the matrix does not list, is an invalid directive. The core owns the only list of valid combinations.
5. One hook applicator. applyDirective(directive, launchInput) is the single path that changes a launch, for every attempt kind: redirect rewrites, keep returns the input unchanged, deny denies. It holds no provider, score, exclusion or exhaustion logic. Ledger and trace writes follow from the directive alone.
6. Credit stays apart. Credit is computed only by computeTaskState from core-owned evidence, never from a hook-declared field. A hook row is a declaration (S101, S106 rule 5), so the REVIEWED_PENDING_PROVENANCE cap holds and ACCEPTED stays unreachable. The G2 vocabulary applies: admissionActive is effective configuration; ADMITTED is a favorable predicate decision with an identifiable origin; enforcement is separate evidence of whether and how control applied.
7. Rule A, compatibility rewrites (S108). Gentle AI and check-agent keep their compatibility rules before routing, but such a rule cannot grant credit, skip a confirmed exhaustion, or invalidate the admission of a linked Reviewer. Rows P3 and P4 apply this rule to gentle-owned actors, and P4 never covers an admission-bound actor (Terms, S110); any other compatibility rewrite is covered by the same sentence and is checked in T0.

Ordered predicate matrix (B1). Active contract unless the row says otherwise. The same matrix applies to every attempt kind. First match wins, so each row implicitly carries the negation of every earlier row; the rows are mutually exclusive by order, and every input reaches exactly one row. Derived sets, all computed from the single evidence snapshot:

| Set | Definition | Empty result |
|---|---|---|
| qualified | Candidates the shared scorer qualifies for this role. A scorer failure gives qualified empty for non-linked launches and row P9 for linked Reviewers | No candidate |
| S5-excluded | Qualified candidates excluded by S5 for the linked task. Always empty for non-linked launches | Excludes nothing |
| confirmed-exhausted | Providers with a confirmed, current restriction, from the snapshot markers or from a verified cached restriction (Cached restrictions) | No restriction |
| eligible | qualified minus S5-excluded minus confirmed-exhausted | No candidate |

Terms: linked Reviewer means an admission-bound launch with identity linked, whatever role it declares (S110, A1); "Reviewer" in P5 to P12 names the admission policy, not the declared role. Non-linked means every other launch: an UNLINKED launch (identity absent, not_found or invalid), including a review-* actor with such an identity, Builders and other roles. An admission-bound launch with identity task_unreadable is neither: only P5 applies to it. A task marker on a launch that is not admission-bound is recorded and never evaluated for admission or credit. Unrepresentable means condition C: an explicit model or alias the core cannot map to a scored candidate.

Exhaustion-unknown (V2.1), per required provider. A provider's availability is established only by a readable exhaustion source that shows no restriction on it. A restriction removes the provider it names and never shows another provider to be available. The required providers of a linked Reviewer are the providers of the members of qualified minus S5-excluded minus confirmed-exhausted, that is, every candidate the decision could still select. Exhaustion-unknown holds for a linked Reviewer when the exhaustion source is unreadable and that required set is not empty, whatever restrictions are cached on other providers. When the required set is empty, S5 exclusions and known restrictions already decide, through P10 or P11. When the scorer failed, the set is undefined and P9 applies. For a non-linked launch, exhaustion-unknown holds whenever the exhaustion source is unreadable. No row grants admission or provisional credit while any exhaustion read needed for the decision is unreadable: under an unreadable source P12 and P14 are unreachable, and the rows that can still launch (P4, P7, P13) grant no credit.

Gentle-owned actor means an agent named review-* or jd-*. The name is not an authenticated identity and never grants Reviewer credit. Review operation is a fact the launch point declares: role independentReview, or a task marker whose declared kind is review. Admission-bound (S110) means a launch with a task marker, whose identity state in the core snapshot is linked or task_unreadable, and that has either a review-* name or a declared review operation. Equivalently, exactly the S110 table: (a) gentle actor named review-* with a linked task, (b) declared review operation with a linked task, and in both cases an unreadable task identity. An admission-bound launch passes through U3 admission (P5 to P12) before any compatibility exception, whatever role it declares and whether or not it declares a review operation. The review-* name is a conservative signal only: it can add controls (U3, P3, X6), and it never credits a Reviewer, proves S5 independence, grants authority, or alone allows a credited verdict. A review-* actor with identity UNLINKED is not admission-bound and keeps continuity under the existing UNLINKED policy (P3, then P4), with no credit. A gentle-owned actor with no review-* name and no declared review operation is not admission-bound and keeps P4, subject to P3 and X6 and every other restriction that applies.

Task identity unreadable (S110). An unreadable task identity is never read as UNLINKED. Order check: the task_unreadable row P5 (the D9 equivalent) precedes every UNLINKED continuity row, namely P4, P7, P13a, P13, P14, P15 and P16, and every exhaustion-unknown row. P4 carries the negation of admission-bound, so an unreadable identity with a review-* name or declared review operation never reaches P4. P3 alone precedes P5, and it also denies. A task marker whose identity is unreadable on a launch with neither a review-* name nor a declared review operation is not admission-bound, is recorded only and follows its non-admission row.

Gentle-owned actors under U3 (orchestrator reconciliation of S20 with S108 to S110, pending Sam's confirmation). S20 (model-diversification, 2026-10-23) says Kairo must not route gentle-ai actors whose launch contract gentle owns (review-*, review-refuter, jd-judge-a, jd-judge-b, jd-fix-agent), and S108 condition A keeps their compatibility rules but subjects them to authority restrictions. Reconciliation, no new logic: for an admission-bound gentle-owned actor, U3 (P5 to P12) acts only as an admission gate and never as a provider rewrite. If its original provider and model are in the eligible set, the result is keep with the original launch unchanged (row P12g). If they are not, a deny row applies in order: P10 WAIT_FOR_INDEPENDENT_REVIEW when the original is S5-excluded or qualified minus S5-excluded is empty, P11 WAIT_FOR_AVAILABLE_PROVIDER when the original is confirmed-exhausted or otherwise not eligible, P8 and P9 as already ordered. A gentle-owned actor is never redirected. The review-* name never grants credit by itself (S110), and P12g grants none. A launch that is not gentle-owned follows P12 unchanged.

| # | Predicate | Action | reasonCode | Ledger | Trace | Credit |
|---|---|---|---|---|---|---|
| P1 | contract_inactive | keep, legacy, envelope only | CONTRACT_INACTIVE | legacy | legacy | none |
| P2 | no valid directive and no contract_inactive envelope: contract_corrupt, protocol_unsupported, negotiation_incomplete, malformed directive or transport_error (Channel states) | no directive; X1 to X7 decide | ENVELOPE_NO_DIRECTIVE | per X row | per X row | none |
| P3 | gentle-owned actor, original provider confirmed-exhausted | deny | WAIT_FOR_AVAILABLE_PROVIDER | none | denied | none |
| P4 | gentle-owned actor, not admission-bound (S110) | keep, unchanged | GENTLE_NAME_CLAIM | none | legacy | none |
| P5 | admission-bound launch with identity task_unreadable | deny | ADMISSION_UNAVAILABLE | none | denied | none |
| P6 | linked Reviewer, unrepresentable | deny | MODEL_UNREPRESENTABLE | none | denied | none |
| P7 | non-linked, unrepresentable, original provider not confirmed-exhausted | keep, unchanged, no silent substitution | MODEL_UNREPRESENTABLE | continuity | continuity | none |
| P8 | linked Reviewer, exhaustion-unknown (source unreadable, required set not empty) | deny | ADMISSION_UNAVAILABLE | none | denied | none |
| P9 | linked Reviewer, scorer failed | deny | ELIGIBILITY_FAILURE | none | denied | none |
| P10 | linked Reviewer, qualified minus S5-excluded is empty; for a gentle-owned actor also when its original provider or model is S5-excluded | deny | WAIT_FOR_INDEPENDENT_REVIEW | none | denied | none |
| P11 | linked Reviewer, eligible is empty (P3 precedes P11, so a gentle-owned actor whose original provider is confirmed-exhausted is already denied by P3); for a gentle-owned actor, P11 covers the remaining cases where its original provider or model is not in eligible | deny | WAIT_FOR_AVAILABLE_PROVIDER | none | denied | none |
| P12g | linked Reviewer that is a gentle-owned actor, original provider and model in eligible | keep, unchanged, never redirect (S20 reconciliation) | ROUTED_LINKED | linked, with the original as selected and attempted provider | governed-provisional | none |

P12g credit (S111): credit none is definitive, even when the gentle-owned actor declares a review operation. Review executed, U3 admission, S5 independence and acceptance authority are distinct; P12g establishes admission restrictions only. The governed-provisional state and reasonCode ROUTED_LINKED are kept as they are for now, and T0 must verify (S111 section 3) that no consumer reads either as authorization, independence or positive credit when credit is none. Any consumer granting credit from that state alone is an implementation blocker, not a minor warning.
| P12 | linked Reviewer, not a gentle-owned actor | redirect to the top eligible candidate, which may equal the original | ROUTED_LINKED | linked, with selected and attempted provider; observed provider only with evidence | governed-provisional | provisional, capped |
| P13a | non-linked, exhaustion source unreadable, original provider confirmed-exhausted | deny, never redirect | WAIT_FOR_AVAILABLE_PROVIDER | none | denied | none |
| P13 | non-linked, exhaustion source unreadable | keep, unchanged, no redirect | EXHAUSTION_UNKNOWN | continuity | continuity | none |
| P14 | non-linked, eligible is not empty | redirect to the top eligible candidate | ROUTED_OPERATIONAL | operational, with selected and attempted provider; observed provider only with evidence | operational | none |
| P15 | non-linked, original provider not confirmed-exhausted | keep, unchanged | CONTINUITY_KEEP | continuity | continuity | none |
| P16 | non-linked | deny | WAIT_FOR_AVAILABLE_PROVIDER | none | denied | none |

Order constraints, each satisfied above: contract state rows first (P1, P2, inactive and corrupt as distinct states); P5 task_unreadable before every exhaustion-unknown row (P8, P13a, P13), so it cannot be bypassed; P4 excludes admission-bound actors, so they reach P5 to P12 and the name never skips U3; P5 precedes every UNLINKED continuity row (S110); P12g precedes P12 and applies only to gentle-owned actors, which are never redirected; P6 and P7 for condition C before any linked or non-linked routing row; linked rows P8 to P12 before non-linked rows P13a to P16; P8 before P9 to P12, and P8, P13a and P13 before every redirect row (P12, P14), so an unreadable exhaustion source never reaches a redirect. Mixed case: when qualified minus S5-excluded is empty, P10 gives WAIT_FOR_INDEPENDENT_REVIEW; otherwise, when eligible is empty because of exhaustion, P11 gives WAIT_FOR_AVAILABLE_PROVIDER. Condition C holds as P6 and P7: for a linked Reviewer, deny when eligibility cannot be evaluated; for UNLINKED, keep the original launch only if no known hard restriction contradicts it, and otherwise fall to P14 or P16. A manual pick or explicit model is a fact, not a bypass: under P12 and P14 it must pass as any candidate.

Unreadable exhaustion (S107, carried over). Markers live in one launch ledger file, so a failed read reveals nothing about any single provider and cannot name an affected provider. A known restriction has two sources, both conservative: the snapshot of the same decision, and a verified cached restriction. A restriction can only be added by these sources, never lifted. This does not stop all Builders on a temporary EIO: P13 accepts one launch attempt on a possibly exhausted provider, recorded as attempted with reason EXHAUSTION_UNKNOWN and never described as admitted; P13a denies when the original provider itself has a known restriction. This replaces the unreleased behavior in the uncommitted diff, which denies every launch when the ledger is unreadable. P8 keeps the S107 D10b rule for linked Reviewers, per required provider: a known restriction on one provider never shows that another is available, so with an unreadable source a linked Reviewer is denied ADMISSION_UNAVAILABLE even when a verified cached restriction exists on another provider, with no redirect and no provisional credit.

Protocol negotiation and no-directive rows (B2, B6, V2.1). The launch point sends the protocol versions it supports with every request. The core answers a valid kairo.launch-directive/v1 directive, or an envelope stating contract_inactive, or an envelope stating contract_corrupt or protocol_unsupported. contract_inactive comes only from an explicit core envelope. It is never inferred from a transport error, a timeout, a crash, a non-zero exit, malformed output, or an older core rejecting the flag as Unknown option. Only P1 yields legacy by itself.

Channel states. Each reply is classified once, first match wins, so the states are exclusive and exhaustive:

| # | Channel state | Definition | Route |
|---|---|---|---|
| H1 | transport_error | No reply obtained: timeout, crash, non-zero exit or no output | P2 |
| H2 | malformed | A reply that cannot be parsed, fails the schema, or carries a directive combination the matrix does not list | P2 |
| H3 | protocol_unsupported | An older core rejecting the flag (Unknown option), or an envelope stating protocol_unsupported | P2 |
| H4 | negotiation_incomplete | A well-formed envelope that names no negotiated version, or a version the launch point did not offer | P2 |
| H5 | envelope_corrupt | An envelope stating contract_corrupt | P2 |
| H6 | envelope_inactive | An envelope stating contract_inactive | P1 |
| H7 | valid_directive | A schema-valid kairo.launch-directive/v1 directive | P3 to P16 |

A malformed or schema-invalid directive (H2) is treated exactly as no valid directive. It is never permission.

Cached last valid directive (S107 C4). Valid means a schema-valid kairo.launch-directive/v1 returned by the core, whose projectKey equals the key the hook derives from the canonical project location, whose sessionId equals the launch's session, and which records its protocolVersion. Current means now is before the expiresAt the core stamped in it; the hook never sets or extends that value. Anything else is not valid and current. The hook keeps it only in its existing per-session state, and where it has none the cache is absent. It can justify a conservative denial and never admission.

Effective activation. The canonical contract file alone is configuration. Its existence, or enabled true, does not show that the hook, team exec and the service route all support the protocol. Effective activation is the file plus an activation record in the same canonical contract: schema-valid, with a protocolVersion that includes kairo.launch-directive/v1 and a consumer set that includes the hook. The core writes it only after the coordinated activation gate passes (below) and clears it when the gate stops passing. The hook only reads it, writes nothing and adds no routing logic. A forged record can only over-restrict (same limit as Security conditions). Until the record exists the contract is configured but not effective and every path stays legacy. Open point: whether the existing contract schema can carry this record without a new file or service is unproven, and T0 must check it. If it cannot, the hook cannot tell S3 from S5 below and would have to treat every enabled file as not effective, so no denial would come from the file alone and only S4 and S6 would remain. That is a product decision, not decided here.

Stage 1, local effective state. It runs when row P2 applies: no valid directive and no contract_inactive envelope. The hook reads the canonical file itself in this decision, never a cached copy, so "current" for the file means read in this decision. File states: absent (ENOENT only); corrupt (present but any other read error, or failing the schema); disabled (schema-valid, enabled false); enabled-effective (schema-valid, enabled true, valid activation record); enabled-not-effective (schema-valid, enabled true, activation record missing or invalid). First match wins:

| # | State | Predicate |
|---|---|---|
| S1 | DISABLED | File disabled and the channel is not H5 |
| S2 | CORRUPT | Channel is H5, or file corrupt |
| S3 | ACTIVE_FILE | File enabled-effective |
| S4 | CONFLICT | File enabled-not-effective, and the cached directive is valid and current |
| S5 | CONFIGURED_ONLY | File enabled-not-effective, and the cached directive is absent or not current |
| S6 | ACTIVE_CACHED | File absent, and the cached directive is valid and current |
| S7 | NO_EVIDENCE | File absent, and the cached directive is absent or not current |

Corrupt is never disabled: S2 precedes S3 and a disabled file with an H5 envelope is S2, because only a consistent, valid disablement may drop a restriction. Channel states other than H5 do not change the state, since they carry no information about the contract.

Stage 2, transport rows. They use only facts the hook has and make no provider or score decision. TR (task-marked Reviewer) means a task marker is present and the launch has either a review-* name or a declared review operation (Terms), the same admission-bound facts the hook has, minus the identity state it cannot know. K means the original provider has a known confirmed restriction: a verified cached restriction (Cached restrictions) before its stored expiresAt. The hook cannot know identity state without a directive, so a TR is treated the same whether the core would link it, find it UNLINKED or find it unreadable. First match wins:

| # | Predicate | Action | Trace |
|---|---|---|---|
| X1 | S1, any role, any marker, any K | keep, legacy, no credit | absent, not_prevented |
| X2 | TR and S3 | deny ADMISSION_UNAVAILABLE | denied; never claims the core evaluated the task |
| X3 | TR and S2 | deny ADMISSION_STATE_UNKNOWN | denied; same wording |
| X4 | TR and S6 | deny ADMISSION_STATE_UNKNOWN | denied; same wording |
| X5 | TR and S4 | deny ADMISSION_STATE_UNKNOWN | denied; same wording |
| X6 | K | deny WAIT_FOR_AVAILABLE_PROVIDER, never redirect | denied |
| X7 | everything else, including every launch in S5 or S7, every non-TR, and every TR in S1 | keep, unchanged, no credit | invalid or absent, not_prevented, no selected fields |

Precedence. Stage 1 runs before stage 2. X1 is the only row that may drop a known confirmed restriction, because a valid, current, explicit disablement makes the contract inactive and S100 limits exhaustion denial to an active contract. X2 to X5 precede X6, so a TR with K gets an admission denial; both deny and neither redirects. X6 precedes X7. Every input reaches exactly one stage 1 state and then exactly one stage 2 row. No transport row other than X1 may drop a known confirmed restriction.

Precedence against S107. X1 to X5 and X7 reproduce S107 C1 to C6 in order with the same results, with X6 added for the S107 sentence that unmarked launches keep continuity except hard restrictions known locally. Changes forced by S109: X2 now needs the activation record, because S109 says the file alone does not show every consumer ready and S108 requires compatibility until they are; a configured-only file falls to X7. A corrupt file stays a denial for a TR (S107 C3, S109 "archivo corrupto no equivale a contrato desactivado"). X5 no longer reads "other contradictory evidence": it is exactly S4 for a TR. The old X1 (older core, keep unchanged) no longer overrides S107 for a TR, because an older core is H3 and goes through stage 1. The old X2 and X3 covered only no marker and independentReview, so Builders and other roles reach X6 and X7 explicitly.

Security conditions, all required. Origin: the hook reads the contract only from the canonical project location, never from a path in the prompt. TTL: a cached state expires, in both directions. Isolation: cached state is bound at least to project and session. No positive authority: cached state can only justify a conservative denial, never admission or independence. Valid disablement: a current, intact, explicit disablement outranks an earlier active state. No added infrastructure: no second database or state service. Boundary: this check does not authenticate a process sharing the user's permissions. Scope: this logic exists only when no valid directive exists and is not a second Router; with a valid directive it never runs.

Feasibility, not verified: the canonical path comes from admissionContractPath, which derives a project key in the core. The hook can compute it only if it reproduces HARNESS_HOME resolution, root canonicalization, the worktree commondir, and the SHA-256 key. A cwd approximation is unsafe, because a different worktree or symlinked root yields a different key, so it would read another project's state. The hook may also lack the imports its sandbox allows, or a file API for that location. T0 must prove the exact derivation, or prove it impossible. If it cannot, a user decision is needed before T2.

Rule 6 of S106 governs the trace: prevented is written only for a denial the host applied; a launch that ran is never described as prevented.

Handover (B3). Attempt identity and failure are recorded for every attempt: executionId, attempt number, failure category, and the provider and model that failed. Outcomes:

| Scenario | Behavior |
|---|---|
| Reviewer, contract inactive | Legacy handover, unchanged |
| Reviewer, contract active, linked or UNLINKED | No automatic handover. A failure ends the attempt, recording the fields above, with no replacement launch |
| Reviewer relaunched manually | A new evaluation through decideLaunch with a new executionId |
| Builder and other roles | Keep the role's existing handover policy, but every replacement goes through decideLaunch with attempt kind handover and the facts: prior provider and model, failure category, attempt number, and the role's existing handover budget |
| Confirmed exhausted provider | Never selected automatically, for any role |

On a handover attempt, keep means no replacement launch. It never re-runs a finished attempt. This does not remove the ability to change provider: a Reviewer first selected by Kairo may be run again later with another provider by an explicit relaunch. What is removed is the automatic chain of replacements after a failure. The budget is the role's existing one; V2 adds no new budget or limit.

Cached restrictions (B4, condition B). A cached restriction travels on the wire as a hook-declared fact with this schema:

| Field | Content |
|---|---|
| origin | Directive id and protocol version that produced it |
| projectKey | Canonical project key |
| sessionId | Session it was observed in |
| provider | Restricted provider |
| kind | Restriction kind, for example confirmed exhaustion |
| confirmedAt | When the core confirmed it |
| expiresAt | Taken from the core marker's own expiry, never set by the hook |
| state | confirmed or expired |

A cached restriction can only restrict. The core accepts it only when its expiry verifies against core data, meaning origin and expiresAt match a core marker or directive. A hook value without a core-verifiable expiry is ignored as authority for continued restriction beyond the same decision, and it never grants anything. While the core is unreachable the hook honors a record only until its stored expiresAt, copied from the last valid directive, and never extends it; a forged record can only over-restrict.

Persistence split (B7). The kind vocabulary (routing-trace.js:50-55) needs operational and continuity, which today coerce to absent. Rows split into two classes. Operational launch rows (operational, continuity, legacy) record the provider requested or operationally selected, the launch attempted, and the provider effectively observed when evidence exists; the directive's provider is never recorded as the provider that ran. Evidence rows (linked, governed-provisional) are the only rows valid for authorship, admission and independence. The authorship reader and computeTaskState read only evidence rows, so an operational row can never create an authorship exclusion. Operational rows must not map to governed (routing-trace.js:57-65) and feed no credit (task-governance.js:115-122). Credit requires one consistent trace for the attempt: a row mixing operational and evidence fields cannot satisfy credit. Distribution and account samples read the ledger (launch-ledger.js:355-375), and today continuity writes no row. No row grants S5 credit by itself.

Outcomes per role (B8, V2.2). Contract inactive means P1 for every row below. With a valid directive the rows follow the core's identity state. With no valid directive the hook knows only its facts, and each fact set selects exactly the X rows listed, first match wins. Rows 1 to 3 apply to non-gentle-owned launches only (S111); gentle-owned launches use the last two rows. No row outcome changes.

| Role and hook facts | Valid directive | No valid directive | Credit | Handover |
|---|---|---|---|---|
| Non-gentle-owned admission-bound launch (review-* name or declared review operation, with task marker) | linked or task_unreadable: P5, P6, P8 to P12; UNLINKED: P7, P13a, P13 to P16 | X1 to X7 (TR) | provisional, capped, only on P12 and S5 | none |
| Non-gentle-owned Reviewer role without task marker | P7, P13a, P13 to P16 | X1, X6, X7 | none | none |
| Non-gentle-owned Builder and other roles, any marker not admission-bound | P7, P13a, P13 to P16 | X1, X6, X7 | none | role policy via decideLaunch |
| gentle-owned actor, review-* name or declared review operation, and task marker (admission-bound when identity is linked or task_unreadable) | admission-bound: P3, then P5, P6, P8 to P11, P12g (gate only, never redirect); otherwise P3, P4 | X1 to X7 (TR) | none, including P12g (the name never credits) | not applicable |
| gentle-owned actor, not admission-bound (no review-* name and no declared review operation, or no task marker, or UNLINKED) | P3, P4 | X1, X6, X7 | none | not applicable |

Coordinated activation (B8). The contract becomes effective only when the contract file is enabled and every relevant consumer (hook, team exec, service route) reports support for kairo.launch-directive/v1. Until then the core answers contract_inactive with a detail naming the pending consumers, and every path stays legacy. No intermediate state grants authority: a partial activation is the inactive state. The gate passing is what makes the core write the activation record (Effective activation); the file alone never does. A consumer that falsely claims support enables enforcement, which only restricts; a consumer that falsely claims none leaves the legacy behavior, the same limit as the existing capability flag (routing-input-cache.js:171-180).

Compatibility. With the contract inactive (P1), disabled (X1), configured but not effective (S5), or without evidence (S7) every path stays byte-identical to legacy, shown by the route and approval differentials against cd531a250, except that confirmed restrictions follow X6 in every no-directive state other than disabled. A corrupt contract (S2) is not disabled: it is legacy only for launches that are not a TR and have no K, and a TR is denied by X3. X2 to X6 are the only no-directive departures from legacy. A hook without the capability flag activates nothing (routing-input-cache.js:171-180). Older hook behavior against this core is not verified beyond that, and the matrix covers it.

Test matrix.

- One data table, the rows P1 to P16 with P13a, the channel states H1 to H7, the states S1 to S7 and the rows X1 to X7, crossed with attempt kinds initial, handover, fallback and retry, and with consumers hook, team exec and service. Core and launch points read this same table, so no answer is copied by hand.
- Each case runs the real core from this tree's bin/kairo.js in an isolated HOME and HARNESS_HOME, and asserts at the real launch point: the input reaching the host launch, spawn, or deps.startRun. It also asserts the ledger, the trace and computeTaskState. No model is launched and no active session is touched.
- Forged and malformed answers come from mutating real directives, for X rows and invalid combinations; protocol_unsupported, contract_corrupt and transport_error are separate cases, and inactive is never produced by any of them.
- Evidence faults are injected per read: every reader failing at every position, which is the class that found blocker 1 of recheck four. Also a failed read combined with a known restriction, and with none, per role.
- X1 to X7 run in order against a real canonical file, including an enabled false file over a cached active state, a cached state from another project or session, an expired cached state, and a task-marked Builder.
- Mixed sets: S5-excluded and confirmed-exhausted together, checking P10 before P11.
- The recheck inputs of V2.1: a linked Reviewer with an unreadable ledger, a verified cached restriction on codex and qualified {claude-x, codex-y} gives P8 and no credit; a gentle-owned review-* actor with a task marker and a known S5 conflict gives P5 to P12 and never P4; a gentle-owned actor with a task marker and no directive gives X1 to X7 by its facts; an older core with an enabled file that has no activation record, a task-marked Reviewer and consumers not ready gives S5 and X7.
- The S110 cases (V2.2), each run through the real core with a healthy ledger unless stated:
  - review-* name, linked task marker, no declared review operation: reaches P5 to P12 and never P4. As a gentle-owned actor it gets P12g when its original is eligible and P10 or P11 when it is not; it is never redirected and never credited.
  - review-* name with identity UNLINKED: P3, then P4, keep with no credit.
  - review-* name with task identity unreadable: P5 denies ADMISSION_UNAVAILABLE, never P4 and never an UNLINKED row.
  - gentle-owned actor with no review-* name and no declared review operation, with or without a task marker: P4, subject to P3 and X6.
  - non-gentle launch with role Builder (not independentReview) and marker kind review, identity linked: admission-bound, reaches P5 to P12 and gets P12 (redirect) when eligible, or P10 and P11 otherwise.
  - S20 reconciliation: review-* actor, linked, original provider S5-excluded gives P10; original eligible gives P12g keep with the launch unchanged; original confirmed-exhausted gives P3.
- Exclusivity: every combination of channel state, file state, cached state, TR and K reaches exactly one S state and one X row; every no-directive reply, including a malformed directive and a truncated negotiation, never produces permission or a credit.
- Persistence: an operational row never creates an authorship exclusion, and a mixed trace never earns credit.
- Invariants across the whole matrix: no row grants admission or credit while an exhaustion read needed for the decision is unreadable; nothing runs on a denied row; a confirmed exhausted provider never runs, except under X1; no linked launch without a qualified admissible candidate; no credit on any row except P12, and never above REVIEWED_PENDING_PROVENANCE; no row claims prevented unless a denial was applied; one action per input.

Harness feasibility, observed. The plugin test sandbox allows only relative imports and claude-code, and register.test.ts mocks process.run, so a plugin test cannot spawn the core. Probed: register.ts does not load under plain node --experimental-strip-types, because pane.ts imports claude-code at runtime and imports use no file extension. A Node test therefore needs a module resolver and a minimal stub of claude-code (atom, read, update) and of the injected host object. This is unproven and is the first task. If it fails, the fallback is a Node test that generates the core answers into a file the plugin tests read, with a test that fails on any difference; this keeps real core answers but tests the host stub less, and would need a user decision.

Recheck closure criteria (S108, S109). The V2.1 recheck is limited to the three S109 defects, the concrete inputs that reproduced them, and the intersections of their rows. It closes only when all hold:

- "Las ocho deficiencias identificadas deben estar resueltas o explícitamente fuera del alcance con una razón comprobable."
- "Cada decisión debe producir una única acción para las mismas entradas."
- "No pueden existir estados intermedios que otorguen autoridad."
- "La activación debe preservar compatibilidad hasta que todos los consumidores relevantes estén preparados."

A new structural contradiction leads to reducing the scope of the protocol, not to a third rewrite; a further minor specification defect is assessed for impact with no automatic correction round (S109). The recheck uses one independent eligible Reviewer within current limits, with no frontier model forced (S108).

Implementation order. Design status: PROTOCOL_DESIGN_CLOSED, subject to the structural readback of the S111 fixes. Per S111, T0 is authorized once that readback passes, with a strictly experimental scope (verbatim from S111 section 4): "1. Construir un arnés aislado que invoque el core real, sin modelos. 2. Confirmar que puede capturar la salida y los errores sin modificar el checkout activo. 3. Probar inicialmente los escenarios D2 y D6 previstos. 4. Verificar cómo se resuelven la raíz canónica, `HARNESS_HOME`, el `commondir` del worktree y la identidad del proyecto. 5. Comprobar si el esquema permite representar la versión del protocolo, los sellos y el estado de activación sin atribuir crédito accidental." Fixture rule (S111): decideLaunch and kairo.launch-directive/v1 are not implemented, so T0 demonstrates harness feasibility and must not claim the core already produces directives of this protocol; any simulated directive is identified explicitly as a fixture and is not accepted as proof of real enforcement. T0 also carries the P12g check above (no consumer reads governed-provisional or ROUTED_LINKED as authorization, independence or positive credit when credit is none; a consumer granting credit from that state alone is an implementation blocker). Expected report: T0_PASS or T0_BLOCKED with evidence. T1 to T4 are not authorized, and the 13 uncommitted files in the worktree stay untouched. The earlier T0 outline (rows P1, P10, the canonical contract read and the activation record, for S1 to S7 and X1 to X7, with the path derivation above, no product change) stays a candidate scope only where it fits S111 section 4. When T1 to T4 are authorized: T1 decideLaunch and the evidence snapshot in the core, wired to the service and team exec. T2 directive output and applyDirective in the hook, removing the sites above. T3 trace vocabulary, ledger rows and the persistence split, which touches routing-trace.js, task-governance.js and the authorship reader. T4 the full matrix and the coordinated activation check. Each is its own commit and recheck against this matrix, not a sweep. The 13 uncommitted files stay intact until the user decides how they feed T1 and T2.

T0 result and T1 inputs (S112). T0_PASS_HARNESS_ONLY: the isolated harness runs the real core, D2 and D6 pass, canonical identity passes from the core and is partial from the hook (T2), and the directive and persistence schema are partial (T1/T3). Activation source is the core: kairo team admission status --json when needed; the directive carries activation in the normal flow, with no second status query per launch when a valid complete answer exists; transport failures follow OD-C1 and give no positive authority from cache. Task identity and ledger evidence resolve through one canonical project derived from the real commondir, with isolation tests across different repositories and correlation tests across worktrees of one repository, and no automatic migration or merging of existing records. T0 tests are separated from npm test and get an explicit command. T1 must not modify register.ts. T2-T4 are not authorized. Path note: register.ts lives at integrations/claude-code/kairo-router/hooks/register.ts (there is no src/ directory); S105 keeps the earlier src/register.ts string only because it quotes Sam verbatim.

#### Known-reviewer snapshot (S114), approved per S115, reviewed inactive per S116

Status. T2 remains T2_IMPLEMENTED_INACTIVE and is not accepted. The focused recheck of 8d1a95378 returned PASS (Sonnet, L92). The full-suite failure (4902/4903, test/claude-hooks.test.js, test 'team prompt-context CLI ... fails open without it', which passed alone) stays recorded as an unattributed intermittent failure until a final satisfactory validation. Nothing below is implemented, and S114 does not authorize implementing it.

Why the existing source cannot be reused. The approved team strategy persists at ~/.harness/sessions/<projectKey>/project-strategy.json (src/global/team/project-strategy-store.js:21-23) and the routing input cache at the same sessions/<projectKey>/ directory (src/global/team/routing-input-cache.js:36-37). projectKey is projectKeyForPath, a SHA-256 of the lowercased realpath of the commondir parent (T0). The hook cannot compute it (no realpath or crypto in its sandbox, T0 finding), and S112 2A forbids the hook from computing project location or interpreting configuration files. Since 8d1a95378 the hook receives projectKey from the core (team admission status --launch-protocol) once per session, so on a first launch with the core unreachable it has no key and cannot locate the existing strategy. .kairo/roles.json is a role catalog, not the approved team: it has no version, no approval link and no expiry, and it may be absent in linked worktrees. Conclusion: the persisted strategy cannot be read reliably by the hook during a core outage on a first launch, so a minimal core-generated snapshot is needed and, per S114, must be specified before any implementation.

Minimal contract. File kairo.reviewer-snapshot/v1, written only by the core, atomically (temp file in the same directory, then rename). Fields, and nothing else (no providers, models, scores or credit):
- schema: "kairo.reviewer-snapshot/v1".
- projectKey: the core's canonical key.
- roots: the exact absolute paths the core observed for this canonical project (main checkout toplevel and each known linked worktree toplevel, as the core resolved them). The hook matches its launch cwd by exact string or by exact path prefix at a directory boundary (/a/repo matches /a/repo and /a/repo/x, never /a/repo2). The hook never computes realpath or hashes.
- approvalRef: the approved strategy's approvedAt, and its id if present.
- reviewers: agent names whose approved role is a Reviewer or independentReview role.
- admissionEffective: whether the admission contract was effective (activation record) at write time.
- issuedAt and expiresAt.

Location (proposal). One fixed file the hook can open without computing a key: <HARNESS_HOME or HOME>/.harness/reviewer-snapshots.json, holding one entry per projectKey (alternative: the plugin data directory). Requirement: the hook resolves HARNESS_HOME and HOME exactly the way it already does for its other reads (env get). If that resolution is uncertain inside the hook sandbox, it is a T0-style feasibility item to prove before implementation.

Lifecycle.
- Written on team approval, on admission enable or disable, and on activation record changes.
- Refreshed by every successful core route answer for the project. Rewrite only when content changes. expiresAt is never extended merely because the snapshot was read, consistent with S113.
- Default validity proposal: 24 hours (a value for Sam to confirm).
- On explicit disablement the entry is removed or marked admissionEffective false.
- Never written for a project that never enabled admission.

Hook use (restrict-only). Consulted only when there is no valid directive and the core is unreachable (the X rows). The hook denies ADMISSION_STATE_UNKNOWN only when all hold: the launch cwd matches exactly one entry's roots, the entry is not expired, admissionEffective is true, the task marker is present, and the agent name is in reviewers. Other cases:
- review-* with a task marker keeps the existing deny.
- Builder and other roles keep continuity without credit.
- Any doubt (no match, multiple matches, expired, unreadable, malformed, admissionEffective false) gives X7, and the hook records it as incomplete coverage with a distinct trace reason, never as a successful denial.
- Explicit valid disablement keeps legacy behavior (S107 C1 wins).
- The snapshot never grants selection, independence or acceptance, and the agent name never credits a provider.

Threat note. A forged or stale snapshot can only over-restrict a Reviewer launch in a project whose roots it names, or fail to restrict (X7). It cannot admit or credit. The same-user process boundary is unchanged.

Test plan required by S114. Each case asserts whether a host launch actually happened: first launch (no session key), core down, wrong project (cwd of another repository, and a path-prefix sibling such as /a/repo versus /a/repo2), stale (expired) snapshot, contract disabled, plus Builder continuity and unknown-role X7.

Approved values (S115). Validity: 24 hours maximum; the TTL starts when the core generates valid evidence, never when the hook reads the file; an approval change or explicit disablement updates or invalidates the entry; the hook never renews it; an expired entry is no authority to deny and never a positive authorization. Location: <HARNESS_HOME || HOME>/.harness/reviewer-snapshots.json with one entry per projectKey and no additional database; concurrent writes must be serialized or conflicts detected without losing other projects' entries (atomic rename alone does not prevent lost updates); the hook uses the core's HARNESS_HOME precedence and never guesses a project from a partial directory match. Unknown worktree: a worktree the core does not yet know gives X7 continuity without credit, REVIEWER_SNAPSHOT_COVERAGE_INCOMPLETE is recorded, and no claim is made that U3 protected the launch; this is a temporary accepted coverage degradation, not an accredited bypass, and registering new worktree roots is required before raising operational authority.

Renewal policy (S116, approved). A live identical entry is not rewritten. A missing entry is created, and an expired entry is regenerated, only from new core evidence. A change of approval, team or activation updates the entry with new evidence. A hook read never renews. A failed update never extends the previous validity. The TTL stays at 24 hours maximum. Enabling or disabling admission updates or invalidates the snapshot within that same successful operation, never through a later query. The residual lock race and the git call without a timeout are recorded robustness debt and do not block T3, because the snapshot grants no permission and no credit.

Debt status. Routing cache TTL and schema validation in team exec fall under evidence freshness in design point 2, so T1 absorbs them. G2 is resolved by the credit and trace rules once T3 lands, and stays open until then. The why text comparison stays as test debt. The statusline.test.js flake stays registered and unexplained.


## Tasks

- T1 | S8, S11, S24, S26, S27-S30, S31-S53, A2 | none | delegated Explorer plus Test Repro Runner | complete the override inventory and measure which floor rejects each Builder candidate. Acceptance: every inventory row re-verified at its path and new rows added; a table gives each of the 8 Builder candidates its rejecting gate, floor, required value, actual value and verdict (miscalibrated or genuinely below); proposed task limits with evidence; no code changed; override and frontier exception paths are checked for governance bypass, with findings; the escalation budget is checked against repeated attempts; the user validates the T1 result before any code change; output includes an eligibility matrix by task type and observable subscription consumption, with unknown kept as unknown; the pilot runs only after automatic refresh is isolated and the user approves. Superseded: local model evaluation is no longer part of the T1 acceptance (S50). | done, validated by the user (S59) | none
- T2 | S5, S16, S19, S59-S62, S64-S66 | T1 | delegated, Codex writer, because the orchestrator never writes | trace record in observe mode. Acceptance: ROUTED, refused and override paths each write one complete record; routing decisions match baseline in a test; unknown usage is recorded as unknown; legacy ledger rows still parse. | accepted with limitations | bd34aa0ba, b434ffdab, f5cd6733d
- T3 | S1, S14 | T2 | writer | task identity and writer provider from ledger; Reviewer route excludes it. Acceptance: tests show a codex-written task gets only claude reviewers and the reverse; both providers wrote gives WAIT_FOR_INDEPENDENT_REVIEW; missing identity gives WAIT_FOR_TASK_IDENTITY; existing team-wide checks still active. | pending | none
- T3-R2b | S83, S84 | T3-R2a | delegated, because the parent never writes | opt-in `team exec --verify-provider` (codex only): env allowlist, pinned preflight, rollout link, evidence in routing-trace.jsonl. STOPPED, not accepted; provenance only, validated with fakes in the Kairo integration, not end to end. R2b never blocks and grants no authority; Codex credit stays disabled (providerVerified false). Commits: ee93bad29, e3b4e30af and the closure commit, subject fix(router): fail closed on unverified Codex provider evidence; its hash is in Engram topic router/r2b-stopped because a commit cannot contain its own hash.
- T4 | S1 | T3 | writer | remove team-wide independence from formation, approval, routing; item 3 and stored format risk. Acceptance: a team with Builders on two providers is approved and routed; kairo team rebuild no longer fails with reviewer_independence for that split; a same-provider reviewer is still refused per task; a legacy strategy file is byte-identical after being read. | pending | none
- T5 | S2, S10-S13, S15, S55, OD2, S22-S25 | T1, T4 | writer | Builder pool fix, selection order, frontier exception, task budget, blocked decision in core. Acceptance: all S10 order tests pass; floors changed only where T1 shows miscalibration; renamed-model fixture passes; limit overflow stops and escalates; formation still never seats frontier on labor; failure classes and same-provider retry follow D12; each frontier authorization consumes one budget unit. | pending | none
- T6 | S2, S22, S23 | T5 | writer | launcher denies on BLOCKED, no unchanged launch; own commit, high risk. Acceptance: a test proves the original agent is not started on BLOCKED and the reason is shown; a scoped override launches and is recorded; CLI failure, timeout and invalid response block; the override meets every S23 rule, including no run when authorization cannot be verified or recorded. | pending | none
- T7 | S3, S15 | T6 | writer | launches use Router model; keepsAgent, explicit model, downgrade and nextWriter become Router decisions or scoped overrides. Acceptance: a pinned agent definition runs the Router-chosen model and the trace matches what executed; downgrade is decided in core; nextWriter alone changes no route. | pending | none
- T8 | S4, S31-S33, S36, S55 | T5 | writer | distribution ranking per D6. Acceptance: fixtures show quota, cost, history and in-flight saturation each changing the ranking; an exhausted provider receives no work; identical inputs give identical choices, with no percentages or rotation; ranking uses subscription quota and windows, published API prices do not decide, and review capacity is reserved. | pending | none
- T9 | S6, S19 | T6, T7, T8 | independent verifier | end to end proof of S6, all regression tests, quota comparison. Acceptance: verdict per S#; Claude and Codex Builders run simultaneously with cross review; comparison report produced, and savings stated only if shown; an override implementation still gets independent review. Uses deterministic tests and simulated providers, plus at most one real integration check when the user authorizes it. | pending | none
- T10 | S3, S9, S17 | T7 | Documenter | CLI reference, help, docs, S21 cross-reference. Acceptance: every new decision code and override appears in help and docs/cli-reference.md; team-formation-integrity S21 points to S17; structural readback confirms no private host content. | pending | none
- T11 | S54, S56-S58, P16-P20 | P0 Router tasks | writer | Model Discovery per P20. Not authorized; scheduled after the P0 Router work (P0 per S63). Acceptance: sync changes no team, route or policy state; a new model stays not eligible until apply; a known unavailable model receives no new assignment; no provider outside the team is probed; no model runs.

Risk note: T4, T6 and T7 touch item 3 (contracts others consume); T4 also item 1 (persisted format); T6 item 5 (delivery path of every delegation). These need an independent verifier. T5 touches item 3 and item 2 style guard behavior through quality floors; verify independently. Forecast exceeds 400 authored lines; apply ask-on-risk before the second slice.
- T-U2U5 | S1, S5, S14, S23, S85, S91-S93, S96 | U1 | inline reading, delegated write | coordinated U2 to U5 cut per the section U2 to U5 implementable specification. Where they differ, its acceptance criteria replace the T3 line (S92 already superseded missing identity and the still-active team-wide checks) and the T4 rebuild sentence (finding F-C). | specified, implementation not authorized; OD-U-1 to OD-U-4 open | none
- T-U2U5-A | S85, S92, S96, S97 | U1 | delegated, because the orchestrator never writes | slice A, authorship reader in worktree agentic-harness-worktrees/u2-u5. Acceptance: criterion 1 of the section; reads only; no command, route, hook, verdict or credit changes. | done in worktree, not merged, native review declined by the user | 2376769ff on feat/router-u2-u5
- T-U2U5-B | S5, S14, S23, S85, S92, S96-S99 | T-U2U5-A | delegated, because the orchestrator never writes | slice B in worktree agentic-harness-worktrees/u2-u5. Global vetoes stay, the contract stays inactive, hooks unchanged. Expected state B_IMPLEMENTED_INACTIVE. | B_IMPLEMENTED_INACTIVE, cross review passed, not merged, not accepted | 6c36dd202, 3aa28b9f9 on feat/router-u2-u5
- T-U2U5-C | S5, S14, S23, S85, S92, S96-S100 | T-U2U5-B | delegated, because the orchestrator never writes | slice C in worktree agentic-harness-worktrees/u2-u5. Contract inactive, plugin not installed, not merged. Expected state C_IMPLEMENTED_INACTIVE. | C_IMPLEMENTED_INACTIVE, cross review run, not merged, not accepted | 1c523ee39, 8d2cbd811, 091093ddd, a293ef319, 42b775d4e, 0cc87f029, cd531a250 on feat/router-u2-u5
- T-U2U5-D | S1, S5, S14, S92, S95-S104 | T-U2U5-C | delegated, because the orchestrator never writes | slice D per the section Slice D contract (S101). Contract inactive by default. | BLOCKED, not accepted, contract inactive, not merged | 6174cf8ed, 21019189b, 1d518ff78, 62a9dd6f8 on feat/router-u2-u5, plus a second correction left uncommitted in the worktree on top of 62a9dd6f8 because local commit was authorized only after validation; the third correction, still uncommitted on top of 62a9dd6f8, now holds 10 files (595 added, 58 deleted); status stays BLOCKED per S104
- T-CORE-HOOK | S104-S119 | T-U2U5-D | delegated, because the orchestrator never writes | Core-hook decision protocol V2.2 per the section of that name, tasks T0 to T4. | PROTOCOL_DESIGN_CLOSED pending structural readback per S111; T0 authorized; T1-T4 not authorized | none
- T-CORE-HOOK-T0 | S106-S112 | T-CORE-HOOK | delegated, because the orchestrator never writes | isolated experimental harness per S111 section 4; result T0_PASS or T0_BLOCKED | T0_PASS_HARNESS_ONLY per S112; 19/19 harness tests, rerun by orchestrator 19/19; hook canonical identity partial (T2); directive and persistence schema partial (T1/T3) | 748c243f0 on feat/core-hook-t0
- T-CORE-HOOK-T1 | S106-S112 | T-CORE-HOOK-T0 | delegated, because the orchestrator never writes | decideLaunch and kairo.launch-directive/v1 in the core per S112 section 3, task identity via commondir per S112 2B, harness test separation per S112 2C, in worktree agentic-harness-worktrees/core-hook-t1 on feat/core-hook-t1 | T1_PASS: independent verification (Codex gpt-6.1-sol) FAIL with four blockers at 55be28f6f (shallow directive validator; P12g by provider only; service substituted model; unverified cached restriction); one correction batch da4056085; focused recheck (Sonnet) PASS on all four plus canonical task listing and exact exec deny assertion; npm test 4822 pass; test/core-hook 138/138; test:core-hook 19/19; legacy differential 270/270 identical vs 62a9dd6f8 | 748c243f0..da4056085 on feat/core-hook-t1 (9 commits)
- T-CORE-HOOK-T2 | S106-S114 | T-CORE-HOOK-T1 | delegated, because the orchestrator never writes | hook applyDirective, X1-X7 and protocol negotiation per S113 section 2, harness scratch cleanup, directive bound to project, session and attempt, in worktree agentic-harness-worktrees/core-hook-t2 on feat/core-hook-t2 from da4056085; expected T2_IMPLEMENTED_INACTIVE | T2_REVIEWED_INACTIVE_WITH_KNOWN_GAP per S115 (first launch of a known Reviewer with core unreachable not yet protected); T2_IMPLEMENTED_INACTIVE: protocol off by default (register(on, { launchProtocol: true })); cross-review (Codex gpt-6.1-sol) FAIL at b057038fa with five blockers (declared Reviewer escaped OD-C1 on transport failure; first foreign directive set the project binding; schema-valid target edit applied; freshness used pre-request clock; --launch-protocol silently accepted on admission disable); one correction batch 8d1a95378; focused recheck (Sonnet) PASS on all five plus intersections; npm test 4902/4903 (one load flake in test/claude-hooks.test.js that passes alone); test/core-hook 217/217; test:core-hook 19/19; plugin tests 488/488 | da4056085..8d1a95378 on feat/core-hook-t2 (7 commits)
- T-CORE-HOOK-SNAPSHOT | S114-S115 | T-CORE-HOOK-T2 | delegated, because the orchestrator never writes | kairo.reviewer-snapshot/v1 core writer with serialized writes and hook reader, protocol inactive, in worktree agentic-harness-worktrees/core-hook-snapshot on feat/core-hook-snapshot from 8d1a95378; focused independent review | SNAPSHOT_REVIEWED_INACTIVE per S116: launchProtocol off by default; known Reviewer with current effective snapshot denied ADMISSION_STATE_UNKNOWN with core down (0 launches); other project, sibling prefix, expired, corrupt, ambiguous, unknown worktree give X7 with REVIEWER_SNAPSHOT_COVERAGE_INCOMPLETE; independent review (Sonnet) PASS, no blockers; 12 concurrent writers x 30 rounds lost no entry; legacy byte-identical and no snapshot written for projects without admission; npm test 4938/4940 (known readonly sandbox flake, 10/10 alone); test/core-hook 254/254; test:core-hook 19/19; plugin 494/494 | 77f72eb1f, 05c51addb, fdadabeb6 on feat/core-hook-snapshot
- T-CORE-HOOK-T3 | S106-S117 | T-CORE-HOOK-SNAPSHOT | delegated, because the orchestrator never writes | trace and ledger persistence per S116 units T3.0-T3.5 and invariants A-E, in worktree agentic-harness-worktrees/core-hook-t3 on feat/core-hook-t3 from fdadabeb6; focused independent review | T3_REVIEWED_INACTIVE per S117: F1 (related operational rows keep R1/R2 exclusions, never authorship) and F2 (hook checks record-launch exit code and timeout, counts loss into priorFailures, toast, launch proceeds, no credit) fixed in f9b881d1c; focused review PASS on Sam's five points; test/core-hook 289/289; plugin 494/494; npm test exit 1 only from the 6 readonly sandbox failures (two files 10/10 alone, known concurrency risk, not investigated per S117); T3_IMPLEMENTED_INACTIVE: independent review (Sonnet) PASS, no blockers; 16 forged record-trace/record-launch variants never exceed REVIEWED_PENDING_PROVENANCE (baseline forged P14 and P12g credit now withheld as review_trace_mixed); forged prevented tagged enforcementEvidence declared; unlinked operational/continuity rows add no exclusion; old rows byte-identical in task-state and show; injected lock/EISDIR/EACCES failures exit 1 with kairo.persistence-failure/v1 and never grant credit or clear exclusions; legacy 20-command differential identical except new persisted fields routingClass and enforcementEvidence; npm test 4965/4970 (readonly sandbox load flakes, 10/10 alone); test/core-hook 284/284; test:core-hook 19/19; plugin 494/494 | fdadabeb6..f9b881d1c on feat/core-hook-t3 (7 commits)
- T-CORE-HOOK-T4 | S92-S118 | T-CORE-HOOK-T3 | delegated, because the orchestrator never writes | integration per S118 T4.0-T4.3: D reconciliation (13 files as material, keep/superseded/conflict), consolidation into decideLaunch, end-to-end tests at the effective launch point, hook budget, full suites, cross-provider review; in worktree agentic-harness-worktrees/core-hook-t4 on feat/core-hook-t4 from f9b881d1c; expected T4_INTEGRATED_INACTIVE_REVIEWED | T4_INTEGRATED_INACTIVE, PENDING_INDEPENDENT_REVIEW per S119 (Codex gpt-6.1-sol after the 2026-11-10 quota reset, no Astra, no automatic fixes); D reconciliation kept 0 code hunks and 1 docs sentence, all D scenarios reused as end-to-end tests; new kairo team admission activate writes the activation record only when every consumer reports kairo.launch-directive/v1; test/core-hook 331/331; plugin 494/494; npm test 5016/5017 (readonly sandbox flake, 10/10 alone); legacy differential 45/45 across 3 contract states; hook budget route 124-271 ms at real sizes, median 415 ms and up to 1357 ms under parallel load at 10k/50k rows (limit 2000 ms); findings T4-F1 service waits while route and exec proceed for a Builder (candidate codex/luna vs directive codex/sol), T4-F2 team exec and service startRun never negotiate in production, T4-F3 V1-V6 lifted on an enabled file without activation record | f9b881d1c..HEAD on feat/core-hook-t4 (11 commits)
- T-ASTRA-QUOTA | S108 | none | not started | separate defect: gpt-6-astra routed with Codex at 24 percent while policy reserves it for quota of at least 50 percent; cause unknown; no Astra reviews until explained; out of S106 scope | none

## Log

- L1 (2026-11-04), user verbatim: "problema 1, por que todo lo hace claude? tenemos cuota complta de codex pero todo lo ahce los modelso de claude por que? eso se supoqnue ya uq lo teniamos configurado"
- L2 (2026-11-04), user verbatim: "esta es la idea de lo que deberiamos tener, ya tenemos base de todo pero n oesta funcionando como se espera, no podemos tener modelos fijos como tal"
- L3 (2026-11-04), user verbatim: "Procede con la spec y el desglose de tareas de la Etapa 1. No implementes todavía. Primero validaremos que el diseño resuelva realmente la diversificación entre proveedores, la gobernanza y el ahorro de cuotas."
- L4: Spec drafted. Next step: user validates design and answers OD1 and OD2. Stage 2 (operational cells) is out of scope here.
- L5 (2026-11-04), user verbatim: "Actualiza la spec con esta decisión, conserva los seis veredictos anteriores y sigue sin modificar código."
- L6: OD1 recorded. Parent checked approved S21: its acceptance says frontier does not implement, so S17 is recorded as an explicit amendment limited to launch-time exceptions. Next step: user validates A1, A2 and OD2. Stage 2 (operational cells) is out of scope here.

- L7 (2026-11-04), user verbatim: "Mantén A1 como presupuesto compartido provisional y A2 pendiente de T1. Conserva los seis veredictos anteriores y no sobrescribas otras memorias de Engram."
- L8 (2026-11-04), user verbatim: "No apruebo todavía la implementación. Primero quiero cerrar T1: inventario completo, diagnóstico de elegibilidad de Builders, propuesta de límites por tarea y comprobación de que los overrides y excepciones frontier no pueden eludir la gobernanza."
- L9: OD2 recorded; T1 started read-only.
- L10 (2026-11-04): T1 first pass recorded as partial. Open: Builder role-fit values, routing cache refresh decision, proposals P1-P6. Code remains not authorized.
- L11 (2026-11-04): User decided T1_CONTROLLED_EVALUATION_ONLY; the current kairo team route --refresh is not run. Parent note: the route output for gpt-6.1-terra shows codingIndex null and agenticIndex null; whether null signals explain unqualified is being tested without running models. The per-candidate evaluation budget is not defined yet and needs user approval before any model runs.
- L12 (2026-11-04): Offline measurement recorded. Budget proposal awaits user approval. T1 remains open; no model ran. Scratch retained at /private/tmp/router-builder-eligibility.6jTYcT.
- L13 (2026-11-04): Subscription quota policy recorded. Pilot not approved. Cells remain Stage 2; S34's cell measurement applies once cells exist. Open: how to isolate automatic refresh without code, and P1-P12.
- L14 (2026-11-04), user verbatim: "Con 48 KB, recomiendo dividir ahora la documentación antes de seguir añadiendo resultados." Evidence moved to odd/tasks/router-provider-authority-evidence.md. Preflight authorized; no pilot run authorized. This session cannot run the preflight because it is itself a Claude Code session with hooks; the user runs it from an independent terminal.
- L15 (2026-11-04): PREFLIGHT_PASS_WITH_C7_FINDING recorded with evidence. T1 open. First model run not authorized; T2-T10 not authorized.
- L16 (2026-11-04): DRY_RUN_PASS and validator hardening recorded in evidence. Awaiting user authorization for one Luna run after the 5h window resets. Five further runs and T2-T10 not authorized.
- L17 (2026-11-04): One Luna run authorized, to be run by the user from an independent terminal after the reset. Parent note: the report's four acceptance criteria exclude the fixture verdict and it prints no overall class, so the parent derives it: FAIL if any criterion fails or the fixture verdict is not pass; UNVERIFIED if no FAIL and identity is unverified; PASS otherwise.
- L18 (2026-11-04): Pilot and Luna run suspended by the user (S50). The Luna run was not executed. Preflight, dry run and hostile evidence remain valid as security evidence. Scripts in /Users/kal-el/kairo-t1 are kept unused. Next: user decides Builder eligibility from external evidence, then validates T1.
- L19 (2026-11-04): Full catalog inventory and offline matrix recorded in evidence. Router sees 8 of 24 discovered models. No model ran. Builder choice remains postponed.
- L20 (2026-11-04): P6 decided and Model Discovery recorded as design (S54-S58, P20, T11). Parent checked the proposal against code; findings in evidence. No code changed. T1 awaits user validation.
- L21 (2026-11-04): T1 validated by the user and T2 authorized in observation mode (S59-S63). S42-S58 moved to Specs without text changes. T3-T10 remain not authorized.
- L22 (2026-11-04): T2 implemented by Codex gpt-6.1-terra in two commits. npm test 4421/0 before a one-line revert in explicitModelVerdict; plugin test 345/0 after it. Claude cross review found one S60 blocker, traceLaunch throwing on malformed route shapes and dropping the routed rewrite; fixed, and recheck PASS with explicitModelVerdict identical to baseline. Native four-lens review approved and acknowledged, with warnings whose text was not retained, only their locations. The cross review ran through a self-written no-redirect marker because the Reviewer route is also Codex; this is the bypass S23 describes and T3 replaces. Open advisories: effectiveLaunch.confirmed on the hook side comes from the launch instruction, not from observed execution; team exec awaits the trace before spawn, up to about 2 seconds under lock contention; taskId stays null until T3, so hook and exec records cannot be correlated. Not accepted until the user accepts.
- L23 (2026-11-04): S64 conditions addressed. Supersedes the L22 advisories: the hook now reports evidence requested or unknown, never confirmed; team exec writes the trace after the child closes, with a 200 ms bounded lock. Review warnings of the earlier runs were lost when acknowledgement burned the artifacts; a new native review of 00a7f7247 regenerated 14, classified in evidence. One was a real blocker, an unbounded stale-lock spin, fixed in c59f25a35. npm test 4428/0, plugin test 345/0, plugin validate passed on c59f25a35. The no-redirect cross review stays a temporary limitation, never a policy. Plugin not installed; no push.

- L24 (2026-11-04): Final native review of f99585a35 approved with no blockers; 11 findings classified in evidence, 5 relevant and 6 informational, all open. S64 conditions 1-5 met. Plugin not installed; no push. Awaiting the user's installation decision.
- L25 (2026-11-04): The five relevant findings fixed in 256ae4855; hook mapping was already correct and is now proven by test. npm test 4431/0, plugin test 345/0, plugin validate passed. Installation manifest and session-only rollback recorded in evidence. Plugin not installed; no push; awaiting the user's decision.
- L26 (2026-11-04): One-session validation authorized (S66); baseline and checklist in evidence. The session is started by the user from an independent terminal. Independent review of 256ae4855 launched. T2 stays not accepted until validation and that review finish.
- L27 (2026-11-04): Partial validation results recorded in evidence: items 1-3 pass or hold, 4-7 open. settings.json hash changed through the user's /model command in the parent session; the other four monitored files equal the baseline. No stop condition. T2 stays not accepted.
- L28 (2026-11-04), user verbatim: "Sí, acepto registrar T2 como PARTIAL — MODEL_IDENTITY_MISMATCH. No acepto cerrarla como completada ni trasladar este defecto a T3 sin corregirlo primero." "La solución no puede ser simplemente cambiar fallbackDetected a true cuando aparezca una diferencia. Necesitamos distinguir un cambio de proveedor, un cambio de versión dentro de la misma familia y una ejecución cuya identidad no se haya podido comprobar." "Identidad solicitada: Registrar ID completo y alias enviado. Identidad observada: Registrar versión efectiva sólo cuando exista evidencia. Divergencia: Distinguir proveedor, familia y versión. Ledger: No atribuir ejecución comprobada a un modelo solamente solicitado. Verdict: No acreditar resultados a una versión incorrecta. Pruebas: Cubrir explícitamente el caso Haiku 4.5 → Haiku 5.5." "Si el runtime no puede identificar el modelo durante el lanzamiento, debe dejarlo unverified hasta disponer de evidencia posterior." "Autorizo corregir este defecto dentro de T2, agregar pruebas deterministas y realizar revisión cruzada. No autorizo merge, actualización permanente del plugin ni comenzar T3 todavía." Status recorded: T2 PARTIAL — MODEL_IDENTITY_MISMATCH. Validation item 6 failed (evidence in the evidence document). Explorer verdict not registered, by the user's decision. Route for the correction: delegated, Claude builder (team-builder), because the orchestrator never writes; correction stays inside T2; cross review follows; T3 not started.
- L29 (2026-11-04): Native review lineage review-8ec9aa8e13589498 opened correction for R3-001 and R4-unobservable-provider-credit-loss. Rule changed to credit moves only on proof: unverified and matched credit the recorded model, mismatch credits the observed model, mismatch without an observation credits nothing. Residual: an unobserved Claude alias launch still credits the requested version until observation exists, awaiting the user's decision.
- L30 (2026-11-04): Native review lineage review-8ec9aa8e13589498 approved and acknowledged at target bca965b4. Its warnings fixed: R3-003/R1-001/R4-first-agentid-match (only the last agentId line of the result, with nothing but the host trailer after it, selects a transcript), R3-002 (on mismatch observedModelId is the most frequent id that differs from the requested one), R3-005/R4-unbounded-observed-argv (deduplicated ids in frequency order, capped at 8, in argv and payload), R3-004 (record-launch rejects --observed-model, no row written), R3-007/R4-handover-trace-linkage (one traceId per launch, observation carries the id of its launch), R3-006 (service-level credit test in test/service-identity-credit.test.js), R4-silent-observation-failure (hook writes an unverified observation payload with identityReason unreadable or no-model; routing-trace.js does not persist identityReason, which was outside the allowed surfaces). Trailer shape taken from existing test fixtures, not confirmed against a real host run.
- L31 (2026-11-04): User approved T2_SINGLE_SESSION_VALIDATION_APPROVED and specs S68-S74. Implementation of the ADAPTIVE_SUBSCRIPTION_EFFICIENCY policy is deferred until the Router stabilizes.
- L32 (2026-11-04): User decision T2_ACCEPTED_WITH_KNOWN_LIMITATIONS; specs S75 and S76 recorded. T2 formally closed with the three observation limitations documented in S75. T3 design and implementation breakdown authorized; code not authorized. Ten pending verdicts remain untouched; no push, merge, or permanent plugin installation. Untracked tsconfig.json and temporary directories remain outside commits pending provenance review.

- L33 (2026-11-04): Added the T3 design proposal and implementation breakdown after CodeGraph-first, bounded source inspection. Corrected the reference map, separated provider evidence from model identity and artifact authorship, identified existing Architect task primitives, and proposed an all-launch-path guard with coordinated T3/T4 global-restriction removal. OD-T3-1 through OD-T3-3 remain user decisions. T3/T4 task lines, all status/spec text, ten pending verdicts and untracked tsconfig.json are unchanged. Documentation only; no code, tests, configuration, operational state, delegation, formatter, commit, push, route refresh or team re-formation.
- L34 (2026-11-04): User approved provider/model separation and specs S77-S81. T3 code remains unauthorized; all ten pending verdicts remain untouched. Documentation only.

- L35 (2026-11-04): User approved OD-T3-4; reduced T3 specification recorded per S82; implementation remains unauthorized; ten pending verdicts untouched.

- L36 (2026-11-05): User approved T3-R1 only, Spanish verbatim: Autorizo implementar exclusivamente R1 (identidad de tarea), con revisión cruzada y sin modificar el comportamiento del Router. New principle, Spanish verbatim: Cada nueva funcionalidad de Kairo debe justificar cualquier aumento del contexto que carga o transmite. WAIT_FOR_TASK_IDENTITY from the reduced R1 text is deferred, because this approval forbids Router changes. executePlan writes one trace row and no ledger row, because ledger launch rows feed routing distribution. Writer Codex through team-builder-codex because the Builder route was WAIT_FOR_PROJECT_TEAM. Cross review by Claude team-verifier through the no-redirect marker, because the Reviewer route is also Codex; one blocker found, a prompt marker starting with two dashes broke record-launch, fixed by the equals argv form. Open advisory: a separate flag token starting with two dashes still fails as an unknown option. Push, merge and global deployment not authorized. Verification: node --test test/role-telemetry-quality.test.js test/team-launch-ledger.test.js: 23 passed, 0 failed, exit 0; claude plugin test integrations/claude-code/kairo-router: 359 passed, 0 failed across 4 files, exit 0. npm test not run as instructed.

- L37 (2026-11-05): User decision T3-R1_CONDITIONAL_ACCEPTANCE: "Acepto R1 como implementación funcional, pero falta cerrar la verificación independiente de la corrección del bloqueante. No autorizo una nueva revisión nativa completa" and "Si pasa, R1 queda aceptada sin necesidad de una nueva autorización." Focused recheck by the same Claude reviewer at aae75cc95: PASS on all four items; marker values --foo, --cwd=/tmp/x, --agent=other, --task-id=y exited 0, wrote one row each with taskId null and taskIdStatus invalid; reverting the hook line failed 4 plugin tests. T3-R1 accepted. Native review declined by the user for this candidate. Recorded advisories: readonly-codex-sandbox failed once in a full run, then passed 6/6 alone and in the next full run, cause unknown; separate tokens --task-id --foo are rejected as an unknown option; the CLI must deploy before the plugin; no emitter sends the marker yet; WAIT_FOR_TASK_IDENTITY belongs to R3; ten pending verdicts untouched. User proposal: reduce global instructions inherited by workers as independent work, without changing governance rules during R1. R2 and R3 code not authorized.

- L38 (2026-11-05): User approved OD-T3-R2_TRACE_LEDGER_SEPARATION and T3-R2A_IMPLEMENTATION: the trace observes, the ledger accounts, the Router decides, governance validates. team-verifier stays trace-only until R3/T4. R1 integration limitation recorded: the hook and team exec generated different executionIds on transport wrappers; R2a corrects it. Background stop events prove only that the host agent stopped. SendMessage stays out of scope as a documented limitation. R2b, R3, T4, plugin installation, push and merge not authorized.

- L39 (2026-11-05): T3-R2a cross review by Claude team-verifier. No blockers. Two advisories corrected because they broke user conditions. Non-empty text no longer implies completed. A no-redirect launch without subagent_type keeps baseline output. Governance exception. The R2a Builder ran through the no-redirect path without an explicit marker, because the installed kairo-router 0.7.5 matches the marker in user message text and applies it to that turn. The user message quoted it. Open advisories. Quoting the marker disables routing for a turn. A prompt already holding a different Kairo-Execution-Id line falls back to an unlinked UUID. A background launch with no reported agentId or no stop event leaves no outcome row. The ledger keeps completed at a background stop, observed at 16:31:35 UTC while Codex ran until about 16:37 UTC. C1 first valid measurement. First-request cache write 7768 against baseline 63165. No instruction files loaded. Contract respected.

- L40 (2026-11-05): User accepted T3-R2a after an independent recheck of F1 and F2; native review declined for that candidate without disabling RDD. C1 validated on team-builder-codex only: first-request cache write 63165 to 7768. Priority admission defect for R3/T4: a no-redirect marker in user text is not a deliberate authorization. C3 canary approved on team-verifier with a restrictions block, declarative and not a technical lock; measurement pending on the next real review. Reader differential by execution and installed plugin validation remain open. R2b code, Knowledge and Capability Gateway implementation, push, merge and plugin installation not authorized.
- L41 (2026-11-05): User approved T3-R2B_IMPLEMENTATION_APPROVED on 2026-11-05 with the scope in S83 and S84 (env allowlist only for governed and verified Codex executions; effective-config preflight; binary, signature and version check; detection of overrides, profiles and proxies; mandatory link thread_id to rollout to executionId; evidence in routing-trace.jsonl). team-builder-codex migration and R3/T4 are not authorized; push, merge, deploy and plugin install are not authorized; the 14 verdicts are intact.
- L42 (2026-11-05): Probes and canary evidence on Codex 0.166.0: -c openai_base_url reached a local listener while the rollout stayed model_provider openai and originator codex_exec. The env var OPENAI_BASE_URL did not reach it under API-key auth. model_providers.openai.base_url is refused at load. CODEX_INTERNAL_ORIGINATOR_OVERRIDE changes the rollout originator. CODEX_EXEC_SERVER_URL opens a websocket with the rollout unchanged. config/read does not show env overrides. app-server does not accept -p. thread.started is top-level in exec json output. Canary cost: 42176 input tokens with 5 output.
- L43 (2026-11-05): Independent review returned FAIL on S83 and S84. B1: rollout must hold its own single task_complete whose turn_id equals the turn_context turn_id (missing: none-detected rollout-incomplete). B2: the whole rollout JSONL is parsed (malformed: none-detected rollout-unparseable; session_meta count other than one, or contradicting context or completion: untrusted). B3: regular files only, O_NOFOLLOW and O_NONBLOCK open plus fstat (rollout-not-regular), 64 MiB cap (rollout-too-large), one 5 second abortable deadline (evidence-timeout), proved with a real FIFO. B4: live detection uses two ps reads joined by pid with comm and first-positional app-server matching, and a live match no longer skips config inspection. A1: `--` before the task on verified launches only, required by the argv check, real parser acceptance unproven. A2: more than one thread.started is untrusted. A3: app-server reader exercised against a node protocol fixture (success, error, hang). The Builder's earlier report of a live app-server is unconfirmed: at orchestrator check no such process existed and PID 5705 in daemon.pid was dead, and the old matcher (any line containing codex and app-server) could produce that false positive.
- L44 (2026-11-05): Recheck verdicts: B1, B2, B4, A1, A2, A3 FIXED; S83 PASS; S84 FAIL on B3 (findRollouts kept walking after the deadline: directory reads rose from 1 to 5 after a call that returned in 11 ms; inspectRollout could keep its handle during a pending read). Second correction: the abort signal now gates every directory read and entry in the walk, and inspectRollout closes its handle once on abort (listener removed in finally). Known limitation recorded: Node cannot cancel an in-flight filesystem call the OS will not interrupt. No false controlled credit came from this path.
- L45 (2026-11-05): User approved REMEDIATION_APPROVED_BEFORE_CANARY on 2026-11-05: four corrections, then deterministic tests, independent recheck, one real canary with a read-only local tool through kairo team exec --verify-provider, then an acceptance decision; the canary stops if it would need wider permissions or a changed allowlist; plugin install, R3/T4, push and merge are not authorized; the 17 verdicts are intact; Docker is a later evaluation, Kubernetes is not needed now; pstack, ECC and ClaudeMod are references only and none is installed.
- L46 (2026-11-05): Remediation unit outcome. (1) providerEvidence is registered in a module-private WeakSet by classifyCodexExecution (isClassifiedCodexEvidence); buildRoutingTrace emits it only for source exec plus a registered object, so a forged object through buildRoutingTrace, appendRoutingTrace or record-trace yields a row without it; documented limitation: the trace file is a local unsigned file. (2) Signature check is one codesign --verify --strict -R=<anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"> on the launch path; non-zero is untrusted, tool error or timeout is none-detected; the TeamIdentifier display read was removed (team-mismatch stays in the vocabulary, unused). Real read-only run: codex binary exit 0, /bin/ls exit 3. (3) App-server parser skips value-taking options derived from codex --help 0.166.0 (-c/--config, --enable, --disable, --remote, --remote-auth-token-env, -i/--image, -m/--model, --local-provider, -p/--profile, -s/--sandbox, -C/--cd, --add-dir, -a/--ask-for-approval) plus the equals form, and fails closed on an unknown option followed by an exact app-server before --. (4) prepareVerifiedCodexLaunch returns failure env or executable; team exec exits 1 with one stderr line before any ledger write or spawn. Advisory 5 (orphan with an npm wrapper) stays documented only. Covers S83, S84.
- L47 (2026-11-05): Recheck found the variadic -i/--image false negative in the live app-server parser (codex -i a.png b.png --profile work app-server was reported not live). Parser corrected, recheck pending.
- L48 (2026-11-05): User decision: the last correction of this unit is authorized as an explicit exception, with one recheck. If the recheck fails, R2b stops and no canary runs; if it passes, the one authorized real turn proceeds. Correction: the live app-server detection no longer parses an option list (value options, known flags and variadic handling are removed, because macOS ps loses argument boundaries). Codex processes are identified by comm basename codex, a parenthesised comm, or node with an argument whose basename is codex or codex.js. First token app-server is live; a non-option first token or no arguments is no effect; a dash-first token with a later exact app-server is possibly live; a dash-first token without app-server, a missing args row, args not beginning with comm, or a parenthesised comm is process-ambiguous (none-detected). Deliberately conservative: it may deny credit in legitimate cases. Finding: the governed launch argv starts with an option (--model, and -c when an effort is set), so a concurrent governed run reads as process-ambiguous; changing the verified launch to put exec first needs team-exec.js, outside this correction's edit surface. Also: Context7 is reused as is and fits a future Gateway; Upstash Box is a later optional remote sandbox, not a subscription substitute; neither changes the architecture now.
- L48a (2026-11-05): Launch-shape correction authorized by the coordinator (team-exec.js and test/team-exec.test.js added to the surface; the earlier omission was the coordinator's error). Under --verify-provider with provider codex only, the argv is rebuilt on every attempt as exec, --json, the adapter flags, --model X, the optional -c model_reasoning_effort, then -- and the task, so it never starts with an option; checkCodexArgv now requires exec first. Launches without the flag are byte-identical (--model first, pinned by a test). Evidence from the orchestrator canary on 0.166.0: codex exec --json -s read-only -m gpt-6.1-sol -c model_reasoning_effort="low" exited 0, so exec-first with -m and -c after exec is proven; the --model long form and the -- before the task remain to be proven by the canary.
- L49 (2026-11-05): The previous recheck FAIL stopped R2b. The user approved R2B_OPTION_A_APPROVED_WITH_BOUNDARIES on 2026-11-05 as the last exception, with these boundaries: no other Codex process detected and all other checks passing is eligible for controlled; another Codex process active, whatever its arguments, is none-detected with no credit (reason other-codex-process); processes that cannot be enumerated or identified with enough confidence give no credit; Kairo's own pid is excluded; contradictory evidence or a disallowed transport is untrusted; argv is not reconstructed from ps strings and a query that ended incomplete or with an error is not read as absence. Implemented as one `ps -axww -o pid= -o comm=` read (detectForeignCodexProcess), the argument parser removed. Sequence: one correction, one focused recheck, one conditional canary through kairo team exec --verify-provider with one local read-only tool and no other Codex active; on failure R2b stops with verifiable provenance only and no more correction rounds; push, merge, plugin install, R3 and T4 are not authorized.
- L50 (2026-11-05): User chose closing R2b with provenance on 2026-11-05: no further correction, canary cancelled, providerVerified false until later validation; push, merge, install not authorized; verdicts intact; ee93bad29 and e3b4e30af remain in local history. Next architectural evaluation, user words: find an isolation or launch-control mechanism that identifies which process Kairo ran and what configuration it used, without inspecting all macOS processes to deduce their arguments; do not depend on proving global absence of local processes through ps; Podman may be investigated for tests or auxiliary services but is not assumed to solve provenance of an authenticated host Codex CLI. Pending parser correction (documented, not continued): a nonblank unparseable ps row is dropped when others parse. Closure: classifyCodexExecution never returns controlled; a clean run is none-detected with provider-credit-disabled; evidence carries rolloutLinked.
- L51 (2026-11-05), user decision R2B_SAFE_CLOSURE_APPROVED, verbatim: "Autorizo cerrar R2b mediante un commit local, conservando la procedencia y dejando deshabilitada la acreditación de Codex. R2b seguirá marcada como detenida y no aceptada." "La procedencia todavía sólo está validada mediante fakes en la integración de Kairo. No la presentaremos como una capacidad comprobada de extremo a extremo." "No autorizo otra revisión nativa de tres lentes sólo para volver a evaluar R2b." "No seguiría intentando acreditar Codex mediante inspección global de procesos." "¿Cómo garantizamos la procedencia de una ejecución que Kairo controla directamente, sin intentar demostrar qué están haciendo todos los demás procesos del sistema?" "Orden aprobado: commit local de cierre → documentación y Engram → cerrar la unidad R2b → retomar el diseño de autoridad de R3/T4 considerando explícitamente que Codex todavía no puede recibir crédito verificado." Accepted: providerVerified false, controlled removed, none-detected with provider-credit-disabled, the thread_id to rollout to executionId link kept pending real validation, the transport preflight kept as a diagnostic without authority. R3 and T4 are not authorized; push, merge and plugin installation are not authorized; none of the 21 pending verdicts is recorded retroactively or automatically.
- L52 (2026-11-05): R2b closure outcome. Codex credit stays disabled and ledger semantics and distribution are unchanged. The suite results 115/115 focused and 4527/4527 full come from before this closure write and were not repeated, as the user allowed, because no code changed afterwards. Limitation: the closure has no independent review, by user decision. Native assessment of the candidate reported risk high, reason process_boundary on src/global/team/codex-provider-evidence.js, review_due true; no review was started and no repository hook or gate blocks the commit. integrations/claude-code/kairo-router/tsconfig.json stays untracked and out of the commit.
- L53 (2026-11-05): Findings preserved before temporary cleanup. Why process inspection failed the reviews: whitespace-split ps text loses argument boundaries, so a config value can hide app-server (codex -i a.png b.png -c 'model = "gpt-6.1-sol"' app-server read as not live, and that command shape was confirmed with --help on the standalone 0.166.0 binary); truncated or executable-only process text read as clear and earned controlled in in-memory probes; a process started with a spoofed argv0 ending in exec could present app-server as exec at parser level, with real macOS serialization unverified; a malformed nonblank ps row was dropped when other rows parsed and also reached controlled in-memory. Earlier rollout findings handled by the L46 remediation: incomplete rollout, corrupt or contradictory records, evidence reads that could stall on a FIFO, and grep-like lines matched as live servers. Discarded approach: the argument parser of L48 and the exclusivity rule of L49 can no longer grant credit. Separate defect, not part of this closure: team-reviewer-codex returned an old result. Next design question is the one quoted in L51, including evaluating team-builder-codex through kairo team exec, child process identification and its real transport limits, with no global exclusivity and no new services; that implementation has not started.
- L54 (2026-11-05), user decision R3/T4_AUTHORITY_DESIGN_APPROVED_WITH_CONDITIONS, verbatim: "Apruebo separar autoría declarada de proveedor verificado como base para R3/T4." "una revisión independiente no puede considerarse demostrada únicamente porque el ledger declara dos proveedores distintos, ni siquiera si marcamos la aceptación como provisional." "No autorizo todavía la implementación de R3/T4." "qué evidencia mínima permitiría elevar la autoría Codex de DECLARED a OBSERVED, sin recuperar el mecanismo frágil de inspección global de procesos." Explicit debt: closure commit ae5ef70b2 is safe by design because it disables credit, but its final change had no independent review. The 21 pending verdicts stay pending and are not recorded retroactively.
- L55 (2026-11-05): Code findings against S85, open decision. (a) No VERIFIED evidence exists for any provider: --verify-provider accepts only codex and providerVerified is always false, and src contains no Claude equivalent, so the S85 rows that need Claude verified or both verified are unreachable today and the matrix has no row for the current real case, Codex declared with Claude declared. Open decision OD-R3-1: the state for that case. Orchestrator recommendation, not approved: REVIEWED_PENDING_PROVENANCE, since it grants no acceptance; consequence: ACCEPTED is unreachable and only S23 closes a task until VERIFIED exists. (b) team-builder-codex launches codex exec directly, not kairo team exec, so its work produces no provider evidence and can only reach DECLARED. (c) Nothing reads routing-trace.jsonl yet, and the WeakSet forgery guard only protects trace writing in one process; a later reader sees plain JSON, so persisted evidence can support OBSERVED but never VERIFIED. (d) kairo-router treats [no-redirect] as a skip of rewrites; per S85 limit 3 the R3 admission check must run regardless of that marker.
- L56 (2026-11-05): Proposed minimum for DECLARED to OBSERVED, not approved and without code: the execution ran through kairo team exec --verify-provider with its executionId recorded before spawn; the spawned child, whose absolute executable passed the signature check, emitted through its own pipe exactly one valid thread.started and a turn.completed with exit 0; rolloutLinked is true; and no CODEX_UNTRUSTED_REASONS reason is present, since a contradiction keeps DECLARED. other-codex-process and any other global process result must not affect this level, so parallel runs are not penalized. OBSERVED describes the execution only: linking it to a task artifact additionally needs the task identity plus the contribution evidence of S5. It does not prove served model or transport, and requires one authorized real run because the link is validated only with fakes; no credit before that run.
- L57 (2026-11-05), user decision, verbatim: "Apruebo REVIEWED_PENDING_PROVENANCE para el caso actual: Codex declarado como Builder y Claude declarado como Reviewer." "Permite continuar implementando, ejecutar pruebas, corregir defectos y avanzar entre tareas que no dependan de una aceptación definitiva." "No permite acreditar una revisión como independiente verificada, emitir ACCEPTED, hacer merge o desplegar automáticamente." "S23 sigue siendo la vía de cierre excepcional cuando falta evidencia suficiente. No debe activarse de manera implícita." "No podemos seguir construyendo una arquitectura en la que sólo Codex tenga una ruta formal de evidencia." "Autorizo actualizar el diseño de R3/T4 con este criterio, pero no su implementación. Tampoco autorizo todavía instalar ninguno de los plugins comunitarios." OD-R3-1 is resolved.
- L58 (2026-11-05): Open points. (a) The same message also proposes the levels DECLARED, PROCESS_ATTESTED and TRANSPORT_VERIFIED, where PROCESS_ATTESTED could support operational independence if policy authorizes it, with higher requirements or S23 for critical tasks (security, credentials, governance, the verifiers themselves), no global ps detector, no MCP, service, database or daemon, and no reopening of R2b. S85 and S86 keep DECLARED, OBSERVED and VERIFIED, where OBSERVED supports decisions but does not credit independence; so whether process attestation can credit operational independence is an open decision, not resolved here. providerVerified true is not reused for it. (b) Claude subagents launched through the host Agent tool are not child processes of Kairo, so process attestation cannot apply to them as it does to kairo team exec; only kairo team exec with provider claude or a transcript source could reach them, and --verify-provider currently refuses every provider except codex. (c) The requirement of a real recorded review depends on review results being trustworthy; the open team-reviewer-codex defect, which returned an old result, must be fixed or excluded for this evidence.
- L59 (2026-11-05): OD-R3-2 canary, one real run at eefdc9ede through kairo team exec --provider codex --model gpt-6-luna --verify-provider, no role so no capacity fallback, no retry. executionId cb7d3446-f468-4ac7-b666-1f070a413e6d, thread 01a1adaf-c56e-7170-9bfe-eee90d022146, exit 0, status none-detected, rolloutLinked true, reasons only provider-credit-disabled, providerVerified false. L56 conditions: launch row at 21:48:59.957Z before rollout start at 21:49:00.636Z; signature passed by absence of signature-invalid and an after-the-fact codesign recheck, path not persisted; lifecycle passed through the classifier, raw JSONL discarded; one rollout with matching id, cwd, originator, version and turn id; no untrusted reason. The rollout shows one exec tool call running shasum -a 256 LICENSE, and the hash matched an independent one; that evidence comes from the rollout, not the pipe. Report classification PROCESS_ATTESTED_CANDIDATE, experimental, no authority. Limits: one sample, no other Codex process present, taskId absent, workspace-write sandbox, served model and transport unverified, executionId absent from the rollout. Cost: 11 s total, about 7.5 s turn, 85219 tokens over two requests. Repository and Codex config hashes unchanged; ledger, trace and rollout gained rows.
- L60 (2026-11-05), user decision, verbatim in S87: OD-R3-2 OBSERVED_DESIGN_APPROVED. PROCESS_ATTESTED_CANDIDATE is an experimental result, not acceptance authority; the rollout model is requested or client-recorded, not served. Design written in the section R3/T4 execution observation design. Premises corrected against code: no ledger row kind called observation exists; Codex evidence sits on exec rows; record-trace accepts a JSON payload from any local process, so native Claude evidence lacks the in-process guard; trace retention is 8 days. Open: native Claude level and retention window. No implementation, canary, Router change or global configuration change authorized.
- L61 (2026-11-05), user decision, verbatim in S88: OD-R3-3 NATIVE_CLAUDE_OBSERVED_APPROVED, with executionObservation on routing-trace/v2, process null, sessionArtifact.linked, core-derived provenanceLevel, no provenance.jsonl, hash and size as minimum evidence, and no S5 credit on ambiguous contribution approved for design. Checked against official hooks documentation: internal agents fire SubagentStop, and transcript_path may lag. Corrections to the decision text: C3 remains unmeasured (L40, S87), so no C3 context reduction is recorded as achieved; no video appears in this session. Design updated with correlation, trusted sources, dimensions and retention tied to the task. Open: independent design review, retention cap, Codex native host source. No implementation, hook change, migration, canary or added authority authorized.
- L62 (2026-11-05): OD-R3-4 review result, static contract, code and documentation review at 7140a1094 on Codex gpt-6-astra; the router labeled the launch Technical Lead. The review token was returned, so the result is fresh. VERDICT CONDITIONAL_PASS, no BLOCKER. F1 DEFECT HIGH: the design's hard cap permits deletion after 90 days and has no expiry flag, conflicting with S89. F2 DEFECT MEDIUM: terminal state is undefined; architect-types.js defines plan states draft, awaiting_approval, approved, rejected and failed, which do not establish task closure. F3 DEFECT HIGH: final-text equality does not prove segment freshness, because a resumed subagent ending with identical text can pass against an old prefix; a validated segment and bounded range are required. F4 DEFECT HIGH: reportedAgentId falls back to parsing result text (register.ts:265-274), which S88 calls model controlled, so a miscorrelated agent could be bound to the wrong launch; a structured host-owned binding is required. L1 accepted limitation: same-user forgery. Task identity, S5 independence and portability covered. Not validated: real hook delivery, transcript timing, undocumented fields across CLI versions, Claude child events, sandbox enforcement. Parent spot check confirmed F2 and F4 in code. Parent read-only count over two local session transcripts, field names only: 19 background Agent results carry a structured agentId, and all 19 sidecars have a toolUseId matching that launch and agent; the 8 other Agent results carry no structured result object, so foreground binding remains unproven. That count reads the stored result, not the value the hook receives. Corrections not applied; they await a user decision.
- L63 (2026-11-05), user decision, verbatim in S90: OD-R3-5 DESIGN_CORRECTIONS_APPROVED. F1 to F4 applied to the OBSERVED design, recorded as CONDITIONAL_PASS, FINDINGS_ADDRESSED_IN_DESIGN, not a new independent PASS; these corrections have not been independently reviewed. Claude foreground stays DECLARED until a structured link exists. No closure source exists, so linked evidence is kept and flagged at 90 days. Next: decide how to apply OBSERVED before authorizing R3/T4, keeping execution, review and acceptance separate. No code, hook, Router, wrapper, canary or R3/T4 implementation authorized.
- L64 (2026-11-05), user decision, verbatim in S91: OD-R3-6 OBSERVED_AUTHORITY_POLICY_APPROVED. F3 precisions and the performance gate added to the OBSERVED design. Minimal cut prepared in the section R3/T4 authority policy and minimal cut. Findings against code: the Router denies no launch today; the current Builder wait cites a stale entitlement, not the veto; no writer reader or task registration outside Architect exists; R1 as written would create a new global block. Open: launches with no taskId, deferral of S82, emptiness-at-launch equivalent, performance criterion. Engram now keeps a compact status under odd/router-provider-authority/status; the older mirror parts stop being updated and this document is the full reference. No code, hook, wrapper, routing or canary authorized.
- L65 (2026-11-05), user decision, verbatim in S92: OD-R3-7 UNLINKED_EXECUTION_APPROVED. Cut sequence approved with U1 first and U2 to U5 as one governance unit. Design updated with the identity contract and the U1 specification. Findings: a removed task marker cannot always be told from a legitimate absence, which is safe in this cut only because of the REVIEWED_PENDING_PROVENANCE cap; rejecting the timestamp as proof leaves first segments without a trusted start, so native Claude first segments stay DECLARED until the proposed SubagentStart source is verified and approved; the marker is documented in claude-kit.js, the README and the CLI reference; the installed plugin is 0.7.5 against 0.8.0 in the repository, so register.ts line references describe the repository, not necessarily the running hook. No code, hook, wrapper, routing, canary or install authorized.
- L66 (2026-11-05), user decisions verbatim in S93: U1 implemented in the repository and committed locally with this entry. Builder claude/sonnet per the ledger, under the marker defect still live in plugin 0.7.5, since the user message quoted the marker. Review codex/gpt-6-astra on the real diff, token returned: CONDITIONAL_PASS, no change-caused defect. Checks: npm test run directly 4527 of 4527; claude plugin test 398 of 398; node --test test/claude-kit.test.js 24 of 24. The same suite routed to Codex reported 35 failures, with errors from the nested sandbox and CLI markers; 29 were named and not individually diagnosed, and the tree passed in full when run directly. Open reviewer items, not fixed: exhaustion has no integrated hook to core test and non-Builder custom roles are not proven at runtime; the handover trace can name the original provider as selected (register.ts:994), pre-existing; a rewritten test lost an outcome assertion (register.test.ts:2098), optional. The plugin version was not bumped. Stale external guidance, unmodified: user CLAUDE.md, a user plan file and the installed plugin copy.
- L67 (2026-11-05), user decision in S94: two authorized probes through service.verifyAnalystAccess returned allowed for claude-opus-5-5 and claude-sonnet-5-5, and kairo team analysts in this repository then listed both with four Codex models under CONSERVE, which confirms the stale entitlement cause. Where the cause is lost: project-strategy.js:391 sets available false, team-cli.js:42 drops the row and team-cli.js:478 throws analyst_unknown. Sonnet's probe session recorded 103720 cache-write tokens; that is not a quota measure. Builder diagnosis, read only: the stale hypothesis no longer explains it. The routing input cache has a 30-minute TTL and regenerated on its own at 23:02:40Z, about 2.6 minutes after the probes, with both entitlements allowed. Builder still returns WAIT_FOR_PROJECT_TEAM, now because claude-sonnet-5-5, claude-opus-5-5, gpt-6.1-sol and gpt-6-astra are outside band, gpt-6.1-terra and gpt-6-luna are unqualified, and the cached Builder pool holds only opencode-go models, a provider not configured for team roles. That belongs to the Builder pool work of T5, not to entitlement. Unknown: whether claude-haiku-5-5 would qualify, since it stays unverified. Abril was not checked because its path is unknown. analysis_failed and DRIFT DETECTED are not diagnosed. No refresh, kairo sync or assignment change ran.
- L68 (2026-11-05), user decision verbatim in S95: OD-T5-1 DESIGN_UPDATE_APPROVED. T5 specified in the section T5 Builder eligibility design, with observed facts apart from hypotheses. Order: U2 to U5, then T5. New facts: installed plugin 0.7.5 has no record-trace call, so a launch after WAIT leaves neither a ledger nor a trace row in live sessions; the U2 reader must therefore read the trace, which needs 0.8.0. No code, hook, wrapper, configuration, assignment, cache, entitlement, probe, plugin, push or merge change was made.
- L69 (2026-11-06), user decision verbatim in S96: OD-R3-U2-U5. Delivery inventory and U2 to U5 specification written with no code change. Findings: the global kairo CLI is a symlink to this checkout, so src edits go live at once; the U5 list omitted the team-wide Reviewer filter; formation still throws reviewer_independence; an explicit Claude model can bypass an exclusion; verdicts are not bound to a task. Simulation used throwaway object storage and ran no tests. OD-U-1 to OD-U-4 await the user. Next step: user decisions, then Level 2 validation of 0.8.0 if authorized.
- L70 (2026-11-06), user decisions verbatim in S97: OD-U-1 and OD-U-4 modified, OD-U-2 and OD-U-3 approved, slice A authorized in an isolated worktree, slices B to D pending review. Slice A narrowed to reading, so task open moved to B. Correction to the specification: persisted rows hold taskId null for invalid, not_found and unreadable markers, so anomalies cannot be attributed per task. Open point for the user: the decision text cites S22 for keeping the chosen host, while S22 in this document is OD2 FAIL_CLOSED_WITH_HUMAN_OVERRIDE; no spec with that host wording was located by a bounded search of S1-S96. Next step: slice A.
- L71 (2026-11-06): Slice A committed as 2376769ff on feat/router-u2-u5 in the isolated worktree, 338 added lines, src/global/team/task-authorship.js and its test, imported by nothing. Reader test 25 of 25. Full suite in the worktree 4552 of 4552, run from the main session with node_modules linked temporarily. RED observed before the module and before the correction. Parent review found a real defect, corrected before commit: the Codex wrapper calls team exec with no role, so a linked Reviewer on Codex counted as a Codex writer; roles now resolve across rows by executionId and parentExecutionId. Evidence notes: a suite run through the Codex-routed runner gave 69 sandbox failures (EPERM, ambiguous_host) and is not evidence; a worktree without node_modules gives 333 missing-package failures. gentle-ai assess returned high with process_boundary signal shell_process on the reader, which spawns no process. Native review of the commit was offered and declined by the user for this candidate. Slices B to D await their review.
- L72 (2026-11-06), user decisions verbatim in S98: OD-BACKUP-1 stopped because origin Kal-elSam/harness is PUBLIC, nothing pushed there. OD-BACKUP-2: private repository Kal-elSam/harness-backup created, remote backup added, atomic push of both branches. Parent verified visibility PRIVATE after the push and remote SHAs equal to local: f41d81ab90d8cb7b038807de4887fa2793a42529 and 2376769ff9728b63d2a14fea775dc7cc1460cc18. origin untouched, no upstream set, no tags. No agent named Deliverer is installed, so team-builder ran the operation under that instruction. Fixtures sk-secret123456 and sk-live-secret-value-123 confirmed test-only; gitleaks and pattern searches are not an exhaustive audit. Slice B contracts proposed. This entry is newer than the backup.
- L73 (2026-11-06), user decision verbatim in S99: slice B approved in the worktree without activation. One cross-review of the final diff suffices, with deterministic tests and checked suite exit codes. f4bea1da9 stays outside the private backup as a known difference; no new push authorized. The enable and disable guard moved to slice C because S99 excludes hook changes from B.
- L74 (2026-11-06): Slice B committed as 6c36dd202 with corrections 3aa28b9f9 on feat/router-u2-u5. Cross-vendor review found four blockers: related-anomaly provider loss, gentle-owned names qualifying as Reviewers, governance failure refusing a verdict, and a silent invalid configuration on verdict output. One correction batch, then a recheck limited to them: all four fixed, no correction-caused finding. Full suite 4624 of 4624 three times with npm exit 0 from the main session. One earlier worker run gave npm exit 1 without captured output; it did not reproduce and stays unexplained. Part of the RED evidence was confirmed after writing the code, by swapping in the base files. Native review was not started because S99 states one cross review of the final diff suffices. Contract stays inactive, no hook changed, global vetoes stay. Advisories kept: forged record-trace declarations reach the provisional state, contained by the cap and the limit S99 accepted; admission at verdict is computed before the ledger lock; disabling the contract does not revoke an earlier provisional state. Known contradiction until slice D: team veto and per-task exclusion stack, so a Builder-on-Claude team cannot review a Codex-written task. Slice C holds explicitModelVerdict, exhaustion handover, ADMISSION_UNAVAILABLE denial and the enable guard. plans show calls a registered task a failed draft, which is misleading and left unchanged. A first recheck stalled on open stdin after a quoting problem and was stopped by the parent.
- L75 (2026-11-06), user decision verbatim in S100: slice C authorized in the worktree with the exhaustion denial conditional on an active contract. OD-BACKUP-3 pushed bb756da4b and 3aa28b9f9 to the private backup, SHAs verified. Pending from the user's B assessment: slices must stay smaller, the post-correction recheck of B was limited rather than a full approval, and the rollback of provisional states, the pre-lock race and forgeable provenance must be resolved or explicitly limited before any acceptance above REVIEWED_PENDING_PROVENANCE. task open id duplication stays as debt; no Architect refactor for cleanliness.
- L76 (2026-11-06): Slice C committed in parts C0 to C4 plus two corrections, final commit cd531a250. C0: the prior core rejects the new flags with Unknown option and exit 1, so a 0.9.0 hook degrades to an unchanged launch and merge must precede install; 14 argv forms of hooks 0.7.5 and 0.8.0 under 4 contract states gave identical stdout, stderr and exit code, with claimedTaskId and the admissionContract stamp as the additive persisted differences; route budget median 114 ms at real file sizes and 151 ms at ten times, against the 2000 ms limit. A full cross review of 2376769ff to 42b775d4e found four blockers, three of them in slice B code: conflicting Reviewer providers, not_prevented launches earning credit, and an active exec stamp overriding negative stamps, plus a wrapper bypass of the admission guard. Correction 0cc87f029 fixed the three. The guard regressed on quote concatenation and was fixed by cd531a250, the second and last permitted correction. Final recheck reported two items as still failing, classified by the parent, open for the user to overrule: a direct main-session disable being denied is S98 behavior, and printf piped to xargs assembles the command at run time, the same class S100 leaves outside the guard, and was already so before the commit. Reachability confirmed: legitimate exec and hook reviews reach REVIEWED_PENDING_PROVENANCE; ACCEPTED unreachable. Suite at cd531a250 from the main session: 4643 of 4643 in 5 of 5 runs with npm exit 0, plugin tests 479 pass and 0 fail. Flaky: the sandbox canary tests failed in 2 of 4 parent runs at earlier commits on this branch and in some builder runs; the baseline 60582b217 gave 5 of 5 clean and the final commit 5 of 5 clean. Cause unconfirmed, and it is not shown to be pre-existing. Advisories kept: a Claude route with no targetAgent keeps a fixed team-reviewer-codex agent, pre-existing; a record-trace payload can claim denied and thus prevented, within the limit S99 accepted. WAIT_FOR_AVAILABLE_PROVIDER applies to Builders with an active contract under the retained veto, so C must not be activated before D.
- L77 (2026-11-06), user decision verbatim in S101: proceed to D with the sandbox failure registered as FLAKY_UNATTRIBUTED and its investigation deferred, the maintenance.lock hypothesis unconfirmed; if it reappears on the final version during D validation, keep the full log, exit code, affected test and conditions, and investigate before merge. Guard classification accepted provisionally: printf piped to xargs stays an existing bypass outside S100. The decision text cites S9 for the denied disable; S9 here is the specification-content rule, and the behavior comes from S98. Backup update of C authorized. Slice D contract specified read-only.
- L78 (2026-11-06), user decision verbatim in S102: D1 6174cf8ed, D2 21019189b, D3 1d518ff78 on feat/router-u2-u5. Route differential 576 of 576 identical to cd531a250. Full suite on 1d518ff78: 4669 of 4669, npm exit 0. First cross review CONDITIONAL_PASS with two source-observed blocker candidates: F1 service routing without task identity, and F2 UNLINKED preference displaced by tier-band. First correction 62a9dd6f8; approval differential 20 of 20 in process, not through the CLI; full suite 4683 of 4683, npm exit 0. The recheck was BLOCKED: F2 reinserted an unqualified approved model, a score-1 Codex over a score-90 Claude. Advisories: service.js swallowed evaluator errors; the launch test spied on launchRun, which is not the dependency, the real one being deps.startRun at service.js:599. Part of the F2 defect came from the parent's correction prompt, which asked to include approved model and fallback without saying how to verify qualification.
- L79 (2026-11-06), user decision verbatim in S103: second correction written and uncommitted, 7 files, 205 added and 37 deleted, on top of 62a9dd6f8. Writer reported route differential 576 of 576 and approval differential 20 of 20. G2 stays open per S103, with docs/cli-reference.md and test wording corrected so the stamp is not presented as hook enforcement proof.
- L80 (2026-11-06): results of the final validation, verdict BLOCKED. Independent recheck, Codex gpt-6.1-sol, read-only, disk-free probes, native-filesystem suites not run by it. Blocker 1, src/global/team/project-router.js:329: strict qualification depends on a non-empty exclusion set, not on task linkage. A real linked task with no writers has excludedProviders empty, and score-1 approved, fallback and manual candidates can route; a service probe invoked startRun once. Blocker 2, src/global/team/service.js:2656: readTaskAuthorship catches read failures at task-authorship.js:82-84 and task-governance.js:52 returns task_unreadable, so the new exception handler never runs; reproduced with a transient admission-time EIO after successful verification, where both providers had written and Claude launched once. Also in D1: the later unguarded cheapestQualifiedAlternative call at project-router.js:422 rethrows qualification errors instead of giving WAIT_FOR_INDEPENDENT_REVIEW, reproduced. Evidence test 2 is an incomplete guarantee, since it misses linked empty-exclusion cases and its fallback equals the same model. Evidence test 3 misses swallowed task-read failures. Evidence test 4 does not launch or inspect resulting credit. D3 launch test PASS: startRun spy, genuine preview confirmation, exact admission error, positive control. Advisories: test/task-governance.test.js:445 deletes independence and why from the comparison, weakening detection of unexpected credit; team-exec.js:62 lets a STALE approval reach explicit execution, predating this diff. Open for a new decision: UNLINKED with no qualified candidate keeps the unqualified approved model, and an unqualified manual pick is honored when UNLINKED, which conflict with the wording that all candidates qualify. Parent spot check confirmed project-router.js:329 and task-governance.js:52 in source only. Interim wrapper output repeated the prior recheck text from a stale codex-review-last.md; the parent discarded it and read the real file. Full suite on the same uncommitted tree: first run 4690 of 4691, npm exit 1, failing test statusline explains missing Codex quota without inventing numbers at test/statusline.test.js:103, actual Kairo fallback, duration 2181 ms, while the recheck ran concurrently. Isolated test file 5 of 5 runs, 9 of 9 each. Second full run with no concurrent load: 4691 of 4691, npm exit 0. statusline-cli.js is not in the diff. Hypothesis unconfirmed: STDIN_TIMEOUT_MS 200 at statusline-cli.js:12 expires under load. This is a different failure from the registered FLAKY_UNATTRIBUTED, which did not reappear. No correction applied, per S103. No commit of the correction, no activation, no plugin, no merge, no push, no verdicts.
- L81 (2026-11-06), user decision verbatim in S104: third correction, uncommitted on top of 62a9dd6f8, 10 files, 595 added and 58 deleted. Gate-derived literal linkedReview now requires shared qualification even with no writers; scorer errors give no candidate and eligibilityFailure; task_unreadable gives ADMISSION_UNAVAILABLE in service preview and execution, team route and team exec; active continuity routes carry additive legacyContinuity true and qualifiedKairoSelection false. Writer's sandbox reported 2 focused failures: the capacity-switch failure did not reproduce when run directly, and the byte comparison in test/task-governance.test.js came from the parent's restriction, so the two fields were listed explicitly with asserted values. Full suite then failed 4715 of 4717, npm exit 1, in two test/team-exec.test.js tests whose fixture had no scored cache after team exec began qualifying linked Reviewers; the parent had omitted that file from the writer's focused list. Fixture given a scored routing cache with assertions unchanged. Final full suite alone: 4717 of 4717, npm exit 0. Differentials against cd531a250 rerun by the parent: route 576 of 576, approval 20 of 20 in process after normalizing temporary paths, not through the CLI. Independent recheck, Codex gpt-6.1-sol, read-only, real functions over in-memory filesystem fixtures with mocked launch seams, no native-filesystem suites or installed hook runner, verdict BLOCKED. Blocker 1: integrations/claude-code/kairo-router/hooks/register.ts ignores the continuity fields; it acts only on decision ROUTED, rewrites the launch and records selectedProvider and selectedModel, so a score-1 UNLINKED Codex route rewrote an original Claude team-reviewer into kairo-codex and recorded it as selected; this fails policy row 1 and the fundamental condition of S104. Blocker 2: service.js routing falls back to arguments without exhaustion markers when a usage-sample read throws, because marker enrichment happens after sample reads at routing-input-cache.js:105-118; confirmed Claude exhaustion plus a usage-sample EIO gave ROUTED claude and one startRun, for linked and UNLINKED Reviewers; also reproduced at HEAD, so not a regression, but it fails policy row 8. Held by the recheck: rule 1 and rule 2 for route, service and exec, rows 3, 4 and 5, forgery attempts on the linked signal, the C3 startRun test, inactive differential probes. Advisories: team exec qualifies from the routing cache without TTL, schema or approval validation, while team route rejects the same stale inputs; a missing cache refuses, fail-closed; exact why equality is removed for active UNLINKED Reviewers in test/task-governance.test.js without replacement text validation. Parent confirmed both blockers in source only. Per S104 no further correction was started and the diff stays uncommitted. A new user decision is required. No activation, plugin install, merge, push or verdicts.
- L82 (2026-11-06), user decision verbatim in S105: final bounded unit, uncommitted on 62a9dd6f8, 13 files, 1091 added and 91 deleted. Verified copies: slice-d-62a9dd6f8.patch with 10 files and slice-d-62a9dd6f8-unit4.patch with 13 of 13 matching, sha256 ef1fd22743ec4d5d383f158e44ad6f48d767db68047baab3fb422ebe002d0ec2, in agentic-harness-worktrees/u2-u5-private-backup. Parent narrowed legacyContinuity to unqualified routes to keep the S101 preference, which caused blocker 3 below. Focused 178 of 178, plugin 501 of 501, differentials route 576 of 576 and approval 20 of 20 in process. Independent recheck, Codex gpt-6.1-sol, read-only with in-memory fixtures, verdict BLOCKED with four P1 blockers listed in the section Core-hook decision protocol. Full suite alone 4726 of 4726, with npm exit 0 observed on a second run because the first did not capture the exit code. Hook tests replay duplicated core constants, so no real hook to core path exists yet. Per S105 no correction ran. D stays BLOCKED, uncommitted, not activated, plugin not installed, no merge, push or verdicts.
- L83 (2026-11-06), user decision verbatim in S106: core-hook decision protocol specified with no code change. Mapped by a read-only explorer with parent probes. Not verified: older hook behavior against this core beyond the capability check, and an exhaustive audit of other integrations, where a bounded search found no other team route consumer. Whether record-trace can be invoked directly to forge a row was not verified, so the protocol treats hook rows as falsifiable. Next: user decision OD-C1, then authorization for T0.
- L84 (2026-11-06), user decision verbatim in S107: OD-C1 resolved as conditional fail-closed. D10 split into D10a and D10b, with the policy for an unreadable source proposed by the parent and marked unreviewed, because one ledger file cannot name an affected provider. Ledger wording separates selected, attempted and observed provider. Independent review of the full protocol authorized; T0 to T4, code, installation, activation, merge and push not authorized. The 13 uncommitted files and verified copies stay intact.
- L85 (2026-11-09), user decision verbatim in S108: core-hook protocol revised to V2 with no code change, targeting the eight blockers of the review at 7e1d69430 (B1 to B8). The decision table became ordered predicates P1 to P16 with defined sets and empty results; transport rows became X1 to X7 behind protocol negotiation, with inactive, corrupt, unsupported and transport error as distinct states; Reviewers under an active contract get no automatic handover; cached restrictions have an explicit schema and can only restrict; the reinterpretation inventory gained pacing, model alias, gentle bypass, check-agent and service checks; operational rows are split from evidence rows; per-role outcomes and a coordinated activation rule were added. Recheck of the eight blockers authorized, with one independent eligible Reviewer within current limits and no Astra. A new structural contradiction means reducing scope, not a third rewrite. T0 to T4, the 13 worktree files, merge, install, activation and push stay unauthorized. The Astra quota discrepancy is registered separately as T-ASTRA-QUOTA. Unreviewed V2 choices are listed in the final report, not decided here.
- L86 (2026-11-09), user decision verbatim in S109: core-hook protocol corrected from V2 to V2.1 with no code change, limited to the three defects of the recheck at 8a2944523. P8 now defines exhaustion-unknown per required provider, so an unreadable ledger denies a linked Reviewer even when a restriction is cached on another provider; P13a was added so a known restriction on the original provider denies a non-linked launch. P4 now excludes admission-bound gentle-owned actors, so a review-* name with review semantics and a task marker goes through U3 first. The no-directive rows became one ordered two-stage table: channel states H1 to H7, local effective states S1 to S7 with an activation record written only by the core, and rows X1 to X7 with exact predicates for the cached directive and X5. Corrupt is never disabled, a malformed directive is never permission, and each input reaches one row. B3 to B8 are unchanged. One focused recheck limited to these defects is authorized, with no Astra. T0 to T4, the 13 worktree files, merge, install, activation and push stay unauthorized. Open points for Sam are listed in the final report, not decided here.
- L87 (2026-11-09), user decision verbatim in S110: core-hook protocol adjusted from V2.1 to V2.2 as a documentation-only change. Admission-bound now follows the S110 table exactly: a review-* name with a linked task, or a declared review operation with a linked task, passes through U3 (P5 to P12) whatever role it declares, so a launch cannot skip admission by omitting its role declaration. P4 covers only gentle-owned actors that are not admission-bound, a review-* actor with identity UNLINKED keeps continuity without credit, and an unreadable task identity is never UNLINKED and is denied by P5 before every continuity row. The review-* name can add controls and never credits, proves independence or grants authority. The orchestrator also reconciled S20 with S108 to S110 (pending Sam's confirmation): U3 is an admission gate for gentle-owned actors, so the new row P12g keeps the original launch when it is eligible and P10 or P11 deny otherwise, with no redirect. B3 to B8 are unchanged. One focused check of this adjustment is pending. T0 to T4 and worktree code stay unauthorized.
- L88 (2026-11-09), user decision verbatim in S111: core-hook protocol closed at V2.2 by a minimal documentation correction, with no behavior change and no new independent review. B8 rows 1 to 3 are scoped to non-gentle-owned launches and the heading moved to V2.2; P11 states that P3 precedes it; P12g keeps credit none definitively, and T0 must check that no consumer reads governed-provisional or ROUTED_LINKED as credit. Design status is PROTOCOL_DESIGN_CLOSED subject to the structural readback. T0 (isolated experimental harness, no models, directives only as labeled fixtures) is authorized; T1 to T4, the 13 worktree files, install, activation, merge and push stay unauthorized.
- L89 (2026-11-09), user decision verbatim in S112: OD-R3-T0 accepted as T0_PASS_HARNESS_ONLY (19/19 harness tests, rerun 19/19) and T1 authorized in an isolated worktree only. Hook canonical identity stays partial until T2, directive and persistence schema until T1/T3. Activation source is the core, task identity resolves via the real commondir, T0 tests separate from npm test, and T1 builds decideLaunch and kairo.launch-directive/v1 in the core without touching register.ts. Controlled cleanup of T0-owned scratch authorized. T2-T4, the 13 pending D files, plugin update, admission activation, merge and push stay unauthorized.
- L90 (2026-11-09), not a user decision: T1 outcome T1_PASS. Independent verification (Codex gpt-6.1-sol) found four blockers at 55be28f6f (shallow directive validator; P12g by provider only; service substituted model; unverified cached restriction); one correction batch da4056085; focused recheck (Sonnet) passed all four plus canonical task listing and exact exec deny assertion; npm test 4822 pass, test/core-hook 138/138, test:core-hook 19/19, legacy differential 270/270 identical vs 62a9dd6f8. Open product decisions: directive TTL of 5 minutes was chosen by the builder (spec fixes none); team task open from a linked worktree writes to the main checkout canonical .ai/tasks; the V1 service route accepts only the exact provider+model pair of the directive, else waits (agent not compared, service has no agent concept); with the marker source unreadable, a bound cached restriction counts only if it expires within 5 hours (longest marker window), and with the source readable unverifiable values are ignored even within the same decision (stricter than the V2.2 sentence, per S108 condition B); the activation record writer is T4, so the core answers contract_inactive configured_not_effective until then; P8 is reachable only via an injected reader because exhaustion and scorer read the same ledger file.
- L91 (2026-11-09), user decision verbatim in S113: the four T1 product values are approved as maximums, with conditions. The directive is bound to project, session and attempt and is never reused; T2 tests run in temporary repos only; a service provider+model mismatch waits with a reason and never substitutes; cached negative evidence counts only if current, bound, with verifiable expiry within 5 hours, no TTL renewal on re-read, and an unreadable ledger never proves availability nor admits a linked Reviewer. T2 is authorized in an isolated worktree. Plugin 0.7.5, T3-T4, activation, merge, push and recording pending verdicts are not authorized.
- L92 (2026-11-09), not a user decision: T2 outcome T2_IMPLEMENTED_INACTIVE. The hook applies the core directive (applyDirective, X1-X7, protocol negotiation) with the protocol off by default. Cross-review found five blockers at b057038fa; one correction batch 8d1a95378 fixed them and the focused recheck passed on all five plus intersections. Core bug found by the integrated test: directive target.agent used a descriptive agent name; fixed to the legacy targetAgent. Legacy decision sites (explicitModelVerdict, admissionRefusal, nextCandidate, pacing downgrade, alias fallback, gentle bypass) are kept only on the legacy path; none runs with a valid directive. Accepted residual: a same-user process can rewrite target, candidates and id consistently, outside the spec boundary. Open product decision: first launch of a non-review-* Reviewer with no prior directive while the core is unreachable stays X7 (unchanged, no credit) because the hook has no source for the declared review operation. Open advisory, pre-existing at baseline: a Claude target can keep a fixed Codex agent definition. Plugin version bump, activation switch and activation record writer remain T4. The hook-legacy-differential test reads git history and skips when absent.
- L93 (2026-11-09), user decision verbatim in S114: known Reviewers of the approved team get a conservative deny (ADMISSION_STATE_UNKNOWN) when the core is unreachable, but only on evidence of an effective contract; Builders and unknown roles keep continuity without credit. The existing persisted strategy cannot be read reliably by the hook on a first launch, so a minimal core-written snapshot is specified (section Known-reviewer snapshot, S114) and not implemented. T2 stays IMPLEMENTED_INACTIVE and not accepted; the 8d1a95378 recheck is PASS (L92) and the 4902/4903 full-suite failure stays an unattributed intermittent failure. No install, activation, merge, push or T3.
- L94 (2026-11-09), user decision verbatim in S115: T2 accepted as T2_REVIEWED_INACTIVE_WITH_KNOWN_GAP, not deployed and not operationally accepted. The three snapshot values are approved (24 hours maximum from core-generated evidence, <HARNESS_HOME || HOME>/.harness/reviewer-snapshots.json with serialized or conflict-detected writes, X7 with REVIEWER_SNAPSHOT_COVERAGE_INCOMPLETE for worktrees unknown to the core). One bounded unit implements kairo.reviewer-snapshot/v1 in an isolated worktree, protocol inactive, with a focused independent review; /tmp/x deletion authorized if it is the test-runner file. Full-suite validation gave runs 4901/4903 (two load-dependent sandbox failures: test/readonly-claude-sandbox.test.js:38 and test/readonly-codex-sandbox.test.js:36, a COMMIT_EDITMSG hash diff, passing 3/3 solo on T2 and T1), then 4903/4903 and 4903/4903; not proven pre-existing. No T3-T4, installed plugin change, merge, push, activation or pending verdicts.
- L95 (2026-11-09), not a user decision: T-CORE-HOOK-SNAPSHOT implemented inactive on feat/core-hook-snapshot (commits 77f72eb1f, 05c51addb, fdadabeb6). launchProtocol is off by default; a known Reviewer with a current effective snapshot is denied ADMISSION_STATE_UNKNOWN with the core down (0 launches); other project, sibling prefix, expired, corrupt, ambiguous and unknown worktree give X7 with REVIEWER_SNAPSHOT_COVERAGE_INCOMPLETE. Independent review (Sonnet) PASS, no blockers; 12 concurrent writers x 30 rounds lost no entry; legacy output byte-identical and no snapshot written for projects without admission; npm test 4938/4940 (known readonly sandbox flake, 10/10 alone), test/core-hook 254/254, test:core-hook 19/19, plugin 494/494. Advisories and open items: residual stale-lock race with three or more waiters can lose an entry, degrading only to X7 (reviewer-snapshot.js:124-132); git call inside the lock has no timeout; hook tolerates issuedAt up to 60 s in the future; renewal happens only when the entry is missing, expired or changed (a live identical entry is left alone), reviewer classified consistent with S115, pending Sam's confirmation; real plugin sandbox reading HARNESS_HOME outside HOME unproven; incomplete-coverage marker is a free-text reason prefix until T3; admissionEffective false in real projects until the T4 activation-record writer; negotiated team route now writes the snapshot; symlinked cwd falls to X7; snapshot consulted only when the admission status query also fails.
- L96 (2026-11-09), user decision verbatim in S116: the snapshot renewal policy is approved (live identical entry not rewritten; missing created and expired regenerated only from new core evidence; approval, team or activation change updates; hook read never renews; failed update never extends previous validity; 24 hours maximum; admission enable or disable updates or invalidates the snapshot within that successful operation). The snapshot unit closes as SNAPSHOT_REVIEWED_INACTIVE. The residual lock race and the git call without timeout are robustness debt, not T3 blockers. T3 units T3.1 to T3.5 with invariants A to E are authorized in an isolated worktree with focused independent review and local commits after validation; T4, installed plugin, activation, merge, push and verdict registration stay unauthorized; the 13 pending D files stay untouched.

- L97 (2026-11-09), not a user decision: T-CORE-HOOK-T3 implemented inactive on feat/core-hook-t3 (fdadabeb6..HEAD, 6 commits) and independently reviewed by Sonnet with PASS and no blockers. Forged record-trace and record-launch variants (16) never exceed REVIEWED_PENDING_PROVENANCE; the baseline forged P14 and P12g credit is now withheld as review_trace_mixed. Persistence failures exit 1 with kairo.persistence-failure/v1 and never grant credit or clear exclusions. Reviewer classifications: a lost trace write is visible only on the next successful write, acceptable under invariant D; a surviving admissionEffective true snapshot entry after a failed disable-time invalidation lasts at most 24 h, is restrict-only, and the command exits 1, a product decision for Sam. Advisories: task-authorship.js around line 133 skips unlinked operational/continuity rows even when an R1/R2 relation (parentExecutionId to a linked writer) holds, so such a row loses the related-anomaly hold and exclusion (forged or CLI input only; the real hook keeps taskId on handover); the hook ignores record-launch exit codes (register.ts around line 936), so a ledger-only loss is never counted in priorFailures and the stderr marker has no consumer; a corrupt snapshot file makes admission disable exit 0; team exec rows stay legacy class and class-neutral.

- L98 (2026-11-09), user decision verbatim in S117: the 24 h snapshot window left after a failed disable-time invalidation is accepted as a known availability degradation, not an S5 independence breach (the disabled contract stays source of truth, the command exits 1, the old snapshot is restrict-only, and a verified disablement prevails per OD-C1). Findings F1 and F2 were fixed in one batch (f9b881d1c) and independently reviewed with PASS on the five points. Advisory: the ledger-failure toast shares the traceFailures counter and the 1/5/25/125 cadence with trace failures, so a first ledger failure may not toast, though it is still counted in priorFailures. The reviewer did not run a byte-level legacy comparison for this batch (diff scope plus passing legacy tests). T4 is not authorized.

- L99 (2026-11-09), user decision verbatim in S118: T4 integration approved in an isolated worktree (feat/core-hook-t4 from f9b881d1c); the 13 files of D are reconciliation material, not an approved unit, and no parallel decision path (routeAuthority, explicitModelVerdict, handovers) may return to the governed path. The cross-provider review must use a provider other than the Builder (Builder is Claude Sonnet). Codex weekly quota is about 6% until it resets on 2026-11-10, so the review may wait for the reset or use another eligible non-Claude provider without Astra. Expected state T4_INTEGRATED_INACTIVE_REVIEWED only if validations pass.
- L100 (2026-11-09), user decision verbatim in S119: the independent T4 review is deferred until the Codex quota reset on 2026-11-10 and will use gpt-6.1-sol, no Astra, no other provider, no automatic fixes. Review scope is the real diff of feat/core-hook-t4 and its execution paths: F1 (high), F2 (critical) and F3 (critical), each classified BLOCKER, ADVISORY or NOT_REPRODUCED with evidence; hook timeout behavior and not only the median latency (1357 ms observed under load against the 2000 ms limit); legacy behavior with admission configured but not activated; authority bypass and improper credit risks. Unattributed observation, not a finding: during T4 the real ~/.harness top-level mtime changed because huggingface-leaderboard.json and codex-models-last-good.json were rewritten while tests ran under a scratch HOME; sessions/ and reviewer-snapshots.json are unchanged; this may be a live-session background refresh but is not proven. No kairo sync and no extra refresh will be run. Deployment, install and activation remain blocked; the 11 T4 commits and the 13 D files stay intact.
- L101 (2026-11-09), user decision verbatim in S125: T4 boundary scope is limited to governable execution (delegated work for managed tasks and roles passes the execution boundary; quick-ask, entitlement/auth probes, metadata queries and normal interactive continuation do not, but respect confirmed exhaustion). An adapter that does not implement the boundary cannot be announced as governed and runs in compatibility mode without credit or stays out of the version. The MVP is defined by seven minimum capabilities and excludes remote VERIFIED attestation and universal host compatibility; T6-T11 are not required unless indispensable. A finding blocks release only if it meets one of four closure consequences, otherwise it is known debt; F1-F13 are grouped accordingly and milestones A-D define delivery. The 13 D files are historical backup only. Implementation remains unauthorized; the next decision is approval of the MVP plan.
- L102 (2026-11-09): OD-MVP-1 approved the MVP plan, added M16 (context) and M17 (panel), fixed release/v0.3.0 and version 0.3.0 (0.3.0-beta.1 pilot), and authorized Milestone A MA1-MA7 plus baselines; the MVP plan is tracked in odd/tasks/kairo-runtime-mvp.md.
- L103 (2026-11-09): OD-MVP-VERSION replaced the invalid 0.3.0 target (already published in July 2026; current 0.36.0) with 0.37.0, branch release/v0.37.0, pilot 0.37.0-beta.1; tracked in odd/tasks/kairo-runtime-mvp.md.
