Objective: Kairo Runtime 0.37.0, first governed release, under the release contract fixed by S125 of odd/tasks/router-provider-authority.md and approved as OD-MVP-1 (L2).
Branch: release/v0.37.0 approved as future integration target (not created; no automatic worktree merge, no contract activation, no plugin install, no publish authorized). Versions: 0.37.0-beta.1 for the pilot, 0.37.0 after exit criteria (OD-MVP-VERSION, L4; replaces the invalid 0.3.0 target of OD-MVP-1). Release branch creation, package version change, npm publish, merge and push are NOT authorized. Source decisions: S125 / L101 in odd/tasks/router-provider-authority.md, OD-MVP-1 (L2 below), OD-MVP-VERSION (L4 below).
Delivery: ask-on-risk. Test runner: `npm test` (node --test); plugin tests under `integrations/claude-code/kairo-router`.

## Specs

Quotes are Sam's exact strings from S125 and OD-MVP-1. Anything not stated by Sam is marked "Assumption".

- M1 (governable execution scope): "Todo lanzamiento que ejecute trabajo delegado para una tarea o un rol gestionado por Kairo debe pasar por la frontera de ejecución." and "Pero no toda interacción con un modelo constituye trabajo gobernable."

  | Tipo de ejecución                                     | ¿Frontera obligatoria?               |
  | ----------------------------------------------------- | ------------------------------------ |
  | Builder, Reviewer, Architect con trabajo delegado     | Sí                                   |
  | `team exec`, servicio, `startRun` y hooks compatibles | Sí                                   |
  | Planning asociado a una tarea gestionada              | Sí                                   |
  | Review-runner y minions gestionados por Kairo         | Sí, cuando ejecuten trabajo delegado |
  | Continuación de una tarea gestionada                  | Sí                                   |
  | Continuación normal de una conversación interactiva   | No                                   |
  | `quick-ask`                                           | No                                   |
  | Sondas de entitlement y autenticación                 | No                                   |
  | Consultas de metadatos o capacidades                  | No                                   |

- M2 (auxiliary probes): "Las sondas y consultas auxiliares no necesitan recorrer `decideLaunch()`, pero deben respetar las restricciones de agotamiento confirmadas que sean aplicables. No vamos a construir otro sistema de admisión para ellas." and "La frontera gobierna trabajo delegado, no cada llamada a un LLM."
- M3 (non-governed adapters): "si un adaptador todavía no implementa esa frontera, no puede anunciarse como integración gobernada. Puede seguir funcionando en modo de compatibilidad sin crédito, o quedar fuera de las capacidades habilitadas de esa versión." and "Esto evita que T4 se convierta en una reescritura de todas las integraciones."
- M4 (MVP definition): "Kairo Runtime — Primera versión pública funcional": "Un runtime de orquestación que pueda instalarse en un proyecto nuevo o existente, utilizar proveedores compatibles, coordinar trabajo delegado y aplicar gobernanza sin reemplazar el host elegido."

  Capacidades mínimas
  - "Instalación y configuración inicial reproducibles."
  - "Funcionamiento en proyectos con y sin configuración previa de Kairo."
  - "Routing multi-proveedor con disponibilidad y motivos de exclusión explícitos."
  - "Delegación de Builders y Reviewers mediante las integraciones soportadas."
  - "Independencia por tarea, con estados provisionales cuando falte evidencia."
  - "Compatibilidad cuando Kairo esté deshabilitado."
  - "Diagnóstico, recuperación y desinstalación sin romper el host."

  "No incluye acreditación remota `VERIFIED`, compatibilidad universal con todos los hosts ni todas las capacidades avanzadas del roadmap."
- M5 (T6-T11): "No es necesario terminar T6–T11 para publicar, a menos que alguna capacidad de esas etapas resulte indispensable para cumplir el contrato mínimo."
- M6 (finding grouping): "Identidad y reutilización" F1, F2, F3, F4, F8: "Bloqueantes para activar el protocolo". "Fallos de contrato y agotamiento" F5, F6: "Bloqueantes para la gobernanza soportada". "Resolución de proyecto" F7: "Confirmar en el flujo real; el helper solo no demuestra impacto completo". "Otras rutas de ejecución" F9: "Clasificar por operación: gobernable o auxiliar". "Rutas no reproducidas" F10, F11: "No bloquear publicación únicamente por hipótesis". "Reportes y rendimiento" F12, F13: "Corregir afirmaciones y establecer pruebas de rendimiento".
- M7 (hook budget): "También debemos resolver el recorrido del hook que acumuló 3612 ms. No podemos publicar una integración que supere habitualmente su presupuesto de ejecución; pero la solución debe ser reducir consultas redundantes, no crear otro protocolo completo."
- M8 (closure rule): "Un hallazgo sólo bloquea la primera versión si demuestra una de estas consecuencias:"
  - "Ejecuta un modelo o una tarea en contradicción con una restricción obligatoria del producto."
  - "Acredita independencia, admisión o ejecución sin evidencia suficiente."
  - "Rompe una ruta principal soportada de instalación, trabajo o recuperación."
  - "Provoca una regresión reproducible de compatibilidad, estabilidad o rendimiento que impide el uso normal."

  "Si no cumple alguna de esas condiciones, se clasifica como deuda conocida, se documenta y no impide publicar." and "Esto no significa ignorar defectos de seguridad; significa no convertir cada caso hipotético, cada integración futura y cada mejora posible en un requisito de lanzamiento."
- M9 (milestone A): "Hito A — Cerrar la frontera mínima": "Corregir los defectos reproducidos de las rutas gobernables soportadas. Validar contra entradas reales y un conjunto fijo de pruebas de aceptación. No ampliar automáticamente el alcance ante nuevas hipótesis."
- M10 (milestone B): "Hito B — Integración instalable": "Consolidar worktrees, preparar el paquete y comprobar instalación desde cero, actualización, desactivación y funcionamiento sin Kairo en proyectos existentes."
- M11 (milestone C): "Hito C — Piloto real": "Probar proyectos temporales nuevos y existentes, al menos con las rutas Claude Code y Codex que se anuncien como soportadas. Medir el routing, la independencia, los fallbacks y la latencia con activación controlada."
- M12 (milestone D): "Hito D — Publicación": "Documentación de instalación, compatibilidad, limitaciones, troubleshooting, versión etiquetada y paquete publicado. Después, roadmap de mejoras separado."
- M13 (plan content and exclusions): "El plan debe utilizar los defectos F1–F13 y el código ya construido. Debe identificar qué bloquea realmente la publicación, qué puede quedar fuera, qué integraciones vamos a anunciar inicialmente y qué evidencia necesitamos para declarar cada hito completo." and "No quiero más rondas de diseño generales, nuevos subsistemas de seguridad ni infraestructura de observabilidad por anticipado."
- M14 (D files): "Tampoco quiero que los 13 archivos abandonados de D sigan siendo un objetivo de integración. Ya determinamos que el protocolo nuevo reemplaza aquella implementación; deben conservarse como respaldo histórico, no como otra deuda de código que obligatoriamente haya que fusionar."
- M15 (authorization, S125): "Autorizo registrar esta decisión de alcance y preparar un plan cerrado de entrega del MVP, pero todavía no otra implementación." Superseded for Milestone A by OD-MVP-1 (see M18-M20 and L2).
- M16 (context optimization, OD-MVP-1 section 2):

  "## 2. Nuevo requisito M16 — Optimización del contexto"

  "La pérdida de contexto que describes merece prioridad."

  "Ejemplo reportado: primera tarea tras iniciar sesión" "100% → 86%" "−14 puntos"

  "Es una caída de contexto disponible, no necesariamente 14% de cuota de suscripción consumida ni 14% atribuible a Kairo."

  "Sabemos que anteriormente C1 consiguió reducir una carga inicial de aproximadamente 63k a 7.8k tokens para una ruta de Builder. Eso demuestra que existen oportunidades importantes."

  "Ahora debemos medir el costo de arranque de una sesión completa, no sólo el de un subagente."

  "M16 debe cubrir:"
  - "Instrucciones globales y archivos `CLAUDE.md` / `AGENTS.md`."
  - "Contexto añadido por Kairo y Gentle AI."
  - "Duplicación de instrucciones entre host, agentes y plugins."
  - "Descripciones de herramientas, MCP y capacidades cargadas inicialmente."
  - "Contexto necesario para iniciar una tarea frente a contexto que puede recuperarse bajo demanda."
  - "Comparación con Kairo habilitado, deshabilitado y sin instalar."

  "La medición debe separar el contexto inicial del consumo propio de la primera tarea. Propongo buscar una reducción de al menos el 50% de la sobrecarga inicial atribuible a Kairo, sin eliminar controles esenciales. Si el 14% proviene mayoritariamente de otros componentes, debemos reportarlo, no atribuírselo artificialmente al runtime."

  "No necesitamos inventar otro sistema de memoria ni un nuevo mecanismo de compactación."

  Closure for the MVP: defined by M34 (OD-MVP-M16 PRODUCT_OPTIMIZATION_SCOPE_APPROVED).

- M17 (panel redesign, OD-MVP-1 section 3):

  "## 3. Nuevo requisito M17 — Rediseño del panel"

  "La captura confirma que el panel actual no funciona como un resumen operativo."

  "Sus problemas visibles son concretos: muestra un rol `Unknown`, tiempos de espera desconocidos, `opencode-go: unavailable`, modelos asignados a varios roles y después una lista de 73 veredictos que ocupa prácticamente toda la pantalla."

  "Un panel de estado no debe comportarse como un volcado de logs."

  "### Propuesta visual para la primera versión"

  Proposed view (Sam's mockup, quoted): "KAIRO RUNTIME" "Vista propuesta"; "CLAUDE · 5H" "80%" "Semana 92%"; "CODEX · 5H" "31%" "Semana 89%"; "Agentes y routing" "Vista resumida": "Technical Lead" "Astra · Codex", "Builder" "Sin ruta elegible", "Reviewer" "Astra · Codex"; "Veredictos pendientes" "73"; "Los detalles, historiales y errores completos se consultan bajo demanda." "Mockup basado en los valores de la captura, no en una lectura actual del sistema."

  "Este panel debe tener dos niveles: una vista compacta que informe lo esencial y una vista detallada para diagnóstico."

  "M17 también debe corregir la semántica: `Unknown` no puede presentarse como si fuera un rol asignado; `waiting until unknown` debe convertirse en una razón comprensible; los roles no deben multiplicarse por cada ejecución histórica; y las cuotas deben mostrar su fecha de actualización y si el dato está vencido."

  "El panel debe consumir una fuente de estado existente. No construiremos otro motor de monitoreo para dibujarlo."

- M18 (work rule, OD-MVP-1 section 6):

  "## 6. La nueva regla de trabajo"

  "A partir de ahora quiero que cada tarea tenga tres elementos obligatorios: resultado funcional, prueba de aceptación y condición de cierre."

  "Una vez que esos tres se cumplen, la tarea se cierra. Si aparece una mejora no bloqueante, va al backlog de una versión posterior."

  "No quiero que una revisión de seguridad o arquitectura genere automáticamente cinco nuevos requisitos y retrase indefinidamente la publicación."

  Every task below carries Result, Acceptance and Closure. Non-blocking improvements go to the later-version backlog, never into this list.

- M19 (updated release priority, OD-MVP-1 section 4):

  "## 4. MVP actualizado: qué sí y qué no bloquea publicar"

  | Bloque                                                     | Prioridad de release                               |
  | ---------------------------------------------------------- | -------------------------------------------------- |
  | Instalación limpia, actualización y desinstalación         | Obligatorio                                        |
  | Uso en proyectos nuevos y existentes                       | Obligatorio                                        |
  | Continuidad cuando Kairo está deshabilitado o no instalado | Obligatorio                                        |
  | Routing funcional Claude/Codex y Builder elegible          | Obligatorio                                        |
  | Gobernanza de las rutas oficialmente soportadas            | Obligatorio                                        |
  | Contexto inicial controlado — M16                          | Obligatorio                                        |
  | Panel compacto, correcto y legible — M17                   | Obligatorio                                        |
  | Proveedores adicionales                                    | Evolución posterior                                |
  | Acreditación remota `VERIFIED`                             | Evolución posterior                                |
  | Todas las tareas T6–T11                                    | Sólo las indispensables para los contratos del MVP |
  | Optimizaciones adicionales y nuevas interfaces             | Evolución posterior                                |

  "No prometeremos que Kairo gobierna todos los hosts si todavía sólo hemos validado dos. Pero un proyecto que no utilice Kairo debe seguir funcionando normalmente, y uno que lo instale debe poder empezar sin configurar manualmente toda nuestra arquitectura."

- M20 (resolved points, OD-MVP-1 section 1):

  "## 1. Los tres puntos pendientes"

  | Decisión                  | Resolución                                                                                              |
  | ------------------------- | ------------------------------------------------------------------------------------------------------- |
  | Rendimiento del hook      | Aprobado: p95 inferior a 2000 ms en el recorrido completo                                               |
  | Rama de release           | `release/v0.3.0`                                                                                        |
  | Integraciones gobernadas  | Claude Code y Codex CLI, condicionadas a superar sus pruebas reales                                     |
  | Integraciones compatibles | OpenCode, Pi, Cursor, Gemini y adaptadores genéricos, únicamente donde exista compatibilidad comprobada |

  "Como Kairo ya tiene una versión pública 0.2.2, propongo que la primera versión con gobernanza sea 0.3.0, comenzando con `0.3.0-beta.1` para el piloto y publicando `0.3.0` al superar los criterios de salida."

  "Una precisión sobre el rendimiento: el presupuesto de 2000 ms debe abarcar la operación completa, no 2000 ms por cada consulta. Los timeouts internos deben reservar margen para que la operación termine de manera controlada."

  "Superseded by OD-MVP-VERSION (M22): version 0.37.0, branch release/v0.37.0." The version and branch rows above are Sam's words at the time and are kept verbatim; the published 0.3.0 and 0.3.1 (July 2026) made 0.3.0 invalid.

  Pointer: the 2000 ms threshold above is qualified by M28 (M20 exception and MA5 rollback).

- M21 (M16 knowledge-tool addendum, Sam's follow-up, L3):

  Tool roles:

  | Herramienta | Responsabilidad                                                      | Prioridad para MVP                           |
  | ----------- | -------------------------------------------------------------------- | -------------------------------------------- |
  | Engram      | Memoria persistente de decisiones, avances y contexto entre sesiones | Alta — ya lo utilizamos                      |
  | CodeGraph   | Comprensión estructural del código, dependencias y relaciones        | Alta — aprovechar la integración existente   |
  | Graphify    | Representación y exploración de relaciones del proyecto              | Evaluar si aporta algo adicional a CodeGraph |
  | Context7    | Documentación técnica actualizada, recuperada bajo demanda           | Alta — integración selectiva                 |
  | Obsidian    | Base de conocimiento legible y organizada a largo plazo              | Posterior — opcional                         |

  "La regla es sencilla: primero identificar qué necesitamos; después recuperar el contexto. No cargar toda la documentación, todos los grafos y todas las memorias al iniciar la sesión."

  "Para el MVP definiría cuatro medidas:"
  1. "Bootstrap mínimo: auditar `CLAUDE.md`, `AGENTS.md`, agentes, skills y herramientas MCP para eliminar instrucciones duplicadas y carga innecesaria."
  2. "Engram compacto: guardar decisiones y punteros a documentos, no copias completas de las especificaciones ODD."
  3. "Recuperación bajo demanda: CodeGraph para navegar código y Context7 para documentación externa, cuando la tarea lo justifique."
  4. "Presupuesto por tarea: medir cuánto contexto se añadió, de dónde provino y si se utilizó."

  "Y mediría tres momentos por separado: contexto inmediatamente después de iniciar, después de preparar la primera tarea y al terminarla. Así podremos saber si esa caída de 100% a 86% proviene de instrucciones iniciales, herramientas o trabajo real."

  "Para declarar M16 terminado no necesitamos integrar todas las herramientas. Necesitamos demostrar que Kairo:"
  - "No carga información innecesaria en cada sesión."
  - "Recupera contexto relevante cuando hace falta."
  - "No duplica masivamente instrucciones y memorias."
  - "Mantiene sus controles de seguridad al optimizar."
  - "Reduce de forma medible la sobrecarga de contexto respecto a una línea base comparable."

  "Mi decisión para el MVP 0.3.0: conservar las cinco opciones en la estrategia de conocimiento, pero hacer obligatorio el resultado de optimización, no la instalación de todas."

- M22 (version, OD-MVP-VERSION, L4): current published version is 0.36.0 (package @kal-elsam/kairo-runtime, tag kairo-runtime-v0.36.0). 0.3.0 and 0.3.1 were already published in July 2026, so the 0.3.0 target was invalid. Not authorized by this decision: release branch creation, package version change, npm publish, merge and push.

  "Elegimos `0.37.0`, con `release/v0.37.0` como rama y `0.37.0-beta.1` como primera versión piloto."

  | Elemento                 | Decisión                                     |
  | ------------------------ | -------------------------------------------- |
  | Versión actual reportada | `0.36.0`                                     |
  | Próxima versión objetivo | `0.37.0`                                     |
  | Rama de integración      | `release/v0.37.0`                            |
  | Primer prerelease        | `0.37.0-beta.1`                              |
  | Versión pública estable  | `0.37.0`, tras superar los criterios del MVP |
  | `1.0.0`                  | Se evaluará posteriormente                   |

  "### Condiciones para publicar"

  "La versión `0.37.0` debe entregar un producto instalable y funcional, con:"
  - "Routing y gobernanza comprobados para Claude Code y Codex CLI."
  - "Funcionamiento en proyectos nuevos, existentes y sin configuración previa."
  - "Optimización de contexto medible (M16)."
  - "Panel operativo claro y legible (M17)."
  - "Instalación, actualización, recuperación y desinstalación verificadas."
  - "Limitaciones documentadas para integraciones todavía no gobernadas."

  "La versión no tiene que ser perfecta, pero las capacidades anunciadas deben funcionar."

  "### Qué autorizo ahora"

  "Autorizo actualizar el plan MVP, sus referencias de release y la documentación para sustituir `0.3.0` por `0.37.0`."

  "También autorizo continuar MA1 cuando termine la validación de la línea base, según el alcance previamente aprobado."

  "No autorizo todavía crear la rama de release, cambiar la versión del paquete, publicar en npm ni realizar merge o push. Eso corresponde a los hitos de integración y entrega."

- M23 (OD-MVP-MA1b, L5): "Confirmo que la Regla B de S124 exige tolerancia cero para directivas emitidas en el futuro." Condition:

  ```
  issuedAt <= now &&
  now < expiresAt &&
  expiresAt - issuedAt <= 300_000
  ```

  Conditions of the MA1b batch (limited to F3 and F8):

  "- Eliminar la tolerancia de 60 segundos tanto del core como del validador del hook.
  - Actualizar los tests de paridad y añadir el caso `issuedAt = now + 1 ms`.
  - Evitar reutilizar una directiva cuando haya surgido una restricción de agotamiento nueva y vigente que la contradiga.
  - No extender la corrección a otros componentes ni modificar la arquitectura del protocolo."

  Review: "Para la siguiente revisión, autorizo utilizar la invocación directa de Codex, sin ese wrapper, y exigir que el informe identifique el commit y los archivos exactos inspeccionados. Si no coincide, el resultado se descarta."
- M24 (BYOK Artificial Analysis onboarding, release-mandatory, L5): "Confirmo que el onboarding inicial debe permitir que cada usuario configure su propia API key de Artificial Analysis (AA)."

  "Esto debe funcionar tanto en una instalación limpia como al configurar Kairo posteriormente:
  - Clave personal opcional, sin credenciales compartidas incluidas en el paquete.
  - Almacenamiento local seguro, nunca dentro del repositorio ni de las trazas.
  - Comprobación explícita de la clave y explicación de errores de acceso.
  - Funcionamiento degradado si no existe clave, sin inventar rankings o datos actuales.
  - Separación entre la API de evaluación de modelos y las suscripciones de Claude/Codex utilizadas para ejecutar trabajo."

  "La ausencia de una API key de AA no debe impedir instalar ni utilizar las funciones básicas de Kairo."
- M25 (external references, not dependencies, L5): Sam's table:

  | Proyecto | Qué podemos aprovechar | Decisión MVP |
  | -------- | ---------------------- | ------------ |
  | Ponytail (https://github.com/DietrichGebert/ponytail) | Minimización de código, medición de tokens, tests y revisión enfocada | Referencia prioritaria para M16 y calidad |
  | Taste Skill (https://github.com/Leonxlnx/taste-skill) | Criterios de diseño visual y validación en navegador | Referencia para el panel M17 |
  | pstack (https://github.com/cursor/plugins/blob/main/pstack/README.md) | Playbooks de ingeniería, verificaciones y flujo multi-modelo | Reutilizar ideas; evitar duplicar Gentle AI |
  | MCP Gateway (https://github.com/Samuel-Mencke/mcp-gateway) | Capacidades MCP bajo demanda y acceso unificado | Evaluación posterior; no introducir otro servicio obligatorio |

  "Ponytail publica resultados de reducción de tokens y código en sus benchmarks, pero esas cifras son propias de sus pruebas: no debemos asumir el mismo ahorro en Kairo sin medirlo."

  "No autorizo instalar automáticamente los cuatro proyectos externos ni añadirlos como dependencias del runtime."
- M26 (execution order, L5):

  "1. Cerrar MA1b — F3/F8, con tests deterministas.
  2. Obtener una revisión independiente auténtica de MA1/MA1b sobre el commit correcto.
  3. Continuar MA2 y los bloqueantes restantes del runtime.
  4. Incluir onboarding BYOK, ahorro de contexto, calidad de tests y panel compacto en los criterios de salida del MVP.
  5. Mantener las herramientas externas como referencias hasta demostrar que incorporarlas aporta valor medible."

- M27 (orchestration strategies, OD-MVP-ORCHESTRATION, L8):

  "`OD-MVP-ORCHESTRATION — THREE_PATTERNS_REQUIRED`"

  "Las tres estrategias serán capacidades verificables de Kairo Runtime 0.37.0, usando los mecanismos existentes:"

  - "No crear un nuevo workflow engine."
  - "No duplicar la selección de proveedores."
  - "No requerir paralelismo cuando las tareas tienen dependencias."
  - "No permitir que la ejecución paralela eluda cuotas, admisión o revisión por tarea."

  "El objetivo es que Kairo seleccione cómo organizar el trabajo según las dependencias reales y cómo asignarlo según los recursos disponibles. Eso es más importante que agregar más modelos o más agentes."

  "No deberíamos obligar al usuario a elegir un modo global. Kairo debe poder combinar las tres estrategias dentro de una misma ejecución."

  "Por ejemplo:"

  1. "Secuencial: Architect define tres tareas."
  2. "Paralelo: tres Builders trabajan en tareas independientes."
  3. "Routing: cada Builder se asigna al proveedor/modelo elegible."
  4. "Secuencial por tarea: cada implementación pasa por su Reviewer independiente, respetando S5."
  5. "Integración: se consolidan los resultados y se validan las dependencias."

  "El orquestador host conserva el control. Kairo gestiona decisiones operativas y admisión, sin introducir un segundo orquestador maestro."

  "Propongo añadir una matriz de aceptación al MVP, no un motor nuevo de workflows. Tres escenarios de integración bastan para demostrar estas estrategias inicialmente, incluyendo fallos, cuotas y revisión cruzada."

- M28 (M20 exception and MA5 rollback, OD-MVP-MA5 ROLLBACK_APPROVED, L11): Sam's section 3, verbatim:

  "No podemos declarar M20 cumplido si su contrato exige que todos los recorridos terminen antes de 2000 ms."

  "Sin embargo, un p95 inferior a 2000 ms tampoco exige que absolutamente todas las ejecuciones individuales estén debajo de ese límite."

  "Para el MVP establezco esta distinción:"

  - "Rendimiento normal: debe cumplir el p95 inferior a 2000 ms, medido con una carga representativa y muestras suficientes."
  - "Degradación por core lento: queda como excepción documentada F13, con tiempos observados de hasta 4331 ms."
  - "Seguridad: cualquier fallo de comunicación debe conservar las restricciones de admisión y no producir lanzamientos indebidos."

  "El plan deberá reflejar expresamente esta excepción; no debemos presentar el límite de 2000 ms como una garantía universal. Si el p95 representativo falla o la degradación provoca problemas operativos importantes, M20 seguirá bloqueando la publicación."

  Sam's section 2 table:

  | Elemento                           | Decisión             |
  | ---------------------------------- | -------------------- |
  | Optimización MA5                   | Revertida            |
  | Transporte serializado             | Sin cambios          |
  | Consulta redundante                | Se conserva          |
  | Latencia degradada de 3612–4331 ms | Problema conocido    |
  | Nueva concurrencia en el runner    | No autorizada        |
  | Modificación del protocolo         | Fuera del MVP actual |

- M29 (MA4b targeted completion, OD-MVP-MA4b, L13): Sam's "Alcance autorizado" table, verbatim:

  | Hallazgo                                           | Decisión  | Criterio de cierre                                                                            |
  | -------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
  | 1. Cursor Auto y bootstrap ASK pierden el proyecto | Corregir  | Las ejecuciones auxiliares reciben el proyecto de origen y respetan su agotamiento confirmado |
  | 3. Fallo del lazy import                           | Corregir  | Devuelve un resultado tipado, sin excepción inesperada ni lanzamiento que evada restricciones |
  | 4. Tests incompletos                               | Completar | Cubrir Cursor con su marcador correcto, OpenCode Zen y los callers reales de bootstrap        |
  | 2. Detección Git frágil                            | `KD12`    | Documentar limitación y reproducción; no modificar MA3                                        |

  Sam's "Restricciones de MA4b" list, verbatim:

  - "No introducir un nuevo Router ni otro sistema de gobernanza."
  - "No convertir `quick-ask` o las sondas en lanzamientos gobernados por V1."
  - "No añadir consultas adicionales al core para cada ejecución auxiliar si la evidencia vigente ya está disponible."
  - "No modificar las reglas de agotamiento, crédito o clasificación."
  - "No instalar dependencias nuevas."

  "La propagación de identidad debe utilizar los mecanismos existentes y no permitir que el llamador falsifique un proyecto distinto para eludir una restricción."

  Sam's "Validación y cierre" section, verbatim:

  "Exijo tests específicos que demuestren que Cursor Auto, bootstrap ASK y OpenCode Zen respetan los marcadores correspondientes, además de comprobar que los errores de importación se manejan de forma tipada."

  "Después:"

  1. "Ejecutar pruebas focalizadas y suite completa fuera del sandbox restrictivo."
  2. "Obtener una revisión cruzada independiente y acotada al diff de MA4b."
  3. "Si no hay bloqueantes, registrar el commit local y cerrar MA4."
  4. "Continuar inmediatamente con M16 — Optimización de contexto y tokens."

  "Los tests intermitentes preexistentes se registrarán separadamente; no reabriremos MA4 por hallazgos ajenos a su contrato."

  Sam's "Sobre el ritmo del MVP" paragraph, verbatim:

  "Quiero establecer un límite adicional: MA4b es el último lote correctivo autorizado para esta unidad. Si la revisión descubre un nuevo problema, deberá demostrar que incumple directamente un criterio de publicación para bloquear el cierre. Las mejoras de robustez no críticas irán al backlog."

- M30 (M16 measurement method and success criteria, OD-MVP-M16, L17, L18): two decisions by Sam, quoted fragments verbatim. From `OD-MVP-M16 — MEASUREMENT_PILOT_APPROVED`:

  "Además, la medición debe distinguir entre tokens de entrada, caché creada, caché reutilizada y tokens de salida. El `usage` del JSON puede ser útil, pero no debemos confundirlo automáticamente con el tamaño total de la ventana de contexto."

  "La comparación debe separar:"

  - "Host base, sin Kairo."
  - "Kairo instalado pero deshabilitado."
  - "Kairo habilitado."

  "Después podremos realizar ablaciones de Gentle AI, Engram, CodeGraph y MCP, manteniendo constante la tarea. Obsidian, Graphify y Context7 sólo deben incluirse cuando realmente estén cargados en la configuración medida."

  "Para distinguir el arranque del costo de la primera tarea, tendremos que preservar una misma sesión entre los momentos de medición, no tratar tres ejecuciones independientes como si fueran una continuación."

  Success criteria table:

  | Métrica                  | Objetivo                                    |
  | ------------------------ | ------------------------------------------- |
  | Tokens iniciales         | Reducir la sobrecarga innecesaria           |
  | Tokens añadidos por Kairo | Medirlos y minimizarlos                    |
  | Duplicación de instrucciones | Eliminar contenido redundante comprobado |
  | Calidad de ejecución     | Mantener tests y comportamiento             |
  | Continuidad entre sesiones | Recuperar sólo el contexto relevante      |
  | Cuota consumida          | Comparar costo real y uso de caché          |

  "No debemos optimizar únicamente para consumir menos tokens. Si eliminamos información esencial y los agentes necesitan más intentos para terminar una tarea, la optimización habrá fracasado."

  "No autorizo todavía modificar `CLAUDE.md`, `AGENTS.md`, los hooks de Gentle AI, Engram ni la configuración de MCP."

  From `OD-MVP-M16 — CONTROLLED_LIVE_PILOT_APPROVED`:

  "Autorizo una única corrida piloto con la configuración real de Claude Code, incluyendo los hooks normales de Kairo y Engram."

  "Acepto expresamente las escrituras operativas habituales: registro de sesión de Engram y trazas de Kairo."

  "El resultado será una línea base instrumental, no una medición definitiva del ahorro de tokens."

  "No autorizo todavía la matriz de 27 corridas ni la eliminación de instrucciones."

- M31 (M16 controlled comparison, OD-MVP-M16, L19): decision by Sam, quoted fragments verbatim. From `OD-MVP-M16 — CONTROLLED_COMPARISON_APPROVED`:

  "Elijo fijar explícitamente Sonnet 5.5 y utilizar un modo de permisos restrictivo para la comparación controlada."

  State definitions:

  - "A — Kairo habilitado": "Host + Gentle AI + Engram + MCP + Kairo operativo."
  - "B — Kairo deshabilitado": "Configuración equivalente, pero sin ejecución de Kairo."
  - "C — Sin Kairo": "Sin plugin ni instrucciones gestionadas por Kairo, comprobado mediante el evento `init`."

  "Los estados B y C sólo son válidos si los flags realmente producen esas diferencias. Si simularlos requiere modificar la instalación real, detener esa configuración en lugar de etiquetar una medición incorrectamente."

  "No sumar indiscriminadamente tokens de caché y tokens de salida para representar la ocupación de contexto. Tampoco presentar una sola corrida por estado como ahorro estadísticamente demostrado."

  "Autorizo únicamente estas tres mediciones iniciales. Sin cambios permanentes de configuración, instalaciones ni optimizaciones todavía."

  "El criterio de M16 será demostrar un ahorro reproducible, manteniendo calidad y funcionalidad. No quiero que optimicemos un benchmark artificial y empeoremos el trabajo diario con Kairo."

- M32 (M16 MCP ablation and direction, OD-MVP-M16, L20): decision by Sam, quoted fragments verbatim. From `OD-MVP-M16 — MCP_ABLATION_APPROVED`:

  "Sí. Autorizo una única corrida de ablación de MCP utilizando `--strict-mcp-config`, sin modificar archivos ni la configuración productiva."

  "No basta con pasar el flag. El evento `init` debe confirmar que efectivamente se redujeron los servidores y herramientas MCP."

  "Importante: no podemos atribuir toda la diferencia de tokens a MCP si también cambian plugins, instrucciones o hooks. Tampoco debemos confundir tokens procesados con la ocupación exacta de la ventana de contexto."

  "Si confirmamos que MCP representa una parte importante del arranque, la solución que evaluaremos para M16 será descubrimiento y activación selectiva de capacidades, no eliminar herramientas arbitrariamente."

  "Aquí también debemos considerar Engram, CodeGraph, Graphify y Context7: recuperar sus capacidades cuando la tarea las necesite, evitando cargar esquemas e instrucciones redundantes."

  "No autorizo construir todavía un MCP Gateway propio ni incorporar otro servidor obligatorio."

  "Nuestro objetivo no es sólo reducir el contexto inicial: es hacer que Kairo utilice menos tokens sin perder capacidades, calidad de ejecución ni continuidad entre sesiones."

- M33 (M16 instruction deduplication measurement, OD-MVP-M16, L21): decision by Sam, quoted fragments verbatim. From `OD-MVP-M16 — INSTRUCTION_DEDUPLICATION_APPROVED`:

  "Elijo la opción 1: medir primero la duplicación de `AGENTS.md`. Autorizo una prueba controlada mediante copias temporales, sin modificar tu instalación real."

  "Antes de interpretar la diferencia, verificar que ambas corridas carguen realmente el archivo temporal previsto y no el `AGENTS.md` del home."

  "Si no podemos garantizarlo, cancelar el experimento. No autorizo editar ni renombrar los archivos originales, aunque sea temporalmente."

  "No debemos extrapolar el ahorro a todos los subagentes a partir de estas dos ejecuciones."

  "Optimizar tu entorno: eliminar duplicaciones entre Gentle AI, `CLAUDE.md` y `AGENTS.md`."

  "Optimizar Kairo Runtime 0.37.0: evitar que Kairo introduzca cargas innecesarias y asegurar que su instalación funcione eficientemente para cualquier usuario, incluso sin Gentle AI."

  "No quiero que el MVP dependa de modificar archivos personales de cada desarrollador."

  "Si se confirma un ahorro importante, prepararemos una propuesta mínima de deduplicación con respaldo y verificación de que no desaparecen reglas necesarias. La aplicación sobre tu instalación real requerirá autorización separada."

  "Por ahora, no autorizo repetir A/B/M, implementar activación selectiva de MCP ni modificar el runtime."

- M34 (M16 product optimization scope and closure, OD-MVP-M16 PRODUCT_OPTIMIZATION_SCOPE_APPROVED, L24, L25): decision by Sam, quoted fragments verbatim. Registers MA20 to MA22 for planning only; implementation is not authorized. Defines the criteria under which M16 can be closed for the MVP (below); M16 is not closed by this decision.

  "Apruebo B1 y B2 como tareas del MVP 0.37.0, con un alcance limitado. Autorizo registrarlas en el plan y definir sus criterios de aceptación, pero todavía no implementarlas."

  "Hay algo importante en los resultados: Kairo no debería intentar resolver todos los problemas de contexto del ecosistema. Debe controlar su propio consumo y ayudar al usuario a identificar oportunidades de ahorro."

  Scope table:

  | Unidad | Decisión | Prioridad |
  | ------ | -------- | --------- |
  | B1 — `kairo doctor` | Aprobado, como diagnóstico ligero | MVP |
  | B2 — Presupuesto de contexto de Kairo | Aprobado, con tests automatizados | MVP, primero |
  | B3 — Guía de MCP selectivos | Aprobado, sólo documentación | MVP |
  | A1 — `CLAUDE.md` local | No implementar todavía | Entorno personal |
  | A2 — MCP por proyecto | Recomendación, no automatización | Posterior |

  B1:

  "Quiero aprovechar `kairo doctor` sin convertirlo en otro sistema de observabilidad."

  "Debe identificar, cuando sea posible, archivos de instrucciones potencialmente cargados, duplicaciones detectables y servidores MCP configurados. También debe ofrecer recomendaciones concretas."

  "Distinción obligatoria: el diagnóstico estático no puede afirmar que conoce los tokens reales procesados ni todas las herramientas efectivamente cargadas. Esos datos sólo deben mostrarse cuando exista una fuente de medición válida."

  "No autorizo nuevos procesos de modelos, un gateway, un indexador permanente ni lecturas de credenciales."

  B2:

  "Debemos medir por separado el bloque `harness:managed`, las instrucciones y descripciones de agentes `kairo-*` y la salida dinámica del router."

  "El criterio no debe ser simplemente reducir tokens. Debemos demostrar que una optimización no elimina información necesaria para routing, admisión, revisión o continuidad."

  "El presupuesto se fijará a partir de la línea base medida, con tests que detecten incrementos injustificados. No impondría todavía un umbral arbitrario que obligue a recortar instrucciones útiles."

  Interpretation:

  "Una corrección a la interpretación: los 481 tokens representan el efecto observado al deshabilitar el router, no todo el costo de Kairo. Todavía faltan componentes como las descripciones de agentes y otros elementos instalados."

  Personal environment:

  "No autorizo añadir todavía un `CLAUDE.md` al repositorio para evitar que se cargue `AGENTS.md`."

  "El comportamiento de precedencia del plugin es una hipótesis basada en logs, no una garantía comprobada. Además, los archivos contienen reglas distintas que podrían perderse."

  "Respecto a `~/.claude/projects/-private-tmp`, como contiene un subdirectorio `memory`, aunque esté vacío, no cumple literalmente la condición anterior de directorio completamente vacío. Déjalo intacto por ahora. No necesitamos más trabajo de limpieza."

  Closure:

  "M16 podrá cerrarse para el MVP cuando exista evidencia de que:"

  "- Kairo tiene un presupuesto de contexto medido y protegido mediante tests."

  "- `kairo doctor` ofrece diagnóstico útil sin sobrecarga importante."

  "- El onboarding documenta cómo configurar MCP de forma selectiva."

  "- No se sacrifican capacidades funcionales para reducir tokens."

  "- Las limitaciones y los resultados de medición se reportan sin atribuciones exageradas."

  "No haría obligatorio optimizar automáticamente el entorno personal de cada usuario, ni alcanzar una reducción porcentual global que Kairo no puede controlar."

  Order:

  "Orden de implementación posterior: B2 → B1 → B3."

- M35 (MA20 implementation, MA15 rule, milestones and MA13 closure, OD-MVP-M16 IMPLEMENTATION_AND_CLOSURE_APPROVED, L26): decision by Sam, quoted fragments verbatim. Authorizes the implementation of MA20 only, assigns milestones, makes MA15 non-blocking and closes MA13 with limitations; M16 is not closed by this decision.

  MA20:

  "MA20 debe establecer un presupuesto de contexto propio de Kairo, con mediciones y tests que detecten aumentos injustificados."

  "- Medir `harness:managed`, descripciones de agentes `kairo-*` y salida dinámica del router."

  "- Establecer un baseline reproducible por componente, sin sumar indiscriminadamente métricas diferentes."

  "- Añadir tests que detecten crecimiento injustificado y cambios en contenido obligatorio."

  "- Mantener routing, admisión, revisión y continuidad."

  "- No instalar herramientas, cambiar proveedores ni modificar instrucciones personales."

  "Criterio de cierre: presupuesto documentado, tests aprobados y ausencia de regresiones funcionales atribuibles a MA20."

  "No autorizo todavía MA21 ni MA22."

  MA15:

  "El 50% deja de ser un requisito obligatorio de publicación."

  "Ese objetivo se definió antes de medir el consumo real. Ahora sabemos que deshabilitar el router produjo una diferencia de aproximadamente 481 tokens sobre 104,200 procesados en aquella muestra."

  "Minimizar el contexto atribuible a Kairo sin sacrificar funcionalidad ni imponer reducciones porcentuales artificiales."

  "MA15 debe actualizarse como objetivo experimental no bloqueante y quedar subordinado al presupuesto y los tests de MA20. Esto no elimina M16 del MVP."

  Milestones:

  | Tarea | Milestone | Entregable |
  | ----- | --------- | ---------- |
  | MA19 — Tres patrones de orquestación | C — Piloto real | Validación E2E secuencial, paralela y routing |
  | MA20 — Presupuesto de contexto | A — Runtime verificable | Baseline, límites y tests |
  | MA21 — `kairo doctor` | B — Integración instalable | Diagnóstico funcional en proyectos nuevos y existentes |
  | MA22 — Guía MCP | B — Integración instalable | Documentación de activación selectiva por proyecto |

  "MA19 podrá preparar pruebas antes del Hito C, pero su aceptación final requiere evidencia de ejecución real con las integraciones que vamos a anunciar."

  MA13:

  "Autorizo cerrar MA13 como `BASELINE_COMPLETE_WITH_LIMITATIONS`, ajustando explícitamente su alcance documental."

  | Comparación | Diferencia observada | Estado |
  | ----------- | -------------------- | ------ |
  | Kairo habilitado vs. router deshabilitado | −481 tokens | Medido una vez |
  | MCP habilitado vs. deshabilitado | −16,796 tokens | Medido una vez |
  | Instrucciones duplicadas vs. depuradas | −22,242 tokens | Medido una vez, con contaminación documentada |
  | Estado C — Sin Kairo | — | No medido |

  "No autorizo más corridas de ablación por ahora."

  "Los tres momentos dentro de una misma sesión y la validación estadística siguen pendientes, pero no serán condiciones adicionales de MA13. Tampoco debemos presentar estos resultados como ahorro reproducible o como medición exacta de ocupación de contexto."

  "MA13 puede cerrarse; M16 permanece abierto hasta completar MA20–MA22 y sus criterios funcionales."

  Engram:

  "Respecto a Engram, mantenemos `KD6` como deuda conocida. Las decisiones registradas por CLI son suficientes para continuar, siempre que puedan recuperarse y verificarse."

  Priority:

  "MA20 → revisión y cierre → MA21 → MA22 → cerrar M16."

## Release contract

The closure rule (M8) is the single release gate. Every future finding is classified exactly once:

- BLOCKER: it demonstrates at least one of the four consequences in M8 (mandatory-constraint violation at execution; independence, admission or execution accredited without enough evidence; main supported install/work/recovery route broken; reproducible compatibility, stability or performance regression that prevents normal use). M16 and M17 are mandatory release items (M19); a missed M16 or M17 acceptance criterion blocks.
- KNOWN_DEBT: it meets none of the four. It is documented in the known-limitations section of the Milestone D docs and does not block publication. Non-blocking improvements go to the later-version backlog (M18).

New observations are evaluated against this contract; they do not expand the roadmap automatically. Security defects are not ignored: they are BLOCKER when they meet a consequence, otherwise KNOWN_DEBT with a written record.

## Findings triage

Per-number table recovered from the read-only audit of worktree core-hook-t4 at 2d5a766bf (plus uncommitted S121-S123 batches). Evidence class: effective = reproduced through the real flow; helper-only = reproduced only in a helper; source-only = read in source, not reproduced; not reproduced.

| Finding | Defect | Evidence class | Release decision | Task | Status |
| ------- | ------ | -------------- | ---------------- | ---- | ------ |
| F1 | reusableDirective never compares role (Builder directive authorized a Reviewer) | effective repro | BLOCKER | MA1 | done, independently reviewed (65bfe5c1a, MA1) |
| F2 | keep directive not bound to original provider/model | effective | BLOCKER | MA1 | done, independently reviewed (65bfe5c1a, MA1) |
| F3 | future-issued directive accepted (+1 ms; core skew 60 s, hook copy) | effective hook | BLOCKER per Rule B zero tolerance | MA1b | done, independently reviewed (fae107434, MA1b) |
| F4 | directive expired during preparation still spawned; no spawn-time revalidation | effective | BLOCKER | MA1 | done, independently reviewed (65bfe5c1a MA1; 4d226db14 MA1c race fix; a085f99c8 MA1d spawn refuses only on a confirmed marker) |
| F5 | corrupt contract on unmarked launch classified legacy; exhaustion marker reader never called | effective | BLOCKER | MA2 | done, independently reviewed. Evidence: worktree core-hook-t4 commits e63f074a9 (MA2: a corrupt contract is never inactive on startRun, team exec and the service route; task-marked gets X3, unmarked with a confirmed marker gets X6, otherwise degraded X7 continuity without credit, persisted in run state and rechecked at spawn; new readNegotiationRequired; veto removal unchanged) and 94dcffc85 (MA2b: team exec rechecks exhaustion right before the spawn for governed launches; directive reuse is skipped when the current contract is invalid). Review: direct Codex review of a085f99c8..e63f074a9 (verified header) found 8 of 10 rules HOLD and two BLOCKERS (team exec spawned despite a marker appearing during launch-record persistence, M8(a); a reusable directive bypassed the corrupt-contract X3 denial, M8(a)/(b), a gap that pre-existed MA2); one correction batch MA2b; Codex recheck of e63f074a9..94dcffc85 (verified header): both RESOLVED. Suite at 94dcffc85 under clean env: npm test 5073 pass, 0 fail; core-hook 389 pass. |
| F6 | team exec with corrupt contract: activation reader false, shared gate skipped, exit 0, "inactive" diagnostic | effective | BLOCKER | MA2 | done, independently reviewed. Evidence: worktree core-hook-t4 commits e63f074a9 (MA2: a corrupt contract is never inactive on startRun, team exec and the service route; task-marked gets X3, unmarked with a confirmed marker gets X6, otherwise degraded X7 continuity without credit, persisted in run state and rechecked at spawn; new readNegotiationRequired; veto removal unchanged) and 94dcffc85 (MA2b: team exec rechecks exhaustion right before the spawn for governed launches; directive reuse is skipped when the current contract is invalid). Review: direct Codex review of a085f99c8..e63f074a9 (verified header) found 8 of 10 rules HOLD and two BLOCKERS (team exec spawned despite a marker appearing during launch-record persistence, M8(a); a reusable directive bypassed the corrupt-contract X3 denial, M8(a)/(b), a gap that pre-existed MA2); one correction batch MA2b; Codex recheck of e63f074a9..94dcffc85 (verified header): both RESOLVED. Suite at 94dcffc85 under clean env: npm test 5073 pass, 0 fail; core-hook 389 pass. |
| F7 | git exit 1 "not a git repository" classified NO_PROJECT | helper-only | confirm in real flow per M6 | MA3 | authorized |
| F8 | directive reused after a new current exhaustion (P16) | effective | BLOCKER | MA1b | done, independently reviewed (fae107434 MA1b no reuse after current exhaustion; a085f99c8 MA1d unreadable source keeps P13 continuity while still blocking reuse) |
| F9 | quick-ask and Claude/Cursor entitlement and Cursor auth probes spawn model prompts outside the gate | effective | auxiliary per M2: no decideLaunch, must respect confirmed exhaustion | MA4 | authorized |
| F10 | review, architect, OpenCode backend, bootstrap sandboxes, Pi minion, continuation, capability adapter bypass the gate | source-only | HYPOTHESIS, KNOWN_DEBT unless reproduced; classify per M1 | MA4/MA6 | authorized |
| F11 | non-hook launches carry null session and possibly null attempt identity | not reproduced | HYPOTHESIS, KNOWN_DEBT | MA6 | authorized |
| F12 | core-hook-t4-report.md S123 claims exceed implemented validation | n/a (report) | ADVISORY: correct claims | MA6 | authorized |
| F13 | inactive hook path: two reads each with a 2000 ms deadline, 3612 ms observed | effective | must meet hook p95 < 2000 ms full operation (M20) | MA5 | KNOWN_DEBT (KD11), MA5 rolled back (M28) |

Review evidence for F1-F4 and F8 (worktree core-hook-t4): commits 65bfe5c1a (MA1: F1 role, F2 original pair, F4 spawn revalidation and handoff admission), fae107434 (MA1b: F3 zero skew in core and hook, F8 no reuse after current exhaustion), 4d226db14 (MA1c: F4 race, marker read awaited before the binding check with a fresh clock, no await before spawn), a085f99c8 (MA1d: spawn refuses only on a confirmed marker, unreadable source keeps P13 continuity while still blocking reuse). Direct Codex review of 7d11e9a74..4d226db14 (verified header): F1-F4 HOLDS and one F8 BLOCKER (unreadable source broke fresh P13 continuity, M8(c)). One correction batch (MA1d). Codex recheck of 4d226db14..a085f99c8 (verified header): BLOCKER RESOLVED. Suite at a085f99c8 under clean env: npm test 5058 pass, 0 fail; core-hook 374 pass.

Source: audit report returned (stale) by the codex reviewer wrapper on 2026-11-09, matching the original audit of 2d5a766bf; recovered here because the original table was chat-only.

F9 operation classification follows S125 (M1, M2): quick-ask, entitlement/auth probes and metadata queries are auxiliary (no decideLaunch, but must respect confirmed exhaustion); review-runner, architect, Kairo-managed minions and managed-task continuation are governable when they run delegated work; OpenCode, Pi and generic adapters stay in compatibility mode without credit unless they implement the boundary.

## Milestones

Each milestone is complete only when its exit evidence is observed. Scope does not grow on new hypotheses (M9); new findings go through the Release contract.

### A - Close the minimum boundary (M9, M6, M7, M16, M17)

Exit evidence:
- Reproduced defects of the supported governable routes (F1-F6, F8, and F7 if reproduced in the real flow) fixed, each with a regression test that failed first.
- A fixed acceptance test set exists, runs through real inputs (real startRun plus supervisor, real hook, `team exec`), and passes under `npm test` and the plugin tests.
- Zero launches on rejected, expired or foreign directives, asserted in that set.
- F9 classification written per operation; governable operations on announced routes pass the boundary.
- Hook redundant reads removed; a performance test covers the normal path and the timeout path. Threshold (approved, OD-MVP-1 / M20): hook p95 under 2000 ms over the full operation. Internal timeouts must leave margin so the whole operation ends in a controlled way; the budget is not 2000 ms per query. The threshold applies to normal performance measured with a representative load and enough samples; slow-core degradation is the documented exception F13 (observed up to 4331 ms, KD11), and the threshold is not a universal guarantee (M28).
- F12/F13 claims corrected and performance tests committed.
- M16 baseline recorded: measured session-start context for three states (Kairo enabled, Kairo disabled, Kairo not installed), separating initial context from first-task consumption, and broken down by source: global instructions and CLAUDE.md/AGENTS.md; Kairo and Gentle AI additions; host/agent/plugin duplication; tool/MCP/capability descriptions; needed-at-start versus on-demand. The M16 target (at least 50% reduction of Kairo-attributable startup overhead without removing essential controls) is implemented in a later milestone (MA15), not here; per M35 that target is a non-blocking experimental objective. Non-Kairo sources are reported as such and not attributed to Kairo. No new memory system, no new compaction mechanism, no new monitoring engine.
- MA20 (M35): Kairo's own context budget with baseline, limits and tests (Runtime verifiable).
- M17 baseline recorded: current panel inventory of the defects Sam lists (Unknown role shown as assigned, "waiting until unknown", opencode-go unavailable noise, roles multiplied per historical run, 73-verdict list flooding the panel, quota without update time or staleness) and identification of the existing state source the panel must consume.

### B - Installable integration (M10, M17)

Exit evidence:
- Worktrees core-hook-t0..t4, core-hook-snapshot and u2-u5 consolidated into release/v0.37.0 (approved as integration target; not created yet; no automatic merge authorized). The 13 D files are not merged (M14).
- Package built; fresh install in a clean scratch project passes.
- Upgrade from the previous installed state passes.
- Disable passes and Kairo-off behaviour in existing projects is unchanged for the host (no Kairo launch gating, no errors).
- Diagnosis, recovery and uninstall leave the host working (M4 last capability).
- Compact plus detailed panel (M17) consuming an existing state source with the semantic fixes (MA16), if not authorized earlier.
- MA21 and MA22 (M35): `kairo doctor` functional diagnosis in new and existing projects (MA21); documentation of selective per-project MCP activation (MA22).
- BYOK AA onboarding (M24, MA18): a fresh install without an AA key works; a key set later is validated with explicit error messages; the key is stored locally outside the repository and never appears in traces; degraded mode (no key) shows no invented rankings or current data.

### C - Real pilot (M11, M16)

Exit evidence, on new and existing scratch projects, via Claude Code (kairo-router hook) and Codex (team exec/service/startRun), published as 0.37.0-beta.1 for the pilot:
- Routing observed with availability and explicit exclusion reasons.
- Per-task independence observed, with provisional states when evidence is missing.
- Fallbacks observed and explained, none silent.
- Hook and launch latency measured under controlled activation. Pass threshold: hook p95 under 2000 ms over the full operation (approved, M20).
- M16 target measured against the Milestone A baseline (MA15 scope). Per M35 this target is a non-blocking experimental objective, not a publication requirement.
- MA19 (M35): three orchestration patterns validated end to end (sequential, parallel and routing), with real execution evidence using the integrations to be announced.
- BYOK AA onboarding (M24) covered by the pilot both with and without an AA key.
- Any finding classified BLOCKER or KNOWN_DEBT; BLOCKERs return to Milestone A scope only if they meet M8.

### D - Publication (M12)

Exit evidence:
- Documentation published for install, compatibility, limitations (including KNOWN_DEBT list), and troubleshooting.
- Version 0.37.0 tagged and package published, after the exit criteria are met.
- Improvement roadmap kept in a separate document, not in this feature.

## Announced integrations

Approved per OD-MVP-1 (M20; derived from M3, M11):

- Governed: Claude Code and Codex CLI, conditional on passing their real tests. Claude Code via the kairo-router hook; Codex via `team exec`, service and `startRun`.
- Compatible: OpenCode, Pi, Cursor, Gemini and generic adapters, only where compatibility is proven.

## Out of scope

Aligned with M19 (later evolution):

- Additional providers (M19).
- Remote `VERIFIED` attestation (M4, M19).
- Extra optimizations and new interfaces beyond M16 and M17 (M19).
- T6-T11 of router-provider-authority, except those indispensable for the MVP contracts (M5, M19). Assumption: no T6-T11 capability is identified as indispensable yet; if Milestone A or C evidence shows one is, it is raised to Sam as a decision and not added silently.
- Universal host compatibility and the advanced roadmap capabilities (M4).
- Obsidian integration: later and optional (M21).
- The 13 D files: historical backup only, not an integration target and not mandatory debt to merge (M14).
- New general design rounds, new security subsystems, anticipatory observability infrastructure (M13), another governance framework or new subsystems (OD-MVP-1 section 5).

## Known debt (non-blocking, per M8)

- KD1: cockpit path src/global/service.js (~2645-2649, ~2806, ~2855-2866) passes no original pair, so cockpit redirect reuse falls back to a fresh core decision (extra core read, no functional break). Source: Codex review 7d11e9a74..4d226db14.
- KD2: t3-hook "F2 record-launch crash/timeout" tests fail intermittently under full-suite load and pass alone (9/9 x3). Sam's condition, verbatim: "antes de publicar `0.37.0` necesitaremos comprobar que no representan pérdida de registros, lanzamientos indebidos ni un fallo real de gobernanza." Pre-release check required (Milestone C).
- KD3: the real hook entry test for future issuance uses a 5 s offset; the exact +1 ms is pinned only in the core-level test (needs a hook clock seam).
- KD4: SNAPSHOT_CLOCK_SKEW_MS in reviewer-snapshot.ts is still 60 s (different component, out of MA1b scope).
- KD5: t4-ma1c test detects the marker read through the function name readExhaustionMarkers in the stack trace; a rename breaks the test.
- KD6: Engram marked the live session ended (SessionEnd at 2026-11-10 00:22:43); root cause not determined; hypothesis: a child process inherited CLAUDE_CODE_SESSION_ID; verified recovery: POST /sessions with resume: true; pending: identify the SessionEnd emitter; focused diagnosis only if it recurs and blocks work (OD-MVP-ENGRAM).
- KD7: team-reviewer-codex wrapper returns a stale codex-review-last.md; reviews must use direct Codex with a verified header (M23).
- KD8: the Pacing line shows remaining quota without saying "remaining"; it was misread as used. M17 label fix.
- KD9: with a corrupt contract and a task-marked launch, X3 takes precedence over X6 even when a confirmed exhaustion marker exists; the launch is denied either way (no restriction bypass). Source: Codex recheck e63f074a9..94dcffc85.
- KD10: parity between the hook's learned-restriction memory and the shared gate's direct marker read (hook only knows restrictions it has learned). Source: MA2 builder backlog.
- KD11: F13, slow-core hook latency. The inactive hook path makes two core reads, each with its own 2000 ms deadline; observed 3612 ms wall and 4331 ms critical path with a slow core. Cause identified: the redundant second read cannot be removed without a new field in the core reply, and a shared 1800 ms budget (MA5) regressed classification because the status read inherited at most 400 ms while one status call costs about 330 to 690 ms. Evidence: outside any sandbox on AC power, full suite with MA5 5112 of 5114 against baseline `b82eff1fb` 5108 of 5108; under load only with MA5, launches denied with `ADMISSION_STATE_UNKNOWN, X3` instead of X2 and, on projects with the contract disabled or not effective, one X3 denial and unrouted launches in `hook-legacy-differential`; baseline 0 failures in three parallel `test/core-hook` runs at load average 7 to 12. The speculative status read was not applied: the live runner transport queues core calls one at a time, so it cannot overlap, and concurrent core calls would add lock contention; Sam did not authorize runner changes. Future alternatives, not mandatory in this cycle: a protocol extension that removes the second read, or a better transport. Safety rule that stays: any communication failure must keep admission restrictions and produce no undue launch. Patch kept at `odd/t4/ma5-hook-budget.patch` in the `core-hook-t4` worktree (branch `feat/core-hook-t4`). Source: M28, L11.
- KD12: fragile git repository detection in MA3 (`src/global/team/launch-gate.js` lines 127 to 134 at commit `c14301b75`). Exit 128 plus English diagnostic text does not prove repository absence. Reproduction, identical at the baseline `94dcffc85` and at `b82eff1fb`: from a valid repository, `GIT_DIR=/does-not-exist` yields legacy `NO_PROJECT`; with Spanish git diagnostics the same case yields `PROJECT_RESOLUTION_FAILED`. So broken repositories are not uniformly fail-closed and the match is locale-dependent. Pre-existing, found by the independent review of MA3 and MA4. Decision: documented limitation, MA3 not modified (OD-MVP-MA4b). Future fix, not in this cycle: stabilize the diagnostic locale and distinguish broken git metadata or configuration from real absence. Source: M29, L13, L14.
- KD13: intermittent hook tests under machine load, pre-existing and recorded separately from MA4. Sam: "Los tests intermitentes preexistentes se registrarán separadamente; no reabriremos MA4 por hallazgos ajenos a su contrato." Evidence with MA4b applied and hook code byte-identical to `eb1276cb8` (`git diff HEAD --quiet -- integrations` exit 0): full suite run 1, 5108 of 5118, 10 failures, all in `hook-acceptance`, `hook-crossreview`, `hook-legacy-differential` and the F2 record-launch tests, load average 10 to 14 with a Codex review running in parallel, 435 s against about 300 s normally; full suite run 2, 5117 of 5118, one failure (`a directive is never reused: replaying the first answer for a second launch authorizes nothing and the launch stays unchanged`, in `hook-acceptance`), load average 7 to 15; then `hook-acceptance` 18 of 18, `hook-crossreview` 7 of 7 and `hook-legacy-differential` 6 of 6, each alone three times, and `test/core-hook` in parallel twice, 434 pass and 0 fail both times (load average 4.7 and 10.3). No failure reproduced in isolation or in the core-hook set. Not established: a clean full-suite run with MA4b, and the cause of the load (three unidentified node processes near 100 percent CPU were seen once; later only a `kairo team route --refresh` of the main checkout). Related: the same family failed intermittently on battery with macOS low power mode (L9), and KD2 (F2 record-launch tests failing under full-suite load). Operational rules learned: run timing-sensitive suites with nothing heavy in parallel; never commit in any checkout while `hook-legacy-differential` runs, because `test/core-hook-t0/guard.js` fails when a HEAD moves.
- KD14: non-blocking improvements from the MA4 reviews (the document has no separate later-version backlog section, so they are recorded here): (a) no test pins the case of a nonexistent `projectRoot` with an exhausted `cwd` (`test/core-hook/t4-ma4.test.js` around lines 156 to 168; the code already refuses); (b) `runCursorSandboxedBootstrap` and `runCodexSandboxedBootstrap` spawn their provider without `askProvider`, so the MA4 guard does not cover them (relates to F10); (c) other `askProvider` callers that pass a snapshot cwd, such as conversation ASK, do not yet pass `projectRoot`.

## Tasks

Closed list (MA1-MA18 plus MA1b; MA19 added by OD-MVP-ORCHESTRATION; MA20 to MA22 added by OD-MVP-M16 PRODUCT_OPTIMIZATION_SCOPE_APPROVED). Route TBD for all. Every task carries Result, Acceptance and Closure (M18); once the three hold the task closes and non-blocking improvements go to the later-version backlog. Milestone A MA1-MA7 plus MA13-MA14 are authorized by OD-MVP-1 (MA14 is done); MA1b is authorized by OD-MVP-MA1b (L5); MA8-MA12 and MA15-MA18 are not authorized yet.

- MA1 (M6, M8; Milestone A). Status: done (closed per M18): 65bfe5c1a (MA1), fae107434 (MA1b), 4d226db14 (MA1c), a085f99c8 (MA1d); authentic direct-Codex review obtained (M23), one F8 blocker fixed in MA1d, recheck BLOCKER RESOLVED; F3 and F8 are done under MA1b. Result: identity and reuse fixes for F1, F2, F3, F4, F8 on startRun, supervisor, launch gate and hook. Acceptance: real startRun plus supervisor and real hook reject reused, expired, foreign and future-issued directives with zero launches; each regression test failed first. Closure: tests pass in the fixed acceptance set (MA7) under `npm test` and plugin tests.
- MA1b (M23; Milestone A). Status: done (closed per M18): fae107434 (MA1b), with follow-ups 4d226db14 (MA1c) and a085f99c8 (MA1d); authorized by OD-MVP-MA1b, L5. Result: F3 zero clock skew in core and hook (condition issuedAt <= now && now < expiresAt && expiresAt - issuedAt <= 300_000) plus F8 no directive reuse after a new current exhaustion that contradicts it; no other component touched, protocol architecture unchanged. Acceptance: t4-ma1b tests including the case issuedAt = now + 1 ms, core/hook parity tests updated, and full suites green. Closure: closure report section MA1b plus an authentic review by direct Codex invocation (no wrapper) whose report names the exact commit and files inspected; a mismatch discards the review.
- MA2 (M6, M8; Milestone A). Status: done (closed per M18; commits e63f074a9, 94dcffc85). Result: contract and exhaustion fixes for F5, F6 (fail closed on corrupt contract, `team exec` gate). Acceptance: corrupt or unmarked contract fails closed on every supported governable route and exhaustion is respected; regression test failed first. Closure: tests pass in the fixed acceptance set (MA7).
- MA3 (M6; Milestone A). Status: in progress (authorized by OD-MVP-1). Result: F7 confirmed or ruled out in the real hook and `team exec` flow; fix only if reproduced. Acceptance: reproduction attempt through the real flow recorded; if reproduced, fix with failing-first test, else KNOWN_DEBT record. Closure: outcome (BLOCKER fixed or KNOWN_DEBT) recorded in the findings table. Independent review: PASS, no blocker; residual limitation recorded in KD12.
- MA4 (M1, M2, M3, M6; Milestone A). Status: authorized (OD-MVP-1). Result: F9 operations classified governable or auxiliary; governable ones routed through the boundary; auxiliary ones respect confirmed exhaustion. Acceptance: written per-operation classification exists; governable operations on announced routes pass the boundary and auxiliary ones respect confirmed exhaustion, each asserted by a test. Closure: classification committed and tests pass in the acceptance set (MA7). Independent review (Codex, read-only, commits `c14301b75` and `b82eff1fb`): no blockers, four advisories; MA4b is authorized for advisories 1, 3 and 4 (M29, OD-MVP-MA4b) and advisory 2 went to KD12. MA4b landed as commit `202f5a1ca` in the `core-hook-t4` worktree (branch `feat/core-hook-t4`): the originating project travels beside the execution cwd through the bootstrap adapters, the ASK call and the Cursor Auto auth probe, and `service.js` passes it at the production call site; a confirmed marker on either scope refuses the prompt; a guard that cannot load returns each caller's typed could-not-verify result; `t4-ma4` went from 22 to 32 tests. Cross review of the MA4b diff (Codex, read-only): PASS, no blockers, items A to E PASS. Status now: closed (2026-11-10).
- MA5 (M7; Milestone A). Status: rolled back (OD-MVP-MA5 ROLLBACK_APPROVED, 2026-11-10), not committed; F13 moved to KD11. Result: redundant core reads removed from the hook path; no new protocol. Acceptance: performance test covers normal and timeout paths and shows hook p95 under 2000 ms over the full operation, with internal timeouts leaving margin. Closure: performance test committed and passing.
- MA6 (M6; Milestone A). Status: authorized (OD-MVP-1). Result: F10 and F11 recorded as KNOWN_DEBT unless reproduced; F12 claims corrected; F13 performance tests added. Acceptance: records exist for F10/F11; reports match observed evidence; F13 tests run and pass, including the hook timeout path. Closure: records and tests committed.
- MA7 (M9; Milestone A). Status: authorized (OD-MVP-1). Result: fixed acceptance test set built and run on real inputs. Acceptance: set covers real startRun plus supervisor, real hook and `team exec`, asserts zero launches on rejected directives, and passes under `npm test` and plugin tests. Closure: set committed with a passing run recorded.
- MA8 (M10, M14; Milestone B). Status: not authorized. Result: worktrees consolidated into release/v0.37.0, excluding the 13 D files. Acceptance: branch builds and `npm test` plus plugin tests pass; no D file present. Closure: branch state and test run recorded.
- MA9 (M10, M4; Milestone B). Status: not authorized. Result: package, fresh install, upgrade, disable, Kairo-off, diagnosis, recovery and uninstall verified. Acceptance: each check passes in a clean scratch project and the host keeps working after disable and uninstall. Closure: check results recorded.
- MA10 (M11; Milestone C). Status: not authorized. Result: pilot of 0.37.0-beta.1 on new and existing scratch projects via Claude Code and Codex. Acceptance: Milestone C exit evidence observed, including hook p95 under 2000 ms over the full operation. Closure: pilot report recorded with every finding classified BLOCKER or KNOWN_DEBT.
- MA11 (M12; Milestone D). Status: not authorized. Result: install, compatibility, limitations and troubleshooting docs. Acceptance: a reader can install, diagnose and uninstall by the docs alone; KNOWN_DEBT list included. Closure: docs committed.
- MA12 (M12; Milestone D). Status: not authorized. Result: 0.37.0 tagged, package published, separate roadmap document opened. Acceptance: tag and published package match the pilot-validated build; roadmap lives outside this feature. Closure: tag, publication and roadmap document recorded.
- MA13 (M16; Milestone A). Status: authorized (OD-MVP-1). Result: session-start context baseline measured for Kairo enabled, disabled and not installed, by source, separating initial context from first-task consumption. Acceptance: context measured at three moments (right after session start, after preparing the first task, after finishing it) for Kairo enabled, disabled and not installed (M21); a recorded table per state with the source breakdown in the Milestone A exit evidence, non-Kairo sources reported as such, no new memory or compaction mechanism built. Closure: baseline recorded in this document. In progress (2026-11-10): instrumental baseline of one live run recorded in the Log (L18, M30); the three-state comparison and the three moments within one preserved session are still pending and not yet authorized beyond the pilot. Controlled comparison (2026-11-10): states A and B measured once each, recorded in the Log (L19, M31); state C is blocked on file changes, which are not authorized. MCP ablation (2026-11-10): measured once with `--strict-mcp-config`, recorded in the Log (L20, M32). Instruction deduplication (2026-11-10): the pair was measured once per variant, recorded in the Log (L21, M33). Closed (2026-11-10) as `BASELINE_COMPLETE_WITH_LIMITATIONS` per M35; documentary scope adjusted: the three moments within one session, the statistical validation and state C (without Kairo) were not measured and are not additional conditions of MA13; the results are one sample each and are not a reproducible saving nor an exact measurement of context occupancy.
- MA14 (M17; Milestone A). Status: done. Result: current panel defect inventory and mapping of the existing state source the panel must consume. Acceptance: each defect Sam lists is confirmed or marked not reproduced with evidence, and the existing state source is named with its file path. Closure: inventory and mapping recorded in this document. Result inventory: "unknown (unknown)" shown as an assigned role at integrations/claude-code/kairo-router/hooks/register.ts:338-343 (planTable); "waiting until unknown" at register.ts:340-341; "No quota data: opencode-go" noise at register.ts:168-172 (providers with empty windows are listed); roles multiplied via src/global/team/routing-input-cache.js:253-273 (run records and launch history); verdict list flood at integrations/claude-code/kairo-router/hooks/pane.ts:18-24 (renders every verdict string); quota shown without generatedAt or stale although the Pacing type has both (register.ts:7, 167-172). State sources for the compact view: `kairo team pacing --json --no-wait` (quota windows, generatedAt) plus `kairo team routes --json` (role routes, wait reasons); verdict producer not yet located. Seventh panel defect (KD8): the Pacing line shows remaining quota without saying "remaining", so it was misread as used; label fix belongs to M17.
- MA15 (M16; Milestone B or C). Status: not authorized. Result: context reduction implemented to the target of at least 50% reduction of Kairo-attributable startup overhead without removing essential controls, through the four M21 measures: (1) minimal bootstrap audit of CLAUDE.md, AGENTS.md, agents, skills and MCP tools; (2) compact Engram storing decisions and pointers to documents, not ODD spec copies; (3) on-demand CodeGraph and selective Context7; (4) per-task context budget showing source and use. Acceptance: re-measurement against the MA13 baseline shows the target met and essential controls still enforced. Closure: the five M21 demonstrations (no unnecessary load every session; relevant context retrieved when needed; no massive duplication of instructions and memories; security controls kept while optimizing; measurable reduction against a comparable baseline) are recorded with the before/after measurement; installing all five tools is NOT required. M34 (OD-MVP-M16 PRODUCT_OPTIMIZATION_SCOPE_APPROVED) defines M16 closure through a measured budget protected by tests instead of a mandatory percentage, Per M35 (OD-MVP-M16 IMPLEMENTATION_AND_CLOSURE_APPROVED), the 50 percent target is no longer a mandatory publication requirement; MA15 is a non-blocking experimental objective subordinate to the budget and tests of MA20; rule: "Minimizar el contexto atribuible a Kairo sin sacrificar funcionalidad ni imponer reducciones porcentuales artificiales."
- MA16 (M17; Milestone B). Status: IMPLEMENTATION_CLOSED / HOST_VALIDATION_PENDING (formally confirmed by Sam, OD-MVP-RELEASE-HARDENING APPROVED, L41; final adjustment commit 26ac5504e on feat/core-hook-t4, L36); the real panel is validated during the Milestone C pilot; incremental: (1) compact view, (2) operational information, (3) visual and functional validation. Result: compact plus detailed two-level panel consuming an existing state source, with the semantic fixes (Unknown not shown as a role, understandable wait reasons, no roles multiplied per historical run, quota with update time and staleness). Acceptance: the MA14 defect inventory is re-checked and every defect is gone; no new monitoring engine added. Closure: panel tests pass and before/after captured. Increment 1 (compact view): done, commit 4d4eb37e9 on feat/core-hook-t4 (L32). Increment 2 (operational information): done, commit f2b40817b on feat/core-hook-t4 (L33). Increment 3 (visual and functional validation): done on rendered text, commit 928094dbe on feat/core-hook-t4 (L34); validation on a real host is pending because install is not authorized.
- MA17 (M21; Milestone B). Status: not authorized. Result: Graphify evaluated against CodeGraph before any dependency is added. Acceptance: a written comparison on the same project shows what Graphify adds beyond CodeGraph, its context cost and its duplication risk with Engram and CodeGraph, ending in adopt or reject. Closure: decision recorded; no Graphify dependency added unless the comparison shows added value.
- MA18 (M24; Milestone B). Status: implementation done, commit a87b81083 on feat/core-hook-t4 (L38), independent security review PASS after one correction batch; the Milestone C exit evidence for M24 is pending the integration pilot. Result: BYOK Artificial Analysis onboarding: optional personal AA key configurable at clean install and when configuring Kairo later; no shared credentials in the package; local secure storage outside the repository and traces; explicit key check with explained access errors; degraded mode without a key that invents no rankings or current data; model-evaluation API kept separate from the Claude/Codex subscriptions used to run work. Acceptance: fresh install without an AA key installs and runs basic Kairo functions; a key set later is validated with explicit error messages; the key is absent from the repository and from traces; degraded mode shows no invented rankings. Closure: tests pass and the Milestone B and C exit evidence for M24 is recorded.

- MA19 (M27; Milestone C - real pilot, M35). Status: authorized (OD-MVP-ORCHESTRATION). Result: an acceptance matrix of three integration scenarios showing sequential, parallel and routing execution as verifiable capabilities of Kairo Runtime 0.37.0 using the existing mechanisms, including failures, quotas and cross review. Acceptance: the three scenarios are defined in this document and each one is observed passing end to end; no new workflow engine; provider selection is not duplicated; parallelism is not required when tasks have dependencies; parallel execution does not bypass quotas, admission or per-task review. Closure: matrix recorded with observed evidence per scenario. First step: define the three scenarios. Per M35, tests may be prepared before Milestone C, but final acceptance needs real execution evidence with the integrations to be announced.

- MA20 (M34, M16; Milestone A - verifiable runtime, M35). Status: done (OD-MVP-MA20 FINAL_VALIDATION, L27), commit 620c9eb1c on feat/core-hook-t4. Implementation order: first (B2). Result: Kairo's own context budget measured and protected by automated tests, with separate figures for the `harness:managed` block, the instructions and descriptions of the `kairo-*` agents, and the dynamic output of the router. Acceptance: the three components are measured separately and recorded as the baseline; automated tests fail on an unjustified increase over that baseline; the budget is set from the measured baseline, with no arbitrary threshold that forces cutting useful instructions; any optimization shows that information needed for routing, admission, review or continuity is not removed; the 481 tokens observed when disabling the router are reported as that effect only, not as Kairo's total cost. Closure: baseline and tests recorded in this document with observed evidence. Evidence: baseline of 71 components in docs/context-budget.md and test/fixtures/context-budget.json; full suite 5122 pass, 0 fail; router plugin 498 pass, 0 fail; independent Codex review of the three corrected blockers PASS with no regressions and no new blockers. Recorded limit: the CodeGraph addition cap counts characters, not bytes, so it is not an absolute byte guarantee; converting it to bytes is a later improvement, not an MA20 requirement.
- MA21 (M34, M16; Milestone B - installable integration, M35). Status: done, closed with known debt (L28, OD-MVP-MA21 CLOSED_WITH_KNOWN_DEBT, L29), commit 2a46a691b on feat/core-hook-t4. Implementation order: second (B1). Result: `kairo doctor` gives a light context diagnosis: instruction files potentially loaded, detectable duplications, configured MCP servers, and concrete recommendations. Acceptance: the diagnosis is static and says so; it never claims to know the real processed tokens or every tool actually loaded, and shows such data only when a valid measurement source exists; it starts no model process, no gateway and no permanent indexer, and reads no credentials; it adds no important overhead; help text and docs updated. Closure: behavior covered by tests and recorded here. Evidence: test/context-diagnosis.test.js 15 pass, 0 fail; router plugin 498 pass, 0 fail; independent Codex review found two security blockers, both fixed in one correction batch and confirmed FIXED by a recheck limited to them; full suite 5136 of 5137 pass in two runs, the single failure being a different core-hook subprocess test each time that passes alone (see L28). Recorded limits: static estimate in bytes, no token figures; exact duplicate detection only; MCP locations for OpenCode and Pi not read; Windows paths untested.
- MA22 (M34, M16; Milestone B - installable integration, M35). Status: done (L30), commit ef4e28508 on feat/core-hook-t4. Implementation order: third (B3). Result: onboarding documentation on configuring MCP servers selectively per project. Acceptance: documentation only, no automation; it reports the measured MCP ablation with its limits (one sample) and without exaggerated attribution. Closure: document published in the repository docs and referenced here. Evidence: docs/mcp-per-project.md on feat/core-hook-t4; independent fact check against the official Claude Code and Codex documentation found 31 items correct and one wrong, corrected in one batch (see L30); documentation only, no automation, no gateway, no secret or personal path.
- MA23 (onboarding, OD-MVP-ONBOARDING FULL_SCOPE_APPROVED; Milestone B). Status: implementation done, commit bb52284b3 on feat/core-hook-t4 (L39); independent review PASS on six of seven blockers after one correction, the seventh closed by a second correction verified by tests only; not exercised with real hosts, credentials or a real terminal. Result: guided first-install experience through the existing setup, doctor and provider commands, in four steps: detect (installed hosts, existing configuration, available providers, and authentication when it can be verified), configure (choose compatible integrations, review options, optionally configure Artificial Analysis), review and apply (what will change, what is kept, what needs confirmation), verify (final diagnosis, capabilities really available, next command to start). Acceptance: detection distinguishes an installed host, a detected configuration and a verified authentication; the existing CLI stays compatible; tests use a temporary home and no real credentials and cover first install and reinstall; the user is not forced to select every model, enable advanced governance or understand Kairo's internal contracts. Closure: tests pass and the flow install, review, configure, verify, start working is demonstrated and recorded here.
- MA24 (onboarding, OD-MVP-ONBOARDING FULL_SCOPE_APPROVED; Milestone B). Status: implementation done, commit aa689a539 on feat/core-hook-t4 (L40); independent review: one blocker closed by the first correction and confirmed, the other closed by a second correction verified by tests only; not exercised with real hosts or a real terminal. Result: before installing or modifying anything, a preview lists the files Kairo intends to create, modify or keep. Acceptance: no foreign configuration is overwritten silently; it works with a previous Kairo install, a project without Kairo and configuration from other plugins, without requiring the removal of Gentle AI, Engram, CodeGraph or other tools; the user can cancel without leaving partial modifications; tests use a temporary home and cover existing configuration and recovery after a failed operation. Closure: tests pass and the preview and cancel behavior are recorded here.
- MA25 (release hardening, OD-MVP-RELEASE-HARDENING APPROVED; Milestone A). Status: implementation closed for integration (OD-MVP-RELEASE PILOT_PREPARATION_APPROVED, L47); release acceptance requires the focused review of the installer diff and the pilot; not a complete security audit; implementation committed as fcd0f8d8e on feat/core-hook-t4 (L42); independent review: one blocker confirmed fixed, two closed by a second correction verified by tests only, one of them narrowed and not fully closable (L42); open decisions for Sam listed in L42. Result: two release blockers of the installer fixed. (A) When a destination under the Kairo home components directory is an existing symbolic link, Kairo does not overwrite it, even with the yes flag: it identifies the link without following it, reports the conflict, keeps the link and its target, and may stop that operation with a manual resolution hint; no advanced symlink management. (B) A nested failed receipt in `kairo setup --yes` produces a failed global result, a non-zero exit code and a diagnostic naming the affected operation; `Setup complete` is not shown and no successful installation is recorded; a partial modification is reported with what was applied and how to recover, reusing the existing backup and rollback mechanisms. Acceptance: for A, a test shows that a link pointing outside the installation stays intact, including the bytes of the target file; for B, tests show the failed result, the exit code, the diagnostic and the absence of a success record; both are tested with a temporary HOME. Closure: tests pass, independent review recorded here.
- MA25b (release hardening, OD-MVP-RELEASE INTEGRATION_PREPARATION_APPROVED; Milestone A). Status: implementation closed for integration (OD-MVP-RELEASE PILOT_PREPARATION_APPROVED, L47), commit 8d30987d4 on feat/core-hook-t4 (L45); release acceptance requires the focused independent review limited to the installer diff, still pending, and the pilot; evidence recorded in L45: installer security tests pass, independent review done with a second correction verified by tests only, no reproducible regression attributable to the batch, final full suite 5361 of 5362 with the single failure classified as a pre-existing infrastructure test. Result: three installer defects fixed by reusing the existing checks and typed results, with no new security subsystem: (2) `kairo upgrade` and `kairo sync` return a failure or an explicit partial status and a non-zero exit code when a component that had to be updated is skipped because of a symbolic link; (3) the wizard detects conflicts before asking for confirmation and revalidates them before applying changes; (4) `kairo doctor` reports CONFLICT or UNSAFE_TARGET, never healthy, for a linked component that is not allowed. The yes flag accepts permitted changes only: it never authorizes overwriting an unsafe destination nor ignoring errors. Acceptance: installer security tests pass; independent review of the MA25b changes; no reproducible regression attributable to the batch; a final full-suite run on an idle machine after MA25b that is clean, or comparable evidence sufficient to classify the failures as pre-existing infrastructure failures. Closure: MA25 and MA25b close together when those hold, recorded here.
- MA26 (release blocker fixes, OD-MVP-L48 BLOCKER_FIX_APPROVED, L50; Milestone C). Status: implementation closed on release/v0.37.0, evidence in L51; the classification of the remaining items is Sam's. Scope: blockers B1, B2 and B3 of `odd/release/v0.37.0-acceptance.md` only, no new capability. Route: delegated direct, one writer (team-builder), tests first with a temporary HOME; trigger evidence: the orchestrator never writes files (Sam's global rule) and the change touches the installer (high-risk item 5), so one focused independent cross-review of the functional changes followed the writer's own checks. Acceptance: Sam's table quoted in L50. Commits on release/v0.37.0: 93c3b9c03 (B2), 9e5d11cfe (B3), 1b1df7b8e and f53074712 (B1), 22d2b1326, 791fcd2f1 and c62e1d3e8 (documentation of B1 and B3). Candidate commit: c62e1d3e8.
- MA27 (read-only audit of the Artificial Analysis integration, OD-MVP-AA-UTILIZATION READ_ONLY_AUDIT_APPROVED, L52; Milestone C). Status: audit done and recorded in L53; open pending the product owner's decisions (one authenticated check, the request budget, the frozen scores in the package). Scope: a focused audit, not a new routing system, with five checks: (1) whether MA18 and the router consume and process the free API, including pagination and null fields; (2) whether they distinguish model from effort variant; (3) whether benchmarks affect a real recommendation or are only stored; (4) cache, traceability of the query date and safe degradation without a key or when the API fails; (5) terms of use and attribution. Output: one verdict per capability, one of IMPLEMENTED, NOT_IMPLEMENTED, NOT_VERIFIED or BLOCKER; the existence of an integration in the code does not prove that the API adds value. A compatibility defect, if found, may be fixed for 0.37.0; no new selection algorithm before the end of the beta. Route: inline reading by the orchestrator plus one read-only code trace (team-verifier) and one external documentation check (team-researcher); trigger evidence: Mapping trigger, more than five sequential lookups. The product owner's claims listed in L52 are verified here. L54 adds one observed fact to row 11 of L53: with no evaluation data at all, team approval fails. L55 result of the authorized check: the path `/api/v2/data/llms/models` answers HTTP 410, so the integration is broken; the compatibility fix authorized in L52 is tracked as MA34.
- MA28 (real-host pilot with `claude --plugin-dir`, OD-MVP-AA-UTILIZATION READ_ONLY_AUDIT_APPROVED, L52; Milestone C). Status: Claude Code headless pilot run and recorded in L54; open for the visual pane check, Codex, and the product owner's classification of the findings. Scope: start with `claude --plugin-dir` and the product owner's existing signed-in session, in a temporary project. Conditions quoted from L52: "no modificar configuraciones personales, no copiar credenciales, no acceder a proyectos productivos y registrar sólo trazas sanitizadas". Codex only after its isolation mechanism is verified to avoid writes to the global configuration; if that is not possible, a dedicated account or machine. It validates the local plugin and part of the host behavior; it does not validate GitHub distribution or the full installer. Findings D9 to D12 and the uninstall and TTY blockers stay open; D13 stays pending an authenticated test and cannot be classified PASS because of stub tests.
- MA29 (single authorized run of `kairo aa-key check`, OD-MVP-REALHOST BLOCKERS_CONFIRMED, L55; Milestone C). Status: done, result in L55. Route: inline, one command.
- MA30 (onboarding and team formation without Artificial Analysis data, OD-MVP-REALHOST BLOCKERS_CONFIRMED, L55 findings A and B; Milestone C). Status: open. Scope: a user with no key and no cache can form and use a team from models whose compatibility was verified by other means, with no fabricated score; when no valid team can be formed the product says what is missing and how to resolve it; the step `kairo setup` recommends works in the user's state; setup makes no automatic model verification calls and states the potential consumption of the active verification step. Route: delegated writer after one read-only map; high risk items 3 and 5. Seat policy decided in L56 (manual assignment by the user among models with verified access, marked capability unverified, no new probes, no change to the team's structural requirements). Part B written, pending commit; part A in progress. Part A implemented and reviewed (L58 status); row P12u authorized in L58 and pending.
- MA31 (governance of generated and unrouted agents, OD-MVP-REALHOST BLOCKERS_CONFIRMED, L55 findings C and D; Milestone C). Status: open. Scope: one shared contract between agent generation by `roles sync` and router recognition, reusing the existing role registry, not accepting arbitrary agent names; with a governance contract verified as active and a task that requires governance, an agent with no authorized route is rejected with an identifiable reason or follows an alternative the contract explicitly allows; without active governance, host compatibility is kept and no governance credit is given. Route: delegated writer after one read-only map; high risk items 2 and 3.
- MA32 (explain the three Explorer models seen in the pilot, OD-MVP-REALHOST BLOCKERS_CONFIRMED, L55; Milestone C). Status: done, result in L56. Scope: explain `claude-haiku-5-5`, `claude-fable-5-1` and `claude-haiku-4-5-20251001` by correlating launch, `taskId`, `executionId`, routes snapshot, selected model, executed model and query time. Investigation only, no scorer or strategy change. Route: inline evidence reading.
- MA33 (validation of MA30 to MA32, OD-MVP-REALHOST BLOCKERS_CONFIRMED, L55; Milestone C). Status: open, in progress: runbook and rebuilt pilot project ready, real-contract rows P12u, P17 and P12 pending the product owner's run (L62, L63). Scope: focused tests, cross-review of the critical changes, repetition of the affected real-host scenarios, acceptance report update, documentary integration of L52 to L55 into `release/v0.37.0`. Round closed 2026-11-12 (L75): P12u evidence obtained, P17 and P12 PENDING not executed, contract disabled; a new small procedure is required to resume them.
- MA34 (Artificial Analysis compatibility fix authorized by L52: "Si descubrimos que la integración actual está rota, autorizo corregir el defecto de compatibilidad para 0.37.0"; Milestone C). Status: open. Scope: the reader and `kairo aa-key check` stop depending on the removed path and use the documented free endpoint. Route: delegated writer; high risk item 3.
- MA35 (test suite metrics, OD-KAIRO-TEST-FITNESS, L59; after the beta). Status: open, not started. Scope: measure total suite duration, the time of the ten slowest files, the percentage of reruns and the load-sensitive failures, to set evidence-based time budgets; evaluate one impact-selection candidate (DiffCI first, testpick if per-test coverage exists) against a historical set of changes, checking it misses no known regression; no new test selection engine before the beta.
- MA36 (exec parity for an evidence-verified manual seat, L60; Milestone C). Status: done, commit 5a5420a24 on release/v0.37.0; Codex review APPROVED; suite 5605 of 5605 and plugin 584 of 584; real-host row under a contract not run (L61). Scope: under an effective contract `kairo team exec` must answer the same row as the hook path, P12, for an acknowledged manual seat whose unscored model is verified by owned evidence, instead of P6; only that seat and only its own model; any other explicit model outside the pool stays P6 or P7; rows P10 and P11 still run first; no new row, no cell change, no plugin or protocol change. Route: delegated (the orchestrator does not write product code, L59).
- MA37 (local canary channel, OD-KAIRO ADAPTIVE_TEAMS, PROJECT INTELLIGENCE & LOCAL ADOPTION, L85 section 3; P1, before public release, once safe). Status: open, not started. Scope: "apruebo preparar el canal canary local como diseño y procedimiento de validación"; execution on personal projects "requiere un entorno aislado que no dependa de modificar las configuraciones globales". Assumption from the decision's text: the pilot starts in a secondary repository with a backup, running the candidate binary by absolute path with an isolated configuration; no global install of the candidate while finding 10 and the plugin versus core mismatch remain open.
- MA38 (adaptive standard team, OD-KAIRO ADAPTIVE_TEAMS, L85 section 1; P1, next functional increment). Status: open, not started. Scope: an approved team must not be required to start; three modalities (adaptive standard team, project-optimized team, custom team); the standard team is a capability template (analysis, implementation, quality, documentation, coordination) with models selected dynamically from those effectively accessible, not a fixed list; a provisional session without manual approval for low-risk query or exploration; for writes and governed delegations the user authorizes the scope once and Kairo operates inside it; "Esto no debe saltarse P17": a linked task without an authorized route is still rejected, and the standard team must generate and validate its own route.
- MA39 (integral project analysis, OD-KAIRO ADAPTIVE_TEAMS, L85 sections 2 and 5; P1, next functional increment). Status: open, not started. Scope: a Project Intelligence Profile with verifiable references, explicit uncertainties and a cell proposal, over eight dimensions (objectives, documentation, architecture, technologies, quality, operation, organization, evolution); static inspection without models for facts such as language, database or tests; AI only to interpret objectives, evaluate architectural decisions and propose teams; understanding of the project separated from executor availability; missing quota telemetry marked `unknown`, separated from real access verification, allowing a provisional proposal without granting unproven eligibility or credit; a specific analyze error instead of a generic message pointing to `doctor` (related, not contained in main: commit `2fea40bf4` on `fix/team-analyze-error-detail`); rule: "no recomendar un stack por defecto si todavía no se conocen los requisitos que justificarían su elección", with alternatives compared from objectives and constraints and Artificial Analysis limited to model evaluation.
- MA40 (teams without Git and temporary sessions, OD-KAIRO ADAPTIVE_TEAMS, L85 sections 3 and 6; P2, after the beta gate). Status: open, not started. Scope: "si es una tarea personal desde la terminal, debe funcionar sin obligarte a crear un repositorio Git"; support without Git is part of the goal but "no debemos afirmar que ya existe si todavía no se implementó". The decision gives no further detail on temporary sessions (assumption: they relate to the provisional session of MA38).
- MA41 (deep optimization of Engram, Obsidian and context, OD-KAIRO ADAPTIVE_TEAMS, L85 section 4; P2, later iteration). Status: open, not started. Scope: an audit of what content is reloaded in each session, how much it contributes to model context, what is duplicated among Engram, Obsidian, ODD and instructions, which oversized test results could be summarized and kept as referenceable files, and which checkpoints allow continuing without recovering the whole history; `session-lens` as a Claude diagnostic tool complemented by Codex and router telemetry, no new memory manager; stored session sizes do not equal active context tokens; rule: "persistencia completa de la evidencia y recuperación selectiva del contexto", with no useful information removed only to reduce sizes.

## Log

- L1: see S125 in odd/tasks/router-provider-authority.md (verbatim). Authorization quote: "Autorizo registrar esta decisión de alcance y preparar un plan cerrado de entrega del MVP, pero todavía no otra implementación."
- L2 (2026-11-09): OD-MVP-1, Sam's decision verbatim:

> ## Decisión: `OD-MVP-1 — SCOPE_AND_DELIVERY_APPROVED`
>
> Sí, apruebo el plan MVP y autorizo iniciar el Hito A (MA1–MA7), pero incorporando dos requisitos fundamentales que faltaban: optimización del contexto y rediseño del panel de Kairo.
>
> Ambos deben formar parte de la primera versión estable con gobernanza. No son mejoras opcionales para después.
>
> También quiero cambiar nuestra forma de trabajar: a partir de ahora, una mejora no debe bloquear la publicación salvo que incumpla un criterio explícito del MVP.
>
> ## 1. Los tres puntos pendientes
>
> | Decisión                  | Resolución                                                                                              |
> | ------------------------- | ------------------------------------------------------------------------------------------------------- |
> | Rendimiento del hook      | Aprobado: p95 inferior a 2000 ms en el recorrido completo                                               |
> | Rama de release           | `release/v0.3.0`                                                                                        |
> | Integraciones gobernadas  | Claude Code y Codex CLI, condicionadas a superar sus pruebas reales                                     |
> | Integraciones compatibles | OpenCode, Pi, Cursor, Gemini y adaptadores genéricos, únicamente donde exista compatibilidad comprobada |
>
> Como Kairo ya tiene una versión pública 0.2.2, propongo que la primera versión con gobernanza sea 0.3.0, comenzando con `0.3.0-beta.1` para el piloto y publicando `0.3.0` al superar los criterios de salida.
>
> Una precisión sobre el rendimiento: el presupuesto de 2000 ms debe abarcar la operación completa, no 2000 ms por cada consulta. Los timeouts internos deben reservar margen para que la operación termine de manera controlada.
>
> ## 2. Nuevo requisito M16 — Optimización del contexto
>
> La pérdida de contexto que describes merece prioridad.
>
> Ejemplo reportado: primera tarea tras iniciar sesión
>
> # 100% → 86%
>
> −14 puntos
>
> Es una caída de contexto disponible, no necesariamente 14% de cuota de suscripción consumida ni 14% atribuible a Kairo.
>
> Sabemos que anteriormente C1 consiguió reducir una carga inicial de aproximadamente 63k a 7.8k tokens para una ruta de Builder. Eso demuestra que existen oportunidades importantes.
>
> Ahora debemos medir el costo de arranque de una sesión completa, no sólo el de un subagente.
>
> M16 debe cubrir:
>
> - Instrucciones globales y archivos `CLAUDE.md` / `AGENTS.md`.
> - Contexto añadido por Kairo y Gentle AI.
> - Duplicación de instrucciones entre host, agentes y plugins.
> - Descripciones de herramientas, MCP y capacidades cargadas inicialmente.
> - Contexto necesario para iniciar una tarea frente a contexto que puede recuperarse bajo demanda.
> - Comparación con Kairo habilitado, deshabilitado y sin instalar.
>
> La medición debe separar el contexto inicial del consumo propio de la primera tarea. Propongo buscar una reducción de al menos el 50% de la sobrecarga inicial atribuible a Kairo, sin eliminar controles esenciales. Si el 14% proviene mayoritariamente de otros componentes, debemos reportarlo, no atribuírselo artificialmente al runtime.
>
> No necesitamos inventar otro sistema de memoria ni un nuevo mecanismo de compactación.
>
> ## 3. Nuevo requisito M17 — Rediseño del panel
>
> La captura confirma que el panel actual no funciona como un resumen operativo.
>
> Sus problemas visibles son concretos: muestra un rol `Unknown`, tiempos de espera desconocidos, `opencode-go: unavailable`, modelos asignados a varios roles y después una lista de 73 veredictos que ocupa prácticamente toda la pantalla.
>
> Un panel de estado no debe comportarse como un volcado de logs.
>
> ### Propuesta visual para la primera versión
>
> KAIRO RUNTIME
>
> Vista propuesta
>
> CLAUDE · 5H
>
> ## 80%
>
> Semana 92%
>
> CODEX · 5H
>
> ## 31%
>
> Semana 89%
>
> Agentes y routing
>
> Vista resumida
>
> Technical Lead
>
> Astra · Codex
>
> Builder
>
> Sin ruta elegible
>
> Reviewer
>
> Astra · Codex
>
> Veredictos pendientes
>
> ### 73
>
> Los detalles, historiales y errores completos se consultan bajo demanda.
>
> Mockup basado en los valores de la captura, no en una lectura actual del sistema.
>
> Este panel debe tener dos niveles: una vista compacta que informe lo esencial y una vista detallada para diagnóstico.
>
> M17 también debe corregir la semántica: `Unknown` no puede presentarse como si fuera un rol asignado; `waiting until unknown` debe convertirse en una razón comprensible; los roles no deben multiplicarse por cada ejecución histórica; y las cuotas deben mostrar su fecha de actualización y si el dato está vencido.
>
> El panel debe consumir una fuente de estado existente. No construiremos otro motor de monitoreo para dibujarlo.
>
> ## 4. MVP actualizado: qué sí y qué no bloquea publicar
>
> | Bloque                                                     | Prioridad de release                               |
> | ---------------------------------------------------------- | -------------------------------------------------- |
> | Instalación limpia, actualización y desinstalación         | Obligatorio                                        |
> | Uso en proyectos nuevos y existentes                       | Obligatorio                                        |
> | Continuidad cuando Kairo está deshabilitado o no instalado | Obligatorio                                        |
> | Routing funcional Claude/Codex y Builder elegible          | Obligatorio                                        |
> | Gobernanza de las rutas oficialmente soportadas            | Obligatorio                                        |
> | Contexto inicial controlado — M16                          | Obligatorio                                        |
> | Panel compacto, correcto y legible — M17                   | Obligatorio                                        |
> | Proveedores adicionales                                    | Evolución posterior                                |
> | Acreditación remota `VERIFIED`                             | Evolución posterior                                |
> | Todas las tareas T6–T11                                    | Sólo las indispensables para los contratos del MVP |
> | Optimizaciones adicionales y nuevas interfaces             | Evolución posterior                                |
>
> No prometeremos que Kairo gobierna todos los hosts si todavía sólo hemos validado dos. Pero un proyecto que no utilice Kairo debe seguir funcionando normalmente, y uno que lo instale debe poder empezar sin configurar manualmente toda nuestra arquitectura.
>
> ## 5. Autorización del Hito A
>
> Autorizo MA1–MA7, con la siguiente condición: actualizar primero `odd/tasks/kairo-runtime-mvp.md` para incluir M16 y M17 y la definición de versión 0.3.0.
>
> El Hito A debe cerrar los bloqueantes demostrados de las rutas que vamos a publicar y establecer mediciones de referencia para contexto y panel. No autorizo introducir otro framework de gobernanza ni nuevos subsistemas.
>
> La rama `release/v0.3.0` queda aprobada como destino de integración futura. Crear o preparar esa rama es válido, pero todavía no autorizo fusionar automáticamente los worktrees, activar el contrato, instalar el plugin ni publicar el paquete.
>
> Los siguientes hitos serán integración instalable, piloto y publicación. Cada uno tendrá sus pruebas de salida; no volveremos al inicio por cada advisory.
>
> ## 6. La nueva regla de trabajo
>
> A partir de ahora quiero que cada tarea tenga tres elementos obligatorios: resultado funcional, prueba de aceptación y condición de cierre.
>
> Una vez que esos tres se cumplen, la tarea se cierra. Si aparece una mejora no bloqueante, va al backlog de una versión posterior.
>
> No quiero que una revisión de seguridad o arquitectura genere automáticamente cinco nuevos requisitos y retrase indefinidamente la publicación.
>
> Objetivo confirmado: lanzar Kairo Runtime 0.3.0 como un producto real, instalable, eficiente y útil para otros desarrolladores. El routing, la gobernanza, el contexto y la experiencia de uso deben funcionar conjuntamente. No necesitamos resolver todos los problemas imaginables para llegar a esa primera versión.
- L3 (2026-11-09): M16 knowledge-tool addendum, Sam's text verbatim:

> Sí. Seguimos considerando Engram, CodeGraph, Graphify, Obsidian y Context7, pero debemos integrarlos estratégicamente. La idea no es instalar más herramientas esperando que automáticamente reduzcan tokens, sino conseguir que Claude Code, Codex y Kairo carguen únicamente el contexto necesario para cada tarea.
>
> Esto forma parte de M16 — Optimización del contexto, pero no todas las herramientas deben convertirse en requisitos obligatorios del MVP 0.3.0.
>
> ## 1. Qué papel tendría cada herramienta
>
> | Herramienta | Responsabilidad                                                      | Prioridad para MVP                           |
> | ----------- | -------------------------------------------------------------------- | -------------------------------------------- |
> | Engram      | Memoria persistente de decisiones, avances y contexto entre sesiones | Alta — ya lo utilizamos                      |
> | CodeGraph   | Comprensión estructural del código, dependencias y relaciones        | Alta — aprovechar la integración existente   |
> | Graphify    | Representación y exploración de relaciones del proyecto              | Evaluar si aporta algo adicional a CodeGraph |
> | Context7    | Documentación técnica actualizada, recuperada bajo demanda           | Alta — integración selectiva                 |
> | Obsidian    | Base de conocimiento legible y organizada a largo plazo              | Posterior — opcional                         |
>
> La principal precaución es evitar que Engram, Obsidian, CodeGraph y Graphify terminen almacenando o recuperando cuatro veces la misma información.
>
> ## 2. Arquitectura de contexto que buscamos
>
> Nueva sesión — Claude Code / Codex
>
> Instrucciones mínimas · Estado compacto · Capacidades disponibles
>
> Kairo + Gentle AI
>
> Identifican la tarea y el contexto realmente necesario
>
> Engram
>
> Decisiones y memoria
>
> CodeGraph / Graphify
>
> Estructura y dependencias
>
> Context7
>
> Documentación externa
>
> Obsidian
>
> Conocimiento opcional
>
> Contexto específico de la tarea
>
> Sólo fragmentos relevantes, con referencias y límites de tamaño
>
> La regla es sencilla: primero identificar qué necesitamos; después recuperar el contexto. No cargar toda la documentación, todos los grafos y todas las memorias al iniciar la sesión.
>
> ## 3. Qué optimizaría primero
>
> Tenemos antecedentes concretos: C1 redujo significativamente la carga inicial de un Builder, pero eso no significa que hayamos optimizado la sesión principal.
>
> Para el MVP definiría cuatro medidas:
>
> 1. Bootstrap mínimo: auditar `CLAUDE.md`, `AGENTS.md`, agentes, skills y herramientas MCP para eliminar instrucciones duplicadas y carga innecesaria.
> 2. Engram compacto: guardar decisiones y punteros a documentos, no copias completas de las especificaciones ODD.
> 3. Recuperación bajo demanda: CodeGraph para navegar código y Context7 para documentación externa, cuando la tarea lo justifique.
> 4. Presupuesto por tarea: medir cuánto contexto se añadió, de dónde provino y si se utilizó.
>
> Y mediría tres momentos por separado: contexto inmediatamente después de iniciar, después de preparar la primera tarea y al terminarla. Así podremos saber si esa caída de 100% a 86% proviene de instrucciones iniciales, herramientas o trabajo real.
>
> ## 4. ¿Debemos implementar las cinco herramientas para publicar?
>
> No. Mi recomendación es mantener Engram y CodeGraph como capacidades existentes, usar Context7 selectivamente y evaluar Graphify frente a CodeGraph antes de introducir otra dependencia. Obsidian puede esperar.
>
> Para declarar M16 terminado no necesitamos integrar todas las herramientas. Necesitamos demostrar que Kairo:
>
> - No carga información innecesaria en cada sesión.
> - Recupera contexto relevante cuando hace falta.
> - No duplica masivamente instrucciones y memorias.
> - Mantiene sus controles de seguridad al optimizar.
> - Reduce de forma medible la sobrecarga de contexto respecto a una línea base comparable.
>
> Mi decisión para el MVP 0.3.0: conservar las cinco opciones en la estrategia de conocimiento, pero hacer obligatorio el resultado de optimización, no la instalación de todas.
>
> Así evitamos convertir M16 en otro proyecto interminable. El objetivo es que Kairo aproveche el contexto de manera inteligente, independientemente del host y del proyecto, y que el desarrollador pueda comenzar una sesión sin gastar una parte importante de su ventana antes de trabajar.
- L4 (2026-11-09): OD-MVP-VERSION, Sam's decision verbatim:

> ## Decisión: `OD-MVP-VERSION — v0.37.0 APPROVED`
>
> Elegimos `0.37.0`, con `release/v0.37.0` como rama y `0.37.0-beta.1` como primera versión piloto.
>
> Coincido en que todavía no corresponde publicar Kairo Runtime como 1.0.0. Primero necesitamos validar la gobernanza, las integraciones soportadas y la instalación en proyectos reales.
>
> | Elemento                 | Decisión                                     |
> | ------------------------ | -------------------------------------------- |
> | Versión actual reportada | `0.36.0`                                     |
> | Próxima versión objetivo | `0.37.0`                                     |
> | Rama de integración      | `release/v0.37.0`                            |
> | Primer prerelease        | `0.37.0-beta.1`                              |
> | Versión pública estable  | `0.37.0`, tras superar los criterios del MVP |
> | `1.0.0`                  | Se evaluará posteriormente                   |
>
> ### Condiciones para publicar
>
> La versión `0.37.0` debe entregar un producto instalable y funcional, con:
>
> - Routing y gobernanza comprobados para Claude Code y Codex CLI.
> - Funcionamiento en proyectos nuevos, existentes y sin configuración previa.
> - Optimización de contexto medible (M16).
> - Panel operativo claro y legible (M17).
> - Instalación, actualización, recuperación y desinstalación verificadas.
> - Limitaciones documentadas para integraciones todavía no gobernadas.
>
> La versión no tiene que ser perfecta, pero las capacidades anunciadas deben funcionar.
>
> ### Qué autorizo ahora
>
> Autorizo actualizar el plan MVP, sus referencias de release y la documentación para sustituir `0.3.0` por `0.37.0`.
>
> También autorizo continuar MA1 cuando termine la validación de la línea base, según el alcance previamente aprobado.
>
> No autorizo todavía crear la rama de release, cambiar la versión del paquete, publicar en npm ni realizar merge o push. Eso corresponde a los hitos de integración y entrega.
>
> Objetivo confirmado: Kairo Runtime v0.37.0, primera versión de esta etapa con gobernanza integrada, contexto optimizado y experiencia de uso mejorada.
- L5 (2026-11-09): OD-MVP-MA1b, Sam's decision verbatim:

> ## Decisión: `OD-MVP-MA1b — ZERO_CLOCK_SKEW_CONFIRMED`
>
> Sí. Confirmo que la Regla B de S124 exige tolerancia cero para directivas emitidas en el futuro.
>
> La decisión ya estaba establecida: core y hook se ejecutan en el mismo host, por lo que no necesitamos aceptar directivas cuyo `issuedAt` sea posterior al momento de validación.
>
> La condición es:
>
> ```
> issuedAt <= now &&
> now < expiresAt &&
> expiresAt - issuedAt <= 300_000
> ```
>
> Por tanto:
>
> | Hallazgo                                    | Estado                                     |
> | ------------------------------------------- | ------------------------------------------ |
> | F1 — Reutilización entre roles              | Implementado en MA1; falta revisión válida |
> | F2 — Reutilización entre modelos originales | Implementado en MA1; falta revisión válida |
> | F3 — Directiva emitida en el futuro         | BLOCKER: corregir                          |
> | F4 — Directiva vencida antes del spawn      | Implementado en MA1; falta revisión válida |
> | F8 — Agotamiento posterior a la directiva   | Pendiente de comprobar y corregir          |
>
> Autorizo un lote MA1b limitado a F3 y F8, con estas condiciones:
>
> - Eliminar la tolerancia de 60 segundos tanto del core como del validador del hook.
> - Actualizar los tests de paridad y añadir el caso `issuedAt = now + 1 ms`.
> - Evitar reutilizar una directiva cuando haya surgido una restricción de agotamiento nueva y vigente que la contradiga.
> - No extender la corrección a otros componentes ni modificar la arquitectura del protocolo.
>
> Hay otro problema que debemos corregir antes de declarar MA1 cerrado: la revisión de Codex no es válida. Dos veces devolvió `codex-review-last.md` de una ejecución anterior. No podemos interpretar esos resultados como revisión de `65bfe5c1a`.
>
> Para la siguiente revisión, autorizo utilizar la invocación directa de Codex, sin ese wrapper, y exigir que el informe identifique el commit y los archivos exactos inspeccionados. Si no coincide, el resultado se descarta.
>
> ## Además: dos requisitos importantes para el MVP 0.37.0
>
> ### Onboarding y API propia de Artificial Analysis
>
> Confirmo que el onboarding inicial debe permitir que cada usuario configure su propia API key de Artificial Analysis (AA).
>
> Esto debe funcionar tanto en una instalación limpia como al configurar Kairo posteriormente:
>
> - Clave personal opcional, sin credenciales compartidas incluidas en el paquete.
> - Almacenamiento local seguro, nunca dentro del repositorio ni de las trazas.
> - Comprobación explícita de la clave y explicación de errores de acceso.
> - Funcionamiento degradado si no existe clave, sin inventar rankings o datos actuales.
> - Separación entre la API de evaluación de modelos y las suscripciones de Claude/Codex utilizadas para ejecutar trabajo.
>
> La ausencia de una API key de AA no debe impedir instalar ni utilizar las funciones básicas de Kairo.
>
> ### Referencias externas revisadas en GitHub
>
> | Proyecto                                                                                      | Qué podemos aprovechar                                                | Decisión MVP                                                  |
> | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
> | [Ponytail](https://github.com/DietrichGebert/ponytail?utm_source=chatgpt.com)                 | Minimización de código, medición de tokens, tests y revisión enfocada | Referencia prioritaria para M16 y calidad                     |
> | [Taste Skill](https://github.com/Leonxlnx/taste-skill?utm_source=chatgpt.com)                 | Criterios de diseño visual y validación en navegador                  | Referencia para el panel M17                                  |
> | [pstack](https://github.com/cursor/plugins/blob/main/pstack/README.md?utm_source=chatgpt.com) | Playbooks de ingeniería, verificaciones y flujo multi-modelo          | Reutilizar ideas; evitar duplicar Gentle AI                   |
> | [MCP Gateway](https://github.com/Samuel-Mencke/mcp-gateway?utm_source=chatgpt.com)            | Capacidades MCP bajo demanda y acceso unificado                       | Evaluación posterior; no introducir otro servicio obligatorio |
>
> Ponytail publica resultados de reducción de tokens y código en sus benchmarks, pero esas cifras son propias de sus pruebas: no debemos asumir el mismo ahorro en Kairo sin medirlo.
>
> ## Orden de ejecución
>
> Para evitar extender otra vez el roadmap:
>
> 1. Cerrar MA1b — F3/F8, con tests deterministas.
> 2. Obtener una revisión independiente auténtica de MA1/MA1b sobre el commit correcto.
> 3. Continuar MA2 y los bloqueantes restantes del runtime.
> 4. Incluir onboarding BYOK, ahorro de contexto, calidad de tests y panel compacto en los criterios de salida del MVP.
> 5. Mantener las herramientas externas como referencias hasta demostrar que incorporarlas aporta valor medible.
>
> No autorizo instalar automáticamente los cuatro proyectos externos ni añadirlos como dependencias del runtime.
>
> La prioridad sigue siendo publicar Kairo Runtime 0.37.0 como un producto funcional. Las herramientas y técnicas externas deben ayudarnos a llegar a ese objetivo, no convertirse en otros cuatro proyectos que terminar antes.

- L6 (2026-11-10): MA1 closed: MA1-MA1d landed (65bfe5c1a, fae107434, 4d226db14, a085f99c8); direct Codex review found one F8 blocker, fixed in one correction batch, recheck BLOCKER RESOLVED. OD-MVP-ENGRAM recorded the Engram premature SessionEnd as known debt (KD6). MA2 started.
- L7 (2026-11-10): MA2 closed: e63f074a9 and 94dcffc85; direct Codex review found two blockers, fixed in one correction batch (MA2b), recheck both RESOLVED. MA3 (F7) started.

- L8 (2026-11-10): OD-MVP-ORCHESTRATION, Sam's decision verbatim:

> Sí. Las tres estrategias deben formar parte de Kairo Runtime: ejecución secuencial, ejecución paralela y enrutamiento dinámico. Pero hay una distinción importante: las hemos considerado en la arquitectura, aunque todavía no tenemos evidencia suficiente de que las tres funcionen de extremo a extremo con las mismas garantías.
>
> ## 1. Las tres estrategias de orquestación
>
> 1. Secuencial — Pipeline
>
> Cada etapa depende de la anterior. Útil para diseño, implementación y revisión.
>
> 2. Paralelo — Fan-out / Fan-in
>
> Tareas independientes se ejecutan simultáneamente y luego se integran sus resultados.
>
> 3. Enrutamiento — Routing
>
> Se selecciona un ejecutor elegible según tarea, capacidades, cuota, riesgo y restricciones.
>
> ## 2. Cómo deben coexistir en Kairo
>
> No deberíamos obligar al usuario a elegir un modo global. Kairo debe poder combinar las tres estrategias dentro de una misma ejecución.
>
> Por ejemplo:
>
> 1. Secuencial: Architect define tres tareas.
> 2. Paralelo: tres Builders trabajan en tareas independientes.
> 3. Routing: cada Builder se asigna al proveedor/modelo elegible.
> 4. Secuencial por tarea: cada implementación pasa por su Reviewer independiente, respetando S5.
> 5. Integración: se consolidan los resultados y se validan las dependencias.
>
> El orquestador host conserva el control. Kairo gestiona decisiones operativas y admisión, sin introducir un segundo orquestador maestro.
>
> ### Estado frente al MVP
>
> | Estrategia | Estado conocido |
> | ---------- | --------------- |
> | Routing    | Implementado parcialmente; seguimos cerrando su gobernanza |
> | Secuencial | Representado por los contratos y etapas de trabajo; falta validar el flujo completo |
> | Paralelo   | Considerado mediante células y ejecución independiente; falta acreditar su integración E2E |
>
> Propongo añadir una matriz de aceptación al MVP, no un motor nuevo de workflows. Tres escenarios de integración bastan para demostrar estas estrategias inicialmente, incluyendo fallos, cuotas y revisión cruzada.
>
> ## 3. Sobre MA5 y el rendimiento
>
> El cambio reportado va en la dirección correcta. Un presupuesto compartido de 1800 ms es preferible a acumular timeouts independientes.
>
> Camino inactivo lento: 1806 ms. Antes: 4331 ms.
>
> Camino activo lento: 1681 ms. Antes: 2491 ms.
>
> Pero señalaría dos aspectos:
>
> - Un p95 calculado sobre 20 lanzamientos es una señal preliminar, no una validación estadística sólida del comportamiento bajo carga.
> - Los 5–7 tests que fallan en paralelo deben quedar caracterizados. Pasar aisladamente no demuestra que no exista una condición de carrera real.
>
> Autorizo completar la suite y, si supera la validación acordada, realizar el commit local de MA5 y la revisión independiente de MA3–MA5. Sin ampliar el protocolo.
>
> ## 4. Decisión para el MVP
>
> `OD-MVP-ORCHESTRATION — THREE_PATTERNS_REQUIRED`
>
> Las tres estrategias serán capacidades verificables de Kairo Runtime 0.37.0, usando los mecanismos existentes:
>
> - No crear un nuevo workflow engine.
> - No duplicar la selección de proveedores.
> - No requerir paralelismo cuando las tareas tienen dependencias.
> - No permitir que la ejecución paralela eluda cuotas, admisión o revisión por tarea.
>
> El objetivo es que Kairo seleccione cómo organizar el trabajo según las dependencias reales y cómo asignarlo según los recursos disponibles. Eso es más importante que agregar más modelos o más agentes.
>
> Con ello tenemos una definición mucho más concreta de la orquestación funcional que queremos publicar.

- L9 (2026-11-10): OD-MVP-ORCHESTRATION recorded as M27 and MA19. Sam authorized completing the suite and, if it passes the agreed validation, the local MA5 commit and the independent review of MA3 to MA5, without widening the protocol. Sam also noted that a p95 over 20 launches is a preliminary signal and that the 5 to 7 tests failing in parallel must be characterized. MA5 validation is pending: at 08:21 the machine was on battery with macOS low power mode on, a state already shown to make the hook timing tests unreliable, so the suite run waits for AC power. MA5 stays uncommitted in the core-hook-t4 worktree.

- L10 (2026-11-10): two intermediate MA5 decisions, both superseded the same day by OD-MVP-MA5 ROLLBACK_APPROVED (L11). The full text of these two messages is not reproduced; the quoted sentences are verbatim. `OD-MVP-MA5 — REGRESSION_INVESTIGATION`: "Regla: si la inactividad está comprobada, conservar legacy. Si la activación es desconocida, no interpretar `Unknown option` como autorización para saltarse V1." "No aceptaremos resolver este test introduciendo un bypass de admisión." "No propongo aumentar el timeout para hacer pasar el test." "Si el cambio de X2 a X3 es reproducible y contradice el contrato, es un BLOCKER de MA5, aunque todos los tiempos estén por debajo de 2000 ms." `OD-MVP-MA5 — TARGETED_REGRESSION_FIX`: "No quiero un número arbitrario agregado para satisfacer un único test." "Si el arreglo especulativo aumenta la complejidad o introduce nuevas carreras, prefiero conservar la versión anterior del hook y registrar la optimización pendiente antes que extender indefinidamente MA5."

- L11 (2026-11-10): OD-MVP-MA5 ROLLBACK_APPROVED, Sam's decision verbatim:

> ## Decisión: `OD-MVP-MA5 — ROLLBACK_APPROVED`
>
> Confirmo: descartamos MA5 del árbol, conservamos su patch y registramos F13 como deuda conocida. No autorizo modificar el runner ni introducir concurrencia especulativa.
>
> La evidencia justifica detener esta optimización. El transporte serializado impide que la consulta especulativa obtenga el beneficio esperado y modificarlo introduciría riesgos de concurrencia y contención de locks.
>
> ### 1. Acciones autorizadas
>
> 1. Guardar el diff completo de MA5 en el reporte de T4, incluyendo archivos nuevos si los hubiera.
> 2. Verificar que el patch pueda recuperarse y registrar su checksum.
> 3. Revertir exclusivamente los cambios no commiteados de MA5, sin afectar MA1–MA4 ni otros archivos.
> 4. Confirmar que el árbol vuelve al estado previo a MA5.
> 5. Registrar F13 como `KNOWN_DEBT`, con evidencia, causa identificada y alternativas futuras.
> 6. Continuar con la revisión independiente de MA3–MA4 y después M16.
>
> No necesitamos ejecutar nuevamente toda la suite si se comprueba que el código quedó idéntico al baseline ya validado. Basta verificar la restauración y ejecutar las pruebas focalizadas necesarias.
>
> ### 2. F13 no está resuelto
>
> | Elemento                           | Decisión             |
> | ---------------------------------- | -------------------- |
> | Optimización MA5                   | Revertida            |
> | Transporte serializado             | Sin cambios          |
> | Consulta redundante                | Se conserva          |
> | Latencia degradada de 3612–4331 ms | Problema conocido    |
> | Nueva concurrencia en el runner    | No autorizada        |
> | Modificación del protocolo         | Fuera del MVP actual |
>
> La investigación futura podrá comparar eliminar la segunda lectura mediante una extensión de protocolo frente a mejorar el transporte. No debe convertirse en otra tarea obligatoria de este ciclo.
>
> ### 3. Importante: M20 y la publicación
>
> Aquí necesitamos mantener la coherencia con nuestra regla de cierre.
>
> No podemos declarar M20 cumplido si su contrato exige que todos los recorridos terminen antes de 2000 ms.
>
> Sin embargo, un p95 inferior a 2000 ms tampoco exige que absolutamente todas las ejecuciones individuales estén debajo de ese límite.
>
> Para el MVP establezco esta distinción:
>
> - Rendimiento normal: debe cumplir el p95 inferior a 2000 ms, medido con una carga representativa y muestras suficientes.
> - Degradación por core lento: queda como excepción documentada F13, con tiempos observados de hasta 4331 ms.
> - Seguridad: cualquier fallo de comunicación debe conservar las restricciones de admisión y no producir lanzamientos indebidos.
>
> El plan deberá reflejar expresamente esta excepción; no debemos presentar el límite de 2000 ms como una garantía universal. Si el p95 representativo falla o la degradación provoca problemas operativos importantes, M20 seguirá bloqueando la publicación.
>
> ### 4. Prioridad inmediata
>
> - MA5 — Optimización del hook: Revertir
> - F13 — Latencia degradada: Known debt
> - MA3–MA4 — Revisión independiente: Siguiente
> - M16 — Contexto y ahorro de tokens: Prioridad MVP
>
> La prioridad es cerrar Kairo Runtime 0.37.0, no conseguir que cada optimización experimental funcione a cualquier costo.
>
> MA5 nos proporcionó información útil sobre los límites del transporte. Conservamos ese aprendizaje, volvemos a la implementación estable y avanzamos.
>
> Esta decisión no autoriza instalación, merge, push ni publicación.

- L12 (2026-11-10): MA5 evidence and progress. Classification reached: X3 instead of X2 under load, REGRESSION; legacy differential under load, REGRESSION; F13 (4) p95 active, INCONCLUSIVE (failed once in the full suite, not reproduced alone or in parallel); `t4-s121` test 6 alone failed on its 2000 ms wall-time assumption at line 142, not on X2. The Builder stopped before edits on the runner finding. Rollback and patch preservation delegated in `core-hook-t4`; recorded as M28 and KD11. Next: independent review of MA3 and MA4, then M16. The Codex-routed test runner executes inside a sandbox (70 EPERM failures on both revisions), so full suites are run from the main session.

- L13 (2026-11-10): OD-MVP-MA4b TARGETED_COMPLETION_APPROVED, Sam's decision verbatim:

> ## Decisión: `OD-MVP-MA4b — TARGETED_COMPLETION_APPROVED`
>
> Autorizo MA4b, limitado a los hallazgos 1, 3 y 4. El hallazgo 2 pasa a deuda conocida `KD12`.
>
> La razón es concreta: MA4 todavía no cumple completamente su criterio de aceptación. Aunque F9 sea preexistente, los auxiliares no pueden ignorar un agotamiento confirmado del proyecto que originó la ejecución.
>
> No necesitamos otra auditoría general ni rediseñar la admisión.
>
> ### Alcance autorizado
>
> | Hallazgo                                           | Decisión  | Criterio de cierre                                                                            |
> | -------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
> | 1. Cursor Auto y bootstrap ASK pierden el proyecto | Corregir  | Las ejecuciones auxiliares reciben el proyecto de origen y respetan su agotamiento confirmado |
> | 3. Fallo del lazy import                           | Corregir  | Devuelve un resultado tipado, sin excepción inesperada ni lanzamiento que evada restricciones |
> | 4. Tests incompletos                               | Completar | Cubrir Cursor con su marcador correcto, OpenCode Zen y los callers reales de bootstrap        |
> | 2. Detección Git frágil                            | `KD12`    | Documentar limitación y reproducción; no modificar MA3                                        |
>
> ### Restricciones de MA4b
>
> - No introducir un nuevo Router ni otro sistema de gobernanza.
> - No convertir `quick-ask` o las sondas en lanzamientos gobernados por V1.
> - No añadir consultas adicionales al core para cada ejecución auxiliar si la evidencia vigente ya está disponible.
> - No modificar las reglas de agotamiento, crédito o clasificación.
> - No instalar dependencias nuevas.
>
> La propagación de identidad debe utilizar los mecanismos existentes y no permitir que el llamador falsifique un proyecto distinto para eludir una restricción.
>
> ### Validación y cierre
>
> Exijo tests específicos que demuestren que Cursor Auto, bootstrap ASK y OpenCode Zen respetan los marcadores correspondientes, además de comprobar que los errores de importación se manejan de forma tipada.
>
> Después:
>
> 1. Ejecutar pruebas focalizadas y suite completa fuera del sandbox restrictivo.
> 2. Obtener una revisión cruzada independiente y acotada al diff de MA4b.
> 3. Si no hay bloqueantes, registrar el commit local y cerrar MA4.
> 4. Continuar inmediatamente con M16 — Optimización de contexto y tokens.
>
> Los tests intermitentes preexistentes se registrarán separadamente; no reabriremos MA4 por hallazgos ajenos a su contrato.
>
> ## Sobre el ritmo del MVP
>
> Quiero establecer un límite adicional: MA4b es el último lote correctivo autorizado para esta unidad. Si la revisión descubre un nuevo problema, deberá demostrar que incumple directamente un criterio de publicación para bloquear el cierre. Las mejoras de robustez no críticas irán al backlog.
>
> La siguiente prioridad es M16, donde tenemos una oportunidad importante de mejorar la experiencia real: menor carga inicial de contexto, menos tokens desperdiciados y continuidad entre sesiones.
>
> Objetivo: cerrar MA4 de forma verificable y avanzar, no iniciar otro ciclo indefinido de correcciones.
>
> Esta autorización permite implementación, pruebas, revisión y commit local tras validación favorable. No autoriza merge, push, instalación ni publicación.

- L14 (2026-11-10): MA5 rollback evidence and independent review of MA3 and MA4. MA5 rollback completed in `core-hook-t4`: patch `odd/t4/ma5-hook-budget.patch`, 252 lines, SHA-256 `6d61929d48f25555fe8c80ea8510266f923dd6d5b992265bf2aa5b5b6ec642be`; recovery proved by `git apply` on a copy of `b82eff1fb` with the three files byte-identical; hook code identical to `b82eff1fb`; commit `eb1276cb8`. Focused tests on the restored tree: `t4-s121` 7 of 7, plugin 494 pass, `hook-legacy-differential` pass. One interim failure of `test/core-hook-t0/guard.js` was caused by a docs commit made in the main checkout while the test ran (the guard requires that no HEAD moves during the test); it passed when rerun. Independent review of MA3 and MA4: MA3 PASS, MA4 PASS with incomplete acceptance; spec verdicts M1 PASS, M2 PARTIAL, M3 PASS, M6 PARTIAL, M18 OPEN; the reviewer could not run tests because of sandbox EPERM. Advisories: (1) Cursor Auto and bootstrap ASK lose the originating project, so a confirmed exhaustion of that project is not respected (`quick-ask.js` 18 to 24, `bootstrap-analyzer-adapters.js` 135 and 213), pre-existing; (2) fragile git detection, recorded as KD12; (3) a failing lazy import in `quick-ask.js` 22 to 23 rejects instead of returning a typed result, introduced by MA4; (4) `t4-ma4.test.js` lacks `opencode-zen` and the real bootstrap callers, and its Cursor case writes a Claude marker. MA4b delegated (M29, L13). Next after MA4 closes: M16.

- L15 (2026-11-10): two Sam validation decisions on MA4b. The full text of the two messages is not reproduced; the quoted sentences are verbatim. `OD-MVP-MA4b — VALIDATION_PENDING`: "Una suite limpia por sí sola no demuestra que los 10 fallos anteriores fueran causados por carga. Debemos considerar conjuntamente las repeticiones, la comparación con baseline y la evidencia del proceso que falló." "No ejecutar otras tareas pesadas simultáneamente durante la validación." "Quiero que M16 comience con mediciones reproducibles de una sesión nueva, separando el consumo atribuible a Kairo, Gentle AI, Engram, herramientas MCP y el propio host." `OD-MVP-MA4b — CONTROLLED_VALIDATION_CONTINUES`: "Si MA4b pasa las pruebas y no hay evidencia de regresión frente al baseline: autorizo commit local, cierre documental y transición a M16." "Esta será la última ronda de caracterización de MA4b antes de tomar una decisión con la evidencia disponible."

- L16 (2026-11-10): MA4 closure. The MA4b builder returned partial once because `src/global/team/service.js` was outside its edit surface (a surface derivation gap by the orchestrator), then completed with one added line and a service-level test (RED `projectRoot: undefined`, GREEN). An earlier attempt at the isolated repetitions ran no tests because of a shell word-splitting mistake and was discarded as evidence. Final round as authorized: the three hook files alone three times each and `test/core-hook` in parallel twice, all passing; the baseline comparison at `eb1276cb8` was not run because no failure reproduced. MA4b committed as `202f5a1ca`. MA4 closed. MA5 remains rolled back (KD11). Next: M16, starting with reproducible measurements of a new session.

- L17 (2026-11-10): MA13 static inventory and failed isolation (M30). Static sizes in bytes; token figures are estimates (bytes divided by 4), not tokenizer counts. `~/.claude/CLAUDE.md`: 114,436 bytes (about 28,600 tokens), containing the Gentle AI blocks `gentle-ai:orchestrator` (lines 225 to 618), `gentle-ai:engram-protocol` (81 to 222) and `gentle-ai:agent-routing` (706 to 809), and the Kairo block `harness:managed` (lines 620 to 671, 3,218 bytes, about 800 tokens). `/Users/kal-el/AGENTS.md`: 52,799 bytes (about 13,200 tokens); it repeats `gentle-ai:orchestrator` (lines 23 to 296) and `gentle-ai:agent-routing` (298 to 389) in an older variant that is not byte-identical, and the host's builtin plugin `cc-plugin-agents-md` loads it. Output style `Gentleman`: 7,128 bytes. `RTK.md`: 961 bytes. Project `MEMORY.md`: 1,264 bytes. No documented reproducible method was found for the earlier C1 figure (about 63k to 7.8k tokens). Isolation attempt: Claude Code 2.1.322 with `CLAUDE_CONFIG_DIR` pointing at an empty scratch directory answered `Not logged in · Please run /login` with 0 tokens in 79 ms. There is no `~/.claude/.credentials.json`, so authentication does not follow a new configuration directory; a separate directory would need a second login, which met Sam's cancel condition. No credential was read or copied.

- L18 (2026-11-10): MA13 live pilot, one run, 2026-11-10 10:36, authorized by OD-MVP-M16 CONTROLLED_LIVE_PILOT_APPROVED (M30). Command shape: `claude -p` with `--output-format stream-json --verbose --include-hook-events --no-session-persistence`, run from the repository root with the real configuration and the parent session's `CLAUDE_CODE_*` environment variables unset. Prompt, verbatim: "Responde únicamente: M16_PILOT_OK." followed on a new line by "No ejecutes herramientas ni modifiques archivos." Result: `M16_PILOT_OK`, 1 turn, no tool call, 0 subagents, no permission denial. Tokens (`result.usage`): `input_tokens` 2; `cache_creation_input_tokens` 105,668, all `ephemeral_1h`; `cache_read_input_tokens` 0; `output_tokens` 148, of which 136 thinking. Duration 8,882 ms (API 5,857 ms). `total_cost_usd` 1.696624 at list price. `modelUsage` does report the window: `contextWindow` 1,000,000 and `maxOutputTokens` 128,000 for `claude-fable-5-2`, so the first request carried about 10.6 percent of the window. Loaded components (`init` event): model `claude-fable-5-2` (the configured default; the run did not pass a model), output style `Gentleman`, permission mode `bypassPermissions`, 497 tools, 19 MCP servers (connected: apify, codegraph, context7, engram, mssql-kcserver, rea, claude.ai Claude Docs, claude.ai Supabase, claude.ai Vercel; the other 10 `needs-auth`), 9 plugins (caveman, codex, engram, kairo-router, rust-analyzer-lsp and the builtins cc-plugin-agents-md, cc-plugin-telemetry, cc-plugin-privacy, cc-plugin-plugin-authoring), 35 agents, 94 skills, 152 slash commands; auto memory path `~/.claude/projects/-Users-kal-el-Desktop-agentic-harness/memory/`. Hooks: SessionStart 7 hooks, 7,384 bytes of output; UserPromptSubmit 4 hooks, 1,536 bytes; Stop 4 hooks, 78 bytes; all exit 0. Environment check before and after: SHA-256 of `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `/Users/kal-el/AGENTS.md`, `RTK.md`, the output style, `MEMORY.md` and the repository `.claude/settings.local.json` unchanged; HEAD and dirty count of the main checkout and of `core-hook-t4` unchanged; plugin install record mtime unchanged; kairo 0.36.0, engram 3.5.2-main.0603156, gentle-ai 4.3.1 unchanged; no stored session added; no leftover process. Limits of this run: one sample; it is an instrumental baseline, not a savings measurement; hook events were aggregated by event name, so output is not yet attributed per owning plugin; the 105,668 tokens are not yet split by source; the static instruction estimate (about 41,800 tokens for the two instruction files) is under half of the measured total, so tool and MCP schemas, skills, agents and the host prompt carry the larger share, unmeasured so far; a first request with cold cache was measured, cache reuse on later requests was not.

- L19 (2026-11-10): MA13 controlled comparison, states A and B measured once each, state C not run (M31). Method: two new independent sessions at 10:41 from the repository root, real configuration, existing login, parent `CLAUDE_CODE_*` variables unset; `claude -p --model claude-sonnet-5-5 --permission-mode dontAsk --output-format stream-json --verbose --include-hook-events --no-session-persistence`; same prompt as the pilot (L18). Both answered `M16_PILOT_OK`, 1 turn, no tool call, no permission denial, 0 subagents. Prompt size is reported as `input_tokens` plus `cache_creation_input_tokens` plus `cache_read_input_tokens`; output tokens are kept separate.

  | State | kairo-router in `init` | input | cache creation (all 1h) | cache read | prompt total | output | duration ms (API ms) | cost USD (list) |
  | ----- | ---------------------- | ----- | ----------------------- | ---------- | ------------ | ------ | -------------------- | --------------- |
  | A, Kairo enabled | present | 2 | 94,610 | 9,588 | 104,200 | 12 | 6,917 (3,092) | 0.3795228 |
  | B, plugin disabled for the run with `--settings '{"enabledPlugins":{"kairo-router@kairo":false}}'` | absent | 2 | 92,266 | 11,451 | 103,719 | 13 | 7,549 (5,173) | 0.3703431 |
  | C, without Kairo | not run | not run | not run | not run | not run | not run | not run | not run |

  Common to A and B (`init`): model `claude-sonnet-5-5`, permission mode `dontAsk`, output style `Gentleman`, 497 tools, 9 of 19 MCP servers connected, 35 agents, 94 skills, 152 slash commands, `contextWindow` 1,000,000. Plugins in A: caveman, codex, engram, kairo-router, rust-analyzer-lsp and four builtins; in B the same without kairo-router.

  Hooks, both states: 7 SessionStart (one prints the Engram protocol and memory context, 7,264 bytes in A and 7,144 bytes in B; one prints `OK`), 4 UserPromptSubmit (one prints 1,536 bytes of `additionalContext`; its owner was not identified), 4 Stop (gentle-ai telemetry, 78 bytes); all exit 0. The kairo-router plugin does not show up as command hook events: its `hooks.json` is 33 bytes and it runs through its register module.

  Reading, stated with its limits: A minus B is 481 prompt tokens; about 30 of them match the 120-byte difference in the Engram output, so roughly 450 tokens is what the router plugin added to this first request. One sample per state: not a statistical result. The split between cache creation and cache read differs between A and B because B ran 30 seconds after A and reused part of A's cached prefix; only the prompt total is comparable.

  State C was not run, by Sam's rule: with the plugin disabled, Kairo content still loaded comes from files, not flags: the `harness:managed` block inside `~/.claude/CLAUDE.md` (3,218 bytes), the six project agents `kairo-codex`, `kairo-cursor`, `kairo-gemini`, `kairo-opencode`, `kairo-opencode-go`, `kairo-opencode-zen` under the repository's `.claude/agents` (still listed in B), and `odd-verify` and `odd-worker` under `~/.claude/agents`. Producing C needs file changes, which are not authorized. State B is therefore "router plugin not running", not "Kairo absent".

  Environment check: combined SHA-256 of the configuration and instruction files identical before A, between A and B, and after B; HEAD and dirty count of both checkouts identical; plugin install record unchanged; `enabledPlugins["kairo-router@kairo"]` in the real `settings.json` still `true`. Authorized operational writes only (Engram session, gentle-ai telemetry).

  Open items: the roughly 104,000 tokens are not yet split by source; the 497 tools and 19 MCP servers are the largest unmeasured candidates; `.claude/agents` in the repository also holds `kairo-backup` copies of the agent files, whose effect on loading was not checked.

- L20 (2026-11-10): MA13 MCP ablation, state M measured once (M32). Method: one new session at 10:45, same command as state A (L19) plus `--strict-mcp-config`, same prompt, model `claude-sonnet-5-5`, permission mode `dontAsk`. Answer `M16_PILOT_OK.`, 1 turn, no tool call, no permission denial, 0 subagents.

  | State | MCP servers | tools (MCP / other) | slash commands | input | cache creation | cache read | prompt total | output | duration ms (API ms) | cost USD (list) |
  | ----- | ----------- | ------------------- | -------------- | ----- | -------------- | ---------- | ------------ | ------ | -------------------- | --------------- |
  | A, Kairo enabled | 19 (9 connected) | 497 (472 / 25) | 152 | 2 | 94,610 | 9,588 | 104,200 | 12 | 6,917 (3,092) | 0.3795228 |
  | B, router plugin disabled | 19 (9 connected) | 497 (472 / 25) | 152 | 2 | 92,266 | 11,451 | 103,719 | 13 | 7,549 (5,173) | 0.3703431 |
  | M, A plus `--strict-mcp-config` | 0 | 25 (0 / 25) | 133 | 2 | 78,381 | 9,021 | 87,404 | 13 | 5,599 (2,299) | 0.3145601 |

  The MCP and other tool split for A and B is derived from M (25 non-MCP tools remain; A and B listed 497 in total), because the per-tool list of A and B was not stored.

  Validity: the `init` event confirms the ablation: 0 servers and 0 MCP tools. Unchanged against A: model, permission mode, output style, 9 plugins including kairo-router, 35 agents, 94 skills, 15 hook events with the same outputs. Changed besides tools and servers: 19 fewer slash commands (152 to 133), which are MCP-provided commands, and the Engram SessionStart output (7,055 bytes against 7,264 in A, about 50 tokens). By Sam's table the measurement is valid: MCP really reduced and the rest comparable.

  Reading, with limits: A minus M is 16,796 prompt tokens, 16.1 percent of A; about 35 tokens per MCP tool, which is consistent with deferred tool schemas (tool names plus server instructions) rather than full schemas loaded at start; this is an inference from the ratio, not an observation of the prompt. A minus B is 481 tokens. `contextWindow` 1,000,000 in all three, so the first request is 10.4 percent of the window in A and 8.7 percent in M; these are tokens processed in the first request, not a measured window occupancy. One sample per state: an estimate, not a statistically reproducible saving.

  The 25 tools that remain without MCP: Task, Bash, CronCreate, CronDelete, CronList, DesignSync, Edit, EnterWorktree, ExitWorktree, ListAgents, LSP, Monitor, NotebookEdit, PushNotification, Read, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskStop, ToolSearch, WebFetch, WebSearch, Write.

  Not yet split: the 87,404 tokens that remain without MCP (instruction files, statically estimated at about 41,800 tokens; 94 skills; 35 agents; the 25 builtin tool schemas; the host prompt; about 2 KB of hook output). Per-server MCP cost was not measured.

  Environment check: SHA-256 over the instruction and settings files identical to the A and B value; HEAD and dirty count of both checkouts and the plugin install record unchanged; MCP server list in `~/.claude.json` intact (apify, codegraph, context7, engram, mssql-kcserver, rea). `~/.claude.json` itself is rewritten by the host in every session, so it is excluded from the comparison hash.

- L21 (2026-11-10): MA13 instruction deduplication measurement, pair measured once per variant (M33). Preflight (read-only): the session scratch directory resolves under `/private/tmp`, outside `/Users/kal-el`; no `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md` or `.claude` exists in any of its ancestor directories. Setup: a temporary workspace `m16-dedup/ws` in the session scratch directory holding only `AGENTS.md`. Variant A: byte-exact copy of `/Users/kal-el/AGENTS.md` (399 lines, 52,799 bytes, SHA-256 starting `e4807ea23cb4`). Variant B: the same file without the blocks `gentle-ai:orchestrator` (lines 23 to 296) and `gentle-ai:agent-routing` (lines 298 to 389, including the nested `gentle-ai:remote-authorization`), markers included: 33 lines, 2,242 bytes, 50,557 bytes less, SHA-256 starting `19914e8f5d49`. The same directory was the working directory of both runs; only the file content was swapped between them. The original file was never edited or renamed; its hash was the same before and after.

  Method: two new sessions at 10:49 and 10:50, same command as state A (L19) plus `--debug-file`, model `claude-sonnet-5-5`, permission mode `dontAsk`, same prompt, real plugins, MCP and hooks. Both answered `M16_PILOT_OK.`, 1 turn, no tool call, no permission denial, 0 subagents.

  Load verification, from the host debug log of both runs: `cc-plugin-agents-md` found `CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md` in 0 of 8 ancestor directories and `AGENTS.md, .claude/AGENTS.md` in 1 of 8, and logged `no CLAUDE.md found; AGENTS.md loaded:` followed by the temporary workspace path. The home `AGENTS.md` was not loaded in either run.

  | Variant | AGENTS.md bytes | input | cache creation | cache read | prompt total | output | duration ms (API ms) | cost USD (list) |
  | ------- | --------------- | ----- | -------------- | ---------- | ------------ | ------ | -------------------- | --------------- |
  | A, duplicated copy | 52,799 | 2 | 100,097 | 0 | 100,099 | 13 | 4,006 (2,912) | 0.400522 |
  | B, two Gentle AI blocks removed | 2,242 | 2 | 66,412 | 11,443 | 77,857 | 189 | 5,715 (4,569) | 0.2686863 |

  Result: A minus B is 22,242 prompt tokens, 22.2 percent of A, for 50,557 bytes removed: 2.27 bytes per token. The earlier static estimate of bytes divided by 4 (about 12,600 tokens for these blocks) undercounted by a factor of about 1.8. By the same ratio `~/.claude/CLAUDE.md` (114,436 bytes) would be about 50,000 tokens; that is an inference, not a measurement.

  Mechanism found: the builtin plugin `cc-plugin-agents-md` loads `AGENTS.md` from the working directory's ancestors only when no `CLAUDE.md` is found there. The repository has no `CLAUDE.md` and `/Users/kal-el/AGENTS.md` is an ancestor of it, which is why that file is loaded in every session of this repository.

  Comparability and contamination: `init` identical in both variants for model, permission mode, output style, 497 tools, 19 MCP servers, 29 agents, 94 skills and the 9 plugins; hooks 15 in both. Differences besides the file: slash commands 153 in A and 140 in B (cause not established; the M ablation showed that 19 commands plus 472 tools cost about 16,800 tokens together, so 13 commands cannot explain the result, but the pair is not perfectly clean); Engram SessionStart output 3,152 bytes in A and 3,332 in B (about 45 tokens, against the direction of the result). The pair is comparable only with itself, not with states A, B and M: the working directory is not the repository (29 agents instead of 35, another project memory path).

  Unexpected host write: the runs created the empty directory `~/.claude/projects/-private-tmp/memory` at 10:49:54, because the host keyed the temporary project by a git root at `/private/tmp`. It is a host write in the real configuration directory, outside the authorized hook writes; reported to Sam, not removed. Instruction and settings hash, both checkouts and the plugin install record unchanged.

  Limits: one sample per variant; no extrapolation to subagents; the removed blocks are an older variant of the Gentle AI blocks in `~/.claude/CLAUDE.md`, not byte-identical, so this measures the size of the duplicated blocks, not that every rule in them also exists in the other file. Applying any deduplication to the real installation needs separate authorization (M33).

- L22 (2026-11-10): decision by Sam `OD-MVP-M16 — CLEANUP_APPROVED`, key sentences verbatim; the full message is not reproduced. "Sí, autorizo eliminar el directorio vacío `~/.claude/projects/-private-tmp`, junto con los dos directorios scratch del experimento." "1. Confirmar que `~/.claude/projects/-private-tmp` es un directorio real, no un symlink, y está completamente vacío." "2. Eliminarlo exclusivamente con `rmdir`, nunca mediante borrado recursivo." "3. Eliminar `m16-pilot-config` y `m16-dedup` únicamente después de verificar que sus resultados, hashes y evidencia relevante quedaron registrados." "5. No eliminar ningún directorio adicional de `~/.claude/projects`." "Si alguna condición falla, conservar el elemento afectado e informar la discrepancia." "Una muestra por variante. El resultado es prometedor, pero la contaminación registrada impide considerarlo ahorro reproducible." "Sin embargo, no autorizo todavía cambiar `CLAUDE.md` ni `AGENTS.md` originales. Antes debemos revisar la contaminación y la escritura inesperada documentadas en L21 para determinar qué parte de la diferencia es atribuible realmente a la deduplicación." "Después de la limpieza, quiero que MA13 avance hacia una propuesta concreta de optimización, separando lo que beneficia a tu entorno de lo que debe incorporar Kairo Runtime 0.37.0." "No autorizo más mediciones ni modificaciones del runtime por ahora."

- L23 (2026-11-10): review of the contamination and the unexpected write of L21, from the two host debug logs of the paired runs (540 and 547 lines), compared after normalizing timestamps, durations, process ids and session ids, before the scratch directories were removed.
  - Structural load identical in both runs: `Loaded 48 unique skills (48 unconditional, 0 conditional, managed: 0, user: 26, project: 0, ...)`, `Loaded 1 commands from plugin caveman`, `Loaded 8 commands from plugin codex`, `Total plugin commands loaded: 9`, the same MCP servers connecting and closing cleanly, the same hooks.
  - Remaining differences are timing lines, the Engram SessionStart text, MCP connection durations (4 to 5 s in variant A, 6 to 8 s in variant B) and the two items below.
  - Slash commands 153 against 140: no log line shows a different command source. Method difference found in the orchestrator's own invocation: variant A ran without a stdin redirect and the host printed `Warning: no stdin data received in 3s, proceeding without it`, so it waited 3 seconds before starting; variant B ran with stdin from `/dev/null` and started at once. The `init` event is a snapshot at one moment, and commands provided by MCP servers arrive asynchronously, so the most likely cause is that variant A's snapshot was taken after the MCP servers had delivered their commands and variant B's before. This is an inference from the timing; no log line states it. Whether those 13 commands were also absent from variant B's first request is not established.
  - Bound on the effect: in the MCP ablation (L20), 472 MCP tools, 19 MCP commands and the server instructions together cost 16,796 tokens. Thirteen commands are a small part of that. The share of the 22,242-token difference that could be due to the 13 commands is therefore small but not measured; the difference attributable to removing the two blocks is at most 22,242 tokens and, by this bound, not far below it. No exact attribution is claimed.
  - Engram output (3,152 bytes in A, 3,332 in B) works against the result by about 45 tokens.
  - Unexpected write explained: variant A logged `memory index backfill: ENOENT: no such file or directory, scandir '/Users/kal-el/.claude/projects/-private-tmp/memory/'`, after which the host created that directory; variant B found it and logged nothing. The host also rewrites `~/.claude.json` atomically in every session (`File /Users/kal-el/.claude.json written atomically`), which is its normal behavior and why that file is excluded from the comparison hash. No other write to the real configuration appears in either log.
  - Method corrections for any later measurement (none is authorized now): redirect stdin from `/dev/null` in every run; store the full `init` lists, not only counts; treat `slash_commands` in `init` as timing-dependent; run from a directory that is not inside any git repository so that the host does not key a new project.
  - Next step per Sam: an optimization proposal for MA13 that separates what benefits Sam's environment from what Kairo Runtime 0.37.0 must incorporate. No further measurements and no runtime changes are authorized.

- L24 (2026-11-10): decision by Sam `OD-MVP-M16 — PRODUCT_OPTIMIZATION_SCOPE_APPROVED` recorded as M34 and MA20 to MA22, key sentences verbatim in M34. Planning only: B1 and B2 are registered as MVP 0.37.0 tasks with limited scope and their acceptance criteria are defined, but implementation is not authorized. Implementation order after authorization: B2, then B1, then B3. A1 (a local `CLAUDE.md` in the repository) is not to be implemented; A2 (MCP per project) is a recommendation, not automation. The plugin precedence behavior (whether a local `CLAUDE.md` would stop `AGENTS.md` from loading) remains a hypothesis based on logs, not a verified guarantee. M16 closure for the MVP is defined by M34; whether MA15 and its 50 percent target still apply is an open point for Sam.

- L25 (2026-11-10): cleanup result after `OD-MVP-M16 — CLEANUP_APPROVED` (L22) and the contamination review (L23). The scratch directories `m16-pilot-config` and `m16-dedup` were removed after their evidence was recorded (L17 to L23). One symlink, `m16-dedup/latest`, pointed inside the scratch directory, so only the link was removed first. SHA-256 of `/Users/kal-el/AGENTS.md`, `~/.claude/CLAUDE.md` and `~/.claude/settings.json` was identical before and after. `~/.claude/projects` still has 194 entries. `~/.claude/projects/-private-tmp` was left intact by Sam's instruction: it holds an empty `memory` subdirectory, so it did not literally meet the completely-empty condition. Before this decision a proposal was presented to Sam in two parts: environment (A1, A2) and product (B1, B2, B3).

- L26 (2026-11-10): decision by Sam `OD-MVP-M16 — IMPLEMENTATION_AND_CLOSURE_APPROVED` recorded as M35, key sentences verbatim in M35. MA13 is closed as `BASELINE_COMPLETE_WITH_LIMITATIONS` with its documentary scope adjusted. MA15 becomes a non-blocking experimental objective subordinate to the budget and tests of MA20; the 50 percent target is no longer a mandatory publication requirement, and M16 stays in the MVP. Milestones assigned: MA19 to C, MA20 to A, MA21 and MA22 to B. MA20 implementation is delegated in the `core-hook-t4` worktree, with a cross review and a local commit authorized if the review passes. MA21 and MA22, changes to the personal environment, and merge, push, install or publish remain not authorized. M16 stays open until MA20 to MA22 are complete and their functional criteria are met. Afterwards: M17 (panel), initial onboarding and own Artificial Analysis API keys, and the validation of the three orchestration patterns.
- L27 (2026-11-10): decision by Sam `OD-MVP-MA20 — FINAL_VALIDATION`, quoted fragments verbatim. "Autorizo continuar exactamente con el procedimiento previsto: 1. Terminar la suite completa. 2. Ejecutar una revisión independiente con Codex de los tres bloqueantes corregidos, sin reutilizar informes antiguos. 3. Si no hay regresiones ni bloqueantes, realizar el commit local y cerrar MA20. 4. Pasar a MA21 (`kairo doctor`), sin abrir otra ronda de optimización de MA20." "Si aparece un fallo, aplicar la regla de cierre del MVP: sólo bloquea cuando demuestra un incumplimiento real del contrato de publicación." "No autorizo todavía merge, push, instalación ni publicación." Two conditions: "El presupuesto en bytes debe ser preciso." The CodeGraph cap counts characters, not bytes; accepted because it is documented and not presented as an absolute byte guarantee, and it can become a later improvement. "Evitemos que el fixture se convierta en una restricción artificial." A budget equal to the baseline detects growth and justified increases, with a reason and evidence, stay allowed. Observed evidence: full suite 5122 tests, 5122 pass, 0 fail; router plugin 498 pass, 0 fail; fresh independent Codex review: blockers 1, 2 and 3 FIXED, no regressions, no new blockers, overall PASS (in the reviewer's sandbox the plugin command could not create temporary directories, EPERM mkdtemp, so plugin execution proof comes from the parent run, not from the reviewer); one advisory, not blocking: add table-driven positive and negative cases for the increase-chain validation. MA20 closed with commit 620c9eb1c on feat/core-hook-t4 (worktree core-hook-t4). MA21 is authorized and is next; MA22, changes to the personal environment, and merge, push, install or publish remain not authorized. M16 stays open until MA21 and MA22 are complete.
- L28 (2026-11-10): MA21 closed with commit 2a46a691b on feat/core-hook-t4 (worktree core-hook-t4), on top of MA20 (620c9eb1c). Route: delegated writer (the orchestrator does not write files), test first. Added `src/global/context-diagnosis.js`, a labeled section in `kairo doctor` and the `contextDiagnosis` key in `kairo doctor --json`; help text in `src/global/cli-help.js`; docs in `docs/context-diagnosis.md`, `docs/cli-reference.md`, `README.md` and a cross-reference in `docs/context-budget.md`. The diagnosis is informational and never changes the doctor exit code or the ok flag. Verification, risk item 2 (credentials): an independent Codex review returned FAIL with two blockers: (1) a TOML multiline string value could be read as an MCP server name, so a secret could reach the result, the rendered text and the doctor JSON; (2) the credential filter checked the spelled import path, so an import that is a symbolic link to a file under the home .ssh directory was read. One correction batch fixed both, tests first: RED 12 pass, 3 fail; GREEN 15 pass, 0 fail. TOML is now scanned with string, comment and bracket-depth state and a file that cannot be parsed safely lists no servers; every file is resolved with realpath before it is opened and anything outside the workspace or host configuration directories, or under a credential location, is skipped with a reason and never opened. Recheck limited to the two blockers: both FIXED, overall PASS. Two advisories, not blocking and not corrected: a workspace that itself lies under a credential directory passes the root-relative check for top-level instruction files; check and open are separate operations, so a concurrent symbolic link replacement is not excluded. Consequence of the canonical-path rule: a host configuration directory that is a symbolic link to a location outside the home directory is skipped with a reason, so the diagnosis under-reports there. Full suite, run by the orchestrator outside the Codex sandbox: run 1 (in parallel with the recheck) 5137 tests, 5136 pass, 1 fail, `test/core-hook/hook-transport-rows.test.js` (bad answer, unknown schema); run 2 (alone, low power mode off) 5137 tests, 5136 pass, 1 fail, a different test, `test/core-hook/hook-acceptance.test.js` (a directive is never reused). Each file passes alone five times out of five (31 of 31 and 18 of 18) and neither imports MA21 code. This matches the load sensitivity of the core-hook subprocess tests already recorded at a clean baseline before MA21; it is treated as not attributable to MA21 under the MVP closure rule, and it is recorded here as observed, not as a clean suite. A full-suite run delegated to the Codex test runner (5063 of 5133) is discarded as evidence: truncated output and a sandbox that denies temporary directories. Router plugin: 498 pass, 0 fail. MA22 stays authorized for planning only; merge, push, install and publish remain not authorized. M16 stays open until MA22 is complete.
- L29 (2026-11-10): decision by Sam `OD-MVP-MA21 — CLOSED_WITH_KNOWN_DEBT`, quoted fragments verbatim. "Acepto el cierre de MA21. No autorizo otra investigación de los tests intermitentes en este momento." On the full suite: "Los dos fallos ocurrieron en tests diferentes del hook y no se reprodujeron en las ejecuciones aisladas reportadas." "Eso es evidencia suficiente para no bloquear esta unidad, aunque no demuestra que toda la suite esté libre de condiciones de carrera." "Mantenemos esa distinción en el reporte de release. No debemos presentar 5136/5137 como una suite completamente aprobada." Security notes to keep documented with precision: "La omisión de directorios de configuración enlazados fuera de las raíces permitidas es una limitación conocida." "La carrera entre `realpath` y la apertura del archivo queda como deuda de robustez." "El comportamiento cuando el workspace está dentro de un directorio sensible, como `~/.ssh`, debe documentarse sin afirmar aislamiento absoluto." "No autorizo ampliar MA21 por estos casos ahora. Si posteriormente se demuestra una lectura o exposición efectiva de credenciales en una instalación soportada, será un bloqueante de publicación, no una simple mejora." MA22: "También autorizo implementar MA22, limitado a la documentación de configuración selectiva de MCP." "MA22 debe ser exclusivamente documental, aprovechando los resultados de M16." "Debe explicar cómo los usuarios pueden configurar MCP por proyecto, evitar servidores innecesarios y comprobar qué capacidades están disponibles en su host." Deliverables and acceptance: "Guía para Claude Code y Codex" with "Configuración compatible con cada host"; "Selección de MCP por proyecto" with "No exige un gateway ni nuevos servicios"; "Engram, CodeGraph, Graphify y Context7" with "Explicar cuándo conviene activarlos"; "Seguridad" with "No exponer claves, tokens ni configuraciones sensibles"; "Diagnóstico" with "Vincular las recomendaciones con `kairo doctor`"; "Mediciones" with "Citar las cifras M16 como muestras, no ahorros garantizados". "No es necesario construir un administrador de MCP ni modificar automáticamente la configuración de los usuarios." "Una vez terminada la documentación, verificar sus instrucciones y rutas de configuración, registrar el commit local y cerrar MA22." M16 state: MA13, MA20 and MA21 closed; MA22 authorized; M16 pending MA22. Afterwards: "Una vez comprobada la documentación, podremos cerrar M16 para el MVP 0.37.0, manteniendo las limitaciones y deudas ya registradas." Next priority M17 (Kairo panel), then onboarding, own Artificial Analysis keys and the pilot orchestration tests. "No quiero volver a investigar M16 salvo que aparezca una regresión que incumpla su contrato de publicación." "No autorizo merge, push, instalación ni publicación." Known debt carried to the release report: the full suite result for MA21 is 5136 of 5137 in two runs and must not be presented as a fully passing suite; the three security notes above (linked configuration directories outside the allowed roots are skipped, a known limitation; the `realpath` to open race is robustness debt; behavior when the workspace lies inside a sensitive directory such as `~/.ssh` is documented without claiming absolute isolation).
- L30 (2026-11-10): MA22 closed with commit ef4e28508 on feat/core-hook-t4 (worktree core-hook-t4), on top of MA21 (2a46a691b). Documentation only, delegated writer. Added `docs/mcp-per-project.md`: where Claude Code and Codex configure MCP servers and at which scope, how to add a server for one project, how to keep a global server out of one project, when Engram, CodeGraph, Graphify and Context7 are worth enabling (Graphify is described as a CLI, not an MCP server, as it is in this repository), a security section, the link to the `kairo doctor` context diagnosis, and the M16 figures cited as single samples, not guaranteed savings. The guide refers to this feature document in prose because the file does not exist on that branch. Also added, per L29, a Known limits section in `docs/context-diagnosis.md` stating the three MA21 limits from the current code without claiming absolute isolation (linked configuration outside the allowed roots is omitted; the realpath check and the read are separate operations; credential checks are relative to the matched root, so a workspace under a sensitive directory is read for instruction files), and softened earlier sentences that overstated the guarantee; no code changed. The same document now states that MCP configuration is read from 4 fixed locations while the cap constant is 6, so the cap limits nothing today. Verification: first pass verified against Claude Code 2.1.322 and codex-cli 0.167.0 with local help output and repository source only, with no user configuration read and no add or remove command run. An independent Codex fact check against the official documentation returned FAIL with one wrong item: the strict MCP config examples were unconditional, although with an enterprise managed MCP file deployed that flag makes Claude Code exit at startup; 31 command, flag, scope, path and key items were correct; no secret, no personal path, no gateway or service required, no guaranteed-savings claim. One correction batch qualified those examples, replaced the five items marked not verified here with the documented syntax (per-project enable and disable keys in Claude Code, environment references in the project MCP file, the file the Codex add command writes to, the Codex project configuration for trusted projects, and the enabled key and the config override flag in Codex), each labeled as taken from the official documentation with its URL and not executed on this machine, and made two precision fixes (the list commands show configured servers, not connected ones; approval of project MCP file servers is interactive-session behavior). Recheck by the orchestrator: structural readback of the corrected passages and the greps for remaining not verified markers, secrets and personal paths, all clean. Not proven: the documentation-sourced statements were not executed here, and the reviewer could not confirm the M16 figures from that worktree because this document is not on that branch. Risk: none (documentation only). M16 state: MA13, MA20, MA21 and MA22 are closed, so the tasks M35 lists for M16 are complete; the formal closure of M16 for MVP 0.37.0 is left to Sam, keeping the recorded limits and debts (L27 to L29). Merge, push, install and publish remain not authorized.
- L31 (2026-11-10): decision by Sam `OD-MVP-M16 — CLOSED_WITH_KNOWN_DEBT`, quoted fragments verbatim. "Confirmo el cierre formal de M16 para Kairo Runtime 0.37.0 y autorizo iniciar M17: rediseño del panel." Task states: MA13 "Cerrada, con limitaciones"; MA20 "Cerrada"; MA21 "Cerrada, con deuda conocida"; MA22 "Cerrada"; M16 "CERRADO PARA MVP". "Este cierre significa que Kairo dispone de mediciones de referencia, controles automatizados de crecimiento del contexto y herramientas para identificar oportunidades de optimización." "No significa que hayamos demostrado una reducción global y reproducible del consumo de tokens. Tampoco significa que la suite completa haya pasado sin fallos." "Conservamos las deudas conocidas sin convertirlas en nuevos requisitos de M16." M17: "Autorizo comenzar M17 utilizando el inventario MA14 existente." "El objetivo es transformar el panel actual en un resumen que permita entender rápidamente:" "Qué proveedores están disponibles y cuál es su cuota restante." "Qué modelos son elegibles para cada rol." "Qué tareas o agentes están activos." "Por qué una ruta está bloqueada o degradada." "Cuántos veredictos están pendientes, sin imprimirlos todos." Acceptance, current problem and expected result: "`unknown (unknown)` repetido" : "Mostrar únicamente roles válidos y estados verificables"; "`waiting until unknown`" : "Indicar motivo conocido o `Sin información`"; "Proveedores irrelevantes" : "Ocultar ruido, sin ocultar indisponibilidad relevante"; "Roles multiplicados por historial" : "Mostrar el estado actual, no ejecuciones antiguas"; "73 veredictos impresos" : "Mostrar contador y comando de detalle"; "Cuotas sin contexto temporal" : "Mostrar actualización y antigüedad de los datos". "M17 debe aprovechar las fuentes actuales, principalmente `kairo team pacing --json --no-wait` y `kairo team routes --json`." "No autorizo un nuevo motor de monitoreo, un servicio adicional ni consultas costosas por cada renderizado del panel." Strategy: "Autorizo una implementación incremental de M17: 1. Vista compacta: corregir representación, roles y veredictos. 2. Información operativa: proveedores, cuotas, rutas y motivos. 3. Validación visual y funcional: comprobar legibilidad, datos faltantes, proyectos nuevos y compatibilidad." "El panel debe seguir funcionando cuando Kairo esté deshabilitado, cuando no exista contrato activo o cuando falten datos de un proveedor." "También debemos evitar que el panel genere consumo innecesario de tokens o llamadas a modelos." Limits: "Autorizo implementar M17, ejecutar pruebas, realizar una revisión cruzada y registrar commits locales después de la validación." "No autorizo merge, push, instalación ni publicación." "El archivo `integrations/claude-code/kairo-router/tsconfig.json` permanece fuera de alcance. Tampoco autorizo registrar retrospectivamente veredictos de las delegaciones anteriores." Next objective: close M17, then the initial onboarding including own Artificial Analysis keys. Route: M17 is implemented as task MA16 in the core-hook-t4 worktree (branch feat/core-hook-t4) on top of ef4e28508, by a delegated writer per increment, with a local commit per increment after validation. Assumption by the orchestrator, to be confirmed by Sam: the literal `Sin información` is rendered in English as "No information", because the panel text and all generated artifacts are in English.
- L32 (2026-11-10): M17 increment 1 (compact view) committed as 4d4eb37e9 on feat/core-hook-t4 (worktree core-hook-t4), on top of ef4e28508. Route: delegated writer, test first, one writer. Changed `integrations/claude-code/kairo-router/hooks/register.ts` (planTable, verdictsLine) with tests in `hooks/register.test.ts` and `hooks/pane.test.ts`. The plan table never prints a placeholder as a model, a provider or a state: a role without a model reads `not assigned`; a wait with a valid date keeps the dated form; a wait without one shows its reason, first line, or `waiting: No information`; an unrecognized, blank or free-text decision is never echoed and shows the reason or `No information`. Cell text and the orchestrator model in the header are cleaned of pipes and control characters, and reasons are cut by code point. The pane shows `Verdicts: N pending (list: kairo team verdict --pending)` instead of every agent name; zero pending and unavailable stay distinct. The same table feeds the pane, the session notice and the per-prompt context, so the fix applies to all three; the measured context budget fixture renders byte-identical and no budget figure moved. Correction to the MA14 inventory: the independent review read the producer and found that the routes command emits one freshly evaluated row per approved role, not history, so the routes output is not the source of roles multiplied by history; the writer's first rule (keep the most complete row) could have hidden a waiting row behind a routed one and was replaced: only rows identical for display collapse, and a waiting row is never hidden. Verification, cross review by Codex: first review FAIL with two blockers (placeholder and state normalization incomplete; a reason containing a pipe could add a table column), fixed in one correction batch; the recheck confirmed the pipe fix and the duplicate rule and found the first blocker still reproducible through the reason text, fixed in a second and last correction with tests first (RED 2 fail, GREEN 509 pass). No third review was run: the orchestrator re-ran the plugin tests on the final tree, 509 pass, 0 fail, and the context budget test, 4 pass, 0 fail. Deviation recorded: in the first correction batch the writer wrote the implementation before the tests and obtained RED by temporarily removing the fixes. Full node suite, run by the orchestrator: on the tree before the corrections 5137 tests, 5137 pass, 0 fail; on the tree after the first correction, run in parallel with the recheck and the writer's test runs, 5137 tests, 5132 pass, 5 fail, all in test/core-hook (legacy differential two tests, bad answer unlisted combination, F2 record-launch crash and timeout); the three files holding them pass alone, 46 of 46, and no node test imports the plugin source changed after the clean run. This is the load sensitivity already recorded (L28, L29) and it is not presented as a fully passing suite. Not proven: the pane was not rendered on a real host (increment 3); the list of decision values was taken from the source, and values such as READY, REFUSED or WAIT_FOR_APPROVAL, if the routes command ever emits them, take the reason or No information path. Assumption still open for Sam: the literal `Sin información` is rendered as `No information`. Risk: none (display text; the only parsers found are the plugin tests). Merge, push, install and publish remain not authorized.
- L33 (2026-11-10): M17 increment 2 (operational information) committed as f2b40817b on feat/core-hook-t4 (worktree core-hook-t4), on top of 4d4eb37e9. Route: delegated writer, test first, one writer. The pane now opens with a data row, `Data: <time>, <age> old`, computed when the pane renders from the stored observation time and the clock, with no I/O; a stale snapshot reads `- STALE snapshot` and a missing or invalid observation time reads `Data: No information`. Quota percentages say `remaining` in the pane and `left` in the per-prompt Pacing line (KD8); reset times use the short local form instead of the raw timestamp. A provider with no quota data is listed (`<name>: data unavailable` in the pane, `No quota data: <name>` in the Pacing line) only when it is relevant: claude or codex, the preferred provider, the vendor of the next writer, a provider named by a plan row, or a provider whose name appears as a whole token in the reason of a plan row that is not routed; when pacing loads and the plan does not, no provider is hidden. The plan table takes a reason length: 160 code points in the pane, 60 in the per-prompt context and in the session notice. Pane state gained `quotaMeta` and the shape tag is `pane-2`. Context budget (MA20): `router-pacing-line` 211 to 231 bytes with an increase record dated 2026-11-10; new component `router-plan-table-blocked`, 255 bytes, baseline equal to budget, measuring a blocked row as the model receives it (the same input at the pane length would be 329 bytes); `router-plan-table` unchanged at 524. Verification, cross review by Codex: FAIL with two blockers, both fixed in one correction batch with tests first (RED 17 fail, GREEN 539 pass): (1) a provider that a waiting row with provider null names only in its reason was hidden from the quota block and the Pacing line, so relevant unavailability disappeared; (2) the reason length raised for the pane also grew the per-prompt context by about 90 bytes for a 150 character reason, undetected by the budget fixture. A third defect was confirmed by the orchestrator by running the pacing command: `generatedAt` is the time of the response and `quotaObservedAt` is when the quota was observed, so an age computed from `generatedAt` would always be near zero; the age now comes from `quotaObservedAt` with no fallback. Recheck limited to these three: both blockers FIXED and the gap CLOSED, overall PASS; one advisory not corrected: no test pins the token match edges (letter case, punctuation, hyphen suffix, special characters), which the reviewer verified by reading the code. Plugin tests on the final tree, run by the orchestrator: 539 pass, 0 fail. Full node suite, run by the orchestrator: before the correction 5137 tests, 5137 pass, 0 fail; on the final tree, first run in parallel with the recheck, 5104 pass, 33 fail in 562 seconds with a load average of 24; second run alone, 5131 pass, 6 fail in 404 seconds (hook acceptance directive reuse, two handover tests, F2 record-launch crash and timeout, claude wrapper sandbox profile). The three files holding those six pass alone, 33 of 33, and the commit changes nothing under src or test/core-hook. This is the load sensitivity already recorded (L28, L29, L32), with a higher failure count than before on this machine today; it was not investigated, as decided in L29, and it is not presented as a fully passing suite. Not proven: the writer used stubs, the waiting row was reproduced from the producer source text and not captured from the routes command, and an older stored pane state was tested on the pure row builder, not through a real host. Risk: item 3 (the Pacing line text and the pane state shape changed on request; nothing in the repository parses that line). Merge, push, install and publish remain not authorized.
- L34 (2026-11-10): M17 increment 3 (visual and functional validation) committed as 928094dbe on feat/core-hook-t4 (worktree core-hook-t4), on top of f2b40817b. Route: delegated writer; tests and documentation only, no product code changed. Added `integrations/claude-code/kairo-router/hooks/pane-scenarios.test.ts` (19 tests through session start, prompt submit and pane render, with outputs shaped after the real commands and a fixed clock), `docs/kairo-pane.md` and one README row. Scenarios: healthy team; blocked role with a long reason (whole in the pane, 57 characters plus an ellipsis in the per-prompt context); waits with and without a date; a provider with no data, irrelevant and relevant; stale and unobserved quota (the age grows with no new prompt and no process call); 73, 1 and 0 pending verdicts, the verdict command failing and a reply that is not a list; a new project (onboarding ask on the first prompt only); a directory that is not a repository; Kairo missing (exit 127, timeout, throwing: the prompt goes through and the pane shows its unavailable rows); an older pane state on the pure row builder. All 19 passed when first written, so there is no RED and GREEN for this increment; a mutation spot check in a scratch copy (pane text and verdict wording changed) failed 12 tests. Cost: a prompt makes the same process calls as before M17 (verdict pending, pacing no-wait, prompt-context, routes, and onboarding only on the first prompt without a plan), each with a 2000 ms timeout; rendering, re-rendering after a clock advance, mounting and unmounting make no process, spawn or model call. Width: the pane is a column of text rows that the host wraps; rows stay within 100 columns except a wait reason shown whole (up to 160 characters, a blocked Builder row measured 170). Re-check of the MA14 inventory: gone: unknown (unknown) as an assigned role, waiting until unknown, No quota data noise for an irrelevant provider, the verdict list flood, quota without update time or staleness, the Pacing line not saying remaining (KD8); not reproduced: roles multiplied per historical run, since no source the pane reads shows a role more than once (routes emit one row per role, the running list holds one entry per live launch and is cleared on finish, each row is drawn once with exact duplicates dropped, the notice is sent once per plan fingerprint), and the baseline capture shows no repeated roles either. Before and after captures for six scenarios are in the worktree report, taken by executing the baseline ef4e28508 in a scratch copy. No active contract: the sources the pane reads carry no contract field, so that case cannot be told apart from a normal team and has no assertion of its own. Verification by the orchestrator on the final tree: plugin tests 558 pass, 0 fail; full node suite 5137 tests, 5137 pass, 0 fail; no secret or personal path in the new files. No independent review was run for this increment because it changes tests and documentation only (Risk: none). Findings not fixed, outside the acceptance table, left for Sam: (1) the per-prompt Pacing line can still say next writer unknown and resets unknown, and fixing it changes model-bound text and its byte budget; (2) for a new project the pane shows only Plan: unavailable, while the no approved team ask appears only in the context of the first prompt; (3) the text output of the core routes command still prints unknown (unknown), which is CLI output and not the pane. Not validated without a real host, because install is not authorized: how the docked pane draws and wraps at its real width, colour and font legibility, the pane toggle command and the fullscreen auto-open, whether the host sends SubagentStop for every background launch (a missed one would leave a Running entry until the session restarts), real routes output for a project with a blocked row, and local time text in the user's time zone. Assumption still open: the literal `Sin información` is rendered as `No information`. Merge, push, install and publish remain not authorized.
- L35 (2026-11-10): decision by Sam `OD-MVP-M17 — FINAL_ACCEPTANCE_SCOPE`, quoted fragments verbatim. "Acepto la implementación de M17 y autorizo un último ajuste limitado a los puntos 1 y 2. Después cerraremos el desarrollo del panel y trasladaremos su validación en el host real al piloto de integración." "No necesitamos reabrir el diseño ni iniciar otra auditoría general." Resolution of the five points: "1. Proyecto nuevo" : "Corregir dentro de M17"; "2. `next writer unknown` y `resets unknown`" : "Corregir dentro de M17"; "3. `kairo team routes` muestra `unknown`" : "Deuda conocida del CLI; fuera de M17"; "4. Idioma del panel" : "Mantener inglés por ahora"; "5. Validación en host real" : "Obligatoria durante el piloto de integración, no durante este ajuste". New project: "Mostrar `Plan: unavailable` sin explicación no es una buena experiencia de onboarding." "Debe indicar el estado real usando evidencia existente:" "Sin configuración: `Plan not configured`." "Sin rutas elegibles: `No eligible routes`." "Error o información insuficiente: `Routing information unavailable`." "No deben inventarse causas. Si hay una acción concreta para resolverlo, mostrar un comando breve de diagnóstico." Unknown writer and reset: "Eliminar mensajes ambiguos como `next writer unknown`." "Cuando no exista una selección válida, utilizar `No writer selected`. Cuando no se conozca la próxima renovación, `Reset time unavailable`." "Conservar los motivos de bloqueo confirmados y no presentar la ausencia de datos como agotamiento." "Importante: estos cambios no deben aumentar innecesariamente el contenido inyectado en cada prompt. Si cambian los bytes, actualizar el presupuesto de MA20 con justificación y tests." Language: "Mantendremos inglés como idioma inicial de Kairo Runtime 0.37.0 para preservar consistencia en una herramienta pública orientada a desarrolladores." "La internacionalización puede entrar en una versión posterior." This closes the open assumption about `Sin información`: the panel keeps `No information`. Real panel validation: "Implementación funcional: probada mediante funciones puras, tests del plugin y suites automatizadas." "Integración visual con Claude Code: todavía no comprobada." "Por eso no afirmaremos que el panel ya está validado visualmente. En el Hito C debemos comprobar su apariencia real, ajuste de líneas, actualización de cuotas, toggle, limpieza de `Running` y funcionamiento en proyectos nuevos y existentes." "No autorizo instalar el plugin en tu configuración productiva todavía. Esa prueba pertenece al piloto controlado." Roles multiplied: "Como no pudo reproducirse, queda `NOT_REPRODUCED`." "No lo registraremos como corregido ni abriremos una investigación adicional. Si reaparece durante el piloto, tendremos una reproducción real para decidir." Authorization: "Autorizo únicamente: 1. Corregir los mensajes de proyecto nuevo y datos desconocidos. 2. Actualizar los tests focalizados y presupuestos de contexto afectados. 3. Ejecutar la validación correspondiente. 4. Registrar commit local y cierre de implementación si pasa." "No hace falta otra revisión arquitectónica. Una comprobación focalizada será suficiente." States: M17 main implementation "Aceptada"; M17 final message adjustment "Autorizado"; M17 visual test on the host "Hito C"; merge, push, install and publish "No autorizado". Next priority after the adjustment: the initial onboarding. "En particular, quiero que un desarrollador pueda instalar Kairo por primera vez, detectar los hosts disponibles, configurar sus proveedores y agregar su propia API key de Artificial Analysis sin tener que comprender nuestra arquitectura interna." "También debemos contemplar el usuario que ya tiene proyectos, plugins y herramientas configurados." Known debt carried forward: the text output of the core routes command still prints unknown (unknown); the roles multiplied item is NOT_REPRODUCED; the panel is not visually validated on a real host.
- L36 (2026-11-10): M17 final message adjustment committed as 26ac5504e on feat/core-hook-t4 (worktree core-hook-t4), on top of 928094dbe, and the implementation of M17 (task MA16) is closed. Route: delegated writer, test first (RED 24 fail, GREEN 576 pass in the plugin tests). Plan state in the pane, from what the plugin already receives and with no new process call: `Plan not configured (check: kairo team onboarding --json)` when the routes command answers status none with no rows; the plan table followed by `No eligible routes` when the plan has rows and none is routed, each row keeping its confirmed reason; `Routing information unavailable`, with no command, when the routes command fails, times out or returns an answer that cannot be read. The Pacing line says `No writer selected` instead of next writer unknown and is unchanged when there is a writer; a window with no reset time reads `(Reset time unavailable)` in the pane and in the Pacing line; a provider with no data keeps saying its data is unavailable and is never described as exhausted. The old texts Plan: unavailable, next writer unknown and resets unknown remain only in negative test assertions. Context budget (MA20): `router-pacing-line` unchanged at 231 bytes and byte-identical; new component `router-pacing-line-degraded` (one window without a reset time, one provider without data, no writer) with baseline 144 and budget 151 and an increase record dated 2026-11-10 naming this decision; the 144 was computed from the previous text for the same input, not measured by running the previous code; no other component moved; the onboarding ask and the reminder are untouched. Limits recorded as they are: (1) the producer returns status none whenever the project strategy is not active, so `Plan not configured` also appears for a proposed or stale team, which the plugin cannot tell apart; the printed command does tell them apart; (2) that command without the json flag prints text addressed to the model, not a diagnosis for a person, and with the flag it returns the state; it is read-only (checked by the orchestrator in a scratch repository); (3) a directory that is not a repository shows `Routing information unavailable`, because the routes command exits with an error there like any other failure; (4) before the first prompt of a session the pane also shows `Routing information unavailable`, because nothing has been read yet; (5) the exported pacingBand function, not called by the plugin, still has its own unknown fallback and was not changed. Focused check by the orchestrator, as decided in L35, with no cross review: diff inside the authorized surfaces (10 files); no product string keeps the old texts; plugin tests 576 pass, 0 fail; context budget test 4 pass, 0 fail; full node suite 5137 tests, 5137 pass, 0 fail. Not proven: the real core was not run by the writer (stubs only) and the pane was not drawn on a real host. M17 commits on feat/core-hook-t4: 4d4eb37e9, f2b40817b, 928094dbe, 26ac5504e. Known debt carried forward: the text output of the core routes command still prints unknown (unknown); roles multiplied per historical run is NOT_REPRODUCED; visual integration with Claude Code is not verified and must be checked in Milestone C (real appearance, line wrapping, quota refresh, toggle, cleanup of Running, new and existing projects). Risk: item 3 (the Pacing line wording and the pane rows changed on Sam's decision; nothing in the repository parses them). Next priority: the initial onboarding. Merge, push, install and publish remain not authorized.
- L37 (2026-11-10): decision by Sam `OD-MVP-ONBOARDING — FULL_SCOPE_APPROVED`, quoted fragments verbatim. "Autorizo las tres unidades: MA18, setup guiado y protección de configuraciones existentes. Las considero parte del MVP de Kairo Runtime 0.37.0." "El onboarding no debe limitarse a guardar una API key. Nuestro objetivo es que cualquier desarrollador pueda instalar Kairo en un proyecto nuevo o existente y comenzar a utilizarlo sin conocer su arquitectura interna." "Pero mantendremos el alcance cerrado: reutilizar lo construido, no crear otro sistema de configuración." Units and priority: "MA18 — Artificial Analysis BYOK" : "Configurar y validar la clave personal de cada usuario", first; "MA23 — Setup guiado" : "Detectar hosts, proveedores y próximos pasos", second; "MA24 — Configuración existente" : "Mostrar los cambios previstos antes de aplicarlos", third. "MA23 y MA24 son identificadores propuestos; registrar esos números únicamente si no existen ya en el plan." MA18: "Apruebo almacenar la clave en un archivo local bajo el directorio de configuración de Kairo, fuera de los repositorios, utilizando permisos `0600` en sistemas POSIX y un directorio privado." "Condiciones obligatorias:" "`ARTIFICIAL_ANALYSIS_API_KEY` tiene prioridad cuando contiene una clave válida." "Escritura atómica y rechazo de symlinks o ubicaciones inseguras." "Ninguna clave debe aparecer en logs, trazas, diagnósticos, reportes o backups." "Validación de credenciales únicamente cuando el usuario lo solicite o durante el onboarding autorizado." "Sin clave, Kairo continúa funcionando con capacidades degradadas y sin presentar rankings no disponibles como actuales." "Permitir agregar, sustituir o eliminar la clave posteriormente." "El archivo `0600` es una solución razonable para el MVP, aunque no equivale a protección cifrada mediante el llavero del sistema." "No incluiremos ninguna API key compartida de Kairo en el paquete publicado." MA23: "1. Detectar: Hosts instalados, configuraciones existentes, proveedores disponibles y autenticación cuando sea verificable." "2. Configurar: Elegir integraciones compatibles, revisar opciones y configurar Artificial Analysis opcionalmente." "3. Revisar y aplicar: Mostrar qué cambiará, qué se conservará y qué requiere confirmación." "4. Verificar: Diagnóstico final, capacidades realmente disponibles y siguiente comando para comenzar." "La detección debe distinguir entre host instalado, configuración detectada y autenticación comprobada. Encontrar una carpeta de Claude o Codex no demuestra que el ejecutable exista ni que esté autenticado." "Reutilizar `kairo setup`, `kairo doctor` y los comandos actuales de proveedores, preservando la compatibilidad del CLI existente." MA24: "Antes de instalar o modificar algo, Kairo debe ofrecer una vista previa que indique los archivos que pretende crear, modificar o conservar." "Regla: ninguna configuración ajena debe sobrescribirse silenciosamente." "Debe funcionar con instalaciones previas de Kairo, proyectos sin Kairo y configuraciones de otros plugins. No exigiremos eliminar Gentle AI, Engram, CodeGraph u otras herramientas." "El usuario debe poder cancelar sin dejar modificaciones parciales." Acceptance: "Cada unidad tendrá pruebas con un home temporal, sin usar credenciales reales. Exijo especialmente pruebas de instalación inicial, reinstalación, configuración existente, credenciales ausentes o inválidas, permisos inseguros y recuperación después de una operación fallida." "El flujo completo debe demostrar que una persona puede: Instalar → revisar → configurar → verificar → empezar a trabajar." "No hace falta obligarla a seleccionar todos los modelos, activar gobernanza avanzada ni comprender los contratos internos de Kairo." Execution: "Autorizo implementar MA18 ahora, con tests y revisión independiente de seguridad antes del commit local." "MA23 y MA24 quedan aprobadas como alcance y planificación, pero su implementación comienza después del cierre de MA18. Esto limita las superficies modificadas simultáneamente." On M17: "Respecto a M17, el ajuste final aún debe completar la validación reportada. No lo consideraremos formalmente cerrado hasta contar con ese resultado; su prueba visual en el host sigue reservada para el piloto." Note by the orchestrator: that validation was completed and recorded in L36 (plugin tests 576 pass, 0 fail; full node suite 5137 of 5137; commit 26ac5504e); the formal closure of M17 remains Sam's to confirm. "No autorizo instalaciones productivas, merge, push ni publicación." Success criterion: "un usuario nuevo puede empezar sin intervención manual compleja; un usuario existente no pierde su configuración; y ninguno necesita nuestras credenciales de Artificial Analysis para utilizar Kairo." Route: MA18 is implemented in the core-hook-t4 worktree (branch feat/core-hook-t4) on top of 26ac5504e by a delegated writer, test first, with an independent security review before the local commit.
- L38 (2026-11-10): MA18 committed as a87b81083 on feat/core-hook-t4 (worktree core-hook-t4), on top of 26ac5504e. Route: delegated writer, test first; a second writer applied the security correction because the first one's context was exhausted. Added the command `kairo aa-key set|status|check|remove [--json]` (`src/global/observability/artificial-analysis-key.js`, wiring in `src/cli.js`, help and `docs/cli-reference.md`, `docs/artificial-analysis.md`). The key is kept in `secrets/artificial-analysis.key` under the Kairo home: directory 0700, file 0600, atomic write with the temporary file created 0600. It is read from standard input (capped at 1024 bytes) or a hidden prompt, never from arguments. Resolution order in one resolver used by every consumer: a well-formed `ARTIFICIAL_ANALYSIS_API_KEY`, then the stored key, then none; a blank or malformed environment value does not shadow the stored key; the source is reported without the value. Location rule: a symbolic link at or below the user home, the Kairo home or the secrets directory is refused; a link above the home is accepted only when root owns it; every directory on the resolved chain up to the root must be a real directory owned by the current user or root and not writable by group or others, except a root-owned sticky directory above the Kairo home; a location inside a repository is refused, bare repositories included; the file is opened without following links and validated on the open descriptor. A refused location yields no usable key with an explanation, so Kairo keeps working in degraded mode. The network check runs only on `kairo aa-key check` or when the user accepts it during interactive setup; setup with the yes flag or non-interactive never prompts, reads a key or calls the network. Requests carrying the key go to the fixed HTTPS host and refuse redirects. Doctor gained one informational line that changes neither the exit code nor the ok flag. The setup preview shows `Artificial Analysis key: none yet (optional; add your own later with: kairo aa-key set)` or `set (source: file|environment)` on both setup paths. Uninstall keeps the key file and prints where it is and how to delete it by hand; backups never contain it. Display audit of evaluation data: one defect found and fixed, `kairo team show` suggested a model from cached data without saying so and, with no data, said that no model qualified; it now labels a suggestion that rests on cached data with its age and says when evaluation data is unavailable; its JSON gained an additive `evidence` field; the other displays were not misleading. Verification: independent security review by Codex, first pass FAIL with four blockers: (1) a redirect to another host would forward the key header; (2) unsafe ancestors (a Kairo home with mode 0777 or reached through a symbolic link) passed the guards and the read was by path; (3) argument errors echoed a key typed as an argument, in two positions; (4) a bare repository as the Kairo home passed the repository exclusion. One correction batch, tests first (RED 28 of 71 failing, GREEN 84 of 84), fixed all four and three advisories (terminal restored on stream error, input size cap, leak scans that also look for encoded and partial keys). Recheck limited to the four blockers: all FIXED, degraded mode confirmed, overall PASS; the recheck was by source reading. Run by the orchestrator on the final tree: full node suite 5210 tests, 5210 pass, 0 fail; plugin tests 576 pass, 0 fail; no real key or personal path in the committed files (two obviously fake test fixtures remain as literals in the test file). Not proven: ownership by another user and the root-owned sticky and link cases are simulated through injected file system calls; Windows checks are skipped by name; the hidden prompt was not exercised on a physical terminal; concurrent set from two processes is not tested; a directory swap after the final check is detected after the write, not prevented, because Node has no openat. Advisories left open: three ordinary files named HEAD, objects and refs in one directory cause a false refusal; the explicit-adapter setup preview does not show the refusal reason and still builds its line separately from the shared formatter (a test pins that both paths print the same text); in interactive setup the key is stored before the final apply confirmation; the interactive wizard has no key offer, which belongs to MA23. Behavior changes to note: a home directory writable by its group is refused for key storage with a chmod hint; `aa-key` rejects flags it does not know. Note for the release report: the stored key is also used by the normal model refresh, which is its purpose; only credential validation is restricted to explicit request. Risk: item 2 (a credential is stored; guards reviewed independently) and item 3 (doctor check list, setup preview, uninstall output, team show text and JSON, and the models reader's key resolution changed). Closure of MA18 per its task line needs the Milestone C exit evidence for M24, which belongs to the integration pilot. Merge, push, install and publish remain not authorized.
- L39 (2026-11-10): MA23 committed as bb52284b3 on feat/core-hook-t4 (worktree core-hook-t4), on top of a87b81083. Route: a read-only explorer mapped the setup flow first, then delegated writers, test first. Finding from the map: plain `kairo setup` never reached the interactive wizard although `docs/cli-reference.md` said it did; it printed a read-only preview. Now, on a terminal and without flags, plain setup walks four steps. Detect (`src/global/team/setup-detect.js`) reports three separate facts per host: executable found on PATH or not, configuration detected or not, and authentication verified, not signed in, stored, not verifiable or not checked, taken from the existing provider connections status (version and sign-in status commands, 10 second timeout each, run concurrently, no model call); authentication is verified only when the status command exits zero and says signed in; a configuration directory alone never makes a host usable. Configure defaults to hosts whose executable was found, lists a configuration-only host as not preselected, stops before the key question and the apply when no host is usable, and offers the optional Artificial Analysis key. Review lists the steps that will run for the confirmed selection and asks `Apply these changes? [y/N] (type y or yes to apply; Enter cancels): `; only y or yes applies. Every host-specific step follows the confirmed selection: kit, router, roles sync, and roles init through a new optional host filter in `src/global/team/roles-init.js` that only the guided flow passes. A typed key is stored only after every apply step succeeded; a failed or partial installer receipt stops the flow with exit code 1, and the applied and not applied lists come from the installer receipts or, when the installer throws, from a content hash comparison of the planned files. Verify prints the doctor result, the capabilities really available and one next command, and mentions without running it the command that verifies paid model access. Without a terminal plain setup stays a read-only preview that never prompts, now with the Detect block; the yes flag, explicit adapters, dry run and JSON output are unchanged. `src/global/provider-connections/service.js` gained one additive field, `authentication.statusExitCode`; the output of the team providers command is unchanged. Added `docs/getting-started.md`; corrected the help line, `docs/install.md`, `docs/artificial-analysis.md` and `docs/cli-reference.md`, which described plain setup as the wizard. Verification, independent review by Codex: first pass FAIL with seven blockers: a failed apply returned as a nested receipt still stored the typed key; a Codex-only selection could install the Claude router; a sign-in status command exiting non-zero while printing a signed-in answer rendered as verified; configuration-only hosts were preselected; partial writes could be reported as nothing applied; help and docs still called plain setup the wizard; the failure test covered only a thrown failure. The orchestrator added one requirement in the same batch: the confirmation applied on Enter and now needs an explicit yes. One correction batch, tests first (RED 9 of 10 new tests failing, GREEN 27 of 27). Recheck: five blockers FIXED; the selection blocker still reproduced through roles init, which registered a Claude agent in the project roles file for a Codex-only selection, making one sentence of the getting-started guide false. Second and last correction, tests first (RED 27 of 30, GREEN 30 of 30); no third review was run, so that last fix is verified by tests only. The orchestrator first authorized a wrong path for that correction (the file is under team, not hosts); the writer stopped without editing and reported it. A writer ran git stash by accident during the first correction and popped it immediately; the orchestrator checked the worktree afterwards (empty stash list, all files present). Run by the orchestrator on the final tree: full node suite 5242 tests, 5242 pass, 0 fail; plugin tests 576 pass, 0 fail. An intermediate full run on the tree before the corrections gave 5227 of 5228, the failure being the real codex preflight canary test, which ran while a Codex review was in progress; it passed in the two later runs and was not investigated. Pre-existing limitation, classified by the reviewer as not a blocker of this change: on the yes flag path a nested failed installer receipt does not stop the run; that path has no key prompt and no selection step. Not proven: no real host executable, credential or terminal was used, so detection relies on the existing parsers; an interrupt on a real terminal was exercised only through closed input; the reinstall test excludes the directories the installer rewrites on every run and stubs the kit and router steps; a thrown failure of the Claude kit step is reported without itemizing what it wrote; the existing preview already ran the local usage command of the Claude CLI before this change, and that it consumes no quota on every installed version is not proven; detection can take about 20 seconds in the worst case and the guided flow detects twice. Open advisories: end of input at the hidden key prompt submits the buffer instead of cancelling; agents with no inferable provider are still listed as unmapped in the roles init output for unselected hosts, without being written; the Review step names do not name hosts. Risk: item 3 (plain setup on a terminal changed from a read-only preview to a flow that can apply after an explicit yes; optional parameter in roles init; additive field in the provider status) and item 2 (the key is stored only after a fully successful apply). Merge, push, install and publish remain not authorized.
- L40 (2026-11-10): MA24 committed as aa689a539 on feat/core-hook-t4 (worktree core-hook-t4), on top of bb52284b3. Route: delegated writers, tests with a temporary home. Added `src/global/team/setup-change-preview.js`: before plain `kairo setup` applies anything, Review lists what it would touch in the home and the project, built from the planning functions the apply steps already use (adapter plans, component asset dry run, SDD and kit plans, roles planning with an approved team), each entry as create, modify only Kairo's managed part, replace the whole file with or without a backup, or keep, with its owner as far as it can be told. Steps whose writes are not known in advance are listed under a labeled group: team analyze and approve when an analyst is passed, roles init and sync in that same run, and the router step, where the Claude CLI writes its own plugin files. Entries rewritten on every run are named with the reason: the Kairo state file, the history file and a new timestamped SDD record. The non-terminal preview and the dry run print the same list, the JSON preview gains an additive `changes` field, and the existing verbose flag prints the full list. The confirmation names how many files will be replaced and names up to three paths that replace content of the user, of another tool, or behind a symbolic link. Building the preview writes nothing, cancelling leaves the home and the project byte-identical (full tree hash, links not followed, permission bits included, nothing excluded), and no write path of the installer, the kit, the router or the roles steps changed. Added `docs/existing-setups.md`. Fixtures with foreign configuration, each compared between the predicted list and the real tree difference after apply: user content with no Kairo block (block appended, user bytes kept, backup equal to the original); user content around a stale block (both parts kept, block replaced); other tools' settings, MCP and hook entries (untouched; a foreign hook kept and the Kairo hook added); other tools' agent and skill files (untouched); foreign files at paths Kairo would create (kept, no backup); symbolic links. Existing behavior that the preview now states instead of hiding, none of it changed: a managed instruction file that is a symbolic link is written through the link, merged, with a backup; a symbolic link at the Codex hooks file or the OpenCode plugin is replaced by a regular file, the old target left unchanged, with a backup; an edited Kairo component copy is replaced with no backup; a component file or directory that is a symbolic link is written through the link, so a user file it points to is overwritten with no backup; SDD skills refuse a linked file; a linked kit file is kept, and a kit file under a linked directory is rewritten where the link leads with a backup beside it. Recovery, as documented: the rollback command restores only the snapshots under the Kairo home backups directory (instruction files, the Codex hook file, the OpenCode plugin); backups beside a file (kit, roles) are restored by hand by copying them back; SDD backups are restored with `kairo components rollback sdd-core --receipt <id>`; component copies have no backup; files created by a failed run are not deleted. Verification, independent review by Codex: first pass FAIL with two blockers: (B1) a component file that is a symbolic link was overwritten through the link while the preview announced only the replacement of a Kairo copy; (B2) the getting-started guide told users to restore beside-file backups with the rollback command, which does not restore them. One correction batch, tests first (RED 8 of 34 failing, GREEN 34 of 34), also fixed three weak tests the reviewer named (an assertion made always true, an agreement case that did not inject a real unexpected write, two applying tests that did not compare against the tree). Recheck: B2 FIXED, the three advisories confirmed, no write path changed; B1 still reproduced in one variant: a symbolic link above the home (an aliased home or temp directory) stopped the recording of links below it. Second and last correction, tests first: the home and the project root are resolved to their canonical path once and each written path is walked component by component below it; RED on the alias case and on a link to a missing target, GREEN 37 of 37. No third review was run, so that fix is verified by tests only. Behavior note: a component file that is a link to a path that does not exist yet is listed as create, since nothing is overwritten. Incident: the first writer reported that a shell loop reverted its edited files to HEAD and that it recreated them from its own edits; the orchestrator then checked the worktree (HEAD unchanged, empty stash list, git fsck clean, only MA24 files modified) and later prompts forbid stash, reset, checkout, restore and shell loops that write tracked files. Deviation recorded: the first writer wrote the new module before its tests, so those tests were not strictly RED. Run by the orchestrator on the final tree: full node suite 5279 tests, 5279 pass, 0 fail; plugin tests 576 pass, 0 fail; no real key or personal path in the committed files. Not proven: no real host executable, credential, terminal or Claude CLI router install was used; Windows and its junctions are untested; the alias cases were run for the component group only, the project root using the same code without an alias test of its own; a chain of more than 40 links makes the walk give up and report the path itself; runs with an analyst were not applied end to end in this unit; with a malformed hooks file the guided flow stops at Review with the existing error and does not print the list. Open for Sam, outside this unit because it changes what the installer writes: the installer still overwrites the target of a linked component file or directory with no backup once the user confirms; it is no longer silent. Also open: a linked file whose target stays inside the Kairo home is listed as Kairo's with its target and warning and is overwritten all the same; the older setup help text printed by `src/cli.js` does not mention the verbose flag. Risk: item 3 (the Review and confirmation text changed; the dry run, the non-terminal preview and the JSON preview gained output) and item 1 only as read-only planning. With MA18, MA23 and MA24 implemented, the three onboarding units of L37 are committed locally; none was exercised with real hosts, credentials or a real terminal, which belongs to the integration pilot. Merge, push, install and publish remain not authorized.
- L41 (2026-11-10): decision by Sam `OD-MVP-RELEASE-HARDENING — APPROVED`, quoted fragments verbatim. "Acepto el cierre de implementación de M17 y autorizo corregir los dos defectos del instalador antes de iniciar el piloto de Kairo Runtime 0.37.0." "Tenemos una base importante: 5279/5279 tests de Node y 576/576 del plugin, pero todavía falta demostrar que el producto funciona correctamente en una instalación real." "Quiero que dejemos de agregar funcionalidades y empecemos a preparar una versión candidata a publicación." Resolution of the four points: "Instalador sobrescribe destinos de symlinks" : "BLOCKER de release. Corregir."; "`kairo setup --yes` ignora fallos anidados" : "BLOCKER de release. Corregir."; "Cierre formal de M17" : "Aprobado, con validación del host pendiente"; "Siguiente etapa" : "Hardening del instalador → integración → piloto real". A: "No podemos distribuir un instalador que sobrescriba archivos externos al seguir enlaces simbólicos." "Para 0.37.0 apruebo la solución más conservadora:" "Si el destino es un symlink existente, Kairo no lo sobrescribe automáticamente, aunque se utilice `--yes`." "Debe identificar el enlace sin seguirlo, informar el conflicto y conservar tanto el enlace como su destino. La instalación podrá detener esa operación con una indicación de resolución manual." "No necesitamos desarrollar un administrador avanzado de symlinks para esta versión." "El test de aceptación debe demostrar que un enlace apuntando fuera de la instalación queda intacto, incluidos los bytes del archivo de destino." B: "Un instalador no puede declarar éxito si alguno de sus pasos obligatorios falló." "La corrección debe garantizar que un recibo anidado de fallo produzca un resultado global fallido, código de salida distinto de cero y un diagnóstico que identifique la operación afectada." "No se debe mostrar `Setup complete` ni registrar instalación exitosa en ese caso." "Si existe una modificación parcial, debe comunicarse claramente qué quedó aplicado y cómo recuperarlo. Reutilizar los mecanismos actuales de backup y rollback cuando estén disponibles." "Ambos defectos deben probarse con un HOME temporal, sin tocar tu instalación." M17: "Confirmo: `M17 — IMPLEMENTATION_CLOSED / HOST_VALIDATION_PENDING`" "La implementación y sus tests están terminados según la evidencia presentada. El trabajo visual y funcional pendiente corresponde al piloto, no a otra ronda de desarrollo del panel." "Durante ese piloto debemos comprobar el panel real en Claude Code, su ajuste de líneas, el estado inicial, la actualización de cuotas, el toggle y la limpieza de `Running`." "Si cumple, M17 quedará validado para publicación. Si aparece un defecto real, lo corregiremos de forma focalizada." Next phase, milestones: Hito A, implementation and tests, "Cierre en curso": "Corregir únicamente los dos bloqueantes confirmados del instalador y revisar los requisitos todavía abiertos." Hito B, release integration, "Preparación autorizada": "Inventario de commits, dependencias entre worktrees, archivos no rastreados, versión, documentación y paquete." Hito C, real pilot, "Pendiente": "Instalación y actualización controladas; Claude Code y Codex, proyectos nuevos y existentes, M17, BYOK y los tres patrones de orquestación." Hito D, publication, "No autorizado": "Prerelease 0.37.0-beta.1, documentación pública y publicación estable cuando el piloto pase." "La evidencia pendiente de M24 para MA18 debe verificarse durante el piloto. No utilizaremos credenciales reales hasta aprobar explícitamente esa prueba y sus límites." Scope authorized now: "Autorizo un único lote de corrección del instalador, con pruebas y revisión independiente de ambos defectos. También autorizo preparar un inventario de integración de solo lectura para la rama `release/v0.37.0`." "No autorizo todavía crear o fusionar la rama de release, instalar en el entorno productivo, modificar credenciales reales, hacer push ni publicar." "El inventario debe señalar las dependencias entre los commits y cualquier archivo sin rastrear relevante, incluido `tsconfig.json`, sin incorporarlo automáticamente." "No necesitamos otra ronda general de arquitectura ni más funcionalidades." Route: the installer correction is recorded as task MA25 and delegated to one writer in the core-hook-t4 worktree (branch feat/core-hook-t4) on top of aa689a539, tests first, followed by an independent review of both defects; the integration inventory is prepared read-only by an explorer and nothing is created or merged.
- L42 (2026-11-10): MA25 committed as fcd0f8d8e on feat/core-hook-t4 (worktree core-hook-t4), on top of aa689a539. Route: delegated writers, tests first, temporary HOME. (A) Links under the components directory: a component path that is an existing symbolic link, at the file or at any directory between the components directory and the file, the components directory itself included, a link with a target inside the Kairo home and a dangling link included, is a conflict: nothing is written, created, deleted or replaced at or through it, with or without the yes flag. A preflight at the start of the installer finds every such conflict before the first write of the run, so on a conflict nothing at all is written, not even components without a link, state or a history line, and the run fails with the link path and a manual resolution (remove or replace the link, then run setup again). Component files are written to a temporary file created exclusively in the destination directory and moved into place with rename; directories are created one level at a time and re-checked by device and inode, again just before the rename; a failed rename after the checks is the same conflict outcome. (B) Failed steps: a nested failed or partial receipt fails setup on every path (plain setup with the yes flag, explicit adapters or components, the guided flow, the install command): non-zero exit, a diagnostic naming the operation and its reason, no success line, a history line with action failed, and no state file written (an existing one stays byte-identical). The output lists what was applied and what was not from every receipt at every level, names only backups that exist, names the rollback command only when a snapshot exists and the SDD rollback only when that component was installed before the run, and otherwise gives the manual copy. On a retry, a file left by a failed run is taken over only when it is a destination of the current SDD plan and its bytes equal the packaged copy, and the receipt naming it is a regular file inside the SDD directory; a receipt alone grants nothing. The change preview lists a linked component path as a conflict that will not be written, and the explicit-adapter path prints the conflict before any preview and asks no confirmation. `kairo upgrade` now prints the conflict line. Verification, independent review by Codex: first pass FAIL with three blockers: a check-then-write race in the component installer; a partial run that stranded ownership because SDD ran before the state was withheld, so a retry did not converge and the printed promise was false; a report that omitted applied component assets, omitted nested backups and suggested an SDD rollback that a fresh failed install refuses. One correction batch, tests first (RED 22 of 32 failing, GREEN 32 of 32). Behavior change from that batch: with the preflight, a link conflict no longer installs the other components in that run. Recheck: the report blocker FIXED; two blockers still reproducible in adversarial variants: a forged receipt could make the retry adopt a foreign file, and a process with write access could move the temporary file and replace the parent directory after the last check. Second and last correction, tests first (RED 6 of 8 new tests failing, GREEN 40 of 40): adoption is bound to the plan and the packaged bytes, the late swap is narrowed, and a preview line that said no managed changes planned before asking for confirmation on a conflict was corrected. No third review was run, so the adoption rule and the narrowed race are verified by tests with injected hooks only, not by a concurrent process or a new independent review. Residual limit, stated in the code and in docs/existing-setups.md and not presented as closed: "A process with write access to the Kairo home that acts between the last check and the rename can still redirect one write. Such a process can already modify your files directly, and an existing link is never written through." Closing it needs directory-descriptor-anchored operations that Node does not provide. Run by the orchestrator on the final tree, with nothing in parallel: plugin tests 576 pass, 0 fail; full node suite 5319 tests, 5313 pass, 6 fail, all in test/core-hook (two handover tests, legacy differential older core, three F2 record-launch tests); the two files holding them pass alone, 15 of 15, and the commit changes nothing under test/core-hook or the router plugin. Earlier runs in this unit: 5296 of 5297 (the claude wrapper sandbox test, which passes alone 6 of 6) and 5309 of 5311 (two core-hook tests). This is the load sensitivity recorded since L28; it was not investigated, as decided in L29, and it is not presented as a fully passing suite. Open decisions for Sam: (1) accept the residual race as a documented limit for 0.37.0; (2) whether `kairo upgrade` and `kairo sync` must also exit non-zero and record a failed history line when a linked component is skipped: today they skip it, upgrade and sync print a conflict line, and both record applied or repaired; (3) the interactive wizard in src/global/clack/setup-wizard.js asks its own confirmation before the conflict is detected, so on that path the conflict is reported only by the apply, with nothing written and a non-zero exit; (4) doctor can show a component that is a symbolic link with canonical content as healthy although setup rejects it (src/global/drift.js lines 76 to 103). Not proven: a failure of the state file write itself; ownership of kit and roles files after a failed run; Windows; permission-bit tests skip as root. Risk: item 2 (link handling, adoption rule and the write path), item 3 (setup exit code on failure, the history gains the action failed, no state on a failed run, JSON failure fields, the preview conflict action, no history line on a preflight conflict) and item 4 (the write-time race and its stated residual). Merge, push, install and publish remain not authorized.
- L43 (2026-11-10): read-only integration inventory for a future branch release/v0.37.0, prepared as authorized in L41; nothing was created, merged, fetched or pushed. The explorer's handoff left most points uncaptured, so the orchestrator completed and verified them with read-only git commands. Chain, verified with merge-base ancestry: main (62f2c6b34), then feat/router-u2-u5 (+55), feat/core-hook-t0 (+1), feat/core-hook-t1 (+9), feat/core-hook-t2 (+7), feat/core-hook-t3 (+10), feat/core-hook-t4 (+32 at the time of the inventory, 114 ahead of main and none behind, before the MA25 commit); feat/core-hook-snapshot (+3 over t2) is contained in t4; fix/team-analyze-error-detail (1 commit) is not in t4. feat/router-provider-authority does not descend from feat/router-u2-u5; it shares the merge base 4cf5f1fa5 with t4, and all of its commits since that base touch only the odd directory, where this feature document lives; t4 has 73 commits since that base; no file was changed on both sides, and a read-only merge-tree of the two branches produced a tree with no conflict. Untracked and uncommitted: integrations/claude-code/kairo-router/tsconfig.json in the main checkout is 56 bytes, contains only an extends of the plugin types tsconfig, does not exist in t4 and is referenced by no tracked file of t4; it was not incorporated. The u2-u5 worktree has 13 modified tracked files without a commit, among them hooks/register.ts, src/global/team/service.js and routing-input-cache.js, which overlap files t4 already changed; their purpose is unknown to the orchestrator. Version: package.json is 0.36.0 on main and on both branches; the router plugin manifest on t4 is 0.9.0; CHANGELOG.md has an empty Unreleased section above 0.36.0; lockfiles were not checked exhaustively. Package: the files field publishes bin, src, scripts, repo-template, global-template, prompts, README.md, LICENSE and CHANGELOG.md, so docs is not published although the CLI help refers to docs/getting-started.md, docs/artificial-analysis.md, docs/install.md and docs/cli-reference.md, and integrations is not published either: the router plugin is installed with the Claude CLI marketplace command from the GitHub repository, so the panel changes of M17 reach a user only once that branch is on GitHub, not through the npm package. Documentation: t4 adds seven documents and modifies README.md, docs/cli-reference.md and docs/install.md; every docs link in the README exists on t4; no stale product phrase remains. Not verified: whether the branches are pushed (none has an upstream configured), pull request state (the gh CLI could not connect), and the exact tarball content (npm pack was not run). Decisions this leaves for Sam: what to do with the 13 uncommitted files of u2-u5; whether docs enters the package or the help points to a URL; how the router plugin reaches the pilot, given that it comes from the GitHub repository and push is not authorized; whether fix/team-analyze-error-detail enters 0.37.0; and the version locations to change for 0.37.0 and for 0.37.0-beta.1.
- L44 (2026-11-10): decision by Sam `OD-MVP-RELEASE — INTEGRATION_PREPARATION_APPROVED`, quoted fragments verbatim. "Autorizo cerrar los pendientes del instalador y preparar la rama `release/v0.37.0` en un worktree aislado. Todavía no autorizo instalación productiva, push ni publicación." "Estamos en la etapa donde debemos dejar de ampliar el MVP y empezar a integrar, empaquetar y validar lo que ya construimos." Resolution of the eight points (decision : condition): "1. Carrera residual TOCTOU" : "Aceptar como deuda conocida" : "Documentar el límite frente a modificaciones concurrentes del mismo usuario. No afirmar protección absoluta"; "2. `upgrade` y `sync` reportan éxito al omitir symlinks" : "Corregir antes del release" : "Si se omite un componente que debía actualizarse, devolver fallo o estado parcial explícito y exit code distinto de cero"; "3. Wizard confirma antes de detectar conflicto" : "Corregir" : "Detectar conflictos antes de solicitar confirmación y revalidarlos antes de aplicar cambios"; "4. `doctor` considera sano un symlink" : "Corregir" : "Reportar `CONFLICT` o `UNSAFE_TARGET`, nunca `healthy` para un componente enlazado no permitido"; "5. 13 archivos pendientes de u2-u5" : "Excluir del release" : "Preservar su diff y checksum; no mezclarlos con T4 ni descartarlos sin respaldo"; "6. `docs/` fuera del paquete npm" : "Incluir documentación pública necesaria" : "Sólo guías referenciadas por el CLI; excluir ODD, investigaciones y documentación interna"; "7. Plugin router requiere GitHub" : "Piloto desde artefacto local" : "Usar el paquete/plugin generado desde el mismo commit del release, en entorno aislado"; "8. `fix/team-analyze-error-detail`" : "Excluir de 0.37.0" : "Sólo reconsiderarlo ante un bloqueante reproducible de los flujos principales". Installer: "Los puntos 2, 3 y 4 deben corregirse en un único lote focalizado MA25b." "No quiero introducir otro subsistema de seguridad. Debemos reutilizar los chequeos y resultados tipados existentes." "En particular, `--yes` significa aceptar cambios permitidos, no autorizar la sobrescritura de destinos inseguros ni ignorar errores." "La carrera residual del punto 1 se acepta dentro del modelo de amenazas actual, siempre que las ubicaciones normales de instalación no sean modificables por otros usuarios no autorizados." Validation of MA25: "No doy por aprobada la suite completa: el resultado actual es 5313/5319." "Sin embargo, tampoco necesitamos repetirla indefinidamente." "Autorizo una corrida final con la máquina en reposo después de MA25b, junto con pruebas focalizadas para los tres problemas corregidos." "El cierre requiere:" "Tests de seguridad del instalador aprobados." "Revisión independiente de los cambios de MA25b." "Ninguna regresión reproducible atribuible al lote." "Suite completa limpia o evidencia comparable suficiente para clasificar fallos preexistentes de infraestructura." "Si vuelven a aparecer los mismos flakes, no iniciaremos otra auditoría general. Se registrarán con el alcance exacto de la evidencia." "MA25 sigue abierto hasta cerrar MA25b." Integration: "Autorizo crear la rama de release en un worktree aislado, sin modificar la instalación global ni los worktrees originales." Code origin: feat/core-hook-t4, "Cadena integrada de core, hooks, M16, M17, onboarding y MA25b". Documentation origin: feat/router-provider-authority, "Sólo los commits documentales necesarios, sin arrastrar código abandonado". Destination: release/v0.37.0, "Candidato reproducible, sujeto a pruebas de integración". "Las dependencias deben verificarse antes de integrar. No debemos hacer cherry-picks indiscriminados de archivos o commits históricos." Packaging: "Autorizo actualizar la lista de archivos públicos del paquete para incluir la documentación necesaria." "La verificación debe utilizar: npm pack --dry-run" "Y posteriormente inspeccionar el tarball real para comprobar que no contiene claves, artefactos internos, worktrees, logs ni documentación ODD privada." "El `tsconfig.json` sin rastrear sigue fuera de alcance hasta determinar si realmente es necesario para construir el paquete o ejecutar sus tests." Plugin without push: "Autorizo preparar un artefacto local del router, identificado por commit y checksum, e instalarlo únicamente en un entorno de prueba aislado." "Debe verificarse que el artefacto sea equivalente al que recibiría un usuario a través del mecanismo público." "Si el sistema de instalación de plugins exige GitHub y no admite una fuente local equivalente, esa limitación debe quedar documentada. En ese caso, no declararemos validado el camino de instalación pública hasta probarlo con su distribución real." "No autorizo publicar una rama temporal solamente para evitar esa limitación." State of the MVP: M16 "Cerrado con deuda conocida"; M17 "Implementación cerrada; piloto real pendiente"; onboarding and Artificial Analysis BYOK "Implementados; pruebas reales pendientes"; MA25 "MA25b pendiente"; release integration "Autorizada para preparación"; three orchestration patterns "Validación E2E pendiente"; publication 0.37.0-beta.1 "No autorizada todavía". Approved order: "1. MA25b: corregir los puntos 2–4, probarlos y realizar una revisión independiente. 2. Congelar el código candidato: sin nuevas funcionalidades, salvo bloqueantes reproducibles de publicación. 3. Integrar `release/v0.37.0`: código y documentación desde commits identificados. 4. Verificar empaquetado: tarball, dependencias, archivos públicos y artefactos del plugin. 5. Preparar el Hito C: matriz de piloto para instalación nueva, actualización, Claude Code, Codex, panel, BYOK y orquestación." "No autorizo aún ejecutar el piloto sobre tu configuración productiva. Primero debemos contar con el paquete candidato y un entorno aislado verificable." "La decisión importante es que 0.37.0 entra en fase de estabilización." "No agregaremos más herramientas, agentes, sistemas de memoria ni capacidades al MVP. Las siguientes tareas deben servir para integrar, probar, corregir bloqueantes reales y publicar." Route: MA25b is delegated to one writer in the core-hook-t4 worktree on top of fcd0f8d8e, tests first, followed by an independent review and one final full-suite run on an idle machine; the uncommitted u2-u5 files are preserved as a patch with checksums outside every repository, without touching that worktree; the release worktree is created only after MA25b closes.
- L45 (2026-11-10): MA25b committed as 8d30987d4 on feat/core-hook-t4 (worktree core-hook-t4), on top of fcd0f8d8e. Route: delegated writers, tests first, temporary HOME; existing checks and typed results reused, no new security subsystem. (2) `kairo upgrade` and `kairo sync` run the same preflight as setup: with a component path that is a symbolic link they write nothing and fail with a non-zero exit, a diagnostic naming the component, the link path and the manual resolution, no success line, a history entry with action failed and JSON carrying the failure; the yes, confirm and no-preflight flags do not override it; a linked home is no longer reported as already in sync. The writer chose the preflight over a partial result because sync and upgrade write configuration, backups and state after the components, so a partial run would leave the home half updated with no state recording it. (3) Every interactive path detects the conflict before it asks: the Clack wizard, the readline question, the explicit-adapter preview, the guided flow and interactive sync and upgrade; with a conflict no question is asked, nothing is written and the exit is non-zero; the installer checks again immediately before it writes. (4) `kairo doctor` and `kairo status` inspect component paths without following links: UNSAFE_TARGET when the link resolves outside the Kairo home, CONFLICT for every other link (target inside, dangling, looping), never healthy; every component reached through a shared link carries the status; doctor exits 1 and status reports failed. Also: the preflight summary before sync and upgrade states the link conflict instead of reporting no planned changes; the guided Verify step lists CONFLICT and UNSAFE_TARGET by name; JSON envelope keys can no longer be overwritten by extras, apart from the deliberate ok false on a failure, and the backups of a failed sync run are reported as `backupsOfRun` while `backups` keeps its numeric meaning. Verification, independent review by Codex: first pass FAIL with two blockers: a link shared by several components (the components directory itself linked) was attributed to the first component only, leaving another reported healthy; the numeric `backups` field of the sync JSON envelope was overwritten with an array on a failed run. One correction batch, tests first, also closed three gaps the orchestrator had flagged (the guided flow still asked for confirmation after listing the conflict, the guided Verify step filtered out the new statuses, the preflight summary said no planned changes) and corrected a sentence that claimed doctor makes no network call, which is false and predates this work (doctor probes a local model backend). Recheck: both blockers FIXED, and one regression introduced by that correction CONFIRMED: on a detected conflict the guided flow skipped the question and then called the apply, so if the link was removed before the installer preflight the apply wrote without an explicit yes. Second and last correction, tests first: on a detected conflict no apply is ever called on any path; interactive sync and upgrade had the same pattern and were fixed; the wizard and readline paths were already safe and are pinned. Rule recorded in docs/existing-setups.md: a skipped question is never consent. No third review was run, so that last fix is verified by tests only. Final full suite, run once by the orchestrator on the final tree with no other task running (load average about 5 at start): plugin tests 576 pass, 0 fail; node suite 5362 tests, 5361 pass, 1 fail in 378 seconds. The single failure is `real codex preflight canary passes and leaves no file behind` in test/readonly-codex-sandbox.test.js, a test that runs the real Codex executable; the file passes alone twice, 4 of 4 each time; MA25b changes no sandbox or Codex file; the same test failed once before on an earlier tree (recorded in L39) and passed in the runs after it. No core-hook test failed in this run. Classification against the criterion of L44, clean full suite or comparable evidence sufficient to classify pre-existing infrastructure failures: pre-existing, dependent on an external executable, not attributable to the batch; recorded with the exact scope of the evidence and not investigated further, as decided. It is not presented as a fully passing suite. Not proven: interactive paths were driven with injected prompts, not a real terminal; for interactive sync and upgrade the absence of an apply call is shown by the shape of the result and an unchanged tree, the installer having no seam that counts apply calls; `kairo update` and `kairo install` share the changed code and were not driven separately; Windows links were not exercised. Known debt accepted in L44 and unchanged: the residual race between the last check and the rename. Risk: item 2 (no write at or through a link on the sync and upgrade paths; a skipped question no longer reaches a write) and item 3 (sync and upgrade exit non-zero with a failed history record; additive JSON fields; new CONFLICT and UNSAFE_TARGET statuses; the guided conflict result). With this, the candidate code is frozen at 8d30987d4 as ordered in L44: no new functionality, only reproducible publication blockers. Next, in the approved order: integrate release/v0.37.0 in an isolated worktree, verify packaging, prepare the Milestone C pilot matrix. Merge to main, push, install and publish remain not authorized.
- L46 (2026-11-10): release integration prepared as ordered in L44, steps 2 to 5; nothing was pushed, published, tagged, merged into main or installed outside a temporary HOME. Step 2, freeze: candidate code frozen at 8d30987d4 (feat/core-hook-t4). Step 3, integration: branch release/v0.37.0 created in a new isolated worktree (agentic-harness-worktrees/release-v0.37.0) from 8d30987d4; documentation brought in with one merge commit without fast-forward of feat/router-provider-authority at db65c6bab (08eb628b5): since the merge base 4cf5f1fa5 that branch has 61 commits touching only two files under odd/tasks, no file changed on both sides, and the staged merge differed from feat/core-hook-t4 only under odd/tasks; no cherry-pick was used; the main checkout and the other worktrees were not modified (verified by the orchestrator). Excluded as decided: the 13 uncommitted files of the u2-u5 worktree, preserved outside every repository at agentic-harness-worktrees/u2-u5-preserved-2026-11-10 with the patch, the files as they are and as they were at HEAD 62a9dd6f8, a manifest and checksums (patch SHA-256 ef1fd22743ec4d5d383f158e44ad6f48d767db68047baab3fb422ebe002d0ec2; 27 of 27 checksums verified by the orchestrator, reverse apply check clean, source worktree unchanged); fix/team-analyze-error-detail; and the untracked integrations/claude-code/kairo-router/tsconfig.json, which is not needed: the plugin tests pass without it and no tracked file refers to it. Step 4, packaging (41b0d954e): the files field of package.json now lists the six documents the CLI refers to (docs/cli-reference.md, docs/install.md, docs/getting-started.md, docs/existing-setups.md, docs/context-diagnosis.md, docs/artificial-analysis.md) plus a negation for docs/README.md, which npm would otherwise add by itself; test/package-contents.test.js pins the contents (RED before the change, GREEN after). npm pack with the dry-run option: 754 files, 1126745 bytes packed, 3935009 unpacked. Real tarball built in a scratch directory: kal-elsam-kairo-runtime-0.36.0.tgz, 1126745 bytes, SHA-256 cba5d827fcc3c6f2bee7c44665b6f3960408467a3d610bde954a26208fac8123 (recomputed by the orchestrator). Inspection of the extracted tarball: no private key header, no provider-key shape, no long literal token, no home path or user name of this machine, nothing from odd, no log, backup or editor file; all three bin files present and executable, the import closure complete, the imported packages declared. Smoke test with a temporary HOME, npm prefix and cache: the version and help commands and setup with the dry-run option exit 0; doctor exits 1 on the empty temporary HOME, as expected with no state; the real Kairo home did not change, and in the real Claude configuration only its backups directory moved, written by the running Claude Code session before the test started. Router plugin artifact: an archive of integrations/claude-code/kairo-router and .claude-plugin made with git archive at 41b0d954e, SHA-256 0855a41f9dd35ce7d15ca22181d3855b5629c30a7e9c982806682037365b57cb, plugin kairo-router 0.9.0; the Claude CLI accepts a local path as a marketplace source, so a local install is possible; it was not installed, and its equivalence with what a user receives from the GitHub repository is not proven: it requires comparing against a fresh clone once the branch is there, and until then the public installation path is not validated. Record: odd/release/v0.37.0-integration.md (15ccefce2). Full suite on release/v0.37.0, run once by the orchestrator on an idle machine after installing dependencies in that worktree: plugin tests 576 pass, 0 fail; node suite 5364 tests, 5364 pass, 0 fail, in 344 seconds. This is the first clean full run on the candidate code. Step 5, pilot plan (0957df564): odd/release/v0.37.0-pilot-matrix.md, status plan pending approval, 91 rows all not run, across environment, new installation, update, existing configuration, Claude Code, Codex, panel, BYOK, orchestration and failure recovery; the two rows that need a real Artificial Analysis key are marked as awaiting explicit approval and limits; it maps the Milestone C exit criteria of this document to its rows and lists the criteria without a row (the hook latency method, the non-blocking M16 target, the classification of findings, and that a local artifact cannot satisfy published as beta); it states that the three orchestration patterns are defined in M27 and L8 while the three concrete MA19 scenarios are not written yet, so its orchestration rows are a proposal; it names the isolation variables it assumes (HARNESS_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR) and tests that assumption in its first rows; nothing in it was executed. Open items for Sam before the pilot: (1) thirteen links from published files (README.md and three published guides) to documents that are not published; (2) scripts/fixtures/verify-then-pick.ndjson, a test fixture that ships and that nothing refers to; (3) the dependency ansi-escapes is declared and never imported by published source; (4) the package version is still 0.36.0 while the decided pilot version is 0.37.0-beta.1; (5) there is no package-lock.json in the repository, so the dependencies of the candidate are not pinned; (6) confirmation of the MA25 and MA25b closure; (7) the thirteen questions of the pilot matrix, among them the isolation mechanism, the baseline version for the update rows, approval and limits for real sign-in and real credentials, the orchestration scenarios, and what the update command does, which the writer of the matrix reports as described in two different ways in docs/cli-reference.md (not verified by the orchestrator). The log entries after L45 on this branch are not yet in release/v0.37.0 and need one more documentation merge before the candidate is final. Push, publication, installation on the productive configuration and the execution of the pilot remain not authorized.
- L47 (2026-11-10): decision by Sam `OD-MVP-RELEASE — PILOT_PREPARATION_APPROVED`, quoted fragments verbatim. "Autorizo finalizar el candidato `0.37.0-beta.1` e iniciar el Hito C mediante un piloto controlado. No autorizo todavía push, instalación global en tu entorno de trabajo ni publicación en npm." "La evidencia reportada es suficiente para pasar de integración a validación: 5364/5364 tests de Node, 576/576 del plugin, tarball inspeccionado y prueba de humo con HOME temporal correcta." "Eso demuestra una base de integración funcional; todavía no demuestra que la instalación y la gobernanza funcionen sobre hosts reales." Resolution of the seven points: "1. MA25 / MA25b" : "Cerrar implementación para integración. La aceptación de release requiere revisión focalizada de sus cambios y piloto"; "2. Versión" : "Establecer `0.37.0-beta.1` únicamente en la rama de release"; "3. Trece enlaces rotos" : "Corregir antes del piloto: incluir los documentos públicos necesarios o actualizar enlaces a destinos existentes"; "4. Fixture y `ansi-escapes`" : "Excluir el fixture si no es necesario en runtime; eliminar la dependencia no utilizada sólo tras verificar referencias"; "5. `package-lock.json`" : "Añadir lockfile si npm es el gestor oficial y verificar una instalación limpia con `npm ci`"; "6. Matriz del piloto" : "Aprobada con las condiciones siguientes"; "7. Hosts y credenciales reales" : "Aprobación limitada y escalonada; sin copiar secretos ni modificar instalaciones productivas". "El cierre de MA25 no debe describirse como una auditoría de seguridad completa. Los tests son favorables, pero la revisión independiente de MA25b sigue pendiente. Esa revisión se limita al diff del instalador, sin abrir otra auditoría general." Candidate: "Autorizo incorporar L46 y la documentación necesaria desde `feat/router-provider-authority` a `release/v0.37.0`." "También autorizo corregir exclusivamente los problemas de empaquetado identificados." "El paquete final debe comprobarse nuevamente con `npm pack` e inspección del tarball. Después de cambiar versión, documentos o dependencias, el checksum anterior ya no identifica al candidato final." "No se deben incluir ODD privados, secretos, trazas, worktrees, fixtures de tests innecesarios ni archivos personales." "`release/v0.37.0` será nuestra única fuente candidata para el piloto, evitando seguir probando diferentes combinaciones de ramas." Pilot matrix: Piloto 1, instalación aislada, "Autorizado": "HOME temporal, proyecto nuevo, setup, doctor, onboarding, BYOK simulado, desinstalación y comprobación del estado residual." Piloto 2, actualización, "Autorizado": "Instalación base 0.36.0 → candidato 0.37.0-beta.1, con configuraciones preexistentes, conflictos de symlinks, backups y recuperación." Piloto 3, hosts reales, "Condicionado": "Claude Code y Codex CLI, usando sesiones autenticadas existentes y workspaces temporales, sin modificar su instalación global." Piloto 4, orquestación, "Tras validar los hosts": "Secuencial, paralelo y routing, con admisión, cuotas, revisión cruzada y registro correcto de evidencia." Real hosts: "Autorizo utilizar una sesión existente de Claude Code o Codex con autenticación válida para operaciones de prueba pequeñas y explícitas." "Se permiten las escrituras operativas normales de sesión y trazas que ya conocemos, siempre que queden identificadas." "No se permite copiar credenciales a un HOME temporal, modificar archivos globales, activar automáticamente Kairo en tu instalación habitual ni iniciar procesos con acceso innecesario a tus proyectos reales." "Si la autenticación sólo funciona modificando el perfil productivo, se detiene ese escenario y se informa la limitación." "Para Artificial Analysis, la prueba básica de BYOK debe hacerse con claves sintéticas. Autorizo como máximo una validación real de lectura utilizando una clave configurada expresamente para el piloto mediante un mecanismo seguro, sin mostrarla ni persistirla en los reportes." Minimum orchestration scenarios (pattern : test : acceptance): "Secuencial" : "Architect → Builder → Reviewer" : "Dependencias y revisión respetadas"; "Paralelo" : "Dos tareas independientes" : "Ejecución separada, sin conflicto de crédito ni archivos"; "Routing" : "Cambio de proveedor por elegibilidad" : "Selección explicable, restricciones respetadas"; "Degradación" : "Proveedor agotado o sin ruta" : "Sin lanzamiento indebido ni crédito falso"; "Compatibilidad" : "Proyecto sin Kairo o deshabilitado" : "Comportamiento del host conservado". "Para estas pruebas no necesitamos una aplicación grande. Utilizaremos proyectos pequeños y tareas deterministas, con consumo acotado de suscripciones." "El piloto también debe comprobar visualmente M17: estado inicial, cuotas, roles, truncamiento, toggle y limpieza de `Running`." Condition for the public beta: integrated candidate tests "Reportados PASS"; final packaging "Revalidar"; focused review of MA25b "Pendiente"; isolated installation and update "Pendiente"; real Claude Code and Codex "Pendiente"; orchestration and panel end to end "Pendiente". "La equivalencia del plugin local con la distribución pública mediante GitHub permanece pendiente. No la daremos por demostrada mediante una instalación local." Operative authorization: "Autorizo preparar el candidato final, corregir el empaquetado y ejecutar los pilotos aislados 1 y 2. También autorizo preparar el escenario de hosts reales y ejecutarlo únicamente si el aislamiento y los límites de credenciales descritos se verifican previamente." "No autorizo registrar retroactivamente veredictos, incorporar los 13 archivos de u2-u5, integrar `team-analyze-error-detail` ni modificar el `tsconfig.json` sin rastrear." "El próximo entregable debe ser un reporte de aceptación del candidato, con PASS, BLOCKER o KNOWN_DEBT para cada escenario, sin nuevas funcionalidades." "Estamos en la fase de entrega de Kairo Runtime 0.37.0. A partir de ahora sólo corregimos defectos que impidan instalación, operación, seguridad o compatibilidad de las capacidades anunciadas." "Si el piloto pasa, el siguiente paso será autorizar `0.37.0-beta.1` como prerelease público. La versión estable `0.37.0` vendrá después de comprobar su instalación mediante el canal de distribución real." Route: the focused review of the installer diff runs on Codex, read-only; the candidate is finalized on release/v0.37.0 by one writer (version, links, fixture, unused dependency, lockfile, documentation merge, repack and inspection); pilots 1 and 2 run in temporary HOME directories against the final tarball; the real-host scenario is prepared and runs only after its isolation and credential limits are verified.
- L48 (2026-11-10): candidate 0.37.0-beta.1 finalized and Milestone C started, as authorized in L47; nothing was pushed, published or installed globally. Candidate on release/v0.37.0: commit 80b128959 is the last one that changes a packed file (HEAD e72bf27f7 adds only records under odd/release); tarball kal-elsam-kairo-runtime-0.37.0-beta.1.tgz, 1147622 bytes, 759 files, SHA-256 10fc0557a3066de1188f84e5d28a659ee03497a8e6d3a60a4cd5eb505eaec78d; the earlier checksums are superseded; router plugin tree ids unchanged. Finalization: documentation merge of L46 and L47; version 0.37.0-beta.1 with a CHANGELOG section (added by the orchestrator's instruction, for Sam to read); the thirteen links fixed by publishing six more guides and pointing two contributor documents at the public repository, with a test that every relative link in a published document resolves to a published file; scripts/fixtures excluded from the package; the unused dependency ansi-escapes removed, the lockfile diff being only that removal. Correction of an orchestrator error recorded in L46: the repository does have a lockfile; the official package manager is pnpm (packageManager field, tracked pnpm-lock.yaml, CI with the frozen lockfile), so no package-lock.json was added, the clean install was verified with pnpm and the frozen lockfile, and the consumer path with npm install of the tarball in a temporary home. Focused review of the installer diff (range aa689a539..8d30987d4, Codex, read-only, not a complete security audit): adoption on retry and JSON key precedence OK; requirements A, B, C, E, F OK; two findings: the readline confirmation accepted any answer other than n or no as consent (predates the release work), fixed with tests first: only y, yes or an empty line where the prompt shows yes as default count, anything else, closed input or an interrupt cancels, in setup, sync and upgrade; and a temporary file can remain in a component directory moved by another process of the same user during a write, documented and not fixed, inside the accepted concurrent-modification debt. The first full suite after the version change gave 5379 of 5381: two tests accepted only three numeric version parts; the audit that followed found that the two update checks (src/global/self-update.js and src/global/observability/ecosystem-updates.js) misordered prerelease versions, so a beta user would not be told about the stable release; fixed with tests first because only the beta itself can carry that fix. Final full suite on the candidate tree, idle machine, Artificial Analysis variable unset: node 5386 of 5386, plugin 576 of 576. Pilot 1 (isolated installation) and pilot 2 (update from the published 0.36.0) were executed with stub host executables first on PATH, temporary homes and synthetic keys; evidence with checksums outside the repository under agentic-harness-worktrees/release-v0.37.0-pilot-evidence. Pilot 3 (real hosts) was stopped under the rule of L47: Claude Code and Codex CLI stay signed in only with the real home and no configuration variable; Kairo decides where it writes host files only from its home override or the home directory and ignores the hosts' configuration directory variables; the router installation would write under the real Claude configuration; so no isolated combination keeps a host authenticated without copying credentials. Pilot 4 was not run because it depends on pilot 3. Deliverable: odd/release/v0.37.0-acceptance.md on release/v0.37.0 (e72bf27f7), with a proposed classification per scenario; the final classification is Sam's. Proposed blockers: (1) a write failure thrown in the managed configuration step of setup, and on upgrade and sync with the yes flag, leaves partial writes and prints only the raw error, with no applied and not applied lists, no recovery text and no history entry; (2) after an upgrade the product tells the user to run the package at the latest tag with setup, which for a beta is the older 0.36.0, and upgrade and sync do not install the Claude kit; (3) docs/cli-reference.md states that detection runs only version and sign-in status commands with no probe, while setup, also with the dry-run flag, runs usage and model listing commands of the hosts, attempts network requests, and invokes the pi executable, which creates two empty files under the home; (4) the conditions real Claude Code and Codex, and orchestration and panel end to end, are unmet. Proposed known debt, most significant first: uninstall leaves kit agents, a command, SDD skills, the kit section of CLAUDE.md and the history, and the command reference does not say so; setup with the dry-run and json flags prints human text before the JSON line, as the published 0.36.0 also does (verified by the orchestrator); doctor on a never-installed home with a linked component reports only the missing state; the router step is skipped on a first non-interactive setup when the Claude configuration directory does not exist yet; several documents state texts the product does not print; the aptitude run command cannot find its fixtures in an installed package; five advisories from npm audit in two production dependencies; six other confirmation prompts keep the old interpretation. Unverified: aa-key set did not exit under a forced terminal flag with standard input left open; it needs a real terminal. Isolation: no Kairo command ran against the real home; one executor left one npm debug log under the real npm directory by running an npm command before the pilot environment existed; other changes in real directories during the pilots match the running Claude Code session and background host activity, without proven authorship. No correction was applied after the pilots: the classification and the next step are Sam's decision. The plugin's equivalence with the public distribution remains pending.
- L49 (2026-11-10): decision by Sam `OD-KAIRO — REUSE_FIRST_POLICY`, quoted fragments verbatim; it is a Kairo-wide engineering policy, recorded here because its section 4 bounds the 0.37.0 release. "Adoptamos Reuse First como principio de ingeniería para Kairo Runtime: antes de implementar una capacidad nueva, debemos investigar qué soluciones existentes podemos aprovechar." "Esto aplica no sólo a Compaction Continuity, sino a routing, memoria, herramientas MCP, testing, onboarding, observabilidad y arquitectura de agentes." Rule: "Antes de desarrollar cualquier componente relevante, el equipo deberá evaluar cuatro alternativas en este orden": (1) "Reutilizar lo que ya tenemos" ("Funciones existentes de Kairo, capacidades nativas del host, Engram, CodeGraph y demás integraciones."); (2) "Integrar una solución existente" ("Bibliotecas, plugins, protocolos o herramientas maduras que satisfagan el contrato necesario."); (3) "Adaptar una implementación" ("Reutilizar una parte concreta, verificando licencia, mantenimiento, compatibilidad y riesgos."); (4) "Construir desde cero" ("Sólo cuando las anteriores no cumplan los requisitos o cuesten más de mantener que una solución propia pequeña."). "Esto no significa agregar dependencias indiscriminadamente. Una integración externa también tiene costos de mantenimiento, actualizaciones, seguridad y contexto." Reuse Assessment: "Propongo incorporar al contrato de tarea de Kairo una sección pequeña de Reuse Assessment" with the fields `Existing capability` ("¿Ya existe en el host o en Kairo?"), `External alternatives` ("¿Qué proyectos resuelven el problema?"), `Fit` ("¿Cumplen nuestro contrato funcional?"), `Integration cost` ("¿Cuánto cuesta integrarlos y mantenerlos?") and `Decision` ("¿Reutilizar, adaptar o construir?"). "No debe ser otra fase burocrática ni exigir una investigación extensa para cada modificación menor. Una función simple no necesita un análisis de cinco bibliotecas." "Para capacidades arquitectónicas, sí debe existir una decisión explícita." Compaction Continuity: "Kairo gobierna la continuidad; el host realiza la compactación; Engram u otro almacenamiento compatible conserva los checkpoints." "La referencia principal sería el protocolo de `agent-checkpoint`, complementado con el patrón `LATEST` de `claude-compact-memory`." "El contrato deberá garantizar que únicamente se recupere el checkpoint vigente, que las decisiones supersedidas no vuelvan a adquirir autoridad y que un fallo de persistencia no interrumpa la compactación nativa." "Todo ello sin instalar automáticamente esos proyectos ni copiar su código antes de comprobar si el host y Engram ya ofrecen las piezas suficientes." References named by Sam and his decision for each: `daurjoy/agent-checkpoint` ("Supersesión de decisiones, carga escalonada de memoria y verificación con Git", "Referencia principal"); `ultramcu/claude-compact-memory` ("Checkpoint semántico, puntero `LATEST` y recuperación mediante hooks", "Referencia para recuperación"); `TbusOS/claude-code-memory-checkpoint` ("Snapshot semántico separado de respaldo automático", "Aprovechar el patrón, no guardar transcripciones completas"); `basicmachines-co/basic-memory` ("Persistencia y recuperación de conocimiento", "Evaluar integración con Engram"). Release: "No debemos retrasar la beta por incorporar estos proyectos." "Autorizo utilizar sus implementaciones como referencias para la especificación de Compaction Continuity y para futuras decisiones de reutilización." "El release actual mantiene sus bloqueantes concretos de instalación y piloto. La integración automática de checkpoints queda para una versión posterior, salvo que el piloto demuestre una regresión de continuidad causada por Kairo." Verification by the orchestrator on 2026-11-10, reading the four public GitHub pages (commit dates were not shown and are not verified): all four repositories exist. `agent-checkpoint`: MIT, 4 commits, 0 stars, README calls itself "Early"; it marks an old decision as superseded with a timestamp and a pointer, loads one index file plus one state file and the rest on demand, and its resume step checks against `git log`; its installer only prints an optional `PreCompact` hook snippet, which confirms Sam's note that the automatic integration is optional and partial. `claude-compact-memory`: MIT, 2 commits, 0 stars; a `LATEST` file points at the newest snapshot and a SessionStart hook injects it back after compaction; the semantic note is written by a skill, because a hook cannot summarize. `claude-code-memory-checkpoint`: MIT, 5 commits, 1 star; it separates a curated status file from an automatic fallback file, and its PreCompact hook saves the full transcript JSONL, which is the part Sam's decision excludes. `basic-memory`: AGPL-3.0, about 4.5k stars, 2,573 commits, Markdown files plus a local SQLite index, exposed as an MCP server. Consequences recorded: the three small projects are pattern references only, none is mature enough to be a dependency; Kairo is MIT (`package.json`), so `basic-memory` code cannot be copied or adapted into Kairo without licence consequences and can only be evaluated as an optional external server. Existing capability already observed for the future assessment: in Claude Code the host produces the compaction summary and the Engram SessionStart hook for compaction already orders a session summary save and a context recovery. Effect on the MVP: no task, code, dependency or template change for 0.37.0; the Reuse Assessment section is not yet written into any task template, because the decision does not name which document is the Kairo task contract; the Compaction Continuity specification waits for a version after the beta. The three decisions requested in L48 remain open.
- L50 (2026-11-11): decision by Sam `OD-MVP-L48 — BLOCKER_FIX_APPROVED`, quoted fragments verbatim. "Sí. Autorizo corregir los bloqueantes 1 a 3 del reporte de aceptación y repetir únicamente las pruebas afectadas de los pilotos 1 y 2." "Esta autorización ya estaba contemplada en la decisión anterior de estabilización; ahora queda confirmado su alcance de ejecución." Acceptance criteria per blocker: (1) "Excepciones de escritura en `setup`, `upgrade --yes` y `sync --yes`": "Error controlado, código de salida distinto de cero, operaciones aplicadas identificadas y diagnóstico de recuperación"; (2) "`upgrade` utiliza `@latest` para una beta": "Respetar la versión solicitada explícitamente. `0.37.0-beta.1` no debe resolverse a `0.36.0`"; (3) "Documentación incorrecta sobre sondas": "Actualizar `docs/cli-reference.md` conforme al comportamiento real, sin modificar la detección". "Para el punto 1, no necesitamos implementar un nuevo sistema transaccional. Debemos aprovechar los recibos, backups y mecanismos existentes." "Para el punto 2, preservar el comportamiento normal de `latest` cuando el usuario no solicita una versión específica." Validation required: "Tests focalizados RED → GREEN para los defectos funcionales." "Repetición de las filas afectadas en los pilotos 1 y 2." "Suite completa y plugin sobre el candidato actualizado." "Inspección del tarball y nuevo SHA-256." "Revisión cruzada focalizada de los cambios funcionales." "Si las pruebas pasan, autorizo los commits locales y la actualización del reporte de aceptación." Not closed by this decision: "`kairo uninstall` y sus componentes residuales." "`aa-key set` en terminal interactiva." "Los otros bloqueantes registrados en L48 que no estén cubiertos por estas correcciones." "Piloto con hosts reales." "Validación E2E de orquestación y panel." "No debemos declarar el candidato apto para beta pública hasta resolver o reclasificar con evidencia esos puntos." Documentation and Reuse First: "Autorizo incorporar L48 y L49 a `release/v0.37.0` mediante integración documental controlada, sin modificar el alcance funcional." "La sección Reuse Assessment puede esperar hasta después de la beta." Correction by Sam to the wording of L49 about `basic-memory`: "AGPL-3.0 no prohíbe absolutamente reutilizar código en un proyecto MIT, pero puede imponer obligaciones de licencia incompatibles con la distribución que buscamos. Por ahora, mantenerlo como referencia conceptual o integración externa opcional es la decisión adecuada." The sentence in L49 saying that its code "cannot be copied or adapted" is therefore too strong; the accurate statement is that reuse would bring AGPL obligations that conflict with the intended MIT distribution. "Orden autorizado: corregir 1–3 → ejecutar pruebas afectadas → revisión focalizada → actualizar candidato y reporte." "Sin push, instalación productiva, credenciales reales ni publicación." "Nuestro objetivo inmediato continúa siendo estabilizar 0.37.0-beta.1, no añadir nuevas capacidades." Effect: task MA26 added; the rule the orchestrator applies to blocker 2 is recorded with the MA26 evidence when the work closes.
- L51 (2026-11-11): MA26 closed in the order authorized in L50; nothing was pushed, published or installed globally, and no real credential was used. B2, commit 93c3b9c03: `kairo upgrade` builds the printed setup commands with the exact running version when the registry latest is known and older than the running version, or unknown while the running version is a prerelease; in every other case it keeps `@latest` and the previous labels; it reuses the prerelease-aware comparison of `src/global/self-update.js`; one line states that setup installs the Claude Code kit, which upgrade and sync do not install. A registry fetch failure still makes upgrade throw, as before, so the unknown case is reachable only when the fetch returns nothing. B3, commits 9e5d11cfe, 22d2b1326, 791fcd2f1 and c62e1d3e8, documentation only, detection unchanged: `docs/cli-reference.md` and `docs/getting-started.md` now state per mode what setup runs. Facts established from the source and the pilot: the guided Detect step runs version and sign-in status commands and, for a signed-in Codex, `codex app-server` to read the model catalog; team analyst discovery runs only inside a Git repository, in the off-terminal preview and in `--dry-run`, and runs `claude -p /usage`, `claude auth status`, `codex app-server`, `cursor-agent models`, `opencode models`, `opencode stats` and `pi --help`, plus a request to the Hugging Face leaderboard dataset API and, when a key or credential exists, to the Artificial Analysis and OpenCode Go usage APIs; the status check requests the local Ollama address `http://127.0.0.1:11434/api/tags` (changeable with `OLLAMA_HOST`) in `--dry-run`, on apply and in `kairo status`, `doctor`, `sync` and `upgrade`, but not in the off-terminal preview; the paid model-access probes are reachable only from `kairo team verify-access` and the project sidecar, never from setup; the request to the code hosting API belongs to `kairo updates check`, not to setup. B1, commits 1b1df7b8e and f53074712: a filesystem write that throws in the component write, an adapter apply or the state write of `setup --yes`, `upgrade --yes` and `sync --yes` is recorded as a failed step of the install result and goes through the existing failure report (failed step, error code, Applied, Not applied, backups, recovery lines, history entry failed, exit 1); every adapter target is classified as written, not written or possibly partial by comparing the file on disk with the planned content and with a pre-image read before the apply; the component writers expose the files already written; a history write failure on a failed run no longer hides the report; a failure saving the SDD receipt becomes the existing SDD step failure; no rollback and no new transactional mechanism were added. Review: one focused cross-review by Codex of the functional changes; B2 and the regression questions passed; one blocker, applied operations not identified in two cases; first correction batch; the recheck closed both reproductions and reported three defects caused by the correction (state file always reported as not written, an empty pre-image treated as absent, the history line printed before the report and missing from JSON in the deferred setup path); second correction batch verified by tests only. Deviation recorded: a third correction followed, outside the two-correction bound, because the repeated pilot row P2-FR-03b failed on the first rerun: the Applied list of `upgrade --yes` and `sync --yes` named `.codex/AGENTS.md`, which had not changed, and omitted `.codex/hooks.json`, which the run had created; cause: the list was built from the adapter result lists, which name the instruction file even when only the hook file changed; fixed in f53074712. The Codex sandbox could not run tests (it cannot create temporary directories); the orchestrator ran them. Suites, every run stated: first correction, 5405 of 5405; second correction, run while other work used the machine, 5405 of 5408 with 3 failures in `test/core-hook/hook-acceptance.test.js` and `test/readonly-claude-sandbox.test.js`; commit 22d2b1326 with the machine idle, 5408 of 5408 and plugin 576 of 576; commit 791fcd2f1, 5390 of 5412 with 22 failures, all in `test/core-hook/` and all timing related, while a system software update was running (load average 18); these two failing runs are not counted as passing and were not investigated, per L-rule on the load-sensitive tests; final run on the candidate commit c62e1d3e8, 5412 of 5412 and plugin 576 of 576. Tarball of the candidate commit c62e1d3e8: `kal-elsam-kairo-runtime-0.37.0-beta.1.tgz`, 1153130 bytes, 759 files, SHA-256 `4994214e7c102fa69d448f9aa920fd1178f7de8c519a61d4bfea3a191d50ea31`, checksum recomputed by the orchestrator; same file list as the previous candidate, no odd, test, fixture or personal file; the previous candidate 80b128959 was rebuilt with the same method and reproduced `10fc0557a3066de1188f84e5d28a659ee03497a8e6d3a60a4cd5eb505eaec78d`; intermediate builds superseded: `b2920ab51c9b45d6ae35cb581b4d8f8ef419b1a52dd5bd0d3dc4c9a9c8c5407d` (22d2b1326) and `4526db9fb3259688ecd5d265a6e017388c4ad016ff5af9f2d0126d683c081597` (791fcd2f1); all 461 files under `src/` and `bin/` are byte-identical between the 791fcd2f1 and c62e1d3e8 builds, which differ only in the two documents. Pilot rows repeated in isolation (env -i, scratch homes, stub hosts, network guard), evidence in `agentic-harness-worktrees/release-v0.37.0-pilot-evidence/rerun-ma26/` (INDEX.md, SHA256SUMS): first rerun on 22d2b1326: FR-03 managed configuration unwritable (2 runs), FR-03 SDD control, P2-FR-03b retry, P2-UP-SETUP-PREVIEW and the controls passed; P2-FR-03b `upgrade --yes`, `sync --yes` and `--json` failed as described above; three documentation imprecisions found; second rerun on 791fcd2f1: every row passed, and the Applied lists were checked against the tree (hash and modification time of every file before and after): no file named as written without changing, no changed managed file unnamed; third step on c62e1d3e8: tarball rebuilt, `kairo --version`, a fresh `setup --yes` and `doctor` passed, and the packed documents match the four observed modes. Isolation: no breach found; the files of the real home that changed during the pilots are attributed to Sam's running sessions and to the kairo-router hook of the orchestrating session, which runs the installed Kairo on every prompt and agent launch (`~/.harness/huggingface-leaderboard.json`, `~/.harness/codex-models-last-good.json`, the modification time of `~/.pi/agent`). Inherited defects found and left unchanged, for Sam's classification: a history write failure after a successful apply still ends with a raw error; `upgrade` and `sync` drop failed or partial results returned by the SDD step, and previews discard failures; the SDD step failure report says `1 file(s) written` when two managed files changed. Not closed by this work, as listed in L50: `kairo uninstall` residue, `aa-key set` on a real terminal, the other items of L48, the pilot with real hosts, and the end to end validation of orchestration and panel. The candidate is not declared fit for a public beta. The acceptance report on release/v0.37.0 is updated in the commit titled "docs(release): update the acceptance report after the blocker fixes". Process note: four wait loops left by the writer of the earlier confirmation fix were found still polling and were stopped; they had no effect on any result.
- L52 (2026-11-11): decision by the product owner, quoted verbatim in Spanish.

  > `OD-MVP-AA-UTILIZATION — READ_ONLY_AUDIT_APPROVED`
  >
  > Autorizo una auditoría focalizada, no un nuevo sistema de routing.
  >
  > Quiero comprobar cinco cosas:
  >
  > 1. Si MA18 y el router realmente consumen y procesan la API Free, incluyendo paginación y campos nulos.
  > 2. Si distinguen correctamente modelo y variante de esfuerzo, por ejemplo Fable High y Max.
  > 3. Si los benchmarks afectan alguna recomendación real o simplemente se almacenan sin utilizarse.
  > 4. Si existe caché, trazabilidad de la fecha de consulta y degradación segura cuando no hay clave o falla la API.
  > 5. Si el consumo y la presentación de datos respetan las condiciones de uso y atribución.
  >
  > La salida debe distinguir `IMPLEMENTED`, `NOT_IMPLEMENTED`, `NOT_VERIFIED` y `BLOCKER` para cada capacidad. No podemos concluir que la API aporta valor sólo porque exista una integración en el código.
  >
  > Si descubrimos que la integración actual está rota, autorizo corregir el defecto de compatibilidad para 0.37.0. Cualquier algoritmo nuevo de selección adaptativa debe esperar hasta después de la beta.
  >
  > Decisión sobre el piloto con hosts reales
  >
  > Elijo comenzar con `claude --plugin-dir` y tu sesión autenticada existente, en un proyecto temporal.
  >
  > Es la opción que permite obtener evidencia real sin realizar inmediatamente una instalación global.
  >
  > Condiciones: no modificar configuraciones personales, no copiar credenciales, no acceder a proyectos productivos y registrar sólo trazas sanitizadas. Este ensayo valida el plugin local y parte del comportamiento del host; no valida la distribución mediante GitHub ni el instalador completo.
  >
  > Para Codex se debe utilizar igualmente un proyecto temporal y una sesión autenticada existente, pero sólo tras verificar que su mecanismo de aislamiento evita escrituras sobre la configuración global. De no ser posible, pasamos a una cuenta o máquina dedicada.
  >
  > Los hallazgos D9–D12 y los bloqueantes de uninstall y TTY permanecen abiertos. D13 queda pendiente de una prueba autenticada y no puede clasificarse como PASS sólo por tener tests con stubs.

  Claims by the product owner, still to be verified by MA27:
  - The current documentation uses `GET /api/v2/language/models/free`, with pagination (claim, unverified).
  - API v1 is scheduled to return `410 Gone` from 10 December 2026 (claim, unverified).
  - Artificial Analysis no longer publishes Coding Index and Agentic Index; both fields return `null` (claim, unverified).
  - Free tier: 100 REST requests and 200 authenticated MCP calls per 24 hour window (claim, unverified).
  - The free tier is meant for internal use, and redistribution rights belong to commercial agreements (claim, unverified).

  Status: MA27 and MA28 opened. First observation from reading `src/global/observability/artificial-analysis-models.js` at `c62e1d3e8`: the reader requests both `https://artificialanalysis.ai/api/v2/data/llms/models` and every page of `https://artificialanalysis.ai/api/v2/language/models/free`; neither path is a v1 path. Nothing else is concluded yet.

- L53 (2026-11-11): MA27 result, read-only audit of the Artificial Analysis integration at `c62e1d3e8` (audited tree `308644faa`, which has no non-odd change after `c62e1d3e8`). Nothing was fixed. No request was made to Artificial Analysis and the key was never read.

  Sources: (a) the orchestrator read `src/global/observability/artificial-analysis-models.js` and spot-checked `src/global/team/pacing-cli.js` lines 80 to 96, `src/global/team/background-refresh.js` lines 28 to 44, `src/global/team/service.js` lines 652 to 672, 736 to 746 and 1543 to 1551, and `README.md` line 165; (b) one read-only code trace by a separate verifier with path and line evidence; (c) one external check of the public documentation at artificialanalysis.ai by a researcher (page text was summarized by a small model, quotes are not byte-checked; the Data Platform Terms PDF and the second half of the OpenAPI document were not read); (d) the product owner's local cache file `~/.harness/model-intelligence.json`, read for its fetch date, slug shapes and null counts only.

  The product owner's five claims in L52: all five agree with the public documentation. The `410 Gone` sunset of 10 December 2026 covers only `/api/data/v1/*`. The code uses no v1 path.

  | # | Capability | Status | Evidence |
  | --- | --- | --- | --- |
  | 1 | Requests to the documented free endpoint with pagination | IMPLEMENTED in code, NOT_VERIFIED live | `artificial-analysis-models.js` lines 159 to 175 read every page of `/api/v2/language/models/free` once and reject inconsistent pagination; tests named S21 in `test/artificial-analysis-models.test.js` use stubs; the documentation confirms the `page` parameter and the fields `page`, `page_size`, `total_pages`, `has_more`. No test covers a page mismatch, `total_pages` above 100 or a `has_more` mismatch. |
  | 2 | Null fields | IMPLEMENTED | With `codingIndex` null the coding capability uses `liveCodeBench` and `sciCode` (`capability-scoring.js` lines 62 to 63, 93, 331, 352); a missing `agenticIndex` leaves that capability unscored without a penalty; no coding score is derived from `intelligenceIndex` alone. The local cache has 728 models with 0 non-null `codingIndex`, 0 non-null `agenticIndex` and 0 non-null `mathIndex`; `intelligenceIndex` is non-null for 99. |
  | 3 | Live consumption in a real environment | NOT_VERIFIED, with contrary evidence | The local cache `fetchedAt` is 2026-11-04T16:15:07Z, seven days old on 2026-11-11, on a machine where a key is set and Kairo runs daily. The reader rewrites that file on every successful fetch, so no fetch has succeeded for seven days. The cause is unknown: a rate limit, a rejected key and a failing request to the undocumented path would all produce the same silent fallback to the cache. |
  | 4 | Request budget against the free limit | BLOCKER proposed, pending the product owner's classification | The reader has no freshness gate on the disk cache; the 6 hour limit in `service.js` line 662 lives in memory, per process. The Claude Code plugin runs `kairo team pacing --no-wait` on prompts; when the routing cache is older than 2 minutes (`pacing-cli.js`, `MAX_AGE`) it starts a detached `kairo team route --refresh`, at most one per minute per project (`background-refresh.js`, `LOCK_MS`). Each refresh invalidates every probe (`service.js` lines 1545 to 1548) and makes 1 request to the legacy path plus 1 per documented page. The documented free limit is 100 REST requests per 24 hours. `README.md` line 165 says "1,000 requests per day", which contradicts the documentation. The hook's own `kairo team route` reads only the disk routing cache and makes no request. |
  | 5 | Dependence on an undocumented path | risk, NOT_VERIFIED | `https://artificialanalysis.ai/api/v2/data/llms/models` does not appear in the documentation that was read. The reader requires it: when it fails, the successful documented result is discarded (line 180). No test covers that case. |
  | 6 | Deprecated `performance` object | NOT_IMPLEMENTED (`performance_v3` is not read) | The documentation says `performance` returns `null` from 10 December 2026 and names `performance_v3` as its replacement; the reader takes `endToEndSeconds` and `outputTokensPerSecond` from `performance` (lines 34 and 58). From that date both become null. Whether `performance_v3` has an end-to-end field is not established. |
  | 7 | Model versus effort variant | NOT_IMPLEMENTED | The cache holds separate entries per variant (bare 614, low 33, medium 36, high 20, xhigh 16, max 5, minimal 4), for example `claude-opus-5-5` 59.1, `claude-opus-5-5-xhigh` 57.4, `claude-opus-5-5-high` 51.8, `claude-opus-5-5-medium` 48.2. A host model id matches the exact slug first, so it takes the bare entry, the highest score in that example. Kairo's own effort value (low, medium or high, `src/global/team/effort-policy.js` lines 6 to 9) comes from tier, risk and quota, never from this data, and is not used to pick a variant. The frontier gate compares `intelligenceIndex` to 54.5 (`role-registry.js` lines 497 to 505), so the bare score can pass a model whose high-effort entry would not. `bareSlug` strips low, medium, high and xhigh only; max and minimal stay separate. |
  | 8 | Benchmarks affect a recommendation | IMPLEMENTED in code with stub tests, NOT_VERIFIED with live data | Scores flow through `scoreAvailableModels`, `computeCapabilityPercentile`, `computeRoleEvaluations`, `buildAiTeamRoleDefinitions` and `buildAiTeam`; a different score can change the model a role gets when a team is formed or refreshed; `test/model-intelligence.test.js` line 191 proves it with fixtures. In the audited environment the scores in use are seven days old (row 3). |
  | 9 | Cache | IMPLEMENTED | `~/.harness/model-intelligence.json`, used as the fallback on any failure and with no key. |
  | 10 | Query date traceability | NOT_IMPLEMENTED for the user | `fetchedAt` is never printed; `kairo team show` takes its age from the routing cache's `generatedAt`, not from the fetch time; the routing cache stores no status or fetch time for this data; cached scores have no maximum age. |
  | 11 | Safe degradation | IMPLEMENTED, silent | With no key no request is made and the result is `cached` or `unknown`; a failed fetch returns the cache; scores are never invented. Only `kairo team show` says the data is cached, so a seven day old snapshot drives routing with no warning elsewhere. |
  | 12 | Attribution in output | NOT_IMPLEMENTED | The documentation requires attribution on all tiers and accepts a visible link to https://artificialanalysis.ai/; outputs that show values derived from this data (`kairo team show`, the analyst ranking trace, `kairo intelligence aptitude-plan`) carry no link; `README.md` and `docs/artificial-analysis.md` do. |
  | 13 | Redistribution | BLOCKER proposed for publication, needs the product owner's decision | `src/global/intelligence/frontier-reference.js` lines 6 to 62 ship 12 frozen `intelligenceIndex` values (version `aa-generalist-2026-10-29/v1`) inside the npm package; the documentation labels the free tier "Internal use only with attribution" and "no redistribution". This is a reading of the public page, not legal advice. |
  | 14 | Index version | NOT_IMPLEMENTED | Responses carry `intelligence_index_version`; the reader does not store it. |

  No compatibility fix was made, because the cause of row 3 is not known and the authorization in L52 covers a defect that is shown to break the integration. One authenticated request (`kairo aa-key check`) would separate a rate limit from a rejected key or a failing path; it needs the product owner's key and his explicit approval. D13 stays open.

- L54 (2026-11-11): MA28 result, real-host pilot with Claude Code 2.1.322, headless, candidate CLI 0.37.0-beta.1 (`c62e1d3e8`) and the plugin directory `integrations/claude-code/kairo-router` of `release/v0.37.0`.

  Setup: every session ran as `claude -p ... --plugin-dir P --setting-sources project,local --strict-mcp-config --no-session-persistence` in a temporary Git project, with the product owner's existing signed-in session and the real HOME. `HARNESS_HOME` pointed to a scratch directory, the candidate `kairo` was first on PATH, the Artificial Analysis variable was unset, and Codex, OpenCode, Cursor, Pi and Ollama were not reachable. A `claude` wrapper added the same isolation flags to the host calls Kairo itself makes. The load probe showed only the candidate plugin plus four built-in `cc-plugin-*` entries, no user plugin, no MCP server. The npm tarball does not contain the Claude Code plugin; the pilot loaded it from the worktree.

  | Row | Scenario | Observed | Result |
  | --- | --- | --- | --- |
  | A1 | Onboarding ask on the first prompt with no team | The model asked whether to analyze the project. | PASS |
  | A2 | Main-thread Write denied | The onboarding ask came first and Write was not attempted. | UNCLEAR |
  | A2b | Same, with wording to skip onboarding | Write denied twice with "The orchestrator does not write files. Delegate the write to the role that owns it (Backend Builder, Tester, Documenter, DevOps) with the Agent tool." and the file was not created. | PASS (prompt modified) |
  | A3 | Generic agent denied | The onboarding ask came first and no Agent call was made. | UNCLEAR |
  | A3r | Same, with the analysis declined | "Blocked subagent_type 'general-purpose': generic agents inherit the orchestrator model and skip Kairo routing." and a trace row `denied` / `prevented`. | PASS |
  | A4 | `kairo` missing from PATH | Normal answer, exit 0, empty stderr, nothing written. | PASS |
  | B0 | List analysts with a fresh Kairo home | `{"ok":true,"action":"analysts","applied":false,"analysts":[]}`. Cause read in code: `team-cli.js` line 42 lists only `available === true` and `project-strategy.js` sets `available: providerOk && !unverified`; all 13 Claude models were unverified. | FAIL (blocked) |
  | B0v-a | After `kairo team verify-access --refresh` (13 Claude models allowed; exit 1 only because of `spawn codex ENOENT`, Codex was removed from PATH on purpose) and with no evaluation data at all | 5 analysts listed and the analysis ran, then `kairo team approve --yes` failed with "Team approval failed validation; draft unchanged. Run kairo team show." (code `approval_blocked`); Technical Lead and Quality Lead had no model. | FAIL at approve |
  | B0v-b | Same, with a cached evaluation snapshot copied from the product owner's Kairo home (fetched 2026-11-04) | Analyze, approve and `kairo team roles sync --host claude-code --yes` worked; 13 agent files with plain role names (`explorer`, `reviewer` and others) and a pinned `model:` were written into the project's `.claude/agents`. | PASS |
  | B1, B2, B3 | Launches of those generated agents (sequential, two in parallel, delegated write) | The work was done and the delegated write was made by the subagent; the trace rows say `observable`, `not_prevented`, `routingClass legacy`, role `unknown`, `selectedModel null`, and no launch ledger was written; the core answers `kairo team route --agent explorer` with `{"decision":"ERROR","code":"unknown_agent","message":"Unknown agent \"explorer\" in the project role catalog."}`. | work PASS, routing FAIL |
  | B1k | Launch of the kit agent `kairo-explorer` (kit files copied from a scratch home written by the candidate's setup) | Description rewritten to "Explorer · claude-haiku-5-5 (claude) — List files in project directory", trace `governed`, role Explorer, `selectedModel claude-haiku-5-5`, launch and outcome rows in `launch-ledger.jsonl`. | PASS |
  | B2k | `kairo-explorer` and `kairo-test-runner` in parallel | Both routed and accounted; Explorer was routed to `claude-fable-5-1` this time and Test Repro Runner to `claude-haiku-5-5`; a later `kairo team routes` shows Explorer on `claude-haiku-4-5-20251001`; the change of model between runs was not investigated. | accounting PASS, model choice UNCLEAR |
  | B3k | `kairo-builder` (the approved team has no Builder role: `{"decision":"ERROR","code":"unknown_role","message":"Unknown role \"Builder\" in the approved team."}`) | The launch was neither denied nor held; trace `degraded`, `not_prevented`, role `unknown`, no ledger row; the subagent wrote the file. | work PASS, routing FAIL |
  | B4, B4k | `kairo team routes`, `pacing`, `show` and `verdict --pending` | They answered with the team and the completed outcomes; `kairo status` and `kairo doctor` exit 1 in a Kairo home with no `state.json`, expected. | PASS |
  | B5 | Kit with `kairo` missing from PATH, with a team | The launch proceeded unrouted, exit 0, empty stderr. | PASS |

  Findings:

  1. With no Artificial Analysis data (no key and no cached snapshot) a team cannot be approved. `docs/artificial-analysis.md` says the key is optional and that Kairo "installs and runs its basic functions" without it.
  2. `kairo setup` prints "Available analysts: none available" and "Next: kairo setup --analyst MODEL --yes" before any model access is verified. The analyst list stays empty until `kairo team verify-access --refresh` runs. Pilots 1 and 2 show that line 28 times and never formed a team.
  3. Agents generated by `kairo team roles sync --host claude-code` use names the router does not route.
  4. A kit agent whose role is not in the approved team launches unrouted and unaccounted, with no denial.
  5. The first prompt of a session without a team is taken by the onboarding ask.
  6. One routed Explorer launch used `claude-fable-5-1`.

  Real home: the watched configuration files (`~/.claude/settings.json`, `~/.claude/CLAUDE.md`, `~/.claude/plugins/installed_plugins.json`, the `~/.claude/agents` entry count, the Codex and OpenCode configuration files, `~/AGENTS.md`) did not change. The host rewrote `~/.claude.json` and created `~/.claude/projects/<pilot project>/` with an empty `memory` directory. The `lastUpdated` value of the `claude-plugins-official` entry in `~/.claude/plugins/known_marketplaces.json` changed during the pilot; it could not be attributed to the pilot or to another session, and the `kairo` entry did not change. Files under `~/.harness` changed in sessions that are not the pilot's; no file with the pilot marker appeared under `~/.harness`, `~/.codex` or `~/.config`. One file was copied out of the real home, `~/.harness/model-intelligence.json`, into the scratch Kairo home. No credential was read or copied.

  Spend: 28 calls reached a model through the product owner's session: 13 by `verify-access`, 2 by the analysis, 13 scenario prompts.

  Limits: headless only, so the pane was not seen (initial state, quotas, roles, truncation, toggle, cleanup of Running remain pending); Claude Code only, so no routing between providers, no handover and no Codex; the kit was copied, not installed by setup; the marketplace installation path was not exercised; evaluation data came from a seven day old snapshot. One correction: the orchestrator first attributed the empty analyst list to missing evaluation scores; that was wrong and is corrected in the evidence index.

  Evidence: `agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma28/INDEX.md` (outside the repository); the scratch directory was left in place under the system temp folder.

  Conditions 5 and 6 are not reclassified here; the acceptance report was not changed.

- L55 (2026-11-11): decision by the product owner, quoted verbatim in Spanish.

  > Decisión: `OD-MVP-REALHOST — BLOCKERS_CONFIRMED`
  >
  > Sí, autorizo ejecutar una sola vez `kairo aa-key check` utilizando tu clave existente de Artificial Analysis, con restricciones de seguridad. También autorizo corregir las cuatro fallas descubiertas en el piloto real.
  >
  > Kairo 0.37.0-beta.1 todavía no está listo para publicarse. Las cuatro fallas reportadas afectan capacidades esenciales del producto, no detalles cosméticos.
  >
  > Autorizo exactamente una ejecución: `kairo aa-key check`
  >
  > Condiciones:
  > - Utilizar la credencial ya configurada; no copiarla, imprimirla, exportarla ni incluirla en reportes.
  > - No modificar la clave ni su almacenamiento.
  > - Permitir únicamente las solicitudes necesarias para comprobar su validez.
  > - Registrar resultado, duración, códigos de estado y número de solicitudes, sin guardar encabezados de autenticación.
  > - Si falla, registrar el diagnóstico sanitizado y no repetir automáticamente.
  > - No encadenar `verify-access --refresh` ni ejecutar evaluaciones adicionales sin autorización.
  >
  > Clasificación de las cuatro fallas: "No se puede aprobar un equipo sin clave ni caché" BLOCKER, Corregir. "Setup recomienda un paso que no puede funcionar" BLOCKER, Corregir. "Los agentes generados por `roles sync` no son reconocidos" BLOCKER, Corregir. "Un agente sin ruta se ejecuta sin gobernanza efectiva ni aviso" BLOCKER, Corregir.
  >
  > A. Artificial Analysis debe seguir siendo opcional. El requisito es inequívoco: un usuario sin API key debe poder formar y utilizar un equipo con capacidades compatibles, sin depender de rankings externos. Cuando no existan datos de Artificial Analysis, Kairo debe utilizar únicamente capacidades y modelos cuya compatibilidad haya podido verificar por otros medios. No puede fabricar puntuaciones ni asumir capacidad. Si no es posible formar un equipo válido, debe explicar qué falta y cómo resolverlo, no producir un error genérico de validación.
  >
  > B. El onboarding debe ser ejecutable. La ruta que recomienda `kairo setup` debe funcionar en el estado en que se encuentra el usuario. No quiero que `setup` provoque automáticamente 13 llamadas de verificación a modelos, especialmente cuando operamos con cuotas de suscripción. La solución debe distinguir entre detección local y verificación activa, ofreciendo el paso necesario con una explicación de su consumo potencial. Si una acción es indispensable para continuar, debe quedar explícita.
  >
  > C. Los agentes generados deben integrarse con el router. `roles sync` no puede generar agentes que la gobernanza de Kairo desconoce. Debemos establecer un contrato compartido entre la generación de agentes y el reconocimiento del router, aprovechando el registro de roles existente. No autorizo resolverlo aceptando indiscriminadamente cualquier nombre de agente.
  >
  > D. No debe existir gobernanza silenciosamente degradada. Este es el hallazgo más importante. Cuando un contrato de gobernanza esté verificado como activo y una tarea requiera gobernanza, un agente sin ruta autorizada no debe lanzarse silenciosamente fuera de ella. Debe rechazarse con un motivo identificable o seguir una alternativa explícitamente permitida por el contrato. Si el proyecto no tiene gobernanza activa, se mantiene la compatibilidad con el host sin atribuir crédito de gobernanza.
  >
  > Inconsistencia de modelos. Autorizo investigar esta inconsistencia antes de cambiar el algoritmo del router. Necesitamos correlacionar el lanzamiento con el `taskId`, `executionId`, snapshot de rutas, modelo seleccionado, modelo efectivamente ejecutado y momento de consulta. Que `kairo team routes` muestre después otro modelo no demuestra por sí solo un fallo: la ruta pudo recalcularse. Lo que sí debemos impedir es una decisión imposible de explicar o auditar. No autorizaría todavía un nuevo scorer ni cambios generales en las estrategias de selección.
  >
  > Orden de ejecución:
  > 1. AA key: realizar la única comprobación autorizada, sin extenderla a otras solicitudes.
  > 2. Onboarding y formación: corregir el funcionamiento sin Artificial Analysis y el siguiente paso de setup.
  > 3. Gobernanza: corregir el reconocimiento de agentes generados y los lanzamientos sin ruta autorizada.
  > 4. Routing: explicar las diferencias de modelo mediante evidencia del lanzamiento, sin rediseñar el router.
  > 5. Validación: tests focalizados, revisión cruzada de los cambios críticos y repetición de los escenarios reales afectados.
  >
  > Autorizo commits locales y actualización del reporte de aceptación. Los registros L52–L54 pueden integrarse documentalmente a la rama de release, sin arrastrar otros cambios.
  >
  > No autorizo push, publicación, instalación global ni cambios en tus configuraciones productivas.
  >
  > Condiciones para seguir hacia la beta: Routing y ledger con agentes del kit PASS. Formación sin API key BLOCKER. Onboarding funcional BLOCKER. Agentes de roles sync BLOCKER. Gobernanza de roles sin ruta BLOCKER. Codex y routing entre proveedores Pendiente. Panel en terminal real Pendiente.
  >
  > El tarball de npm y el plugin distribuido mediante marketplace siguen siendo canales distintos que deben validarse antes de afirmar que la instalación pública funciona.
  >
  > Autorizo el lote focalizado de corrección y su validación. No agreguemos nuevas funcionalidades hasta cerrar estos defectos demostrados.

  Status: MA29 done on 2026-11-11 at 18:41:09 UTC, one run of `kairo aa-key check --json` with the candidate CLI 0.37.0-beta.1 and the key from its configured source (`environment`). Result: exit code 1, 874 ms, one request, `GET https://artificialanalysis.ai/api/v2/data/llms/models`, HTTP 410; the command answered `{"ok":false,"kind":"unexpected","status":410,"source":"environment","message":"The service gave an unexpected answer (HTTP 410). The key was not validated."}`. The key was not printed, copied or changed; no header was stored; the run was not repeated and nothing else was requested. Before it, `kairo aa-key status --json` (local, no request) reported `configured: true`, source `environment`. Consequence: the path the reader requires and the path `aa-key check` uses is gone, which explains the cache age of seven days recorded in L53 (the reader discards the documented result when that request fails). The key itself remains unvalidated, because the check cannot validate any key at present. This is the broken integration that L52 authorizes to fix; it is tracked as MA34. Open point for the product owner, stated in the report: a reader that works again would make one request per documented page on every background refresh, with no freshness gate on the disk cache, against a documented free limit of 100 requests per 24 hours (L53 row 4).

- L56 (2026-11-11): decision by the product owner, quoted verbatim in Spanish.

  > Decisión: `OD-MVP-MA30-A — MANUAL_ASSIGNMENT_APPROVED`
  >
  > Apruebo la opción 1: asignación explícita del usuario, con capacidad no verificada.
  >
  > 1. Artificial Analysis es opcional. Kairo debe funcionar sin API key, incluso si no existe un snapshot en caché.
  > 2. La gobernanza no puede inventar evidencia. Verificar que un modelo está accesible no demuestra que sea competente para un rol específico.
  >
  > No autorizo crear probes nuevos ni modificar los requisitos estructurales del equipo para resolver este problema.
  >
  > Comportamiento aprobado:
  > - Artificial Analysis disponible: Selección basada en las evaluaciones disponibles y válidas.
  > - Sin API key, pero con probes locales de capacidad: Utilizar esa evidencia para los roles correspondientes.
  > - Sin evaluaciones ni probes suficientes: Ofrecer asignación manual entre modelos con acceso verificado.
  > - Modelo elegido manualmente: Marcar `capability: unverified` y conservar el origen manual.
  > - Modelo sin acceso verificado: No ofrecerlo como candidato ejecutable.
  > - Rol obligatorio sin modelo asignado: No aprobar un equipo completo.
  >
  > La asignación manual debe ser una decisión consciente del usuario, no un fallback silencioso.
  >
  > Por ejemplo:
  >
  > Quality Lead
  > Status: Capability unverified
  >
  > Available models with verified access:
  > - Model A
  > - Model B
  >
  > No capability evaluation is available for this role.
  >
  > Select a model manually or leave the role unassigned.
  >
  > Separar autorización de evidencia:
  > - Acceso verificado: el proveedor permite utilizar el modelo.
  > - Asignación aprobada: el usuario autorizó utilizar ese modelo para un rol.
  > - Capacidad verificada: existe evidencia válida de que el modelo cumple los requisitos del rol.
  > - Resultado verificado: una ejecución concreta produjo evidencia y superó las verificaciones requeridas.
  >
  > Una selección manual puede autorizar una ruta cuando las demás políticas lo permitan, pero no convierte automáticamente la capacidad ni el resultado en `VERIFIED` o `ACCEPTED`.
  >
  > La ejecución sigue vinculada a su tarea, se contabiliza y conserva las obligaciones de revisión cruzada. Si una política exige evidencia de capacidad, una asignación manual no puede eludirla.
  >
  > Autorizo completar MA30-A utilizando los mecanismos actuales de selección manual.
  >
  > Los criterios de aceptación son:
  > 1. Aprobar un equipo completo, incluidos Technical Lead y Quality Lead, sin Artificial Analysis ni caché, cuando el usuario haya asignado explícitamente modelos con acceso verificado y las políticas restantes lo permitan.
  > 2. No asignar modelos automáticamente basándose sólo en su nombre, fabricante o popularidad.
  > 3. Mostrar claramente los roles con capacidad no verificada.
  > 4. Conservar las restricciones de elegibilidad, cuotas, proveedores y revisión cruzada.
  > 5. No otorgar crédito falso de capacidad o resultado.
  > 6. Si no hay modelos elegibles, informar el bloqueo y el siguiente paso concreto.
  >
  > No necesito un nuevo estado global de gobernanza si la información puede representarse mediante los metadatos y estados existentes.
  >
  > También confirmo:
  > - MA34: mantener el TTL existente de seis horas, distinguiendo caché válida, ausencia de datos y errores de consulta. Un HTTP 410 no significa credencial inválida.
  > - MA31-C/D: continuar con los cambios de reconocimiento de agentes y rechazo P17, incluida la compatibilidad del plugin 0.9.1.
  > - MA30-B: completar el flujo guiado y eliminar el mensaje antiguo que recomienda un paso no ejecutable.
  >
  > Autorizo la suite integrada, revisión cruzada, commits locales y repetición de los escenarios afectados, tal como estaba previsto. No autorizo nuevas llamadas autenticadas a Artificial Analysis ni probes adicionales de modelos.
  >
  > Resultado que espero: Un desarrollador instala Kairo, no tiene clave de Artificial Analysis y dispone de Claude o Codex autenticado. Debe poder configurar y aprobar manualmente un equipo válido, trabajar con él y comprender qué capacidades están verificadas y cuáles no. Más adelante, cuando agregue su clave o disponga de nuevas evaluaciones, Kairo podrá ofrecer mejores recomendaciones sin invalidar automáticamente las decisiones manuales del usuario.
  >
  > MA30-A queda autorizado. Terminemos este lote, validemos los cuatro fallos del piloto y continuemos hacia la beta sin ampliar el alcance del MVP.

  Status:
  - MA32 result (investigation only, no code change). Evidence: the pilot's `routing-trace.jsonl`, `launch-ledger.jsonl`, `routing-input-cache.json` and the raw session streams. The Explorer role has a pool of three models (`claude-haiku-5-5`, `claude-haiku-4-5-20251001`, `claude-fable-5-1`); the router picks by deficit against a target share of 0.333 each. First launch at 18:24:58Z: "picked claude/claude-haiku-5-5 with deficit 0.333 (target 0.333, actual 0.000, 0 runs in window)". Second launch at 18:26:21Z: "picked claude/claude-fable-5-1 with deficit 0.333 (target 0.333, actual 0.000, 1 runs in window)". `kairo team routes` later showed the third model, the next one in deficit. `claude-opus-5-5` and `claude-sonnet-5-5` were rejected as "outside band". Each launch has one `executionId` shared by the hook trace row, the outcome trace row and the two ledger rows; `taskId` is null with `taskIdStatus: absent` because the prompts carried no task marker; `admissionContract` was `inactive`. Gap found: for the second launch the router selected `claude-fable-5-1` and dispatched the alias `fable`, and the host ran `claude-fable-5-2` (seen in the session stream); the ledger records `claude-fable-5-1`, and the trace has `observedModelId: null` and `identityStatus: unverified`. The decision can be explained from the trace; the model that ran is not recorded. Not changed: the pool composition and the selection strategy.
  - State of the batch at this entry: MA34, MA31 part C, MA31 part D and MA30 part B are written in the release worktree, uncommitted, each with its focused tests passing as reported by its writer; a small follow-up unit (service route label for P17, guided setup line, `docs/cli-reference.md`, `CHANGELOG.md`, plugin version 0.9.1) was interrupted by a session restart and resumed. The integrated suite, the cross-review and the repeated real-host scenarios have not run yet.
  - Facts recorded for MA34: the free endpoint carries the Intelligence Index, six capability indexes, cost, pricing and performance; per-benchmark scores are not in the free shape, per the public reference. The schema was taken from the public documentation, not from a live response; the product owner did not authorize further authenticated calls.
  - Compatibility fact recorded for MA31 part D: a 0.9.0 plugin against the new core does not know row `P17`; it classifies the directive as malformed and reaches stage 2 row `X7`, so it launches unchanged with no credit and no denial. The denial exists only with plugin 0.9.1.

- L57 (2026-11-11): decision by the product owner, quoted verbatim in Spanish.

  > Decisión: `OD-MVP-MA30-A — IMPLEMENTATION_CONFIRMED`
  >
  > Apruebo el diseño de MA30-A y autorizo implementarlo sobre los mecanismos existentes de asignación manual. Los tres huecos identificados son defectos funcionales que impiden cumplir el contrato ya aprobado, no funcionalidades adicionales.
  >
  > Alcance autorizado:
  > - `kairo team assign --role ROL --model MODELO [--yes]`: Aprobado. Vista previa por defecto.
  > - `capabilityAcknowledged`: Aprobado, únicamente mediante selección explícita.
  > - Aprobación de asignaciones manuales sin puntuación: Aprobado si el acceso está verificado y se cumplen las demás políticas.
  > - Roles no directivos desaparecidos: Corregir. Deben permanecer visibles y asignables.
  > - `kairo team rebuild`: Conservar asignaciones manuales válidas.
  > - Trazabilidad `override` y `capabilityUsed`: Obligatoria en las ejecuciones correspondientes.
  > - Modificar P12 o relajar S5: No autorizado.
  >
  > Invariantes obligatorios. Una asignación manual no equivale a capacidad verificada. El contrato debe distinguir:
  > - `accessVerified = true`: el modelo está disponible.
  > - `assignmentSource = override`: el usuario eligió expresamente el modelo.
  > - `capabilityAcknowledged = true`: el usuario acepta la ausencia de evidencia.
  > - `capabilityUsed = unverified`: la ejecución no afirma una capacidad demostrada.
  >
  > La asignación debe ser específica del rol y modelo seleccionado. No puede convertirse en autorización general para utilizar cualquier modelo.
  >
  > `--yes` confirma esa asignación explícita; no permite que `setup`, `rebuild` u otra operación reconozca automáticamente capacidades desconocidas.
  >
  > Reglas de gobernanza. Conservamos las reglas existentes de: Elegibilidad y acceso. Cuotas y disponibilidad. Independencia entre Builder y Reviewer. Restricciones de proveedores y clases de modelo. Revisión cruzada por tarea. Crédito sustentado en evidencia.
  >
  > No autorizo modificar P12 en este lote.
  >
  > Si permitir una asignación manual exige cambiar la matriz de crédito, detener exclusivamente esa parte y presentar el conflicto concreto. No debemos convertir `unverified` en `VERIFIED` o `ACCEPTED` mediante una excepción.
  >
  > Un equipo aprobado puede contener asignaciones manuales sin evidencia de capacidad, pero eso no debe producir crédito de gobernanza que el contrato no permita.
  >
  > Comportamiento esperado. Un desarrollador sin API key de Artificial Analysis debe poder:
  > 1. Consultar sus roles y modelos con acceso verificado.
  > 2. Seleccionar explícitamente un modelo para Technical Lead y Quality Lead.
  > 3. Ver qué roles adicionales permanecen sin asignación.
  > 4. Aprobar el equipo si cumple las restricciones estructurales.
  > 5. Ejecutar tareas utilizando rutas autorizadas, manteniendo la ausencia de evidencia de capacidad.
  > 6. Reconstruir el equipo sin perder selecciones manuales todavía elegibles.
  >
  > Si un modelo pierde acceso, cambia su elegibilidad o entra en conflicto con otra restricción, `rebuild` no debe preservar su autorización ciegamente: debe mostrar el motivo.
  >
  > Validación y cierre. Autorizo el orden propuesto, con una precisión: la suite que está corriendo ahora no valida MA30-A, porque todavía no está integrado. Después habrá que ejecutar pruebas focalizadas y una suite final sobre el árbol conjunto.
  >
  > La revisión independiente debe concentrarse en las rutas de aprobación, reconocimiento y crédito, especialmente para evitar que los cambios de MA30-A y MA31-D se contradigan.
  >
  > El timeout observado en `UserPromptSubmit` queda registrado como hallazgo operativo. Si se reproduce fuera de la carga concurrente de pruebas, habrá que investigarlo porque su salida descartada puede afectar la continuidad, pero no autoriza aumentar indiscriminadamente los tiempos de los hooks.
  >
  > MA30-A queda autorizado para implementación, tests, revisión cruzada y commit local.
  >
  > También autorizo actualizar las referencias del manifiesto a `0.9.1` y corregir la descripción de paginación en `docs/artificial-analysis.md`, sin ampliar el lote.
  >
  > El criterio de éxito sigue siendo el mismo: Kairo debe funcionar sin Artificial Analysis, sin inventar competencias y sin degradar silenciosamente su gobernanza.
  >
  > Sin push, instalación global ni publicación.

  Status:
  - Operational finding recorded as the product owner asked: a `UserPromptSubmit` hook timed out in his session while test suites were running concurrently; to be investigated only if it happens again without that load.
  - First integrated suite run on the release worktree (`308644faa` plus 29 changed files: MA34, MA31 parts C and D, MA30 part B and the follow-up unit, before MA30 part A): NOT a passing result and not a valid one. The machine load average was 9.48 at the start and between 31 and 63 during the run, and the run took more than twice its usual time. At least 60 tests failed, most of them under `test/core-hook/`, the files already known to fail on timing under load; some belong to areas this batch changed (launch directives, admission), so a regression cannot be excluded from this run. The orchestrator's output filter cut the summary lines, so the totals of that run were not captured. The suite must be repeated on an idle machine, after MA30 part A, and the `test/core-hook` files must also be run on their own.
  - No commit was made on `release/v0.37.0` yet.

- L58 (2026-11-11): decision by the product owner, quoted verbatim in Spanish.

  > Decisión: `OD-MVP-MA30-A — P12u_APPROVED`
  >
  > Autorizo la opción 2: agregar una fila `P12u` que permita ejecutar revisiones con asignaciones manuales sin otorgar crédito de gobernanza.
  >
  > También autorizo la corrección focalizada de la regresión G4. Ambas son necesarias para preservar el contrato funcional de Kairo Runtime 0.37.0.
  >
  > Por qué elijo P12u en lugar de P9. Rechazar con P9 es más sencillo, pero produce una limitación importante: un usuario sin Artificial Analysis podría formar su equipo manualmente, pero no utilizar sus Reviewers en tareas vinculadas. Eso contradice nuestro objetivo de que Artificial Analysis mejore las decisiones, pero nunca sea un requisito oculto para utilizar Kairo. P12u permite separar ejecución de certificación.
  >
  > Condiciones (P12 existente / P12u nueva): Capacidad verificada: Sí / No. Asignación manual explícita: No requerida / Obligatoria. Acceso y ruta autorizados: Obligatorios / Obligatorios. Independencia del Reviewer: Obligatoria / Obligatoria. Lanzamiento permitido: Sí / Sí. Registro en ledger: Sí / Sí. Crédito de gobernanza: Según contrato / Ninguno. Resultado automáticamente `VERIFIED`: No / No.
  >
  > P12u no debe convertirse en una vía para aprobar revisiones sin evidencia. La ejecución puede producir resultados útiles, pero las condiciones de verificación de la tarea siguen pendientes hasta que exista evidencia suficiente.
  >
  > Restricciones para implementar P12u. Autorizo una sola fila nueva, sin modificar el comportamiento de P12. Debe cumplir estas condiciones:
  > - Aplicar únicamente a roles de revisión con asignación manual explícita y capacidad no verificada.
  > - Comprobar coincidencia exacta de rol, proveedor y modelo.
  > - Mantener acceso verificado, elegibilidad, cuotas e independencia entre proveedores.
  > - Registrar `override: true`, `capabilityUsed: unverified` y ausencia de crédito.
  > - Sin permiso para convertir automáticamente el resultado en `ACCEPTED` o `VERIFIED`.
  > - Mantener paridad entre núcleo, protocolo y plugin.
  > - Si el plugin no reconoce la directiva, fallar de forma segura, nunca lanzar silenciosamente sin gobernanza.
  >
  > No autorizo un scorer nuevo ni cambios adicionales en la matriz.
  >
  > Regresión G4 — Corrección autorizada. G4 es una regresión real y debe corregirse antes del cierre. Apruebo restaurar el comportamiento anterior de recuperación y reforma cuando una asignación manual rompe restricciones estructurales. El cambio debe ser limitado:
  > - Recuperación y reforma automática conservan sus reglas originales de rechazo.
  > - `rebuild` puede descartar asignaciones inválidas, siempre explicando cuáles y por qué.
  > - Las validaciones nuevas de acceso perdido, modelo inelegible y reconocimiento incorrecto permanecen.
  > - No modificar ni debilitar las expectativas del test G4.
  >
  > La tercera corrección queda autorizada por tratarse de una regresión demostrada. Si no resuelve el problema, detener esa unidad y reportar la causa; no continuar con parches sucesivos sin reevaluación.
  >
  > Validación de cierre. La suite reportada 5511/5514 no está aprobada. Aunque dos fallos son compatibles con problemas de carga, G4 es una regresión reproducible. Autorizo completar las correcciones y después ejecutar:
  > 1. Tests focalizados de G4, P12, P12u, P9 y P17.
  > 2. Paridad núcleo/plugin, incluyendo incompatibilidad con el plugin anterior.
  > 3. Revisión cruzada limitada a P12u y preservación de crédito.
  > 4. Suite integrada con carga controlada y registro de resultados.
  > 5. Repetición de los escenarios reales afectados, sin nuevas verificaciones de acceso ni llamadas autenticadas a Artificial Analysis.
  >
  > El recorrido secuencial de `test/core-hook` es evidencia útil, pero no sustituye la suite completa.
  >
  > Estado de la beta: MA34 — API Free y caché: Corregido, validación integrada pendiente. MA31-C/D — Reconocimiento y rechazo: Correcciones implementadas. MA30-B — Setup: Correcciones implementadas. MA30-A — Asignación manual: P12u y G4 pendientes. Suite integrada: No aprobada. Publicación beta: No autorizada.
  >
  > Autorizo los commits locales y la actualización documental después de las verificaciones. No autorizo push, instalación global ni publicación.
  >
  > Principio que debemos preservar. Kairo debe permitir trabajar con modelos cuya capacidad no está evaluada, pero jamás debe confundir una autorización humana con evidencia objetiva de calidad.
  >
  > Una vez resueltos P12u y G4, volvemos directamente al piloto. No abrimos otra ronda de arquitectura ni nuevas funcionalidades.

  Status (state of `release/v0.37.0` when this decision arrived):
  - Local commits after `308644faa`, in order: `26fdbe503` (MA34 reader and key check), `1d481bad8` (MA31 part C), `21181080a` (MA31 part D, row P17, plugin 0.9.1), `eaf49c98b` (MA30 part B), `84ba78d15` (docs), `793410647` (review blockers B2 and B3, reader lock and cache-only mode), `1ae7fa385` (review blocker B1, a generated agent name is recognized only after `roles sync` registers the file it wrote), `50aefba0e` (MA30 part A, `kairo team assign`), `e2e142b50` (docs), `5e447388b` (review blockers B3 to B6 on the CLI side), `362927fb7` (review blockers F1 to F4 on manual assignment), `e824eda57` (second correction for F3), `6abd33917` (third correction: the G4 regression).
  - Cross-review by Codex, static, no tests run by the reviewer: first review of `308644faa..84ba78d15` found six blockers (B1 to B6); the recheck reported all six FIXED. The review of `50aefba0e` found four blockers (F1 acknowledgement not bound to the role, F2 host pick replacing an assigned seat, F3 reform republishing a seat that lost access, F4 rebuild keeping a seat that conflicts with independence); the recheck reported F1, F2 and F4 FIXED and F3 PARTIAL; the second correction for F3 was verified by tests only.
  - G4: the full suite on `e824eda57` showed that the shared carry-over validation made a structural reform accept what it used to refuse (`test/admission-approval-active.test.js`, test "G4 reform carry-over: a split-Builder override stays refused when inactive and is carried when the contract is enabled"). Corrected in `6abd33917` before this decision arrived, within the limits the decision sets: recovery and reform refuse what the old validation refused; they drop, with a recorded reason, only seats the old code restored wrongly (lost access, provider not eligible, model not offered, acknowledgement missing or mismatched); `rebuild` reports every case as not kept with its reason; the G4 test file was not edited. A second defect found while fixing it: the "no longer offered for this role" reason wrongly dropped overrides on project-defined roles, because the edit catalog covers only built-in roles.
  - Suite runs, none passing: first run on `308644faa` plus the first five units, invalid (load average 31 to 63, totals lost); `5e447388b`: 5478 of 5502, 24 failures, all in `test/core-hook` and the read-only sandbox files, load 8 to 16; `e824eda57`: 5511 of 5514, 3 failures (G4, one `test/core-hook` legacy differential test, one read-only sandbox test). Plugin suite 579 of 579 in each run. Every file under `test/core-hook` run one file per command at `362927fb7`: 442 tests, 38 files, 0 failures. A full run on `6abd33917` was in progress when this entry was written.
  - Scoped exception to an earlier decision, reported to the product owner: a manual pick in a host file no longer replaces the model of a seat assigned with `kairo team assign` and acknowledged; other seats keep the earlier rule that a host pick pins routing.
  - Open: row P12u (this decision), its cross-review limited to P12u and credit, the integrated suite, the acceptance report, the repeated real-host scenarios.

- L59 (2026-11-11): decision by the product owner, quoted verbatim in Spanish.

  > ## Decisión: `OD-KAIRO — TEST-EFFICIENCY & ORCHESTRATOR-RESPONSIBILITY`
  >
  > Sí: el orquestador maestro de Kairo debe coordinar el desarrollo, no programar directamente. Y también coincido en que nuestro proceso de testing está consumiendo demasiado tiempo y recursos.
  >
  > Hay un problema especialmente importante en lo que acabas de compartir: P12u necesitó siete commits de corrección y varios tests utilizaban estados construidos manualmente que no representaban los estados reales del producto.
  >
  > Eso indica que no basta con ejecutar menos tests. Debemos seleccionar mejor qué probar y diseñar pruebas que reproduzcan los contratos reales.
  >
  > ### 1. Responsabilidades del orquestador
  >
  > | Responsabilidad                   | Orquestador                       | Builder     | Reviewer / QA      |
  > | --------------------------------- | --------------------------------- | ----------- | ------------------ |
  > | Analizar requisitos y riesgos     | Responsable                       | Consulta    | Consulta           |
  > | Diseñar el plan de ejecución      | Responsable                       | —           | —                  |
  > | Implementar código                | No por defecto                    | Responsable | —                  |
  > | Escribir tests                    | No por defecto                    | Responsable | Valida calidad     |
  > | Seleccionar pruebas necesarias    | Coordina                          | Propone     | Revisa             |
  > | Ejecutar pruebas                  | Puede delegar o lanzar el comando | Sí          | Cuando corresponda |
  > | Revisar código independientemente | Coordina                          | —           | Responsable        |
  > | Decidir cierre y siguiente tarea  | Responsable                       | —           | Aporta evidencia   |
  >
  > Por los reportes, tu orquestador está delegando la implementación a escritores y la revisión a Codex. Eso es consistente con su función.
  >
  > Lo que no puedo confirmar sin inspeccionar su sesión es que nunca haya editado código directamente. Ejecutar comandos de Git, lanzar tests y registrar decisiones no equivale a estar programando, aunque esas operaciones también deberían delegarse cuando resulte más eficiente.
  >
  > La regla que establecería es: el maestro no modifica código de producto por defecto. Puede realizar consultas y comprobaciones ligeras; las modificaciones excepcionales deben ser explícitas y trazables.
  >
  > ## 2. La política de testing que necesita Kairo
  >
  > Propongo `OD-KAIRO-TEST-FITNESS`, aplicable a cualquier stack, sin incorporar todavía un sistema nuevo al runtime.
  >
  > Nivel 1 — Cambio local
  >
  > Siempre
  >
  > Tests relacionados con el cambio y un test de regresión para cada defecto corregido. Feedback objetivo: segundos, no minutos.
  >
  > Nivel 2 — Integración afectada
  >
  > Según impacto
  >
  > Contratos entre módulos, serialización, caché, hooks y consumidores del código modificado.
  >
  > Nivel 3 — Suite completa
  >
  > Gate de integración
  >
  > Al congelar un lote, antes del release o cuando el impacto sea desconocido. No después de cada pequeña corrección.
  >
  > Nivel 4 — E2E real
  >
  > Flujos críticos
  >
  > Instalación, routing, gobernanza, crédito y otros contratos que sólo puedan verificarse adecuadamente con componentes reales.
  >
  > La selección por impacto es una optimización, no una garantía absoluta. Si no podemos determinar las dependencias, ampliamos las pruebas.
  >
  > ### El cambio más importante para P12u
  >
  > En lugar de construir manualmente una estructura de equipo y asumir que representa la producción, el Builder debería escribir primero una prueba que ejecute:
  >
  > `analyze → assign → approve → routing cache → launch → ledger`
  >
  > Después, pequeñas pruebas unitarias para las decisiones individuales de P12, P12u, P9 y P17.
  >
  > Un test integrado representativo vale más que decenas de tests construidos sobre estados irreales.
  >
  > ## 3. Qué reutilizaría del ecosistema
  >
  > He comprobado en GitHub que estos proyectos existen y describen capacidades pertinentes:
  >
  > | Proyecto                                                                                      | Utilidad para Kairo                                        | Decisión                             |
  > | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------ |
  > | [DiffCI](https://github.com/DiffCI/core)                               | Selección de tests afectados con fallback conservador      | Primer candidato para evaluar        |
  > | [testpick](https://github.com/rubenmaas/testpick)                      | Selección agnóstica mediante cobertura individual por test | Evaluar si disponemos de esos datos  |
  > | [fast-tests](https://github.com/hunkim/ai-is-fast-your-tests-are-slow) | Perfilado de esperas, temporizadores y tests lentos        | Primera referencia para optimización |
  > | [Zen of Test Suites](https://github.com/Ovid/zen-of-test-suites)       | Estructura, independencia y mantenimiento                  | Referencia para revisión             |
  >
  > No instalaría todas estas herramientas. Primero mediría cuánto tarda realmente Kairo y por qué. Después probaría un candidato de selección por impacto sobre un conjunto histórico de cambios, comprobando que no omita regresiones conocidas.
  >
  > ## 4. Cómo evitar la saturación que ya vimos
  >
  > Kairo ha presentado fallos de timeout cuando la máquina está sobrecargada. Ejecutar simultáneamente múltiples Builders, Codex Reviewer y la suite completa puede empeorar el tiempo total.
  >
  > Por tanto, autorizo este cambio operativo:
  >
  > - Builders: tests focalizados mientras implementan.
  > - Reviewer: revisión independiente del diff y de los tests relevantes, sin repetir indiscriminadamente toda la suite.
  > - Orquestador: coordina una única validación integrada cuando el árbol esté estable.
  > - QA: clasifica los fallos reproducibles; no repite suites completas hasta obtener un resultado favorable.
  > - CI: ejecuta las verificaciones completas que correspondan al riesgo de integración.
  >
  > La paralelización debe ajustarse a la capacidad disponible. Más workers no significa necesariamente menos tiempo.
  >
  > ## 5. Qué hacemos con el commit `5078b9188`
  >
  > El defecto de P12u corregido mediante el flujo real es precisamente la clase de error que queremos detectar antes.
  >
  > La evidencia focalizada es favorable, pero la suite completa sigue en ejecución según el último reporte. No la declararé aprobada anticipadamente.
  >
  > Autorizo terminar esa validación, realizar la revisión focalizada prevista y continuar con el piloto si no quedan regresiones reproducibles.
  >
  > No autorizo detener el release para construir ahora un nuevo motor de selección de tests.
  >
  > Para la siguiente etapa, sí quiero medir duración total, tiempo de los diez archivos más lentos, porcentaje de reejecuciones y fallos sensibles a carga. Esas métricas permitirán establecer presupuestos de tiempo basados en evidencia y no en límites arbitrarios.
  >
  > ### Regla definitiva
  >
  > El orquestador coordina. El Builder implementa. El Reviewer valida. QA verifica el riesgo.
  >
  > Y para los tests:
  >
  > Ejecutar la menor cantidad de pruebas que proporcione evidencia suficiente, sin sacrificar la detección de regresiones críticas.
  >
  > Esa política debe ser agnóstica al lenguaje, al framework y al proveedor de IA. Además de tiempo, reducirá llamadas a modelos, consumo de contexto y retrabajo.
  >
  > La optimización estructural del sistema de testing queda para después de la beta; la disciplina de selección y ejecución puede aplicarse desde ahora.
  >
  > Sin autorización nueva para push, instalación global ni publicación.

  Status (state of `release/v0.37.0` when this decision arrived):
  - State of `release/v0.37.0` when this decision arrived: clean worktree at `5078b9188`. Commits after the P12u batch recorded in L58: `0c486e6c7` (row P12u), `dc8405385` (team exec, run gate and service route declare the row), `c1af0ae24` (review fixes), `9b3c7cfcf` (resolved role forwarded on a task-marked redirect, P17 regression), `c8eb62a7d` (wrapper text shortened, context budget increase), `528bd8d27` (setup names the access verification step), `94ad54951` (manual seat markers written to the ledger on every launch path), `5078b9188` (unevaluated manual seat labelled on the cached route so P12u applies in production, found by a real-flow test).
  - Suite runs: `c8eb62a7d` node 5579 of 5579 and plugin 584 of 584, the first passing run of the batch; `94ad54951` node 5593 of 5593, 367 s. The run on `5078b9188` named in the decision was not in progress: it started at 16:53:42 and was killed when the previous session ended, leaving a partial log and no result. Focused evidence before that commit: every file under `test/core-hook` passing, plugin 584 of 584.
  - Order applied under the new policy: focused review first, then one integrated suite on the stable tree.
  - Focused cross-review by Codex, static, no tests run, limited to `94ad54951` and `5078b9188`, P12u and preservation of credit: verdict BLOCKERS, one blocker. `acknowledgedSeatLaunch` (`src/global/team/launch-ledger.js`) decides the markers from the acknowledgement alone, so after owned evidence upgrades an acknowledged seat to P12 the launch row still records `override: true` and `capabilityUsed: unverified` (`src/global/team/team-exec.js`, lines 275 to 276). Confirmed by the orchestrator reading the code. No wrong P12u admission, no P12u credit, no stale route label and no further P12, P9 or P17 regression were found. Test findings from the same review: the post-evidence assertions of `test/core-hook/manual-seat-real-flow.test.js` still pass with the route fix reverted, the P12u exec marker assertions of `test/core-hook/manual-seat-ledger-markers.test.js` still pass with the ledger fix reverted and use a hand-built fixture, and the case of a manual seat with no acknowledgement is absent.
  - Correction in progress: one bounded correction batch (markers derived from the current qualification, RED test through the real flow first, the three test findings), then one recheck limited to that blocker, then the single integrated suite.
  - Open: the correction and its recheck, the integrated suite on the final tree, the acceptance report, the repeated real-host scenarios. Push, global install and publication remain not authorized.

- L60 (2026-11-11): decision by the product owner, an answer to one question from the orchestrator, question and answer quoted verbatim in Spanish.

  > Pregunta: La suite completa pasó en c34d3cd5f (5603/5603 y plugin 584/584). Queda un hueco previo: bajo contrato, `kairo team exec` niega con P6 MODEL_UNREPRESENTABLE un asiento manual cuyo modelo ya fue verificado por evidencia propia (basta una pasada del probe), mientras el plugin decide P12. ¿Qué hacemos con ese hueco antes del piloto?
  >
  > Opciones presentadas:
  > 1. Corregir antes del piloto (Recomendado). Una unidad acotada: test por flujo real primero, cambio mínimo en la representabilidad de launch-decision.js, revisión focalizada y una suite. El piloto corre una sola vez sobre el árbol final. Requiere tu autorización porque toca la regla de decisión.
  > 2. Limitación conocida, piloto ahora. No se toca código. Se documenta en el reporte de aceptación y en la referencia del CLI que un asiento manual verificado por evidencia propia queda negado por exec bajo contrato. El piloto arranca ya sobre c34d3cd5f.
  > 3. Piloto ahora, corregir después. El piloto corre sobre c34d3cd5f y la corrección queda como tarea antes de la beta pública. Costo: repetir las filas del piloto de asignación manual después del cambio.
  >
  > Respuesta: Corregir antes del piloto (Recomendado)

  Status (state of `release/v0.37.0` when this decision arrived):
  - Correction of the L59 blocker: commit `c34d3cd5f` on `release/v0.37.0`. `acknowledgedSeatLaunch` (`src/global/team/launch-ledger.js`) now requires an acknowledged seat and a capability that is still unverified at the moment of the launch, through `isRoleCapabilityVerified`; the trace row (`src/global/team/routing-trace.js`) follows the same rule. RED observed through the real flow before the change: after owned evidence verified the model, the ledger launch row still carried `override: true` and `capabilityUsed: unverified`. Tests in `test/core-hook/manual-seat-real-flow.test.js`, including the case of a manual seat with no acknowledgement; `test/core-hook/helpers.js` exposes the real routing refresh. Focused tests by the builder: 8 files, 131 tests, 0 failures.
  - Recheck by Codex, static, limited to that blocker: RECHECK FIXED on every path that writes markers (team exec with and without `--no-record`, record-launch, trace row); P12u launches, still-unverified acknowledged seats and markers inherited from the first row of an execution are preserved; no defect introduced by the diff. The route label regression is pinned by the pre-evidence assertions, not by the post-evidence ones. The hand-built fixture of `test/core-hook/manual-seat-ledger-markers.test.js` was left unchanged.
  - Debt recorded, not corrected: the join over the routing cache is duplicated between `launch-ledger.js` and `project-router.js` (they differ only for an absent cache with no recorded evidence status, where production routing answers STALE, and for injected non-default account keys); on a cache or evidence store read error the helper leans to the unverified markers.
  - Integrated validation, one run in the session, on a clean tree at `c34d3cd5f`: node 5603 of 5603, 0 failures, 401 s, load average 2.44 at start and 4.81 at end; plugin 584 of 584, 14 s. Order applied: focused review, one correction batch, one recheck, one suite.
  - Gap confirmed by the builder, by the Codex recheck and by the orchestrator reading the code: `readQualification` in `src/global/team/launch-decision.js` adds the routed model of the base route to `poolModels` only while the route says capability unverified with a manual assignment; the cache pool holds only models with a capability evaluation, so once owned evidence verifies the model of an acknowledged manual seat, `kairo team exec`, which always declares its model, is denied P6 before any launch, while the hook path, which sends no explicit model, decides P12. One validated identity-bound operational pass of the role probe is enough to verify (`isRoleCapabilityVerified`). Present since `50aefba0e`; fail safe (a denial), not a regression of the last commits.
  - In progress under this decision: one bounded unit, RED test through the real flow first, minimal change to the representability rule, no new row and no change to the cells of any row, then a focused cross-review, then one integrated suite, then the pilot once on the final tree.
  - Open: that correction and its review, the integrated suite on the final tree, the acceptance report, the repeated real-host scenarios. Push, global install and publication remain not authorized.

- L61 (2026-11-11): MA36 result, integrated validation of the final tree and third repetition of the affected real-host scenarios; nothing was pushed, published or installed globally.

  - MA36, commit `5a5420a24` on `release/v0.37.0`. Route: delegated writer, test first. RED through the real flow before the change: `Launch denied (MODEL_UNREPRESENTABLE, P6): nothing was launched.`, exit 1, no spawn. Change: `resolveProjectRoute` (`src/global/team/project-router.js`) sets the additive route field `acknowledgedSeat: true` for the acknowledged seat that matches role, provider and model, whether its capability is verified or not; the labels `capability: unverified` and `manualAssignment: true` and the sentence in `why` are still set only while unverified. `readQualification` (`src/global/team/launch-decision.js`) adds the routed model of the base route to `poolModels` when `base.acknowledgedSeat` is true. The matrix table, the `unverifiedSeat` flag, the plugin and the protocol were not touched. Tests in `test/core-hook/manual-seat-real-flow.test.js`: the post-evidence exec under an effective contract answers P12 like the hook path, exit 0, one spawn, no unverified marker; an explicit model that is not the seat model is still denied P6. Differential against `c34d3cd5f`: the only difference is the post-evidence exec going from P6 to P12. Focused tests by the builder: 11 files, 0 failures. Risk line: item 3 (shared decision rule and an additive route field).
  - Focused cross-review by Codex, static, limited to that diff: APPROVED. No authorization bypass (the acknowledgement must match role, provider and model; access, eligibility and quota gates remain; P10 and P11 run before P12); no new path from an unverified seat to P12; the new field reaches only the raw `kairo team route` JSON, not the persisted routing inputs, the directive or the plugin protocol.
  - Advisories from that review, present before this change and not corrected: a P12 launch through `kairo team exec` persists no directive metadata, so its ledger row is unclassified and its trace says `caller_selected`, while the hook records the evidence class (`src/global/team/team-exec.js`, lines 224, 276 and 283 to 285); `pairQualified` vetoes the original provider and model pair only through the gentle-actor branch, ordinary linked reviewers are redirected to the qualified top model; two assertions of the new test compare the returned credit, not the persisted credit or class.
  - Integrated validation on a clean tree at `5a5420a24`: node 5605 of 5605, 0 failures, 435 s, load average 1.74 at start and 5.35 at end; plugin 584 of 584, 13 s. Full suite runs in this session: two, one per frozen tree (`c34d3cd5f` and `5a5420a24`), each after its focused review, as L59 orders. `test/core-hook/manual-seat-ledger-markers.test.js` failed once for the builder during the correction (7 pass, 1 fail, output lost), passed in three reruns and in the integrated suite; recorded as possibly load sensitive, not rerun to green.
  - Third repetition of the real-host scenarios, commit `5a5420a24`, run in place, same scratch homes and project as the second repetition, headless, Claude only, no admission contract, one run per row. A2c PASS: `kairo team route --refresh` exit 0 with only local host calls, the explorer route is ROUTED, role Explorer, model `claude-haiku-5-5`, `assignmentSource` override, and carries `acknowledgedSeat` true, `capability` unverified, `manualAssignment` true and the manual assignment sentence in `why`; `kairo team show` lists the three seats with their models as approved, capability unverified, manual, none stale. A3c PASS: description rewritten to "Explorer · claude-haiku-5-5 (claude) — List files in current directory"; the three trace rows (hook, observation, outcome) and the two ledger rows (launch, outcome) carry `override: true` and `capabilityUsed: unverified` with one shared execution id. F8c PASS: the rebuild preview keeps the three manual assignments and changes nothing. Read-only look PASS: `kairo team routes` and `kairo team verdict --pending` answer with exit 0. F5c FAIL as written, not a defect of the candidate: `kairo team assign` without `--yes` on the approved team exits 1 with "Assignments can only change while the team is a draft; this one is active. Run kairo team show."; the expectation was wrong, the orchestrator asked for a draft-only preview on a team approved since the first repetition; that refusal is in `src/global/team/setup-operations.js` line 258 at `94ad54951` and none of the three new commits touches that file; the row was not rerun.
  - Not run on a real host, with the reason: P12u and P17 under an effective admission contract and `kairo team exec` after owned evidence verifies the seat (row P12, MA36), because `admission enable` requires the user's own interactive terminal and a probe pass is a model call outside the budget; these are covered by the real-flow tests only. Also not run: the status pane, routing to Codex, a live Artificial Analysis request.
  - Spend and real home: one model-reaching call this round (A3c), 33 for the whole pilot. Hard configuration files and the `~/.claude/agents` count unchanged, 0 changed files under `~/.harness`, pilot marker not found under `~/.harness`, `~/.codex` or `~/.config`; `~/.claude.json` changed size (content not read) and the `claude-plugins-official` marketplace `lastUpdated` moved at the A3c launch, a host write. A first attempt to run this repetition was routed to the read-only verifier role, which stopped before any row because its rules forbid the signed-in session and evidence writes; no call and no file resulted.
  - Evidence: `agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma28/rerun-l58/INDEX.md`, section "Third repetition, commit 5a5420a24", with `A2c.txt`, `A3c.txt`, `F5c.txt`, `F8c.txt` and `claude-calls-third-repetition.log` (outside the repository).
  - State of `release/v0.37.0`: `5a5420a24`, clean, local only. Commits of this session: `c34d3cd5f` (markers follow the current capability) and `5a5420a24` (exec parity).
  - Open: the real-host rows that need the user's interactive terminal (P12u, P17, post-evidence exec), the acceptance report update and the documentary integration into `release/v0.37.0` (MA33), task MA35 after the beta, the recorded advisories. Push, global install and publication remain not authorized.

- L62 (2026-11-11): decision by the product owner, quoted verbatim in Spanish.

  > ## Decisión: `OD-MVP-MA33 — REAL_CONTRACT_PILOT_APPROVED`
  >
  > Elijo la opción 1: ejecutar las tres verificaciones en mi terminal interactiva, con contrato efectivo.
  >
  > No aceptaría exclusivamente los tests automatizados para publicar una beta cuando todavía no hemos comprobado el comportamiento real de P12u y P17. Son mecanismos centrales de la gobernanza de Kairo.
  >
  > Dicho esto, no vamos a repetir todo el piloto. La evidencia existente es suficiente para limitar la validación a tres escenarios.
  >
  > ### 1. Escenarios autorizados
  >
  > | Escenario                         | Resultado obligatorio                                                                     |
  > | --------------------------------- | ----------------------------------------------------------------------------------------- |
  > | P12u — Capacidad no verificada    | Lanza mediante ruta autorizada, registra ejecución y no otorga crédito de gobernanza      |
  > | P17 — Rol sin ruta autorizada     | Rechaza el lanzamiento, informa el motivo y no produce ejecución ni crédito               |
  > | P12 — Evidencia propia verificada | Permite la ruta correspondiente y aplica únicamente el crédito autorizado por el contrato |
  >
  > En los tres casos debemos correlacionar `taskId`, `executionId`, modelo seleccionado, directiva aplicada, traza y ledger.
  >
  > ### 2. Cómo ejecutaremos la validación
  >
  > Autorizo lo siguiente:
  >
  > 1. Utilizar el proyecto temporal del piloto, nunca uno productivo.
  > 2. Activar el contrato mediante `admission enable` desde mi terminal interactiva, después de mostrar el estado y alcance.
  > 3. Ejecutar solamente los tres escenarios anteriores, con tareas mínimas y deterministas.
  > 4. Inspeccionar las evidencias reales de routing, directivas y ledger.
  > 5. Desactivar la admisión y comprobar que el estado previo se restauró.
  >
  > No autorizo modificar las configuraciones globales, copiar credenciales, instalar plugins globalmente ni ejecutar nuevas evaluaciones de modelos.
  >
  > Si un escenario necesita acciones adicionales que puedan afectar mi entorno, deberá detenerse.
  >
  > ### 3. Criterio de cierre
  >
  > Suite Node
  >
  > 5605/5605
  >
  > Suite plugin
  >
  > 584/584
  >
  > Revisión independiente
  >
  > Aprobada tras corrección
  >
  > Contrato real P12u / P17 / P12
  >
  > Pendiente
  >
  > La observación sobre `team exec` y sus metadatos incompletos puede permanecer como deuda conocida si se demuestra que no genera crédito incorrecto ni compromete la decisión de admisión. Si afecta alguna de esas garantías, se convierte en bloqueante.
  >
  > No repetiremos la suite completa después de una validación sin cambios de código.
  >
  > ### 4. MA33 y documentación
  >
  > Autorizo preparar la actualización de `odd/release/v0.37.0-acceptance.md` e integrar la documentación pendiente. El resultado definitivo de las tres filas debe registrarse después de la prueba, no anticipadamente.
  >
  > Mantener el candidato sin push ni publicación.
  >
  > Mi instrucción para el orquestador: preparar los tres escenarios con los datos y comandos exactos del proyecto temporal, sin ejecutarlos todavía. El orquestador coordina y recoge evidencia; los agentes especializados realizan las comprobaciones.
  >
  > Una vez que tenga los comandos preparados, los ejecutaré en mi terminal interactiva. Si pasan las tres pruebas, podremos cerrar este bloque de gobernanza y continuar con los demás criterios pendientes de la beta.

  Status (state of `release/v0.37.0` when this decision arrived):
  - This decision answers the single open item of L61: the real-host rows that need the user's interactive terminal. The product owner runs them himself; the full pilot is not repeated and no full suite is rerun without a code change.
  - State of `release/v0.37.0` when the decision arrived: `5a5420a24`, clean, local only; node 5605 of 5605 and plugin 584 of 584 on that commit; third real-host repetition recorded in L61.
  - In progress, nothing executed against a model: a delegated preparation of the runbook for the three scenarios in the pilot's temporary project (exact environment, state and scope display, `admission enable`, one minimal deterministic task per scenario, evidence correlation of `taskId`, `executionId`, selected model, directive, trace and ledger, `admission disable` and restoration check), written outside the repository under `agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma33-contract/`; and a delegated independent demonstration, in an isolated scratch copy with no model call, of whether the missing directive metadata of a P12 launch through `kairo team exec` produces incorrect credit or changes an admission decision.
  - Point raised during preparation, not decided: scenario P12 needs owned evidence that verifies the seat model; if the only way to produce it is a role probe pass, that is a model call the decision may count as a new model evaluation, so the scenario is prepared as blocked pending the product owner's answer rather than designed around it.
  - Open: the runbook, the demonstration result and its classification (known debt or blocker), the three real-contract rows (pending, to be recorded only after the test), the acceptance report update and the documentary integration into `release/v0.37.0` (MA33). Push, global install, global plugin install, credential copies, new model evaluations and publication are not authorized.

- L63 (2026-11-11): two decisions by the product owner, answers to two questions from the orchestrator, questions and answers quoted verbatim in Spanish.

  > Pregunta 1: El proyecto temporal del piloto (kairo-realhost.by3PTf, con el equipo aprobado y la caché de acceso) se borró al reiniciarse la máquina. Los tres escenarios bajo contrato real necesitan uno. ¿Cómo lo reconstruimos?
  >
  > Opciones presentadas:
  > 1. Copiar caché de acceso (Recomendado). El Test Repro Runner arma un home y proyecto temporales nuevos, en una carpeta que no se purga, copiando ~/.harness/claude-entitlement.json de tu home real (caché de acceso del 5 de noviembre, 2 KB; no leí su contenido). Costo: 1 llamada a modelo para el análisis del equipo, 0 verificaciones de acceso. Si Kairo rechaza la caché por antigua, se detiene y te aviso.
  > 2. Verificar acceso de nuevo. Home temporal nuevo sin copiar nada de tu home real. Se corre kairo team verify-access --refresh ahí: 13 llamadas a modelo (cerca de un centavo cada una permitida) más 1 del análisis. Contradice el límite de L58 de no hacer nuevas verificaciones de acceso, por eso necesita tu autorización expresa.
  > 3. No reconstruir. No se toca nada. P12u, P17 y P12 quedan sin correr en host real y el bloque de gobernanza sigue abierto para la beta.
  >
  > Respuesta 1: Copiar caché de acceso (Recomendado)
  >
  > Pregunta 2: El escenario P12 exige evidencia propia que verifique el modelo del asiento de revisión. El único productor real es `kairo intelligence aptitude-run` (llamadas a modelo, una evaluación nueva que tu decisión excluye). Tu home real ya tiene ~/.harness/role-aptitude-evidence.json del 20 de octubre (13 KB, contenido no leído). ¿Cómo obtenemos la evidencia para P12?
  >
  > Opciones presentadas:
  > 1. Copiar mi evidencia propia (Recomendado). El agente lee de ese archivo solo rol, modelo, veredicto, origen y versión del probe. Si hay una pasada válida para un rol de revisión, el equipo nuevo sienta ese modelo en ese rol; tras P12u se copia el archivo al home temporal y se corre P12. 0 llamadas extra, evidencia real. Si no hay fila válida para la versión actual del probe, se detiene y te vuelvo a preguntar.
  > 2. Autorizar una pasada del probe. Se corre `kairo intelligence aptitude-run` en el home temporal: evaluación nueva con llamadas a modelo. Primero se lee el plan en seco (`aptitude-plan`) y te muestro costo y modelos antes de ejecutar. El planificador elige candidatos baratos, puede no incluir el modelo del asiento.
  > 3. Dejar P12 sin correr. P12 no se prueba en host real. Queda cubierto por los tests de flujo real y la demostración aislada de hoy, y se declara así en el reporte de aceptación. P12u y P17 se corren igual.
  >
  > Respuesta 2: Copiar mi evidencia propia (Recomendado)

  Status:
  - Why the questions arose: the pilot scratch directory under the system temp folder (`kairo-realhost.by3PTf`) no longer existed when the runbook was prepared; the machine had restarted (uptime 41 minutes at 18:45 local time) and the temp folder was purged. Rule recorded for later pilots: keep pilot state in a durable directory, never only under the system temp folder.
  - Demonstration ordered in L62, independent verifier, isolated copy of `5a5420a24`, stubbed spawn, no model call: KNOWN DEBT. The same linked P12 review through the hook path and through `kairo team exec` gives identical governance credit (`REVIEWED_PENDING_PROVENANCE`, review counted, same provider exclusion) and identical admission answers for a following launch, on every shape tested: exec with its own ledger row, hook plus `exec --no-record` under the wrapper, a Claude seat and a Codex seat, no contract (no credit on either path), corrupt contract (exec refused with `ADMISSION_STATE_UNKNOWN, X3`, the hook earns no credit). Reason: a ledger launch row without `launchClass` is a legacy row and counts like an `evidence` row, only `operational` and `continuity` are filtered (`src/global/team/launch-ledger.js`, lines 61 to 65); admission depends only on task authorship; nothing reads the P12 directive from the ledger. Not covered: `exec --no-record` with a P12u directive, and the second attempt of a capacity-switch handover. Side finding, no credit involved: a hook launch with no contract writes a ledger launch row with no `executionId`, so a verdict bound by `--execution-id` cannot attach to it.
  - Runbook prepared, nothing executed: `agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma33-contract/RUNBOOK.md` (outside the repository). Findings: the contract is per project; `kairo team admission enable --yes` needs a terminal on stdin and stdout and only configures the contract, `kairo team admission activate --hook-protocol kairo.launch-directive/v1` makes it effective, both write only `admission-contract.json` under the Kairo home sessions folder and `reviewer-snapshots.json`; `disable` rewrites the file with `enabled:false`, it does not delete it; the routing cache expires after 30 minutes and a stale cache turns a linked review into P9 before P12u; P12u and P17 go through the plugin hook with `claude -p`, one model call each; `kairo team exec` was rejected as the pilot path because it spawns `claude` without `HARNESS_HOME` and with the real user settings.
  - Rebuild under answer 1, done by the Test Repro Runner role, one model call (the team analysis on `claude-sonnet-5-5`), no access verification: new scratch at `agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma33-contract/kairo-realhost-ma33/` with `kairo-home`, `proj`, `bin`, `bin2`, `kit-home`. The copied entitlement cache was accepted. Approved team, all seats manual with capability unverified: Technical Lead `claude-sonnet-5-5`, Quality Lead `claude-opus-5-5`, Explorer `claude-sonnet-5-5`, Reviewer `gpt-6-luna` (codex); no Builder and no Documenter seat. No admission contract, trace, ledger or evidence store exists in the new home; no scenario was run. Release worktree unchanged at `5a5420a24`, clean.
  - Differences from the earlier pilot, reported to the product owner: Codex is reachable in this environment (the PATH of `env.sh` includes `$HOME/.local/bin`), where the earlier pilot had removed it on purpose, so Codex models are offered and Kairo made its own Codex readiness calls, which the Claude call log cannot see; Explorer is `claude-sonnet-5-5` because `claude-haiku-5-5` is not in the access cache; `kairo-reviewer` was copied in addition to `kairo-builder` and `kairo-documenter`.
  - Owned evidence under answer 2, fields read: role, provider, model, verdict, origin, execution kind, probe and validator ids and versions, account (redacted). 22 rows. Quality Lead has no valid row (its current probe is `test-designer.edge-plan-v1`, no attempt for it). Reviewer has a valid pass for `claude-haiku-4-5`, not assignable in this home, and for `gpt-6-luna` on codex, assignable, which is why the Reviewer seat holds it. Consequence: P12u runs on Quality Lead; P12 runs on the Reviewer seat after the product owner copies the evidence file into the scratch home, and its launch is rewritten by the hook to the `kairo-codex` wrapper, whose `kairo team exec` child runs Codex with the real HOME and may write session records under `~/.codex`. By the rule of L62 that step stops unless the product owner accepts it; it is a gate in the runbook, not decided here.
  - Real-home diff of the rebuild: hard configuration files, the `~/.claude/agents` count and the marketplaces identical; the real entitlement file unchanged; no pilot marker under `~/.harness`, `~/.codex` or `~/.config`; `~/.claude.json` and one new `~/.claude/projects/*kairo-realhost*` directory changed (host writes); some `~/.harness` session and usage files changed in the same minutes and are attributed by name and project key to other running sessions, not by a time gap.
  - Acceptance report: a full draft of the updated `odd/release/v0.37.0-acceptance.md` exists outside the repository at `agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma33-contract/v0.37.0-acceptance.draft.md`, with the three real-contract rows PENDING and marked `TODO-AFTER-TEST`. The release branch stays frozen at `5a5420a24` until the test. Gaps found by the draft: no tarball size, file count or SHA-256 for `5a5420a24`; `odd/release/v0.37.0-pilot-matrix.md` is outdated; the task lines of MA30 and MA31 are stale; no decision is recorded for row G5b, the onboarding ask on the first prompt, the executed model not being recorded, and most items of the L53 audit.
  - Open: the product owner's run of P12u, P17 and P12 with the runbook; his gates (`admission activate`, `route --refresh`, the Codex transport for P12, P12 on the Reviewer seat instead of Quality Lead); then the results, the application of the acceptance draft, the tarball data and the documentary integration into `release/v0.37.0`. Push, global install, global plugin install, credential copies, new model evaluations and publication remain not authorized.

- L64 (2026-11-11): decision by the product owner, quoted verbatim in Spanish.

  > ## Decisión: `OD-MVP-MA33 — INTERACTIVE_PILOT_EXECUTION_APPROVED`
  >
  > Autorizo ejecutar los tres escenarios del runbook en el proyecto temporal reconstruido, incluido P12 con Reviewer en Codex, bajo límites específicos.
  >
  > La preparación está completa según la evidencia reportada. No necesitamos reconstruir el proyecto ni repetir pruebas que ya pasaron.
  >
  > ### 1. Resolución de las cuatro decisiones
  >
  > | Punto                                                          | Decisión                                                                                   |
  > | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
  > | P12 sobre Reviewer con Codex                                   | Aprobado. Es el único asiento con evidencia válida disponible para ese escenario           |
  > | Transporte Codex con HOME real                                 | Aprobado exclusivamente para esta prueba, con escrituras normales de sesión controladas    |
  > | `admission activate --hook-protocol kairo.launch-directive/v1` | Aprobado únicamente en el HOME temporal                                                    |
  > | `kairo team route --refresh`                                   | Aprobado. Refrescar antes de los escenarios, verificando que sólo consulte fuentes locales |
  >
  > ### 2. Límites del transporte Codex
  >
  > Permitimos que Codex utilice su autenticación existente y genere los archivos normales de sesión en `~/.codex`.
  >
  > No autorizo modificaciones de `config.toml`, instrucciones globales, plugins, configuración de autenticación ni proyectos productivos.
  >
  > Antes de P12, deben registrarse el estado y las huellas de los archivos de configuración relevantes. Si el wrapper requiere modificar alguno de ellos, se detiene el escenario.
  >
  > La prueba tampoco autoriza copiar credenciales ni reconfigurar proveedores.
  >
  > ### 3. Orden de ejecución
  >
  > 1. Preflight: verificar HOME temporal, directorio de trabajo, estado inicial, archivos protegidos y contrato todavía inactivo.
  > 2. Activación: habilitar y activar la admisión en el entorno temporal, refrescar rutas y comprobar las directivas esperadas sin lanzar modelos.
  > 3. P12u: ejecutar Quality Lead sin capacidad verificada. Debe quedar registrado, pero sin crédito de gobernanza.
  > 4. P17: intentar lanzar `kairo-builder` sin asiento. Debe impedirse el lanzamiento delegado y registrarse el rechazo.
  > 5. P12: ejecutar Reviewer con Codex y evidencia propia válida. Comprobar la directiva, el modelo efectivamente utilizado y el crédito correspondiente.
  > 6. Cierre: correlacionar trace y ledger, desactivar la admisión y comparar los archivos protegidos con su estado inicial.
  >
  > Cada escenario debe detenerse si el chequeo previo no devuelve la fila esperada. No realizar reintentos automáticos ni verificaciones adicionales de acceso.
  >
  > El archivo de evidencia puede utilizarse únicamente si conserva su procedencia y no contiene secretos ni datos personales innecesarios.
  >
  > ### 4. Criterios de aceptación
  >
  > | Escenario   | PASS esperado                                                                         |
  > | ----------- | ------------------------------------------------------------------------------------- |
  > | P12u        | `ROUTED`, modelo correcto, `capabilityUsed: unverified`, sin crédito                  |
  > | P17         | `DENY`, `NO_AUTHORIZED_ROUTE`, sin ejecución delegada ni crédito                      |
  > | P12         | Ruta de Reviewer autorizada, independencia respetada, crédito sustentado en evidencia |
  > | Integridad  | Task ID, execution ID, directiva, trace y ledger correlacionables                     |
  > | Aislamiento | Sin modificaciones no autorizadas fuera del entorno de prueba                         |
  >
  > Si los tres escenarios pasan, autorizo cerrar la validación MA33 e incorporar los resultados reales al reporte de aceptación.
  >
  > ### 5. Documentación y candidato
  >
  > Autorizo actualizar la matriz, las tareas MA30/MA31/MA33 y el documento L63, únicamente con resultados verificados.
  >
  > Después, generar nuevamente el paquete desde el commit final y registrar tamaño, archivos y SHA-256. No reutilizar el checksum de un candidato anterior.
  >
  > Las 15 marcas `TODO-AFTER-TEST` deben resolverse según evidencia; ninguna debe transformarse automáticamente en PASS.
  >
  > Los pendientes G5b, onboarding, D18 y la auditoría L53 siguen abiertos hasta que exista una clasificación explícita.
  >
  > ### Instrucción para el orquestador
  >
  > El orquestador no debe programar ni modificar el candidato durante este piloto. Su responsabilidad es coordinar los pasos, comprobar las guardas, recopilar evidencia y detener las pruebas ante una desviación.
  >
  > No puedo ejecutar directamente el `RUNBOOK.md` almacenado en tu Mac desde esta conversación. Los comandos deben ejecutarse en tu terminal interactiva, después de revisar que respetan los límites anteriores.
  >
  > Queda autorizada la ejecución controlada de MA33, incluido Codex. Si pasa, cerramos este bloque de gobernanza y revisamos exclusivamente los bloqueantes restantes antes de decidir sobre la beta pública.
  >
  > Sin push, instalación global ni publicación.

  Status:
  - This decision resolves the four gates recorded as open in L63: P12 on the Reviewer seat with Codex, the Codex transport with the real HOME, `admission activate` in the temporary home, and `kairo team route --refresh`.
  - State when the decision arrived: `release/v0.37.0` at `5a5420a24`, clean, local only; the rebuilt pilot project of L63 with no admission contract, no trace, no ledger and no evidence store; no scenario run; no code change since the integrated validation of L61, so no suite rerun.
  - Who executes: the commands run in the product owner's own interactive terminal; `kairo team admission enable --yes` refuses without a terminal on stdin and stdout. The orchestrator writes no code and does not modify the candidate during the pilot.
  - In progress, nothing executed against a model or the admission contract: a delegated revision of the runbook against the limits of this decision (the six-step order, a guard that records path, size, mtime and SHA-256 of the relevant Codex configuration files before and after P12, provenance and a key-name check of the owned evidence file before it is copied, no rerun of a failed scenario, an acceptance mapping per criterion) and a short execution card `RUN.md`, both outside the repository under `agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma33-contract/`.
  - Limitation reported to the product owner before the run: no implementer launch is recorded for the P12 task and none is fabricated, so the P12 result can show that independence is not contradicted, not that provider exclusion was exercised; the isolated demonstration of L63 did exercise the exclusion between a Claude and a Codex seat.
  - Open: the product owner's run of the six steps; then the correlation of task id, execution id, selected model, directive, trace and ledger per scenario, the results in the acceptance report by evidence (the 15 `TODO-AFTER-TEST` marks, none turned into PASS automatically), the pilot matrix, tasks MA30, MA31 and MA33, the package regenerated from the final commit with its size, file count and SHA-256, and the documentary integration into `release/v0.37.0`. G5b, the onboarding ask, D18 and the L53 audit stay open until explicitly classified. Push, global install and publication remain not authorized.

- L65 (2026-11-11): two decisions by the product owner, answers to two questions from the orchestrator, questions and answers quoted verbatim in Spanish.

  > Pregunta 1: Aprobaste `kairo team route --refresh` "verificando que sólo consulte fuentes locales". En realidad consulta la cuenta de cada proveedor por su CLI (`claude -p /usage`, `claude auth status`, `codex app-server` para límites y lista de modelos): no son llamadas a modelo, pero salen a la red. El fetch público a huggingface.co ya quedó bloqueado por una guarda. Sin refresh la caché de rutas está vencida y los escenarios caen en P9. ¿Cómo seguimos?
  >
  > Opciones presentadas:
  > 1. Aceptar consultas de cuenta (Recomendado). El refresh corre con la guarda de red: Hugging Face bloqueado, 0 llamadas a modelo, y se permiten las consultas de estado de cuenta de los CLI de Claude y Codex. La tarjeta verifica que el contador de llamadas a modelo no suba y que los archivos protegidos de Codex no cambien.
  > 2. No refrescar. No se corre el refresh. La caché de rutas tiene más de 30 minutos, así que los chequeos previos devolverán P9 y los tres escenarios se detienen sin lanzar modelos. El bloque de gobernanza queda abierto.
  >
  > Respuesta 1: Aceptar consultas de cuenta (Recomendado)
  >
  > Pregunta 2: En P12 el hook reescribe el lanzamiento del Reviewer al agente wrapper `kairo-codex`, que declara `tools: Bash` y corre `kairo team exec --provider codex` desde un bloque de shell. La tarjeta lanza `claude -p` con `--allowedTools Agent` solamente: en modo headless el Bash del wrapper queda denegado y lo más probable es que Codex nunca arranque. ¿Qué hacemos en ese único paso (5.5)?
  >
  > Opciones presentadas:
  > 1. Permitir Bash solo en 5.5 (Recomendado). El paso 5.5 usa `--allowedTools Agent Bash`. El wrapper puede correr Codex y se prueba el camino completo, incluido `team exec` bajo contrato (el fix de MA36). El orquestador haiku también tendría Bash: el prompt le prohíbe otras herramientas, el plugin niega escrituras del hilo principal, el directorio es el proyecto temporal y la guarda de `~/.codex` corre antes y después. P12u y P17 siguen con `Agent` solo.
  > 2. Dejar solo Agent. 5.5 corre como está. Si el wrapper queda bloqueado se registra como hallazgo, sin reintento: habrá directiva y filas del hook, pero no ejecución de Codex, así que no se podrá comprobar el modelo efectivamente utilizado y P12 no podrá darse por PASS.
  > 3. Solo el chequeo previo. No se lanza P12. Se corre únicamente el chequeo previo sin modelos (0 llamadas), que prueba la fila de directiva que decide el núcleo tras copiar la evidencia. No prueba registro ni ejecución.
  >
  > Respuesta 2: Permitir Bash solo en 5.5 (Recomendado)

  Status:
  - Correction recorded: the orchestrator had told the product owner that `kairo team route --refresh` made only local calls. It does not: it fetches the public Hugging Face leaderboard (`huggingface-leaderboard.js`, lines 19 and 67) and runs the provider CLIs' account status queries. None reaches a model. The fetch is blocked during the pilot by a preload guard (`no-net.cjs`), which removes itself from the environment so child processes do not inherit it, and Kairo falls back to the cache in the scratch home.
  - Runbook revised against L64, nothing executed: six-step order; the no-model prechecks of P12u and P17 inside the activation step; a Codex guard (`codex-guard.sh`) recording 36 protected top-level files and 5 folders of the real Codex folder by path, size, mtime and SHA-256, authentication files by size and mtime only, session files counted separately, dry run printing `PROTECTED UNCHANGED`; an evidence gate (`evidence-gate.sh`) recording provenance and scanning key names: the owned evidence file has `schemaVersion` and `attempts[]`, 22 attempts, account key `default`, no key matching a secret, token or personal-data pattern, and 9 free-text validator messages under `failedChecks[]`, none under Reviewer, not read; no step reruns a failed scenario; an acceptance mapping per criterion; the execution card `RUN.md`.
  - Codex launch, read from the code: `codex --model gpt-6-luna exec --json --approve-for-me <task>` in the scratch project, with the full process environment (real HOME, scratch `HARNESS_HOME`, `CODEX_HOME` unset), no flag that ignores the user configuration; Kairo itself writes nothing under the real Codex folder in this flow. `kairo team admission disable` needs no terminal; only `enable --yes` does.
  - Independence: with no writer launch recorded for the task, a P12 result shows an empty exclusion set and `credit.independence: provisional`, a value fixed by the matrix row; the task state stays `WAIT_FOR_TASK_IDENTITY` with `no_writers`. It shows independence not contradicted, not exercised. No writer row is fabricated.
  - Applied under these two answers: the refresh steps keep the network guard and accept the account status queries; step 5.5 runs with `--allowedTools "Agent,Bash"` and a check that prints any Bash use by the main thread; P12u and P17 keep `Agent` only.
  - Still unconfirmed until the run: whether the wrapper's Bash finds the scratch `kairo` through PATH; whether `--model` before `exec` is accepted by the installed Codex CLI; whether the real Codex `hooks.json` or configuration does anything at session start (not read); the live field names of a hook trace row under an effective contract.
  - Expected model-reaching calls of the run: three `claude -p` (the call log goes from 1 to 4) and one `codex exec`.
  - Open: the product owner's run of `RUN.md`; then everything listed as open in L64.

- L66 (2026-11-11): decision by the product owner, an answer to one question from the orchestrator, question and answer quoted verbatim in Spanish.

  > Pregunta: `--allowedTools "Agent,Bash"` no confina Bash al proyecto temporal: según la documentación de Claude Code solo el sandbox del sistema lo hace, y el plugin no restringe el Bash de subagentes. ¿Cómo corremos el escenario P12 (Reviewer en Codex)?
  >
  > Opciones presentadas:
  > 1. P12 por team exec directo (Recomendado). Vos corrés `kairo team exec --provider codex --model gpt-6-luna` con el task id desde tu terminal, sin Claude ni Bash de Claude. Es el mismo lanzamiento de Codex que haría el wrapper y ejercita el fix de MA36 (exec bajo contrato para asiento verificado). La decisión P12 del camino del hook se comprueba con el chequeo previo sin modelos. No se ejercita en host real la redirección hook a wrapper. 1 llamada a Codex, 0 a Claude.
  > 2. Sandbox del sistema en 5.5. 5.5 corre con `--settings` activando el sandbox y una lista de escritura permitida (home temporal de Kairo y sesiones de `~/.codex`) más dominios de red de Codex. Confinamiento real de escrituras. No está probado en modo headless y puede impedir que Codex arranque; validarlo antes cuesta una llamada extra a modelo fuera de los tres escenarios.
  > 3. Correr 5.5 como está. Se acepta que el control es por instrucción y detección posterior, no por prevención: el prompt prohíbe otras herramientas, el plugin niega escrituras del hilo principal por patrón, 5.6 lista todo uso de Bash y la guarda de `~/.codex` compara huellas. Ejercita el camino completo hook a wrapper a Codex.
  > 4. Solo el chequeo previo. No se lanza P12. Se prueba únicamente la fila de directiva tras copiar la evidencia, con 0 llamadas. P12 queda sin ejecución real.
  >
  > Respuesta: P12 por team exec directo (Recomendado)

  Status:
  - Why the question arose: the product owner's advisor asked to verify, before step 5.5, that the permission `Agent,Bash` allows no operation outside the temporary project. It cannot be verified as true. Claude Code documentation: permission rules do not confine Bash to a directory and do not bind subprocesses; only the OS sandbox confines Bash writes (working directory and the temp directory), it also covers subagent Bash, and its behavior in headless mode is not documented; there is no documented way to give Bash to a subagent while denying it to the main thread. Candidate plugin: main-thread file tools are denied and main-thread Bash is denied by pattern for delivery, admission and write commands; subagent tool calls pass through (`integrations/claude-code/kairo-router/hooks/register.ts`, lines 707 to 717).
  - This answer replaces answer 2 of L65: no step of the execution card allows Bash.
  - What the run no longer exercises on a real host: the hook rewriting a Reviewer launch to the `kairo-codex` wrapper and the wrapper's `exec --no-record`. That recording shape was covered by the isolated demonstration of L63 and by the tests; the hook path decision is still checked by the no-model precheck.
  - Exact exec command (step 5.5, read from the candidate at `5a5420a24`, nothing executed): `printf '%s' 'Reply with the single word OK.' | kairo team exec --provider codex --model gpt-6-luna --role Reviewer --task-id "$(cat "$E/p12-taskid.txt")" --cwd "$P" > "$LOGS/p12.exec.stdout" 2> "$LOGS/p12.exec.stderr"`. The role is `--role Reviewer`; the task identity comes from `--task-id` (`src/cli.js` lines 1055 to 1056, `src/global/team/team-exec.js` lines 206 and 211); the task text is stdin (`team-exec.js` lines 195 to 196). Nothing the hook supplies is missing: no `kairo-role` line (read only when `--role` is absent, lines 200 to 205), no declared row list (exec declares `["P12u"]` itself, `launch-gate.js` line 38), no execution id marker (a UUID is generated, line 207), no `--launch-protocol` (added when the contract is effective, line 188).
  - What exec decides: it asks the core with `role:"Reviewer"`, `originalProvider:"codex"`, `model:"gpt-6-luna"`, `attemptKind:"initial"`, `rows:["P12u"]` and the task, with no agent and no host (`launch-gate.js` lines 36 to 39). Expected row P12 (not P6 `MODEL_UNREPRESENTABLE`, not P12u, not P10: no writer is recorded). It prints only the final Codex message on stdout (`OK` expected), Codex's own stderr unchanged, and exits with Codex's exit code. It writes one ledger launch row and one `completed` outcome row (`role:"Reviewer"`, `agent:"kairo-codex"`, `adapterId:"codex"`, `modelId:"gpt-6-luna"`, `taskId`, `taskIdStatus`, one `executionId`; no `launchClass`, no `override`, no `capabilityUsed`: the known debt already demonstrated by `test/core-hook/unverified-review-exec.test.js` lines 168 to 195) and one trace row (`source:"exec"`, `routingDecision.kind:"caller_selected"`, `selectedModel` and `effectiveLaunch.model` `gpt-6-luna`, the same `executionId`, `outcome:"completed"`, no directive block, `override:false`, `capabilityUsed:"unknown"`). The P12 decision and its credit are therefore on no row of the run; they are shown by the two prechecks.
  - The two no-model prechecks, both before the launch (`age_gate && pf p12 && pf p12exec`): `pf p12` is the hook path decision (agent `kairo-reviewer`, host claude-code, no model fact); `pf p12exec` is new in `corr.sh` and runs `kairo team route --role Reviewer --launch-protocol kairo.launch-directive/v1 --launch-facts` with the facts exec declares, including the model fact so the representability check runs, with the host variables unset. Both expect row P12, `ROUTED_LINKED`, provisional credit, target codex `gpt-6-luna`, `traceClass` `governed-provisional`.
  - `--verify-provider` is not used: it changes no configuration or authentication file and copies no credential, but it replaces the child environment with a ten-variable allowlist (it can change which credential source Codex finds), starts extra host processes (`codesign`, `scutil --proxy`, `ps`, a Codex app-server loading the real configuration), rewrites the argv with a `--` the code itself calls unproven, and its pinned version is `codex-cli 0.166.0` against the installed 0.167.0, so it would report `version-unpinned` and never credit. The model actually used is observed read-only from the `model` field of the `turn_context` rows of the Codex session file created by the run (new helper `codex_observed_model` in `corr.sh`, printing only that field), from the guard's list of pilot session models, and from a `model:` line of Codex's stderr if it prints one.
  - Applied under this answer: step 5 of `RUNBOOK.md` and `RUN.md` revised (the previous texts kept as `RUNBOOK.before-direct-exec.md` and `RUN.before-direct-exec.md`); `--allowedTools "Agent,Bash"` removed everywhere; P12u and P17 blocks unchanged; step 6.1 expects three model-reaching Claude calls in the log.
  - Expected model-reaching calls of the run: two `claude -p` (P12u and P17; the call log goes from 1 to 3) and one `codex exec`.
  - Still unconfirmed until the run: whether the installed Codex CLI accepts `--model` before `exec`; whether the real Codex `hooks.json` or configuration does anything at session start (not read); the live field names of the trace rows (those of the exec row come from the tests); whether the routing cache holds `gpt-6-luna` as an executable automatic entry (otherwise exec reads the Codex model list through `codex app-server`); what Codex writes to stderr under `exec --json`.
  - Open: the product owner's run of `RUN.md`; then everything listed as open in L64.

- L67 (2026-11-11): decision by the product owner, quoted verbatim in Spanish.

  > ## MA33 — Ejecución del piloto
  >
  > Confirmo el alcance del runbook L66 (`f871cd7cb`). El cambio de P12 para usar directamente `kairo team exec` es aceptable como prueba limitada de Codex.
  >
  > Sin embargo, no tengo acceso a la terminal de tu Mac ni al archivo local `RUN.md` desde esta conversación, por lo que no puedo ejecutar personalmente los seis pasos ni confirmar que sus comandos sean seguros únicamente por la comprobación de sintaxis.
  >
  > ### Cómo ejecutarlo
  >
  > En tu terminal:
  >
  > ```
  > bash
  > less "/Users/kal-el/Desktop/agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma33-contract/RUN.md"
  > ```
  >
  > Ejecuta los bloques uno por uno, respetando las verificaciones previas. Si aparece `STOP`, no repitas el escenario; utiliza el procedimiento de cierre del paso 6.
  >
  > ### Una precisión importante para la aceptación
  >
  > | Escenario           | Qué puede demostrar                               |
  > | ------------------- | ------------------------------------------------- |
  > | P12u                | Lanzamiento real y ausencia de crédito indebido   |
  > | P17                 | Rechazo efectivo sin lanzamiento delegado         |
  > | P12 con `team exec` | Decisión previa P12 y ejecución efectiva en Codex |
  >
  > P12 no puede declararse E2E completo con este procedimiento. La ejecución no registra la directiva ni la clase del ledger, por lo que los chequeos previos y la ejecución no proporcionan una cadena completa de evidencia de crédito.
  >
  > Si Codex ejecuta correctamente, registraría `PASS` para el transporte y `PARTIAL` para la validación integral de P12, hasta contar con evidencia suficiente del contrato.
  >
  > También conservaría como pendientes la redirección real del hook al wrapper y la independencia entre proveedores, porque esta prueba no las ejercita.
  >
  > ### Decisión de cierre
  >
  > Autorizo registrar las salidas reales de los tres escenarios, sin nuevas llamadas de verificación de proveedores, cambios de código, push ni publicación.
  >
  > Después de ejecutar la tarjeta, el siguiente paso es clasificar lo efectivamente demostrado, no volver a extender el piloto. Si sólo quedan limitaciones de observabilidad que no afectan la admisión ni el crédito real, podremos evaluar su aceptación como deuda conocida antes de la beta.

  Status:
  - State when this decision arrived: no step of the execution card had been run (no step output file in the evidence directory, no admission contract file in the scratch home); `release/v0.37.0` at `5a5420a24`, clean, local only; card and runbook as revised in L66.
  - Classification rule fixed by this decision, to be applied after the run and not before: P12u can show a real launch and the absence of undue credit; P17 can show an effective denial with no delegated launch; P12 through `kairo team exec` can show the prior P12 decision (the two no-model prechecks) and an effective execution on Codex. If Codex runs correctly, P12 is recorded as PASS for the transport and PARTIAL for the integral validation of P12, because the exec records neither the directive nor the ledger class, so the chain of credit evidence is incomplete. Two items stay pending whatever the result: the real redirect from the hook to the wrapper, and independence between providers.
  - What the syntax check does and does not establish, as the decision notes: `/bin/bash -n` on the card's blocks and scripts proves only that they parse. The review of what each command writes and where was done separately in the revisions of L65 and L66 (writes confined to the evidence directory and the scratch project and home, the Codex session files the product owner authorized, and the host-written files observed in earlier rounds); neither replaces the stop conditions of the run.
  - After the run: record the real outputs of the three scenarios, classify what was actually demonstrated, do not extend the pilot. No new provider verification calls, no code change, no push, no publication. Limitations of observability that affect neither admission nor real credit may then be evaluated as known debt before the beta.
  - Open: the product owner's run of `RUN.md`; then everything listed as open in L64, under this classification rule.

- L68 (2026-11-11): an instruction by the product owner in his own words and a decision by the product owner, both quoted verbatim in Spanish.

  > correlo tu
  >
  > ## Decisión: `OD-MVP-MA33 — STEP 2.1 APPROVED`
  >
  > Acepto la desviación `STALE` como condición de entorno, no como defecto del candidato, según la evidencia reportada.
  >
  > El contrato permanece inactivo, no hay ejecuciones registradas y las identidades de los cuatro asientos coinciden. Que la caché haya vencido es compatible con su TTL de 30 minutos.
  >
  > Autorizo continuar exclusivamente con el bloque 2.1.
  >
  > En tu terminal interactiva Bash, ejecuta:
  >
  > ```
  > . /Users/kal-el/Desktop/agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma33-contract/env.sh
  > kairo team admission enable --yes --cwd "$P"
  > ```
  >
  > Antes de ejecutarlo, confirma que `$P` sigue apuntando al proyecto temporal y que `kairo` corresponde al binario preparado para el piloto.
  >
  > ### Condiciones de aceptación
  >
  > - Código de salida `0`.
  > - Mensaje `Admission contract enabled for this project`.
  > - Sin advertencias sobre actualización fallida de snapshots de Reviewers.
  > - Ningún cambio inesperado en el entorno productivo.
  >
  > Si cualquiera de estas condiciones falla, detenerse sin reintentar.
  >
  > Después del PASS, el Runner puede continuar con los bloques 2.2–2.4, incluyendo el refresco y la verificación de rutas. No debe lanzar modelos antes de superar esas comprobaciones.
  >
  > No cambia el alcance autorizado de MA33 ni se requieren modificaciones al candidato.
  >
  > Pégame la salida del comando y su código de salida para confirmar el siguiente paso.

  Status:
  - The instruction `correlo tu` (run it yourself) came after the card was declared ready: the orchestrator delegated the blocks to the Test Repro Runner role, one block at a time with the system bash, each block's text unchanged in a file under `run-blocks/` of the evidence directory and its output captured beside it. Block 2.1 stayed with the product owner: `kairo team admission enable --yes` refuses without a terminal on stdin and stdout, and that guard was not simulated.
  - Step 1, run by the Runner, no model reached: block 1.1 as expected (candidate `5a5420a24`, 0 changes; `kairo` resolving to the scratch `bin2` link to the candidate; the Artificial Analysis key and `CODEX_HOME` unset). Block 1.2: admission `inactive`, reason `absent`, `effective:false`, ledger and trace 0 lines, no pending verdicts, as expected; deviation D1: the four seats printed `STALE` instead of `ROUTED`, with the expected roles and models. The Runner stopped. The orchestrator classified D1 as an error of the card's expectation, written against a fresh cache (the routing cache was refreshed in the rebuild and expires after 30 minutes), and the product owner accepted it in this decision as an environment condition. Block 1.3 as expected: real-home snapshot 643 lines, scratch home snapshot 8 files, Codex guard `protected files 36, folders 5, session files 1418`.
  - Block 2.1, run and pasted by the product owner after checking that `$P` was the scratch project and `kairo` the scratch `bin2` binary: `Admission contract enabled for this project (core 5a5420a2448eb4c841a4b18da99c83ed02c226a4, plugin 0.9.1).`, exit 0, no snapshot warning.
  - Blocks 2.2 to 2.4, run by the Runner, no model reached: activate printed `applied:true, effective:true, pendingConsumers:[]`; negotiated status `effective:true`, `state:active`, protocol `kairo.launch-directive/v1`, consumers `hook`, `team-exec`, `service-route`. Refresh: `Routing inputs refreshed.`, network guard `LOADED` and `BLOCKED fetch host=huggingface.co`, cache age 0 minutes, only `claude -p /usage`, `claude auth status`, `claude --version` and `claude auth status --json` on the Claude side, model-reaching call count unchanged at 1, Codex guard `PROTECTED UNCHANGED (36 files, 5 folders)`. Task ids `20261112024540-ma33-p12u-minimal-review-task-f5831a20` and `20261112024541-ma33-p17-minimal-task-e4ec6936`. Precheck P12u PASS: row P12u, action `redirect`, reason `ROUTED_UNVERIFIED_OVERRIDE`, credit selection none and independence none, identity linked and admission-bound, target claude `claude-opus-5-5`, agent `quality-lead`, qualified and eligible `["claude"]`, no exclusion, trace class operational. Precheck P17 PASS: row P17, action `deny`, reason `NO_AUTHORIZED_ROUTE`, credit none, identity linked, no target, qualification state `scorer_failed`, trace class denied, ledger none.
  - The orchestrator stopped there and reported, as this decision ordered, before any model was launched.

- L69 (2026-11-11): decision by the product owner, quoted verbatim in Spanish, and the result of the run it authorized.

  > ## Decisión: `OD-MVP-MA33 — EXECUTION_APPROVED`
  >
  > Autorizo continuar con P12u, P17, P12 y el cierre, sin solicitar confirmación entre cada escenario.
  >
  > Los bloques 2.2–2.4 cumplen las condiciones acordadas:
  >
  > - Contrato activo y efectivo mediante `kairo.launch-directive/v1`.
  > - P12u devuelve `redirect`, sin crédito.
  > - P17 devuelve `deny`, sin crédito.
  > - Caché refrescada y guardas de Codex intactas.
  > - Ningún lanzamiento adicional de modelos.
  >
  > ### Secuencia autorizada
  >
  > | Paso       | Acción                                                           | Condición                                          |
  > | ---------- | ---------------------------------------------------------------- | -------------------------------------------------- |
  > | 3 — P12u   | Lanzar Quality Lead con `claude-opus-5-5`                        | Chequeo previo P12u válido y caché vigente         |
  > | 4 — P17    | Intentar lanzar `kairo-builder`                                  | Debe rechazarse sin ejecutar el agente delegado    |
  > | 5 — P12    | Ejecutar Reviewer con `gpt-6-luna` mediante Codex                | Ambos preflight P12 correctos y guardas protegidas |
  > | 6 — Cierre | Correlacionar evidencia, desactivar contrato y comparar archivos | Obligatorio, incluso si un escenario falla         |
  >
  > ### Reglas de ejecución
  >
  > 1. No detenerse entre escenarios si todos los controles pasan.
  > 2. Si la caché supera el límite permitido, ejecutar únicamente el refresh previsto por el runbook y repetir el chequeo previo.
  > 3. Ante cualquier `STOP`, fallo de guardas, cambio inesperado de modelo o modificación no autorizada, detener los escenarios restantes y pasar al cierre seguro.
  > 4. No repetir llamadas a modelos ni alterar las expectativas para convertir un resultado en PASS.
  > 5. Mantener la rama `release/v0.37.0` congelada.
  >
  > ### Evidencia que debe entregarse
  >
  > Para cada escenario, registrar el modelo realmente ejecutado, `taskId`, `executionId`, directiva, trace, ledger y crédito, distinguiendo los campos ausentes de los valores explícitamente negativos.
  >
  > En P12 se mantiene la limitación acordada: el transporte puede obtener PASS, pero la validación integral queda como máximo en PARTIAL.
  >
  > Autorización final: ejecuta los bloques 3–6 de la tarjeta existente bajo estas condiciones. No hace falta consultarme entre pasos salvo que aparezca una desviación.
  >
  > No se autorizan nuevas sondas de proveedores, instalaciones globales, modificaciones al candidato, push ni publicación.

  Status:
  - Result of the run; no classification of PASS, PARTIAL or FAIL is written here, that is pending the product owner.
  - Block 3.1 (P12u), run once by the Runner: one `claude -p` call, exit 0, cache age 2 minutes, precheck P12u PASS. Stream: the orchestrating model `claude-haiku-5-5` made one Agent call with `subagent_type: quality-lead` and no model; result `is_error:false`, the subagent returned OK.
  - Deviation D2 and stop: the card requires an empty stderr for block 3.1; stderr held one line of 157 bytes, `Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.` The Runner applied rule 3: it stopped the remaining scenarios, ran the evidence block 3.2 (no model) and the closure. Blocks 4.1 (P17) and 5.x (P12) were not run. Observation, not yet a classification accepted by the product owner: the card was written for the product owner's interactive terminal, where stdin is a terminal; the Runner's shell has no terminal on stdin, and the message is the Claude CLI's own notice about that.
  - P12u evidence, as recorded: task id `20261112024540-ma33-p12u-minimal-review-task-f5831a20`; one execution id `4c1d55d5-b3b0-4e72-b3a6-7effee0fd01c` on every trace and ledger row; `taskIdStatus` linked on both. Directive: row P12u, action `redirect`, reason `ROUTED_UNVERIFIED_OVERRIDE`, credit none, class operational, observed in the precheck and on the three trace rows (the directive's own `launchClass` is null on the trace rows). Trace rows hook, observation and outcome: `routingClass` operational, `override` true, `capabilityUsed` unverified, `selectedModel` `claude-opus-5-5`, `routingDecision` null. Ledger launch row: `launchClass` operational, `override` true, `capabilityUsed` unverified, `identityStatus` unverified; ledger outcome row: `launchClass` null, `override` true, `capabilityUsed` unverified, status completed. Task state `WAIT_FOR_TASK_IDENTITY` with reason `no_writers`, review null, not `REVIEWED_PENDING_PROVENANCE`.
  - Model actually executed in P12u: not observed. The trace `effectiveLaunch` says provider claude, model `opus`, evidence `requested`; the ledger says `modelId` `claude-opus-5-5`, `dispatchedModelAlias` `opus`, `identityStatus` unverified; the stream carries assistant messages only from the main thread (`claude-haiku-5-5`) and none from the subagent; no session was persisted. Requested and dispatched model: `claude-opus-5-5`.
  - P17 and P12: not run. The P17 precheck of L68 stands as the only evidence for that row; no P12 task was opened, the owned evidence file was not copied, Codex was not launched.
  - Closure, run: pending verdicts list holds only the P12u quality-lead row; `kairo team admission disable` printed the contract disabled, `INACTIVE OK`, envelope `contract_inactive/disabled`, status equal to the initial one except the reason (absent became disabled); scratch home diff limited to the cache, snapshot, contract, ledger, trace, lock and usage files, with `project-strategy.json` and the entitlement stat unchanged; routes identical in seats and models, status wording STALE at step 1 and ROUTED at closure; Codex guard against the pre-run snapshot `PROTECTED UNCHANGED (36 files, 5 folders)`, 0 new session files; candidate `5a5420a24` with 0 changes.
  - Real-home diff: files under `~/.harness` changed during the run (`codex-models-last-good.json`, `huggingface-leaderboard.json`, the routing input cache and a refresh lock of session `dfd01812152434aa`, the usage samples). The orchestrator checked that session `dfd01812152434aa` is this orchestrator's own project: its launch ledger ends with the `team-builder` launches of this session. Attribution to the orchestrator session's own Kairo hooks, which run on every prompt and agent launch with the real home; it rests on that match, not on an exclusion test.
  - Model-reaching calls of the run: one `claude -p` (P12u); the call log reads 2 with the rebuild call. No `codex exec`.
  - Open, for the product owner: the classification of D2 and of the P12u evidence; whether P17 and P12 are run, which needs block 2.1 again because the contract was disabled at closure. Nothing was rerun and no expectation was changed. Push, global install and publication remain not authorized.

- L70 (2026-11-12): decision by the product owner, quoted verbatim in Spanish.

  > Decisión: OD-MVP-MA33 — RESUME_APPROVED
  >
  > Elijo la opción 1: continuar con el Runner y corregir únicamente la entrada estándar de P17.
  >
  > No vamos a repetir P12u ni reconstruir el entorno. La evidencia obtenida se conserva.
  >
  > Alcance autorizado
  >
  > | Punto | Decisión |
  > | --- | --- |
  > | D2 — Advertencia de stdin | Aceptar provisionalmente como problema de invocación; confirmar con la nueva ejecución |
  > | P12u | Conservar la evidencia existente, sin repetir |
  > | P17 | Agregar < /dev/null a su invocación claude -p |
  > | P12 | Ejecutar el escenario Codex tal como está definido |
  > | Activación | Repetir únicamente el bloque interactivo 2.1 |
  > | Cierre | Ejecutar el paso 6, incluso ante un STOP |
  >
  > Secuencia
  >
  > 1. El Builder modifica exclusivamente la redirección de stdin de P17 en la tarjeta. Verifica sintaxis y que no cambien las demás guardas.
  > 2. Ejecutas nuevamente el bloque 2.1 en tu terminal interactiva.
  > 3. El Runner confirma que el contrato quedó activo y efectivo, refresca las rutas si vencieron y ejecuta los chequeos previos.
  > 4. Continúa con P17 → P12 → cierre, deteniéndose ante cualquier desviación.
  > 5. Registra los resultados reales sin convertir automáticamente ninguna fila en PASS.
  >
  > No autorizo reejecutar P12u, repetir probes de proveedores ni agregar llamadas a modelos fuera de las previstas.
  >
  > Sobre D2
  >
  > El precedente documentado respalda la hipótesis de que claude -p estaba esperando entrada estándar, pero no demuestra que sea la única causa.
  >
  > Si < /dev/null elimina la advertencia y P17 cumple su contrato, clasificaremos D2 como un problema corregido del procedimiento de prueba, no del producto.
  >
  > Si persiste, detenemos el escenario sin nuevos intentos.
  >
  > Criterio de cierre
  >
  > Mantenemos la clasificación previamente acordada:
  >
  > - P12u: sólo con evidencia de lanzamiento y ausencia de crédito indebido.
  > - P17: rechazo efectivo, sin ejecución delegada.
  > - P12 transporte: ejecución Codex con modelo y correlación verificables.
  > - P12 integral: máximo PARTIAL.
  > - Redirección hook e independencia: PENDIENTE.
  >
  > No ejecutar otra suite completa: no hay cambios en el código del candidato 5a5420a24.
  >
  > Esta es la última continuación autorizada del piloto MA33. Después, registramos los resultados obtenidos y decidimos sobre los bloqueantes restantes de la beta.
  >
  > Sin push, instalación global ni publicación.

  Status:
  - State when the decision arrived: the contract is disabled (closure ran at L69), so block 2.1 must be run again by the product owner in an interactive terminal; P12u evidence is kept and not rerun.
  - Authorized card change: only the stdin redirection of P17 (RUN.md block 4.1). RUN.md sha256 before the change: 6b6871668d47fac22f54786516f183668fabbb13ed1075e874aa248fee1d67fe. The change and its checks are recorded with the run result in a later entry.
  - D2 stays provisionally classified as an invocation problem of the test procedure, to be confirmed by the P17 run; if the warning persists the scenario stops with no new attempts.
  - Not authorized: rerunning P12u, repeating provider probes, extra model calls, another full suite, push, global install, publication.
  - This is the last authorized continuation of the MA33 pilot.

- L71 (2026-11-12): decision by the product owner on memory and context optimization, quoted verbatim in Spanish, with the concern that prompted it.

  Concern:

  > Siento que no estamos sacando provecho al 100 de obsidian tampoco, y de todas la aherramientas que tenemos para memoria y contexto, considerarlo dentro de tu última decisión que me diste

  Decision:

  > Decisión actualizada: OD-KAIRO — MEMORY & CONTEXT OPTIMIZATION
  >
  > Incorporo Obsidian y todas nuestras herramientas de memoria y contexto a la estrategia de optimización de Kairo Runtime.
  >
  > Estoy de acuerdo con tu preocupación. Tenemos Engram, Obsidian, CodeGraph, Graphify, Context7 y mecanismos nativos de memoria y compactación de Claude Code y Codex. Sin embargo, todavía no hemos medido si estamos utilizándolos eficientemente, si duplican información o si realmente reducen el consumo de tokens.
  >
  > No quiero que Kairo siga agregando integraciones sin aprovechar correctamente las existentes.
  >
  > 1. Responsabilidad de cada herramienta
  >
  > | Herramienta | Función propuesta dentro de Kairo |
  > | --- | --- |
  > | Engram | Memoria operativa: decisiones recientes, progreso, checkpoints y continuidad entre sesiones |
  > | Obsidian | Base de conocimiento: arquitectura, principios, aprendizajes, documentación consolidada y decisiones históricas |
  > | CodeGraph | Comprensión del código: símbolos, referencias, dependencias e impacto de modificaciones |
  > | Graphify | Relaciones y navegación estructural del conocimiento y los proyectos |
  > | Context7 | Documentación externa actualizada de librerías, frameworks y APIs |
  > | Memoria nativa de Claude/Codex | Continuidad propia de cada host, compactación y contexto activo |
  >
  > Esta es una distribución propuesta, no una descripción de cómo están configuradas actualmente todas las herramientas.
  >
  > Hay una separación importante: Git y los documentos ODD siguen siendo la fuente autoritativa de los contratos y decisiones del proyecto. Obsidian puede organizar y conectar ese conocimiento, pero no debe convertirse en una segunda fuente de verdad que pueda contradecirlo.
  >
  > 2. Cómo deberían colaborar
  >
  >     Orquestador maestro
  >     Identifica qué información necesita la tarea
  >     Recuperación selectiva
  >     Consulta únicamente las fuentes relevantes
  >     Engram
  >     ¿Dónde quedamos?
  >     Obsidian
  >     ¿Qué sabemos?
  >     CodeGraph / Graphify
  >     ¿Qué está relacionado?
  >     Context7
  >     ¿Qué dice la documentación?
  >     Contexto mínimo para el agente
  >     Datos vigentes · Referencias · Evidencia necesaria
  >
  > Esto no significa llamar a las seis herramientas por cada tarea. El orquestador debe consultar sólo las fuentes que realmente aporten información necesaria.
  >
  > 3. El papel que quiero darle a Obsidian
  >
  > Obsidian puede aportar más valor que servir únicamente como repositorio de notas.
  >
  > Quiero evaluar su utilidad como base de conocimiento estructurada y navegable para Kairo:
  >
  > - Decisiones arquitectónicas consolidadas y sus relaciones.
  > - Patrones reutilizables de ingeniería y resultados de investigaciones.
  > - Lecciones aprendidas tras bugs, regresiones y revisiones.
  > - Referencias entre proyectos, componentes y documentación.
  > - Conocimiento que permanece útil después de terminar una sesión.
  >
  > El contenido operativo temporal —como estados Running, cachés de cuotas, trazas y checkpoints frecuentes— debe permanecer fuera de Obsidian salvo que exista una razón concreta para conservarlo.
  >
  > Tampoco debemos copiar automáticamente todas las memorias de Engram a Obsidian. Eso sólo generaría duplicación y desactualización.
  >
  > 4. Auditoría de utilización real
  >
  > Apruebo una evaluación de solo lectura de las herramientas actuales, aplicando nuestra política Reuse First.
  >
  > | Dimensión | Qué debemos medir |
  > | --- | --- |
  > | Utilización | Qué herramientas consultan realmente el orquestador y sus agentes |
  > | Relevancia | Cuánto de lo recuperado ayuda a completar la tarea |
  > | Duplicación | Información repetida entre Engram, Obsidian, instrucciones y compactaciones |
  > | Frescura | Cuándo se actualizó la información y si sigue siendo válida |
  > | Tokens | Contexto añadido por consultas, hooks y recuperación |
  > | Continuidad | Qué información se pierde o se recupera incorrectamente entre sesiones |
  > | Coste operativo | Latencia, errores y llamadas innecesarias a herramientas |
  >
  > El resultado esperado es una matriz de decisiones: KEEP, OPTIMIZE, INTEGRATE, ON_DEMAND o REMOVE, siempre acompañada de evidencia.
  >
  > No se deben eliminar herramientas o memorias existentes únicamente porque aparezcan poco utilizadas durante una sesión.
  >
  > 5. Cómo modifica mi última decisión sobre MA33
  >
  > La autorización para continuar P17 y P12 sigue vigente, sin cambios en el runbook.
  >
  > No vamos a introducir nuevas lecturas de Obsidian, hooks, sincronizaciones o escrituras de memoria dentro del piloto activo. Eso contaminaría las mediciones y retrasaría la validación de gobernanza.
  >
  > Una vez terminado MA33, autorizo realizar el inventario de solo lectura y registrar la propuesta de optimización de memoria y contexto.
  >
  > Para 0.37.0 sólo corregiremos problemas de contexto que demuestren una regresión real del producto. Las nuevas integraciones y la automatización de Compaction Continuity continuarán después de la beta.
  >
  > 6. Objetivo arquitectónico
  >
  > Quiero que Kairo gestione el conocimiento con esta distinción:
  >
  > Memoria operativa: lo que estamos haciendo.
  >
  > Conocimiento persistente: lo que hemos aprendido.
  >
  > Contexto técnico: lo que necesitamos entender del código.
  >
  > Documentación externa: lo que debemos consultar y verificar.
  >
  > Contexto activo: únicamente lo necesario para la tarea actual.
  >
  > Esta separación también debe aplicarse a los agentes delegados: un Builder no necesita cargar toda la historia arquitectónica del proyecto, y un Reviewer no necesita recuperar todo lo que sabe Engram para verificar una modificación puntual.
  >
  > La meta no es utilizar Obsidian, Engram y las demás herramientas en cada ejecución. Es obtener el máximo valor de cada una con el mínimo consumo de contexto, latencia y mantenimiento.
  >
  > Queda incorporado este criterio a la decisión de optimización, sin ampliar el alcance inmediato de la beta 0.37.0.

  Status:
  - Effect on MA33: none. The P17 and P12 authorization of L70 stands with no runbook change; no Obsidian reads, hooks, syncs or memory writes are added inside the active pilot.
  - After MA33 closes: a read-only inventory of the memory and context tools is authorized, under the Reuse First policy, ending in a decision matrix (KEEP, OPTIMIZE, INTEGRATE, ON_DEMAND, REMOVE) with evidence. No tool or memory is removed only for low use in one session.
  - Scope for 0.37.0: only context problems that prove a real product regression. New integrations and Compaction Continuity automation come after the beta.
  - The tool responsibility table is a proposal, not a description of the current configuration. Git and the ODD documents remain the authoritative source; Obsidian must not become a second source of truth.
  - No `S#` and no task is added or reopened by this entry: the inventory is not started yet.

- L72 (2026-11-12): message from the product owner after rerunning block 2.1, quoted verbatim in Spanish, with the terminal output of the block.

  > ## MA33 — Bloque 2.1: PASS
  >
  > La activación fue correcta y coincide con el candidato esperado.
  >
  > Contrato de admisión habilitado
  >
  > PASS
  >
  > | Verificación          | Resultado   |
  > | --------------------- | ----------- |
  > | Mensaje de activación | Correcto    |
  > | Código de salida      | `0`         |
  > | Core                  | `5a5420a24` |
  > | Plugin                | `0.9.1`     |
  >
  > Autorizo al Runner a continuar desde el bloque 2.2, sin repetir la activación.
  >
  > ### Instrucciones para el Runner
  >
  > 1. Comprobar que el contrato esté activo y sea efectivo.
  > 2. Verificar la vigencia de la caché y refrescarla si corresponde.
  > 3. Ejecutar los prechecks de P17 y P12.
  > 4. Si todas las guardas pasan, ejecutar P17 y P12 una sola vez.
  > 5. Ejecutar obligatoriamente el paso 6 para desactivar el contrato y comprobar el aislamiento.
  >
  > No repetir P12u ni realizar nuevas verificaciones de acceso a modelos.
  >
  > ### Precaución por la sincronización de Gentle AI
  >
  > Gentle AI reportó cambios en 62 archivos, incluidos `~/.claude.json`, `~/.claude/settings.json` y `~/.codex/AGENTS.md`.
  >
  > Si esa sincronización ocurrió después de las huellas del bloque 1.3, el Runner debe detenerse y revisar las diferencias antes de ejecutar modelos. Si ocurrió antes, las huellas ya reflejan ese estado y puede continuar.
  >
  > Los archivos SDD retirados se conservaron porque Gentle AI no pudo demostrar que eran de su propiedad. No los borremos ahora; revisaremos después del piloto si generan duplicaciones, conflictos de skills o consumo innecesario de contexto.
  >
  > ### Estado
  >
  > - 2.1: PASS.
  > - 2.2–2.4: pendientes de esta continuación.
  > - P12u: evidencia previa conservada.
  > - P17 y P12: pendientes.
  > - Publicación: no autorizada.
  >
  > Puedes pasar al Runner la salida que acabas de compartir y esta autorización. No necesitas otra confirmación si todas las condiciones del runbook se cumplen.
  >
  > El objetivo sigue siendo terminar MA33 sin alterar el candidato y después evaluar conjuntamente Gentle AI, Obsidian, Engram y las herramientas de contexto.

  Terminal output of block 2.1:

  ```text
  ❯ . /Users/kal-el/Desktop/agentic-harness-worktrees/release-v0.37.0-pilot-evidence/realhost-ma33-contract/env.sh
  kairo team admission enable --yes --cwd "$P"; echo "exit=$?"
  Admission contract enabled for this project (core 5a5420a2448eb4c841a4b18da99c83ed02c226a4, plugin 0.9.1).
  exit=0
  ```

  Status:
  - Card change of L70 done before this message: `RUN.md` line 89 (block 4.1, P17) got the stdin redirection from /dev/null; one line changed, `bash -n` exit 0 on the block, P12u line 71 untouched. sha256 before 6b6871668d47fac22f54786516f183668fabbb13ed1075e874aa248fee1d67fe, after 750ef5da23a0617022b71e13c7c6851f014aaf305388daf98e97eef14f9aacaa; backup `RUN.before-stdin-fix.md`. `RUNBOOK.md` was not changed.
  - The precaution applied: the Gentle AI upgrade and sync ran on 2026-11-12 at about 08:35 to 08:36 local (backups `upgrade-20261112T143540Z` and `20261112143641.449446000`), after the block 1.3 fingerprints of 2026-11-11 20:03 local. The orchestrator stopped before blocks 2.2 to 2.4 and before any model, and reviewed the differences read-only from the sync backup snapshot.
  - Differences against the block 1.3 baseline: `~/.codex/AGENTS.md` 6 lines added and 0 removed; `~/.codex/config.toml` same hash, newer modification time; `~/.claude/CLAUDE.md` the same 6 lines added; `~/.claude/settings.json` 214 raw lines replaced; `~/.config/opencode/opencode.json` 1 line; Codex protected folder listings and the `~/.claude/agents` count unchanged.
  - Also found: rerunning blocks 2.2 to 2.4 as written would overwrite first-run evidence (`step2-*.json`, `codex-guard.post-refresh.*`), and block 2.4 would open new tasks over `p12u-taskid.txt` and `p17-taskid.txt`. Returned to the product owner for a decision.

- L73 (2026-11-12): decision by the product owner, quoted verbatim in Spanish.

  > ## Decisión: `OD-MVP-MA33 — CONTROLLED_REBASELINE_APPROVED`
  >
  > Elijo continuar MA33 con una nueva línea base, conservando intacta la evidencia original. Autorizo registrar la desviación D3 y adaptar exclusivamente las guardas necesarias para continuar el piloto.
  >
  > Sin embargo, hay una condición: antes de lanzar modelos debemos caracterizar los cambios en `~/.claude/settings.json`.
  >
  > No considero pequeño un cambio de 214 líneas que afecta `permissions.deny` cuando todavía desconocemos su efecto.
  >
  > ### 1. Alcance autorizado
  >
  > | Operación                                                 | Decisión      |
  > | --------------------------------------------------------- | ------------- |
  > | Crear huellas `pre-resume`                                | Autorizado    |
  > | Conservar huellas originales `pre-run`                    | Obligatorio   |
  > | Preservar resultados anteriores antes de ejecutar 2.2–2.3 | Obligatorio   |
  > | Ajustar las guardas para comparar con `pre-resume`        | Autorizado    |
  > | Registrar D3 como cambio externo de Gentle AI             | Autorizado    |
  > | Reutilizar los IDs existentes de P17 y P12                | Obligatorio   |
  > | Repetir P12u                                              | No autorizado |
  > | Modificar configuraciones globales                        | No autorizado |
  >
  > ### 2. Comprobación de seguridad previa
  >
  > El Runner debe comparar semánticamente la configuración anterior y la actual, especialmente las reglas `permissions.deny`.
  >
  > Debe determinar:
  >
  > - Qué permisos se agregaron, eliminaron o modificaron.
  > - Si se amplió algún permiso de ejecución, escritura, lectura o acceso a herramientas.
  > - Si los hooks que afectan Claude Code cambiaron.
  > - Si el comportamiento de aislamiento de P17 sigue siendo equivalente.
  >
  > Para Codex, el cambio de seis líneas en `AGENTS.md` puede aceptarse como variación documentada de instrucciones, siempre que no modifique las restricciones del piloto.
  >
  > El cambio de fecha de `config.toml` con hash idéntico no es una modificación de contenido, pero debe documentarse.
  >
  > Si los cambios de permisos no pueden caracterizarse, o comprometen alguna guarda, se detiene la continuación y se ejecuta el cierre seguro del paso 6.
  >
  > ### 3. Continuación autorizada
  >
  > Una vez superada esa comprobación:
  >
  > 1. Crear las nuevas huellas `pre-resume`, sin modificar las anteriores.
  > 2. Conservar copias identificables de las salidas previas.
  > 3. Revalidar que la admisión sigue activa y efectiva.
  > 4. Ejecutar el refresh previsto si la caché está vencida.
  > 5. Ejecutar los prechecks de P17 y los dos prechecks de P12, reutilizando sus tareas originales.
  > 6. Si todos coinciden, ejecutar P17 y P12 una sola vez.
  > 7. Ejecutar el paso 6 y comprobar las diferencias contra ambas líneas base.
  >
  > No se deben sobrescribir `p12u-taskid.txt` ni los resultados originales. Los nuevos archivos de evidencia deben tener nombres que permitan distinguir claramente ambas ejecuciones.
  >
  > ### 4. Clasificación de D3
  >
  > Registrar:
  >
  > `D3 — EXTERNAL_ENVIRONMENT_CHANGE / CONTROLLED_REBASELINE`
  >
  > Esto significa que el piloto continúa con una configuración global distinta de la que existía durante su preparación inicial.
  >
  > No invalida automáticamente las pruebas, pero limita las afirmaciones de reproducibilidad: los resultados posteriores deben asociarse con la nueva línea base.
  >
  > ### 5. Qué no cambia
  >
  > El candidato `5a5420a24` permanece congelado.
  >
  > P12u conserva su evidencia anterior sin reclasificación automática. P17 y P12 siguen pendientes hasta sus ejecuciones reales, y P12 integral permanece limitado a PARTIAL.
  >
  > No autorizo nuevas sondas de proveedores, cambios de código, instalación global, push ni publicación.
  >
  > Instrucción final para el Runner: preparar la nueva línea base y comprobar los cambios de permisos primero. Si no hay riesgos nuevos para el aislamiento, continuar hasta el cierre sin solicitar más confirmaciones. Ante cualquier desviación de seguridad, detener los lanzamientos y desactivar el contrato.
  >
  > Después de MA33 podremos estudiar la sincronización de Gentle AI como parte de la auditoría de herramientas, memoria y contexto, sin mezclar esa investigación con el piloto activo.

  Status:
  - Security check done first, read-only, by the orchestrator. The backup copy of `settings.json` has the block 1.3 hash, so the comparison is complete. The only semantic difference is `permissions.deny`: 24 rules before and after; 10 rules re-anchored from cwd-relative patterns (Read and Edit of `.ssh/*`, `.aws/credentials`, `.config/gh/hosts.yml`, `.credentials/*`, `Library/Keychains/*`) to home-anchored recursive ones (`~/.ssh/**` and the like). `permissions.allow` (4 rules), `defaultMode`, hooks, env and every other key are identical; the 214 raw lines are key reordering. No allow rule was added. The cwd-relative variants are no longer listed; the scratch project holds none of those folders. `~/.claude/hooks` untouched since October.
  - P17 isolation judged equivalent: the first-run P12u call used the same flags (`--setting-sources project,local`); its init event shows `permissionMode` default while the user settings say `bypassPermissions`, and its agent list holds no user-level agents.
  - Other sync effects noted for the later audit: three jd agent files and the agent ownership json changed under `~/.claude/agents`; nine `~/.claude/skills/sdd-*/SKILL.md` files present in the sync backup are no longer present.
  - The first run never opened a P12 task (no `p12-taskid.txt`): only the P17 id can be reused; the resume card opens the P12 task once, as the original card defines.
  - Artifacts written by the Builder, none of them touching first-run evidence: `RUN.resume.md` (19 blocks R0.1 to R6.5, `bash -n` exit 0 on all; every block redirects the evidence variable to the `resume/` subfolder), `no-net.resume.cjs` (copy of `no-net.cjs` with the log path under `resume/`, one line changed), `resume/DEVIATIONS.md` with D3 classified `EXTERNAL_ENVIRONMENT_CHANGE / CONTROLLED_REBASELINE`. `RUN.md` stayed at sha256 750ef5da….

- L74 (2026-11-12): result of the resume run authorized by L73.
  - The Test Repro Runner ran `RUN.resume.md` once. R0.1: snapshot `first-run-2026-11-11/` created, `copies not identical: 0`, P17 task id reused. R0.2: `pre-resume` fingerprints taken; the Codex guard delta against `pre-run` was exactly the two D3 lines and the folder listings were equal; the real-home delta against `pre-run` had 54 lines.
  - STOP at R0.2. The block's EXPECT covered only the Codex guard delta and did not enumerate the real-home delta, so the Runner applied its rule (output not covered by EXPECT means STOP), skipped R0.3 to R5.6 and ran the closure. Cause: a gap in the card written under the orchestrator's specification; the Runner acted as instructed.
  - The 54 lines, classified afterwards by the orchestrator: the `settings.json`, `CLAUDE.md` and `opencode.json` hashes (all in D3), the `~/.claude.json` size and modification time line, 18 `~/.harness` state file lines attributed to the orchestrator session's own hooks, and one item not in D3: the `~/.claude/plugins/known_marketplaces.json` hash changed because the `claude-plugins-official` marketplace `lastUpdated` moved to 2026-11-12T14:52:28Z, during the session. The `pre-resume` baseline already includes that hash.
  - Model-reaching calls of the resume run: 0. The call log still reads 2 (rebuild and P12u). P17 and P12 were not run and stay pending; no row is reclassified.
  - Closure (R6.1 to R6.5): `INACTIVE OK`, envelope `contract_inactive/disabled`, negotiated status equal to the initial one apart from the reason; routes identical to step 1; Codex guard against `pre-resume` `PROTECTED UNCHANGED (36 files, 5 folders)`; against `pre-run` STOP with only the two D3 lines, as expected; `first-run originals changed: 0`; candidate `5a5420a24` with 0 changes.
  - Open, for the product owner: whether a further attempt is authorized. It needs block 2.1 again in an interactive terminal because the contract is disabled, and card changes limited to: accepting the existing snapshot in R0.1, enumerating the documented real-home delta in R0.2, adding the marketplace item to D3, and a separate evidence folder so the closure files of this attempt are not overwritten. Push, global install and publication remain not authorized.

- L75 (2026-11-12): decision by the product owner, quoted verbatim in Spanish.

  > ## Decisión: `OD-KAIRO — ODD MIGRATION & REPOLESS EXECUTION`
  >
  > Confirmo dos cambios importantes en la dirección de Kairo: debemos eliminar la gestión heredada de SDD y permitir trabajar con equipos de agentes sin exigir un repositorio Git.
  >
  > También quiero cerrar el ciclo de reintentos de MA33. Estamos dedicando demasiado tiempo a problemas del procedimiento de prueba.
  >
  > ### 1. SDD queda deprecado; ODD es el flujo vigente
  >
  > No tiene sentido que Kairo continúe regenerando instrucciones SDD si ya adoptamos ODD.
  >
  > Pero hay una distinción importante: el comportamiento observado corresponde al binario instalado `0.16.0`. No podemos asumir que el candidato `0.37.0-beta.1` contiene exactamente la misma configuración sin comprobarlo.
  >
  > Autorizo auditar y corregir el ciclo de vida de SDD en Kairo.
  >
  > | Componente                            | Decisión                                               |
  > | ------------------------------------- | ------------------------------------------------------ |
  > | `sdd-core` con `defaultEnabled: true` | Desactivar como predeterminado                         |
  > | Nuevas instalaciones                  | Utilizar ODD, sin reinstalar componentes SDD retirados |
  > | Instalaciones existentes              | Migración explícita, idempotente y reversible          |
  > | Bloques `harness:managed`             | Regenerar únicamente contenido propiedad de Kairo      |
  > | Skills SDD antiguos                   | Conservar los que no tengan propiedad demostrada       |
  > | 18 copias movidas                     | No eliminarlas ni asumir que se recrearán              |
  >
  > Además, debemos identificar el mecanismo que vuelve a escribir los bloques administrados. Ejecutar cualquier comando de Kairo no debería implicar reescribir instrucciones globales innecesariamente.
  >
  > Esto importa también para M16: cada bloque heredado que se carga en Claude o Codex representa contexto potencialmente desperdiciado.
  >
  > No autorizo limpiar manualmente tus archivos globales ni borrar los SDD antiguos. La corrección debe estar en el producto y su proceso de migración.
  >
  > ## 2. Kairo debe funcionar sin `git init`
  >
  > Apruebo este requisito de producto. Git no debe ser obligatorio para utilizar Kairo o formar un equipo.
  >
  > Hay tres contextos diferentes:
  >
  > | Contexto           | Comportamiento esperado                                                 |
  > | ------------------ | ----------------------------------------------------------------------- |
  > | Repositorio Git    | Gobernanza completa con historial y trazabilidad Git                    |
  > | Directorio sin Git | Equipo y tareas vinculados al directorio, sin exigir inicializar Git    |
  > | Terminal ocasional | Sesión temporal de agentes para consultas, análisis y tareas personales |
  >
  > Por ejemplo, debería ser posible abrir la terminal y solicitar un equipo para investigar algo, analizar documentos o resolver un problema puntual sin crear artificialmente un repositorio.
  >
  > ### Reglas arquitectónicas
  >
  > No propongo crear un segundo orquestador.
  >
  > El router existente debe admitir diferentes scopes de trabajo, preservando las mismas reglas de elegibilidad, revisión y crédito.
  >
  > En un entorno sin Git:
  >
  > - No se debe ejecutar `git init` automáticamente.
  > - La identidad de sesión o directorio debe ser explícita y aislada.
  > - Las operaciones que realmente necesiten commits o diffs Git deben declarar esa dependencia.
  > - No se debe conceder crédito de gobernanza si falta la evidencia requerida.
  > - Un contexto sin repositorio no debe confundirse con un contrato activo de otro proyecto.
  >
  > Actualmente `NO_PROJECT` tiene semántica específica en el protocolo. No autorizo cambiarla globalmente para conseguir este comportamiento. Primero debemos identificar qué funciones dependen realmente de Git y cuáles sólo utilizan Git para reconocer el proyecto.
  >
  > Autorizo el mapeo técnico y una propuesta mínima reutilizando las abstracciones actuales. La implementación de scopes no-Git queda condicionada a demostrar que no rompe la admisión existente. No ampliaré a ciegas el candidato congelado.
  >
  > ## 3. MA33 — No autorizo otro intento del mismo runbook
  >
  > Elijo cerrar esta ronda de MA33 con la evidencia disponible.
  >
  > Hemos tenido varias interrupciones por huellas, cambios ambientales y expectativas excesivamente estrictas. Seguir modificando la tarjeta consume recursos sin aportar evidencia nueva sobre el producto.
  >
  > La clasificación debe quedar así:
  >
  > | Escenario                | Estado                                                         |
  > | ------------------------ | -------------------------------------------------------------- |
  > | P12u                     | Evidencia obtenida; clasificación según resultados registrados |
  > | P17                      | PENDING — no ejecutado                                         |
  > | P12                      | PENDING — no ejecutado                                         |
  > | Integridad y aislamiento | Cierre seguro confirmado                                       |
  > | Contrato                 | Desactivado                                                    |
  >
  > No significa que P17 y P12 estén aprobados, ni autoriza la publicación.
  >
  > Cuando retomemos esas validaciones, quiero un procedimiento nuevo y pequeño que compruebe únicamente las precondiciones necesarias, en vez de bloquearse por cada modificación legítima del HOME.
  >
  > ## 4. Próximas acciones autorizadas
  >
  > MA33 — Registro y cierre de esta ronda
  >
  > Autorizado
  >
  > Registrar las pruebas realizadas, las pendientes y sus limitaciones, sin repetir ejecuciones.
  >
  > SDD → ODD — Auditoría y corrección de defaults
  >
  > Autorizado
  >
  > Comparar el binario instalado con el candidato y corregir únicamente la generación heredada confirmada.
  >
  > Equipos sin Git — Análisis de compatibilidad
  >
  > Autorizado
  >
  > Identificar dependencias Git y diseñar el soporte mínimo de sesiones y directorios.
  >
  > Merge, push, instalación global y publicación
  >
  > No autorizado
  >
  > El análisis debe aplicar nuestra política Reuse First. No quiero implementar un nuevo motor de workspaces, configuración o memoria si podemos extender las capacidades actuales.
  >
  > ### Dirección que quiero preservar
  >
  > Kairo debe ser un sistema de ingeniería agéntica que funcione tanto para construir software como para tareas generales desde una terminal.
  >
  > ODD organiza el trabajo cuando se necesita un proceso estructurado. Git aporta trazabilidad cuando existe un repositorio. Ninguno debería ser una obligación artificial para una consulta o una tarea personal.
  >
  > Y para el release: primero verificamos qué está roto realmente y corregimos lo mínimo. No más suites completas ni extensiones arquitectónicas por cada hallazgo.

  Status:
  - MA33 round closed by the product owner without another attempt of the same runbook. Final state of this round: P12u evidence obtained in the first run (L69), classified by the recorded results, not reclassified here; P17 PENDING, not executed; P12 PENDING, not executed; integrity and isolation: safe closure confirmed twice (L69 and L74); admission contract disabled.
  - Tests performed in this round: the first run through P12u with its stderr stop D2 (L69); the resume run that stopped at R0.2 before any model (L74). Model-reaching calls of the whole round: one `claude -p` (P12u) besides the rebuild call; no `codex exec`.
  - Limits of the evidence: D2 stays provisionally classified as an invocation problem of the test procedure and was not confirmed, because P17 never ran with the stdin redirection; D3 (external environment change by the Gentle AI sync, controlled rebaseline) means any later result belongs to the `pre-resume` baseline; the hook redirect and independence rows stay PENDING; nothing here approves P17 or P12 or authorizes publication.
  - Evidence kept, untouched: the first-run files and their copy `first-run-2026-11-11/` (hash check `first-run originals changed: 0`), `RUN.md`, `RUN.resume.md`, `resume/` with D3 and the closure outputs. Candidate `5a5420a24` with 0 changes.
  - For a later validation of P17 and P12 the product owner asks for a new, small procedure that checks only the needed preconditions instead of blocking on every legitimate change of the home directory.
  - New work authorized by this decision and not started in this entry: the audit and correction of the SDD lifecycle defaults, and the compatibility analysis for teams without Git. Verification note by the orchestrator: the first `kairo` on PATH reports version 0.36.0, not the 0.16.0 named in the decision; the audit resolves which build wrote the observed SDD blocks.
  - Merge, push, global install and publication remain not authorized.

- L76 (2026-11-12): decision by the product owner, quoted verbatim in Spanish.

  > ## Decisión: `OD-KAIRO-RELEASE — ACCEPTANCE_CONSOLIDATION_APPROVED`
  >
  > Sí. Autorizo incorporar el borrador del 11 de noviembre al reporte de aceptación, pero como una consolidación histórica, no como un reemplazo completo.
  >
  > El objetivo es que `odd/release/v0.37.0-acceptance.md` sea nuestra fuente única de verdad para decidir la publicación de `0.37.0-beta.1`.
  >
  > ### 1. Cómo consolidar el reporte
  >
  > - Conservar íntegra la sección 11 actual, que documenta la integración SDD y las suites sobre `170f7084f`.
  > - Integrar las evidencias faltantes del borrador: candidato `5a5420a24`, pilotos reales, MA33 y decisiones posteriores.
  > - Renumerar secciones sin duplicaciones, respetando la cronología.
  > - Distinguir claramente los candidatos históricos del candidato vigente.
  > - Registrar resultados observados, limitaciones y escenarios pendientes sin convertirlos automáticamente en PASS.
  > - Mantener referencias a archivos de evidencia y commits para facilitar la auditoría.
  >
  > No quiero un documento que acumule decisiones contradictorias. Quiero una reconstrucción verificable del estado de aceptación.
  >
  > ### 2. Clasificación inicial de los siete hallazgos
  >
  > | # | Hallazgo                                             | Clasificación                                                                              |
  > | - | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
  > | 1 | Fallos en suite paralela                             | Deuda de fiabilidad. La suite serial pasó; investigar después salvo reproducción funcional |
  > | 2 | `sync --dry-run` no anuncia reparaciones             | Riesgo de confianza operativa. Evaluar como posible bloqueante de beta                     |
  > | 3 | `components verify` retorna 0 con archivos faltantes | Defecto de semántica de verificación. Evaluar como posible bloqueante                      |
  > | 4 | Binarios antiguos reinstalan SDD                     | Riesgo de coexistencia de versiones. Requiere advertencia y procedimiento de migración     |
  > | 5 | Conflicto de skill editado sin diagnóstico           | Posible bloqueante por fallo silencioso                                                    |
  > | 6 | Escritura de estado no atómica                       | Riesgo de integridad. Prioridad alta para evaluar impacto real                             |
  > | 7 | `no_project` recomienda repetir el comando fallido   | Defecto de experiencia de usuario; deuda aceptable en beta si no oculta otra causa         |
  >
  > Esta clasificación no autoriza siete correcciones nuevas. Primero necesitamos determinar cuáles afectan realmente la seguridad, integridad o funcionalidad anunciada en la beta.
  >
  > En particular, el punto 6 merece atención: que un escritor no sea atómico no demuestra por sí solo corrupción real, pero tampoco podemos descartarlo sin evaluar sus mecanismos de recuperación.
  >
  > ### 3. Estado del candidato
  >
  > Candidato integrado
  >
  > Validación serial PASS
  >
  > `170f7084f75e2830ad88a45e98dba0bf3e3b417c`
  >
  > Suite serial
  >
  > ## 5627 / 5627
  >
  > Piloto SDD
  >
  > ## 9 escenarios
  >
  > La suite paralela sigue registrada como FAIL y los escenarios E2E P17/P12 permanecen pendientes. La beta aún no está aprobada para publicación.
  >
  > ### 4. Qué sigue después del reporte
  >
  > Mi prioridad es cerrar tres asuntos concretos:
  >
  > 1. Gobernanza: conseguir evidencia E2E de P17 y P12 mediante un procedimiento mínimo, sin repetir los problemas del runbook anterior.
  > 2. Integridad y seguridad: decidir con evidencia si los hallazgos 2, 3, 5 y 6 impiden una beta pública.
  > 3. Distribución: validar la instalación real desde el paquete y los mecanismos de actualización, sin tocar todavía tu instalación global.
  >
  > El inventario de Obsidian, Engram y las demás herramientas sigue autorizado como auditoría independiente, pero no debe bloquear esta publicación.
  >
  > ### Autorización final
  >
  > Procede con la consolidación del reporte, la corrección de su numeración y el registro de los siete hallazgos.
  >
  > No modificar código, no ejecutar nuevas suites ni cambiar el tarball por esta tarea documental. Después del cambio, verificar que el candidato sigue siendo el mismo y que ningún archivo empaquetado cambió.
  >
  > Sin push, instalación global ni publicación.
  >
  > La siguiente decisión será sobre los bloqueantes reales de la beta, no sobre nuevas funcionalidades.

  Status:
  - Consolidation done in the release branch `release/v0.37.0`, commit `0b5dac21e` (`docs(release): consolidate the acceptance report with the 5a5420a24 record, the MA33 round and the findings classification`); it changes only `odd/release/v0.37.0-acceptance.md`.
  - New section map of the report (old to new): sections 1 to 10 keep their numbers and carry dated update notes; the former section 11 (SDD retirement integration, 170f7084f) is now section 13, content intact except the renumbering of its subsections (11.x became 13.x) and one added sentence, `Classified in section 14.`; new section 11 (real-host pilot and governance batch, candidate 5a5420a24, from the draft of 2026-11-11); new section 12 (MA33 real-contract pilot: runs, stops and closure of the round, with the record discrepancies); new section 14 (the seven findings and their initial classification). The head of the report adds the current candidate, the table of candidates in order and the acceptance state of 2026-11-12.
  - Candidate unchanged: `170f7084f75e2830ad88a45e98dba0bf3e3b417c`. `git diff --stat 170f7084f..HEAD -- src global-template bin scripts docs prompts repo-template package.json test integrations` prints nothing, `git diff --name-only 170f7084f..HEAD` lists only `odd/release/v0.37.0-acceptance.md` and `odd/tasks/sdd-retirement.md`, and the stored tarball still measures 1186649 bytes with SHA-256 8c315801e72a5658e7afeae21d2ab4a75f0f43519df98a4e1826fd50cd58f173. No packed file changed; no test, `npm pack` or `kairo` command was run for this task.
  - The SDD integration decisions are quoted in `odd/tasks/sdd-retirement.md` on `release/v0.37.0` (L12, L15, L16).
  - Nothing pushed, published or installed globally. The findings are classified as the product owner wrote, none is marked fixed and none as a confirmed blocker; P17 and P12 stay PENDING.

- L77 (2026-11-12): decision by the product owner, quoted verbatim in Spanish.

  > ## Decisión: `OD-KAIRO-RELEASE — BLOCKER_TRIAGE_APPROVED`
  >
  > Sí. Autorizo comenzar con la evaluación basada en evidencia de los hallazgos 2, 3, 5 y 6.
  >
  > La consolidación del reporte queda aceptada como tarea documental, con las discrepancias y limitaciones registradas. El candidato `170f7084f` permanece congelado.
  >
  > Nuestro siguiente objetivo es determinar qué defectos realmente impiden publicar `0.37.0-beta.1`, sin iniciar otra ronda de desarrollo innecesaria.
  >
  > ## 1. Orden de evaluación
  >
  > | Orden | Hallazgo                                                    | Riesgo principal                                | Qué verificar                                                               |
  > | ----- | ----------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
  > | 1     | #6 — Estado no atómico                                      | Corrupción o pérdida de configuración           | Qué ocurre si se interrumpe una escritura y si existe recuperación          |
  > | 2     | #5 — Conflicto silencioso al instalar SDD                   | Modificación inesperada de archivos del usuario | Si preserva el archivo, lo sobrescribe o genera un estado inconsistente     |
  > | 3     | #3 — `components verify` retorna `0` con archivos faltantes | Falso resultado de verificación                 | Contrato del comando, exit code y consecuencias para automatizaciones       |
  > | 4     | #2 — `sync --dry-run` no anuncia reparaciones               | Vista previa engañosa                           | Diferencias entre las operaciones anunciadas y los efectos reales de `sync` |
  >
  > La clasificación definitiva será `BLOCKER`, `KNOWN_DEBT` o `NOT_A_DEFECT`, según la evidencia.
  >
  > ## 2. Condiciones de investigación
  >
  > Autorizo exclusivamente:
  >
  > - Inspección de código y contratos existentes.
  > - Reproducciones aisladas con `HOME` temporal.
  > - Pruebas focalizadas y simulaciones de fallos cuando puedan ejecutarse con seguridad.
  > - Comparación entre los resultados esperados y los observados.
  > - Revisión del comportamiento utilizando el candidato actual, no los binarios globales antiguos.
  >
  > No autorizo implementar correcciones todavía.
  >
  > Especialmente para el hallazgo #6, no basta con confirmar que se utiliza `writeFile` en lugar de una escritura atómica. Debemos determinar qué estado puede perderse, si existe respaldo o recuperación y si alguna operación crítica puede quedar parcialmente aplicada.
  >
  > Para #5, debemos distinguir entre un conflicto silenciado que conserva correctamente el archivo y uno que puede sobrescribir o perder información del usuario.
  >
  > ## 3. Criterios de bloqueo
  >
  > | Clasificación  | Criterio                                                                                                                          |
  > | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
  > | `BLOCKER`      | Pérdida de datos, modificación no autorizada, corrupción persistente o ruptura de una garantía esencial de seguridad o gobernanza |
  > | `KNOWN_DEBT`   | Defecto reproducible con impacto limitado, comportamiento documentable y sin consecuencias críticas                               |
  > | `NOT_A_DEFECT` | Comportamiento consistente con un contrato válido y verificable                                                                   |
  >
  > Un defecto de exit code o de vista previa también puede ser bloqueante cuando permite que automatizaciones continúen equivocadamente y provoquen consecuencias relevantes.
  >
  > No debemos confundir gravedad teórica con impacto demostrado.
  >
  > ## 4. Entregable requerido
  >
  > Quiero un informe corto por hallazgo que incluya:
  >
  > 1. Comportamiento esperado y comportamiento observado.
  > 2. Reproducción y evidencia verificable.
  > 3. Impacto real y alcance.
  > 4. Clasificación propuesta con justificación.
  > 5. Corrección mínima, únicamente si resulta necesaria.
  >
  > Después decidiré cuáles correcciones autorizar y cuáles podemos documentar para la beta.
  >
  > ## 5. Lo que permanece pendiente
  >
  > Después de esta evaluación, seguimos teniendo dos gates principales: evidencia E2E de P17/P12 y validación de distribución desde el paquete publicado o candidato instalable.
  >
  > La revisión histórica de la sección 11 y D14 continúa pendiente. No debemos usar afirmaciones no verificadas del borrador como evidencia para aprobar un gate.
  >
  > Autorización final: iniciar ahora el triage de los cuatro hallazgos, sin cambiar el candidato, sin suites completas y sin modificar la instalación personal.
  >
  > Quiero que esta evaluación termine en decisiones de publicación, no en otra lista indefinida de tareas.

  Status:
  - The triage of findings 6, 5, 3 and 2 was done read-only on candidate `170f7084f` by two independent verifiers with temporary homes.
  - Proposed classifications: known debt for 6 and 5; not a defect for 3, because the command already exits 1 when its result is not ok and the earlier observation was a misreading; known debt for 2.
  - A new finding 8 appeared: a plain `install` or `setup` over an install with `sdd-core` silently deselected it, a regression of the default change.
  - The final classification and fix scope came in the next decision, quoted as L1 of `odd/tasks/beta-defect-fixes.md` on `release/v0.37.0`.

- L78 (2026-11-12): diagnosis and decision by the product owner on multi-provider execution, quoted verbatim in Spanish.

  > ## Diagnóstico: Kairo todavía no ha demostrado una orquestación multiproveedor equilibrada
  >
  > Tu preocupación está justificada. Hemos dedicado mucho esfuerzo a construir el router, las reglas de gobernanza y la selección de modelos, pero todavía no tenemos evidencia suficiente de que Claude y Codex estén recibiendo trabajo de forma adaptativa, eficiente y equilibrada.
  >
  > ### 1. ¿Por qué parece que sólo trabaja Claude?
  >
  > [程序员大喜 Claude最强编程模型开放1M上下文：加量还不加价--快科技--科技改变未来](https://images.openai.com/static-rsc-4/VGXCgBV1evj8mzt5IROTMQnqvL-pUqFzH-9DbJ_o2wtwl7DOfer2BoZn_AzFJavRix7HXKg2FLiUKsvK36OjYESehY4thomZ8AXEF6TeCksbKu2OOjs2bggsBO4TUscuME2Ro4m_yuTYtgtFCAE8UEvsLv8TNj3SPhn95HkK7wE?purpose=inline)
  >
  > Claude Code — Host principal
  >
  > La captura identifica Claude Code v2.1.322 y Fable 5.2 como modelo de la sesión principal.
  >
  > Kairo Runtime — Enrutamiento y gobernanza
  >
  > Debería decidir qué proveedor recibe cada tarea delegable según capacidad, disponibilidad, políticas y presupuesto.
  >
  > Codex CLI — Segundo proveedor
  >
  > Puede ejecutar tareas delegadas, pero necesita una ruta efectiva desde Kairo. Tener Codex instalado no implica que participe automáticamente.
  >
  > La pantalla que muestras no prueba que Codex esté inactivo. Sólo muestra qué modelo ejecuta la sesión principal. Tampoco demuestra que las delegaciones a Codex estén ocurriendo.
  >
  > Hay otra distinción importante:
  >
  > - `Verbose output: false` controla la verbosidad mostrada.
  > - `Output style: Concise` afecta el estilo de las respuestas.
  > - Ninguna de esas opciones garantiza ahorro de tokens, reparto entre proveedores ni reducción del contexto cargado.
  >
  > En tus registros sí hay una señal preocupante: varios Builders y Reviewers han ejecutado trabajo dentro de Claude, mientras las validaciones reales con Codex han quedado pendientes o se han detenido por restricciones del entorno.
  >
  > Eso no demuestra que el router esté roto, pero sí evidencia una brecha entre la arquitectura diseñada y su utilización observada.
  >
  > ## 2. Revisé `session-lens`: sí nos puede ayudar
  >
  > [Mission Control — Open-Source AI Agent Orchestration Dashboard](https://images.openai.com/static-rsc-4/NjIfj5BOZmtD0G7kEtq6WMrcQQJ1MIBfbY36VvzISEs-v2LxRYr1W_XsJOima0ZzoLccPdIOTinmSZX6w2M1XBKr9rsLbR8KPPcFdAbG9BAwBZHLPejy293Pzf_zTTSjIGR4QAQ4vYYZgp0_iYDsE7aNGtsto2zKZwtiVay9IHI?purpose=inline)
  >
  > [neokn/session-lens](https://github.com/neokn/session-lens?utm_source=chatgpt.com)
  >
  > Plugin de observabilidad para Claude Code. Permite analizar consumo de contexto, tokens, caché, compactaciones, llamadas a herramientas y subagentes.
  >
  > Repositorio MIT · Requisitos declarados: Claude Code 2.1.308+, jq y, para seguimiento de procesos hijos en macOS, Python 3 compatible.
  >
  > Tu Claude Code 2.1.322 cumple el requisito de versión indicado en su README.
  >
  > | Capacidad                                      | ¿Nos aporta valor? |
  > | ---------------------------------------------- | ------------------ |
  > | Tokens por agente y modelo                     | Sí                 |
  > | Identificación de contexto excesivo            | Sí                 |
  > | Consumo de MCP, skills y herramientas          | Sí                 |
  > | Compactaciones y contenido recuperado          | Sí                 |
  > | Procesos hijos `claude -p`                     | Sí                 |
  > | Ejecuciones internas de Codex                  | No directamente    |
  > | Cuotas reales de suscripción de Claude/Codex   | No                 |
  > | Decidir automáticamente qué proveedor ejecutar | No                 |
  >
  > Su estimación monetaria utiliza precios de referencia de tokens; no representa necesariamente el consumo de tus cuotas de suscripción.
  >
  > Decisión: aprobar una evaluación aislada de `session-lens`, no instalarlo todavía en tu configuración global ni integrarlo en Kairo. Su instalación también involucra el plugin `session-report`, por lo que primero hay que revisar las modificaciones y el coste de observación.
  >
  > Podemos reutilizar sus ideas y su enfoque de instrumentación sin duplicar el producto.
  >
  > ## 3. El problema arquitectónico que debemos investigar
  >
  > Veo cuatro puntos que necesitan evidencia.
  >
  > | Componente          | Posible problema                                                                     | Comportamiento que queremos                      |
  > | ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
  > | Master Orchestrator | Delega directamente a subagentes Claude sin pasar por Kairo                          | Toda delegación gobernada atraviesa el router    |
  > | Router              | Reconoce Codex, pero podría descartarlo por elegibilidad, cuota o falta de evidencia | Explica por qué acepta o rechaza cada proveedor  |
  > | Ejecutor            | La ruta selecciona Codex, pero el lanzamiento real no ocurre                         | Ejecuta y confirma proveedor/modelo efectivos    |
  > | Telemetría          | Cuenta tareas y modelos, pero no acredita cuotas y consumo de manera comparable      | Registra utilización y presión de cada proveedor |
  >
  > La diferencia central es:
  >
  > Seleccionar Codex en una ruta no equivale a haber ejecutado Codex.
  >
  > Y un Builder que corre como subagente nativo de Claude no demuestra que Kairo haya realizado una delegación multiproveedor.
  >
  > ## 4. Cómo debería funcionar nuestro equilibrio
  >
  > No quiero establecer porcentajes como 50 % Claude / 50 % Codex. Eso contradice las decisiones de asignación dinámica que ya tomamos.
  >
  > Propongo que Kairo aplique esta secuencia:
  >
  > Tarea + contrato + riesgo
  >
  > Claude
  >
  > Capacidad · Acceso · Cuota · Carga
  >
  > Codex
  >
  > Capacidad · Acceso · Cuota · Carga
  >
  > Elegir proveedor elegible con mejor disponibilidad y adecuación
  >
  > Sin porcentajes fijos; con evidencia y degradación controlada
  >
  > Ejecución comprobada + ledger
  >
  > Proveedor real · Tokens · Resultado · Consumo de cuota disponible
  >
  > Aquí deben medirse por separado tres conceptos:
  >
  > Tokens: recursos utilizados por el modelo, incluyendo caché cuando esté disponible.
  >
  > Cuota: capacidad restante de la suscripción, que puede tener ventanas y límites distintos y no equivale directamente a tokens.
  >
  > Equidad: evitar saturar sistemáticamente un proveedor cuando existe otro elegible, con capacidad suficiente y rendimiento adecuado.
  >
  > Cuando no podamos obtener una cuota fiable, Kairo debe registrar `unknown`, no inventar un porcentaje. El balanceo puede utilizar señales indirectas identificadas como estimaciones, pero nunca convertirlas en evidencia verificada.
  >
  > ## 5. Decisión sobre el release
  >
  > ### `OD-KAIRO — MULTIPROVIDER_EXECUTION_AUDIT`
  >
  > Autorizo una auditoría focalizada de ejecución multiproveedor como gate del MVP, no como nueva funcionalidad.
  >
  > Primero, inspeccionar sin llamadas a modelos las delegaciones recientes, las rutas seleccionadas y los ejecutores reales. En particular, revisar por qué el Builder actual se lanzó en Claude y si pasó por la admisión de Kairo.
  >
  > El registro mínimo por tarea debe permitir responder:
  >
  > ```
  > {
  >   "taskId": "...",
  >   "role": "Builder",
  >   "selectedProvider": "codex",
  >   "selectedModel": "...",
  >   "selectionReason": "...",
  >   "executedProvider": "codex",
  >   "executedModel": "...",
  >   "executionId": "...",
  >   "tokenUsage": {
  >     "input": null,
  >     "output": null,
  >     "source": "unknown"
  >   },
  >   "quota": {
  >     "remaining": null,
  >     "source": "unknown"
  >   },
  >   "result": "completed"
  > }
  > ```
  >
  > Ejemplo del contrato de observabilidad deseado; no afirmo que Kairo ya emita este registro.
  >
  > Después de cerrar los hallazgos #8, #2 y #5, verificar una ejecución controlada de un Builder en Codex con revisión independiente en Claude, aprovechando los mecanismos existentes. Los escenarios P17 y P12 siguen siendo obligatorios para la admisión.
  >
  > No autorizo construir un nuevo router, otro dashboard ni una capa de orquestación propia.
  >
  > ## 6. Respecto al Builder que está trabajando ahora
  >
  > Puede terminar las correcciones ya asignadas. El cambio de `applyCommandPolicy` merece revisión porque afecta código compartido, aunque las pruebas hayan pasado.
  >
  > Pero no consideraremos una revisión de Codex como ejecución real si sólo hubo análisis estático o el sandbox impidió ejecutar.
  >
  > El siguiente resultado del Builder debe incluir, además de las pruebas funcionales, la evidencia de qué proveedor escribió el código y cuál lo revisó.
  >
  > ### Conclusión
  >
  > Mi prioridad cambia en un punto: no aprobaré la beta como sistema de orquestación multiproveedor adaptativa sólo porque las pruebas unitarias estén verdes.
  >
  > El producto debe demostrar al menos que selecciona, ejecuta y verifica correctamente tareas entre Claude y Codex. El balanceo avanzado de cuotas puede quedar en evolución si sus límites están documentados, pero no podemos anunciar optimización y equilibrio automáticos sin mediciones.
  >
  > `session-lens` puede ayudarnos a descubrir dónde se desperdician tokens dentro de Claude. Kairo, en cambio, debe ser quien nos permita comprobar cómo se utiliza todo el conjunto de proveedores.
  >
  > Eso es lo que necesitamos validar antes de salir a producción.

  Status:
  - First audit pass by the orchestrator, read only and without model calls, from the launch ledger of its own session, which runs the installed build 0.36.0 with router plugin 0.7.5 and not the candidate: 31 launches, 26 on Claude and 5 on Codex.
  - Cause: the orchestrator put the no-redirect marker on its writer, verifier and runner launches, which bypasses the router; launches without the marker were routed to Codex and completed there. No launch passed the admission contract, which exists only in the candidate.
  - Telemetry gaps: `team-verifier` launches absent from the ledger; no routing trace rows for Claude launches; verdict rows for `team-test-runner` on Codex models without matching launch rows; launch rows without selection reason, selected versus executed provider, tokens or quota.
  - The evaluation of `session-lens` was not started and nothing was installed.

- L79 (2026-11-12): decision by the product owner on dynamic cells and resource governance, with the authorization of one isolated test run, quoted verbatim in Spanish.

  > ## Esto confirma el problema de fondo de la orquestación de Kairo
  >
  > `OD-KAIRO — DYNAMIC_CELLS_RESOURCE_GOVERNANCE`
  >
  > Deficiencia operativa
  >
  > La captura muestra un solo `team-builder` trabajando durante casi 50 minutos, con un contador de 196.5k tokens.
  >
  > El problema no es que una tarea compleja dure 50 minutos. El problema es cómo el Master Orchestrator decidió ejecutarla.
  >
  > Al revisar la delegación, encuentro cuatro deficiencias:
  >
  > 1. Bypass explícito: `[no-redirect]` impidió que Kairo decidiera qué proveedor utilizar.
  > 2. Trabajo demasiado grande: asignó al mismo Builder el asistente de setup, los planes de sincronización, los conflictos, las salidas CLI, las pruebas y la documentación.
  > 3. Sin control de presupuesto observable: no vemos una decisión de continuar, dividir, transferir o escalar cuando creció el trabajo.
  > 4. Sin células efectivas: el Master utilizó un agente como ejecutor generalista en lugar de coordinar especialistas.
  >
  > La instrucción `Polling sync-sdd-plan-output test results` también sugiere que parte del tiempo podía estar dedicado a esperar pruebas. La captura por sí sola no permite determinar cuánto tiempo o cuántos tokens se desperdiciaron.
  >
  > ## Cómo tendría que haberse organizado esta tarea
  >
  > Master Orchestrator
  >
  > Coordina, supervisa presupuestos y gestiona dependencias; no implementa
  >
  > Célula A — Setup
  >
  > Builder: Sol / Sonnet
  >
  > Selección guardada y wizard
  >
  > Célula B — Sync
  >
  > Builder: Sonnet / Terra
  >
  > Dry-run y conflictos
  >
  > Célula C — Calidad
  >
  > Tester: Luna / Haiku
  >
  > Pruebas independientes
  >
  > Célula D — Revisión
  >
  > Reviewer del proveedor contrario
  >
  > Contratos y regresiones
  >
  > Integración y validación final
  >
  > Evidencia consolidada, sin volver a ejecutar todo innecesariamente
  >
  > Los modelos son candidatos ilustrativos, no asignaciones obligatorias. Las células A y B podrían trabajar en paralelo sólo con superficies de edición aisladas; calidad y revisión pueden incorporarse cuando exista evidencia que revisar.
  >
  > El Master debe pedir una capacidad, no imponer el modelo con el que se ejecutará cada tarea.
  >
  > ## Reglas que debemos exigir a Kairo
  >
  > | Regla                | Comportamiento obligatorio                                                     |
  > | -------------------- | ------------------------------------------------------------------------------ |
  > | Asignación dinámica  | Elegir modelos elegibles según tarea, disponibilidad y salud del ejecutor      |
  > | Control del contexto | Detectar crecimiento anormal y preparar checkpoints recuperables               |
  > | Balance de cuotas    | Considerar presión de uso por proveedor sin porcentajes fijos                  |
  > | Descomposición       | Dividir unidades independientes antes de saturar un solo Builder               |
  > | Fallback             | Recuperarse de fallos de transporte sin ignorar las restricciones de seguridad |
  > | Bypass controlado    | Registrar justificación y alcance de cada `[no-redirect]`                      |
  > | Revisión cruzada     | Verificar trabajo con proveedor distinto al implementador                      |
  > | Telemetría           | Medir modelo ejecutado, duración, tokens disponibles, cuota y resultado        |
  >
  > Me interesa especialmente el punto de los checkpoints. No quiero que un Builder tenga que reconstruir 40 minutos de contexto cuando puede entregar un resultado parcial verificable y transferir el trabajo a otro agente.
  >
  > Tampoco quiero imponer un corte arbitrario a los 15 o 20 minutos. Ese tiempo puede activar una evaluación, pero no debe cancelar una ejecución saludable.
  >
  > ## Sobre los resultados del agente: ya terminó
  >
  > En el registro que adjuntaste aparece que el Builder completó las correcciones, se integraron localmente y se generó un nuevo candidato:
  >
  > | Elemento                 | Estado reportado       |
  > | ------------------------ | ---------------------- |
  > | Candidato                | `6259456e4`            |
  > | Correcciones #8, #2 y #5 | Integradas             |
  > | Pruebas focalizadas      | PASS                   |
  > | Suite serial             | 5679/5684 — FAIL       |
  > | Tarball                  | Generado, 761 archivos |
  > | Push/publicación         | No realizados          |
  >
  > Las cinco fallas se concentran en `test/install-write-failure.test.js`, y existe evidencia de que las pruebas dependen accidentalmente de una consulta al registro npm. Eso apunta a una posible causa ambiental, pero todavía no está demostrado.
  >
  > ### Decisión sobre la prueba pendiente
  >
  > Autorizo una sola ejecución aislada de `test/install-write-failure.test.js` sobre `6259456e4`, con conectividad disponible y registro completo del resultado.
  >
  > Condiciones:
  >
  > - No repetir la suite completa.
  > - No modificar el código para que las pruebas pasen artificialmente.
  > - No ejecutar otros agentes ni nuevas sondas de modelos durante la comprobación.
  > - Si pasa, registrar que las cinco pruebas pasan aisladamente y que la suite serial original continúa formalmente en FAIL.
  > - Si falla, investigar la causa reproducible antes de autorizar correcciones adicionales.
  >
  > No es válido combinar dos corridas distintas y declarar que hubo una suite completa de 5684/5684.
  >
  > ## Qué cambia en nuestra siguiente evaluación de Kairo
  >
  > La ejecución de Sonnet demuestra que tener células definidas no basta si el Master puede ignorarlas rutinariamente.
  >
  > Por eso, después del gate actual, priorizo verificar la cadena completa:
  >
  > Solicitud de tarea → formación de célula → selección de modelo → ejecución efectiva → evaluación de recursos → revisión cruzada.
  >
  > Esa cadena debe funcionar con el host que el usuario elija y con las suscripciones disponibles, sin depender de Claude Max, de un plan específico de Codex ni de APIs de pago por tokens.
  >
  > No autorizo implementar otro sistema de orquestación en este momento. Primero debemos determinar exactamente dónde se rompe esa cadena en el candidato actual.
  >
  > El objetivo de Kairo no es que Sonnet, Sol o Fable sean capaces de hacer todo. Es que el sistema sepa cuándo aprovechar cada uno, cuándo trabajar en paralelo, cuándo conservar capacidad y cuándo reorganizar una célula automáticamente.
  >
  > Ahí es donde tiene sentido toda la arquitectura que hemos construido.

  Status:
  - The orchestrator accepted the four deficiencies as its own choices in this session and changed its practice: no bypass marker by default, a justification and scope stated for any bypass, work split into units with separate edit surfaces, tests and review as separate cells.
  - The isolated run of `test/install-write-failure.test.js` on candidate `6259456e4` at 2026-11-12T22:19:10Z gave 16 tests, 16 pass, exit 0, with the registry reachable before and after and no fetch failed in the log.
  - The serial gate on `6259456e4`, 5679 of 5684 with exit 1, stays formally FAIL and the two runs are not combined.
  - That single run used one bypass marker with its justification recorded in the launch: the Codex sandbox had refused to create temporary directories twice that day.
  - The first documentation task after this decision was launched without the marker, one unit to the Codex writer and one through the router.

- L80 (2026-11-12): decision by the product owner authorizing one controlled final end-to-end round for P17 and P12 on candidate `6259456e4`, quoted verbatim in Spanish.

  > ## Decisión: `OD-KAIRO-MA33 — FINAL_E2E_AUTHORIZATION`
  >
  > Autorizo ejecutar P17 y P12 con el candidato actualizado `6259456e4`, mediante una única ronda controlada con Claude Code y Codex CLI reales.
  >
  > La autorización es para utilizar las sesiones autenticadas de ambos proveedores en tu Mac, no para habilitar permanentemente la admisión en tu HOME personal.
  >
  > ### 1. Condiciones de autorización
  >
  > | Elemento                               | Decisión                    |
  > | -------------------------------------- | --------------------------- |
  > | Candidato                              | `6259456e4`                 |
  > | Protocolo                              | `kairo.launch-directive/v1` |
  > | Proyecto y HOME temporales             | Obligatorios                |
  > | Credenciales de suscripción existentes | Uso permitido               |
  > | Configuración global                   | Sin modificaciones          |
  > | P12u                                   | No repetir                  |
  > | P17                                    | Una ejecución controlada    |
  > | P12                                    | Una ejecución controlada    |
  > | Reintentos de modelos                  | No autorizados              |
  > | Push y publicación                     | No autorizados              |
  >
  > Primero debe terminar el smoke test de distribución. No queremos procesos simultáneos interfiriendo con el piloto.
  >
  > ### 2. Nuevo procedimiento mínimo
  >
  > No reutilizaremos la tarjeta antigua de MA33 ni sus expectativas basadas en huellas completas de HOME.
  >
  > La nueva tarjeta debe verificar únicamente las precondiciones necesarias:
  >
  > 1. Identidad del core `6259456e4` y compatibilidad del plugin.
  > 2. Contrato activo y efectivo en el entorno aislado.
  > 3. Identidad de las tareas vinculadas y sus rutas autorizadas.
  > 4. Vigencia de la caché de routing.
  > 5. Integridad de las configuraciones protegidas de Codex.
  > 6. Ausencia de efectos inesperados sobre el HOME real.
  >
  > El contrato debe activarse explícitamente desde la terminal interactiva cuando corresponda; el Runner no debe saltarse esa protección.
  >
  > ### 3. Criterios de aceptación
  >
  > | Escenario                 | Condición para PASS                                                                   |
  > | ------------------------- | ------------------------------------------------------------------------------------- |
  > | P17                       | Rechazo efectivo de la tarea sin ruta autorizada, sin lanzamiento delegado ni crédito |
  > | P12 — Transporte          | Codex ejecuta el modelo autorizado y existe evidencia verificable de la ejecución     |
  > | P12 — Gobernanza integral | Se evalúa por separado; no declarar PASS sin directiva y ledger correlacionados       |
  > | Aislamiento               | No hay modificaciones globales inesperadas                                            |
  > | Cierre                    | Contrato desactivado y evidencia preservada                                           |
  >
  > La ejecución externa de Codex por sí sola no demuestra que Kairo haya registrado o gobernado correctamente esa tarea.
  >
  > ### 4. Un requisito adicional: telemetría multiproveedor
  >
  > Quiero aprovechar esta ejecución para comprobar la diferencia entre:
  >
  > - Modelo recomendado por Kairo.
  > - Modelo seleccionado para lanzamiento.
  > - Modelo realmente ejecutado.
  > - Modelo registrado en ledger.
  > - Motivo de cualquier discrepancia.
  >
  > Esto debe hacerse con la instrumentación existente, sin agregar código al candidato.
  >
  > Si faltan campos, registraremos el hueco como evidencia. No debemos inventarlos ni atribuir al router decisiones que tomó manualmente el Master.
  >
  > ### 5. Política de STOP
  >
  > Ante una desviación de seguridad, identidad, ruta o ejecutor: detener los escenarios restantes y ejecutar el cierre seguro.
  >
  > No detener el piloto por diferencias inocuas de timestamps o archivos ajenos a su contrato de seguridad. Esas diferencias deben quedar documentadas, pero no volver a provocar el ciclo de reintentos anterior.
  >
  > ## Orden de cierre hacia la beta
  >
  > 1. Finalizar el smoke test de distribución del tarball.
  > 2. Preparar la nueva tarjeta de P17/P12, revisada sin modelos.
  > 3. Activar admisión en el entorno temporal mediante confirmación interactiva.
  > 4. Ejecutar P17 y P12 una sola vez, con cierre obligatorio.
  > 5. Actualizar la matriz de aceptación y decidir sobre la publicación.
  >
  > Importante: incluso si P17 y P12 pasan, todavía debemos distinguir la gobernanza de lanzamientos de la formación y asignación automática de células multiproveedor. No debemos anunciar esta última como validada sin una ejecución que lo demuestre.
  >
  > Autorización final: avanzar con el piloto real y aislado del candidato nuevo, después del smoke test. No habilitar contratos globales, no instalar el candidato en tu entorno personal y no ampliar el alcance funcional de la beta.

  Status:
  - A new kit was built in `release-v0.37.0-pilot-evidence/final-e2e-6259456e4` (card `RUN.md`, helpers, a scratch copy of the earlier pilot environment).
  - A static Codex review reported six blockers; one was refuted with evidence (the guard records use real tabs), five were accepted and corrected, then rechecked.
  - The product owner activated the contract in his terminal (core `6c9146f67`, plugin 0.9.1; the product code equals candidate `6259456e4`, 0 files differ outside `odd` and `test`).
  - Round 1 stopped at block B3 before any model call: zero model calls, contract disabled and confirmed inactive.
  - Causes: after the refresh three Claude seats (Technical Lead, Explorer, Quality Lead) showed unknown with `WAIT_FOR_PROJECT_TEAM` because the Claude access evidence probed on 2026-11-05 crossed the 7 day TTL (`src/global/observability/claude-entitlement-store.js` line 13); and two card defects (a millisecond against whole second clock comparison that reported a future timestamp, and an evidence seal that hashed its own capture file while it was being written).

- L81 (2026-11-12): decision by the product owner on autonomous execution and the approved execution of MA33 version 2, quoted verbatim in Spanish.

  > ## Decisión: `OD-KAIRO — AUTONOMOUS_EXECUTION & MA33`
  >
  > Sí podemos trabajar de manera mucho más autónoma, sin que los subagentes te pidan permiso para cada operación. Pero debemos separar dos conceptos:
  >
  > - Autorización de trabajo: tú apruebas qué queremos conseguir, el alcance y las restricciones.
  > - Permisos de ejecución: Claude, Codex y el sistema operativo controlan qué operaciones pueden realizar los agentes.
  >
  > Mi objetivo para Kairo es que apruebes el trabajo una vez y las células puedan ejecutarlo hasta completarlo, sin interrumpirte continuamente para operaciones ya autorizadas.
  >
  > ## 1. Por qué te siguen pidiendo permisos
  >
  > Claude Code tiene distintos modos de ejecución. En tu versión 2.1.322, `auto` permite que un clasificador revise las acciones y autorice muchas sin intervención humana.
  >
  > Sin embargo, `claude -p` y las ejecuciones del SDK comienzan en modo Manual cuando no se especifica un modo, incluso si tu sesión interactiva trabaja con mayor autonomía.&#x20;
  >
  > [image](https://www.google.com/s2/favicons?domain=https://code.claude.com\&sz=32)
  >
  > Claude Code Docs+1
  >
  >
  >
  > Esto puede explicar parte del comportamiento de tus subagentes.
  >
  > | Modo                | Funcionamiento                                                      |
  > | ------------------- | ------------------------------------------------------------------- |
  > | `default` / Manual  | Solicita permisos para numerosas operaciones                        |
  > | `acceptEdits`       | Permite ediciones y operaciones comunes en el workspace             |
  > | `auto`              | Revisa automáticamente las acciones y reduce las solicitudes        |
  > | `dontAsk`           | Rechaza automáticamente operaciones no autorizadas previamente      |
  > | `bypassPermissions` | Omite controles; sólo recomendable en entornos fuertemente aislados |
  >
  > Para una sesión normal de desarrollo, probaría:
  >
  > ```
  > claude --permission-mode auto
  > ```
  >
  > Para una ejecución independiente:
  >
  > ```
  > claude -p --permission-mode auto "Implementa la tarea autorizada"
  > ```
  >
  > Esto no elimina necesariamente todas las solicitudes: pueden permanecer reglas `ask`, restricciones de hooks o decisiones de seguridad.&#x20;
  >
  > [image](https://www.google.com/s2/favicons?domain=https://code.claude.com\&sz=32)
  >
  > Claude Code Docs+1
  >
  >
  >
  > No recomiendo activar `bypassPermissions` globalmente en tu Mac. Aunque elimine muchos prompts, amplía demasiado el acceso a archivos, credenciales y operaciones del sistema.
  >
  > ## 2. Cómo debería controlar esto Kairo
  >
  > En lugar de que cada Builder solicite permisos por separado, propongo un contrato de capacidades por tarea, integrado en nuestro mecanismo de admisión existente.
  >
  > | Operación                                        | Política propuesta               |
  > | ------------------------------------------------ | -------------------------------- |
  > | Leer código y documentación del workspace        | Automática                       |
  > | Modificar archivos dentro del alcance autorizado | Automática                       |
  > | Crear y eliminar archivos temporales propios     | Automática                       |
  > | Ejecutar pruebas focalizadas                     | Automática                       |
  > | Crear checkpoints y registrar evidencia          | Automática                       |
  > | Modificar configuraciones globales               | Requiere autorización            |
  > | Acceder a credenciales o secretos                | Requiere autorización específica |
  > | Instalar software globalmente                    | Requiere autorización            |
  > | Push, publicar o desplegar                       | Requiere autorización            |
  > | Eliminar datos fuera del workspace               | Requiere autorización            |
  >
  > El funcionamiento deseado sería:
  >
  > Usuario aprueba objetivo, alcance y límites
  >
  > Kairo forma células y asigna capacidades
  >
  > Modelos, herramientas, rutas de escritura y presupuesto
  >
  > Claude
  >
  > Auto / reglas autorizadas
  >
  > Codex
  >
  > Sandbox / políticas de aprobación
  >
  > Trabajo autónomo dentro de los límites
  >
  > Esto debe reutilizar las capacidades nativas de ambos hosts. Kairo no necesita sustituir su sistema de permisos.
  >
  > Para Codex, `workspace-write` permite trabajar dentro del directorio autorizado, mientras que las políticas de aprobación determinan cuándo solicitar intervención. La ausencia de preguntas no significa que el sandbox deba permitir acceso a todo el equipo.&#x20;
  >
  > [image](https://www.google.com/s2/favicons?domain=https://learn.chatgpt.com\&sz=32)
  >
  > ChatGPT Learn+1
  >
  >
  >
  > Importante: el contrato de Kairo no concede permisos por sí mismo. Los launchers deben configurar correctamente las restricciones que Claude y Codex realmente aplican.
  >
  > También debemos medir cuántas interrupciones genera cada célula y por qué. Un permiso repetido dentro de un alcance previamente autorizado puede representar un problema de configuración, no una decisión que tú debas tomar cada vez.
  >
  > ## 3. MA33 — Autorizo el segundo intento
  >
  > `OD-KAIRO-MA33 — V2_EXECUTION_APPROVED`
  >
  > Acepto clasificar como NOTA los tres asientos de Claude con evidencia de acceso vencida, exclusivamente para esta ronda.
  >
  > La causa está identificada: TTL de siete días y expiración de la evidencia de acceso. Esto no equivale a pérdida demostrada del acceso real.
  >
  > | Condición                                   | Decisión                |
  > | ------------------------------------------- | ----------------------- |
  > | Los tres asientos Claude quedan `stale`     | NOTA documentada        |
  > | P17 mantiene `NO_AUTHORIZED_ROUTE`          | Obligatorio             |
  > | P12 mantiene Reviewer en `codex/gpt-6-luna` | Obligatorio             |
  > | Cambio de identidad, ruta o gobernanza      | STOP                    |
  > | `verify-access --refresh`                   | No autorizado           |
  > | Nuevas llamadas a proveedores               | Sólo las dos del piloto |
  > | Repetir P12u                                | No autorizado           |
  > | Cierre y desactivación del contrato         | Obligatorios            |
  >
  > Hay una comprobación esencial: P17 debe rechazar por ausencia de ruta autorizada, no simplemente porque una evidencia Claude haya expirado. Si cambia la causa del rechazo, no se puede declarar PASS.
  >
  > Para P12, la ruta seleccionada tampoco demuestra que Codex tenga acceso efectivo a Luna. Debemos comprobarlo mediante la ejecución autorizada y registrar el modelo realmente servido.
  >
  > Autorizo un directorio nuevo, la tarjeta `RUN.v2.md` y la activación interactiva B1. Se mantienen las restricciones de seguridad anteriores. No se modifica el candidato ni la configuración global.
  >
  > ## 4. Una mejora adicional para nuestras células
  >
  > Quiero distinguir tres estados de autonomía:
  >
  > | Nivel                | Comportamiento                                                                                     |
  > | -------------------- | -------------------------------------------------------------------------------------------------- |
  > | Supervisado          | El usuario aprueba operaciones individuales                                                        |
  > | Autónomo acotado     | El usuario aprueba el contrato; las células operan dentro de él                                    |
  > | Autónomo desatendido | Ejecuta sin intervención en un sandbox preparado; detiene o rechaza operaciones fuera del contrato |
  >
  > El segundo nivel debería ser el comportamiento habitual de Kairo. El tercero sería adecuado para trabajos programados, pruebas y tareas repetitivas en entornos correctamente aislados.
  >
  > El usuario debería intervenir para cambiar objetivos, ampliar permisos o autorizar acciones de consecuencias externas, no para aprobar una y otra vez comandos de lectura, ediciones permitidas o pruebas.
  >
  > ### Prioridades
  >
  > Primero terminemos el piloto MA33. Después, auditemos los prompts reales de Claude y Codex para identificar qué capa solicita cada permiso: host, subagente, sandbox, hook o MCP.
  >
  > No quiero que resolvamos esto agregando instrucciones como «no preguntes y continúa» a los prompts. Eso no cambia las restricciones reales y puede provocar agentes bloqueados.
  >
  > La arquitectura correcta es: autorización inicial explícita, ejecución autónoma dentro de límites comprobables y escalamiento humano únicamente cuando una operación necesita ampliar esos límites.

  Status:
  - Round 2 ran in `release-v0.37.0-pilot-evidence/final-e2e-6259456e4-r2` with the corrected card.
  - P17: one Claude print-mode call; the host returned an error tool result with the text `Kairo admission denied this launch (NO_AUTHORIZED_ROUTE, P17)`; no launch or outcome row, no credit; card verdict PASS.
  - P12: one `kairo team exec` on Codex, exit 0, stdout `OK`, 5.54 seconds, served model `gpt-6-luna` read from the Codex session file of the round; the ledger launch row, the completed outcome row and the trace exec row share one `executionId`; the trace kind is `caller_selected` with no directive.
  - Block D5 raised STOP because the real Codex `config.toml` changed during the exec; D6 and T were skipped and computed after closure from the sealed evidence (folder `post-closure`): P12 Transport NOT PASS only because of the guard exit, P12 Governance NOT PASS with directive ABSENT.
  - Closure: contract disabled and confirmed inactive, seals verified.
  - Model calls of the round: one Claude, one Codex, no retries; P12u not run; `verify-access` not run.
  - The three Claude seats appeared as the documented stale wait NOTE.

- L82 (2026-11-12): decision by the product owner classifying P12 and the isolation finding, quoted verbatim in Spanish.

  > Decisión: OD-KAIRO-MA33 — P12_CLASSIFICATION & ISOLATION_BLOCKER
  > Apruebo P12 Transporte como capacidad funcional verificada, pero NO apruebo el escenario P12 completo. Clasifico el nuevo hallazgo #10 como PROVISIONAL_BLOCKER para la beta.
  >
  > Tenemos una distinción importante: Codex ejecutó correctamente, pero la ejecución produjo una modificación no autorizada de la configuración global. No debemos confundir ambos resultados.
  > 1. Clasificación definitiva de MA33
  > Componente    Clasificación    Justificación
  > P17    PASS    Rechazo NO_AUTHORIZED_ROUTE, sin lanzamiento ni crédito
  > P12 — Transporte    PASS funcional    Codex ejecutó gpt-6-luna, devolvió OK, salida 0 y executionId correlacionado
  > P12 — Gobernanza integral    NOT PASS    Directiva ausente; la selección fue manual
  > Aislamiento    FAIL    Modificación de ~/.codex/config.toml fuera del contrato
  > Cierre    PASS    Contrato desactivado, evidencia sellada
  > Células autónomas    PENDING    No se evaluó asignación automática
  >
  > El resultado formal de la tarjeta permanece NOT PASS para P12 porque su guarda de aislamiento falló.
  >
  > En el reporte debemos distinguir:
  >
  > P12_TRANSPORT_FUNCTIONAL = PASS
  >
  > P12_SCENARIO_ACCEPTANCE = FAIL
  >
  > Esto evita perder evidencia válida del transporte sin ocultar el fallo del escenario completo.
  > 2. Hallazgo #10 — Persistencia global de confianza
  > Clasificación: PROVISIONAL_BLOCKER
  > Pendiente de caracterización
  >
  > Según la documentación oficial de Codex, los proyectos marcados como confiables pueden cargar configuraciones, hooks y políticas locales desde .codex/. La confianza de un proyecto tiene consecuencias de seguridad. 
  >
  > ChatGPT Learn+1
  >
  > Por eso no podemos considerar inocua una entrada nueva en ~/.codex/config.toml.
  > Qué sabemos
  > - El archivo global cambió durante la ejecución.
  > - El cambio ocurrió después del lanzamiento de Codex.
  > - No se ha encontrado una escritura explícita de esa tabla en Kairo.
  > - La atribución a la CLI de Codex es plausible, pero todavía no está demostrada.
  > - El contrato del piloto no autorizaba modificar esa configuración.
  > Qué falta verificar
  > Necesitamos identificar exactamente qué contienen las tres líneas agregadas.
  >
  > En particular:
  > # Ejemplo ilustrativo; no es el contenido confirmado
  > [projects."/ruta/temporal"]
  > trust_level = "trusted"
  >
  >
  > Si el cambio corresponde a una concesión persistente de confianza realizada sin consentimiento explícito, confirmo #10 como BLOCKER de beta.
  >
  > Si resulta ser un registro sin impacto de confianza o permisos, podremos reclasificarlo según la evidencia.
  >
  > No debemos relajar el guard para conseguir que P12 pase.
  > 3. Acciones autorizadas
  > Autorizo únicamente una investigación de solo lectura de #10, utilizando la evidencia ya capturada.
  >
  > El Runner debe:
  > 1. Comparar las tres líneas agregadas con la línea base original.
  > 2. Identificar la clave, el valor y el proyecto afectado, ocultando datos sensibles al reportar.
  > 3. Revisar qué componente de Codex puede escribir esa entrada y bajo qué condiciones.
  > 4. Determinar si la entrada modifica la confianza del proyecto o la carga de configuraciones y hooks.
  > 5. Proponer una solución que preserve las restricciones del host y evite efectos globales inesperados.
  > La solución preferida sería utilizar un entorno de configuración aislado o un mecanismo documentado de Codex que respete la autorización. No debemos copiar credenciales ni cambiar la confianza del proyecto silenciosamente para conseguirlo.
  >
  > No autorizo otra ejecución de modelos, modificar ~/.codex/config.toml ni eliminar todavía esas tres líneas.
  >
  > Una vez identificadas, decidiremos su restauración segura con respaldo y autorización explícita.
  > 4. Qué hemos demostrado sobre Kairo
  > Esta ronda deja resultados importantes:
  > - P17 demuestra que el candidato puede rechazar una delegación sin ruta autorizada.
  > - P12 demuestra que el transporte a Codex funciona y que el modelo ejecutado coincide con el solicitado.
  > - El ledger correlaciona lanzamiento y resultado mediante executionId.
  > - La ruta directa sigue sin demostrar gobernanza integral mediante directivas.
  > - La selección automática de modelos y las células dinámicas siguen sin validación.
  > Por tanto, no necesitamos reconstruir el transporte de Codex. Necesitamos cerrar su aislamiento, verificar la gobernanza y después probar que Kairo puede asignarle tareas automáticamente.
  > 5. Efecto sobre la publicación
  > El candidato permanece congelado. P17 y la ejecución funcional de P12 aportan evidencia favorable, pero no autorizan publicar todavía 0.37.0-beta.1.
  >
  > La siguiente decisión debe concentrarse en #10. Si es un problema de confianza persistente, resolverlo tiene prioridad sobre nuevas optimizaciones de modelos, memoria o cuotas.
  >
  > Conclusión: Codex ya demostró que puede trabajar dentro de Kairo. Ahora debemos garantizar que puede hacerlo sin modificar configuraciones globales no autorizadas y sin depender de decisiones manuales del orquestador.

  Status:
  - The change in the real Codex `config.toml` is exactly three lines: a blank line, a `projects` table keyed by the absolute path of the round 2 temporary project, and `trust_level = "trusted"`.
  - Proof: the SHA-256 of the current file with those three lines removed in memory equals the baseline hash recorded before the exec (`cd9f37d126a65ea467c0275c5ffd93c9a95abe9362681415bf5078038fe592db`); the file grew from 14587 to 14748 bytes.
  - The Kairo exec adapter passes the flag `--approve-for-me` (`src/global/runtime/execution-adapters/codex.js` line 27) and has no code that writes that table.
  - Read-only research in the public Codex source at tag `rust-v0.167.0` attributes the write to the app-server thread start handler (`codex-rs/app-server/src/request_processors/thread_processor.rs`, calling `set_project_trust_level`), when no saved trust entry exists for the project and the effective permissions can write the working directory.
  - The three lines were not removed and the file was not modified by the orchestrator.
  - Not determined: whether a per-invocation config override suppresses the write in that version.

- L83 (2026-11-12): decision by the product owner confirming finding 10 as a publication blocker for 0.37.0-beta.1, quoted verbatim in Spanish.

  > ## Decisión: `OD-KAIRO-RELEASE — FINDING_10_BLOCKER_CONFIRMED`
  >
  > Sí. Confirmo el hallazgo #10 como `BLOCKER` de publicación para `0.37.0-beta.1` por incumplimiento del aislamiento.
  >
  > La clasificación se fundamenta en un hecho comprobado: durante una ejecución gobernada por Kairo, se modificó `~/.codex/config.toml` fuera del alcance autorizado.
  >
  > No necesitamos demostrar todavía que Codex elevó la confianza del directorio para reconocer que el contrato de aislamiento falló.
  >
  > Pero debemos distinguir dos cuestiones:
  >
  > - Bloqueo de publicación: confirmado. La ejecución tuvo un efecto global no autorizado.
  > - Causa y gravedad de seguridad: pendientes. Todavía no sabemos si las tres líneas conceden confianza persistente, quién las escribió ni si un mecanismo documentado de Codex puede impedirlo.
  >
  > ### Estado de aceptación
  >
  > | Gate                             | Estado        |
  > | -------------------------------- | ------------- |
  > | P17 — Rechazo sin ruta           | PASS          |
  > | P12 — Transporte funcional       | PASS          |
  > | P12 — Gobernanza integral        | NOT PASS      |
  > | P12 — Aislamiento                | FAIL          |
  > | #10 — Modificación global        | BLOCKER       |
  > | Células multiproveedor autónomas | PENDING       |
  > | Publicación beta                 | No autorizada |
  >
  > Esta decisión no invalida el trabajo de Codex ni el transporte ya verificado. Impide declarar seguro el escenario completo.
  >
  > ## 2. La investigación del #10 ya tiene una pista concreta
  >
  > Revisé el código público de Codex. Su implementación incluye una función para escribir decisiones de confianza por proyecto en `CODEX_HOME/config.toml`, mediante entradas `trust_level`. También existe una ruta que puede persistir un proyecto como confiable al iniciar una sesión en determinadas condiciones.&#x20;
  >
  > [image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)
  >
  > GitHub+1
  >
  >
  >
  > Esto hace técnicamente plausible la atribución a Codex, pero no demuestra todavía que ese camino exacto se ejecutara en la versión 0.167.0 de tu piloto.
  >
  > Además, las decisiones de confianza pueden influir en la carga de configuraciones, hooks y políticas locales del proyecto.&#x20;
  >
  > [image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)
  >
  > GitHub
  >
  >
  >
  > ### 3. Investigación autorizada
  >
  > Quiero una evaluación focalizada, sin volver a abrir el proyecto de orquestación.
  >
  > 1. Identificar las tres líneas mediante una comparación de solo lectura, sin exponer credenciales.
  > 2. Comprobar la implementación de Codex 0.167.0, no únicamente el código de la rama principal.
  > 3. Evaluar el aislamiento de `CODEX_HOME` y determinar si podemos conservar la autenticación necesaria sin modificar la configuración personal.
  > 4. Comprobar si existe un override documentado por invocación que suprima la persistencia. No asumir que una bandera de aprobación o sandbox lo hace.
  > 5. Diseñar una única reproducción aislada, autorizable después de revisar el plan, con comprobaciones antes y después sobre los archivos globales.
  >
  > La solución debe funcionar para cualquier proyecto nuevo que Kairo ejecute con Codex, no únicamente para la ruta temporal de MA33.
  >
  > ### 4. Criterio para levantar el bloqueo
  >
  > Exigiré evidencia de que:
  >
  > - Codex puede ejecutar la tarea desde Kairo.
  > - La configuración global permanece intacta.
  > - No se concede confianza persistente sin autorización.
  > - Se conservan las restricciones del sandbox.
  > - El resultado queda correlacionado en la telemetría.
  > - La protección es reproducible con un directorio nuevo.
  >
  > La restauración de las tres líneas existentes debe tratarse como una operación separada, con respaldo, comparación exacta y tu autorización. No hace falta restaurarlas para investigar la causa.
  >
  > ## 5. Otros riesgos de publicación
  >
  > No debemos olvidar dos hallazgos independientes:
  >
  > | Hallazgo                                             | Estado                         |
  > | ---------------------------------------------------- | ------------------------------ |
  > | Versión publicada del plugin de Claude sin verificar | Gate de distribución pendiente |
  > | Tres vulnerabilidades altas reportadas por npm       | Triage de seguridad pendiente  |
  >
  > Autorizo investigar ambos en modo de solo lectura. El número de vulnerabilidades no demuestra por sí solo que sean explotables, pero debemos identificar paquetes afectados, si son dependencias de producción y las condiciones de exposición antes de publicar.
  >
  > Prioridad inmediata: #10. No autorizo otra implementación, ejecución de modelos, modificación del HOME, push ni publicación hasta caracterizar el mecanismo de confianza y aprobar una solución mínima.
  >
  > El objetivo sigue siendo el mismo: que Kairo gestione células autónomas multiproveedor sin introducir efectos globales inesperados ni solicitar permisos continuamente para operaciones que ya estaban dentro del contrato aprobado.

  Status:
  - Read-only work after the decision.
  - Codex source at tag `rust-v0.167.0`: the config override key is split on every dot without quote handling (`codex-rs/config/src/overrides.rs` line 22), so a dotted override with a quoted path key cannot match; the working form passes the whole `projects` table as the value of the config flag.
  - A non-none trust decision makes the thread start handler skip the persistent write (`codex-rs/app-server/src/request_processors/thread_processor.rs` lines 1480 to 1493).
  - No documented way was found to reuse a ChatGPT subscription login from an alternate Codex home without copying the credential file; the keyring key derives from the Codex home path.
  - Distribution: the marketplace manifest on `origin/main` (`62f2c6b34`, 2026-11-04) points to the plugin folder with no version pin; the plugin there is 0.8.0 and the core 0.36.0, while the candidate plugin is 0.9.1; `release/v0.37.0` is 275 commits ahead of `origin/main` and unpushed.
  - Dependencies: the repository has no lockfile; advisories for the installed production tree: `@modelcontextprotocol/server` 2.0.0, three high and one moderate, all on HTTP server transports, fixed in 2.3.0; `zod` 4.4.3, one high, fixed in 4.6.6; the core imports only the stdio MCP transport (`src/global/mcp/kairo-mcp.js` and `workspace-mcp-entry.js`).

- L84 (2026-11-12): decision by the product owner approving one isolated reproduction of finding 10, quoted verbatim in Spanish.

  > ## Decisión: `OD-KAIRO-RELEASE — FINDING_10_ISOLATED_REPRO_APPROVED`
  >
  > Autorizo la reproducción de #10 con Codex 0.167.0, mediante los dos brazos propuestos, con algunas condiciones adicionales de aislamiento y verificación.
  >
  > El análisis del código identifica un mecanismo coherente con lo observado: Codex puede persistir `trust_level = "trusted"` cuando inicia un hilo en un proyecto sin decisión de confianza y dispone de permisos efectivos de escritura.&#x20;
  >
  > [image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)
  >
  > GitHub
  >
  >
  >
  > El override `untrusted` es una alternativa razonable para investigar, pero necesitamos demostrar que funciona en la versión instalada.
  >
  > ### 1. Alcance autorizado
  >
  > | Operación                                     | Decisión      |
  > | --------------------------------------------- | ------------- |
  > | Dos brazos: control y override                | Autorizado    |
  > | `CODEX_HOME` temporal independiente por brazo | Obligatorio   |
  > | Proyectos Git temporales                      | Autorizado    |
  > | `codex app-server` por stdio                  | Autorizado    |
  > | `initialize` y `thread/start`                 | Autorizado    |
  > | Enviar turnos al modelo                       | Prohibido     |
  > | Consultar proveedores o usar API keys         | No autorizado |
  > | Modificar `~/.codex/config.toml`              | Prohibido     |
  > | Repetir intentos ante fallo                   | No autorizado |
  >
  > El procedimiento debe bloquear tráfico de red y detenerse si necesita autenticación, intenta iniciar un turno o solicita acceso al llavero.
  >
  > ### 2. Criterios de aceptación
  >
  > Comportamiento esperado
  >
  > Brazo A — Control
  >
  > Sin override
  >
  > Codex inicia el hilo y persiste una entrada `trusted` en el HOME temporal.
  >
  > Brazo B — Prueba
  >
  > Con override
  >
  > Codex inicia el hilo con `untrusted` efectivo y no agrega confianza persistente.
  >
  > Condición común: el hash de `~/.codex/config.toml` real debe permanecer idéntico antes y después.
  >
  > Utilizar la sintaxis de tabla TOML identificada en el código:
  >
  > ```
  > -c 'projects={"<ruta-canonica>"={trust_level="untrusted"}}'
  > ```
  >
  > La ruta es un marcador ilustrativo: el Runner debe generar la ruta canónica efectiva del proyecto, considerando la resolución de la raíz Git.
  >
  > También debe comprobar que Codex efectivamente interpretó `untrusted`, no simplemente que el archivo quedó sin modificar.
  >
  > Si cualquiera de los brazos falla antes de inicializar el hilo, el resultado es INCONCLUSIVE, no PASS.
  >
  > ### 3. Una limitación importante
  >
  > Esta reproducción verifica el comportamiento de `app-server/thread/start`, pero no demuestra automáticamente que el launcher `codex exec` de Kairo respete el mismo override.
  >
  > Además, `untrusted` puede deshabilitar las configuraciones, hooks y políticas locales de Codex. Por tanto, no basta con impedir la escritura: también debemos evaluar si perdemos capacidades necesarias para Kairo.
  >
  > Si la reproducción pasa, autorizo preparar una propuesta mínima para el launcher, pero no incorporarla todavía al candidato.
  >
  > El bloqueo #10 se levantará únicamente después de verificar el comportamiento en la ruta real de ejecución de Kairo.
  >
  > ## 4. Nuevo hallazgo: incompatibilidad del plugin distribuido
  >
  > Con la evidencia que compartiste, clasifico también el desfase del marketplace como `DISTRIBUTION_BLOCKER`.
  >
  > | Componente                         | Versión         |
  > | ---------------------------------- | --------------- |
  > | Core del candidato                 | `0.37.0-beta.1` |
  > | Plugin requerido                   | `0.9.1`         |
  > | Plugin disponible en `origin/main` | `0.8.0`         |
  >
  > Si setup instala desde la rama pública por defecto, no podemos garantizar que un usuario reciba el plugin validado junto con el core.
  >
  > La solución debe asegurar una versión de plugin compatible y verificable, sin depender de que `main` se encuentre casualmente actualizado.
  >
  > Esto no autoriza todavía push ni publicación.
  >
  > ## 5. Vulnerabilidades y reproducibilidad
  >
  > Mantengo el triage de dependencias pendiente de cierre.
  >
  > - Los avisos HTTP de `@modelcontextprotocol/server` parecen no alcanzar los transportes que usa directamente Kairo; hay que confirmar que no existe otra ruta de exposición.
  > - La vulnerabilidad de `zod` merece atención porque el paquete sí participa en la validación de entradas MCP.
  > - La ausencia de lockfile impide garantizar una resolución idéntica de todas las dependencias transitivas.
  >
  > No abriría una migración de dependencias durante la investigación de #10, pero tampoco aprobaría la beta ignorando estos puntos.
  >
  > ### Orden autorizado
  >
  > 1. Ejecutar una única reproducción aislada de #10.
  > 2. Conservar evidencia de ambos brazos y verificar el HOME real.
  > 3. Clasificar si el override resuelve el mecanismo y si cambia las capacidades locales.
  > 4. Preparar una corrección focalizada del launcher, sólo si queda sustentada.
  > 5. Cerrar la compatibilidad del plugin y el triage de dependencias antes de publicar.
  >
  > El candidato continúa congelado y la beta no está aprobada.
  >
  > No autorizo restaurar todavía las tres líneas de confianza existentes, instalar globalmente, hacer push ni publicar.
  >
  > La prioridad es conseguir que Kairo ejecute Codex con autonomía sin conceder confianza persistente a proyectos nuevos y sin modificar silenciosamente el entorno personal del usuario.

  Status:
  - The kit is in `release-v0.37.0-pilot-evidence/finding-10-repro`.
  - A static Codex review reported 2 blockers, 7 major and 2 minor findings, all accepted and corrected; a recheck closed two of three points and the last residue was corrected and re-read by the orchestrator; an end to end dry run against a fake executable passed six scenarios.
  - The single run on 2026-11-13 at 02:54 UTC exited 0 with classification PASS: both arms started a thread through `codex app-server` over stdio under a sandbox that denied network and writes outside the scratch, with a temporary HOME and Codex home per arm, sending only `initialize` and `thread/start`.
  - Arm A, without override, persisted a `projects` table with `trust_level` `trusted` for its project in its temporary config.
  - Arm B, with the override passing the `projects` table with `trust_level` `untrusted` for the canonical project path, created no config file and the server reported that the project is marked as untrusted in the effective configuration (project-local config, hooks and exec policies disabled, skills still load).
  - The real Codex config was unchanged (same SHA-256 `d85e4fd029ad8300c2d31bd6bdb71359cbc287ad948b473a6d2c907f114a98e3`, size 14748, modification time) and no app-server process remained.
  - Limit: this verifies the app-server thread start path, not the `codex exec` launcher of Kairo.
  - Incident: the scratch folder of the earlier distribution smoke, which held the stub host argument log, no longer exists; it was probably removed by a temporary folder cleanup of a later cell.

- L85 (2026-11-13): decision by the product owner on adaptive teams, project intelligence and local adoption, quoted verbatim in Spanish.

  > ## Decisión: `OD-KAIRO — ADAPTIVE_TEAMS, PROJECT INTELLIGENCE & LOCAL ADOPTION`
  >
  > Tu observación revela varios problemas que están relacionados: Kairo sigue dependiendo de una configuración manual para formar equipos, el análisis del proyecto no es suficientemente integral, seguimos utilizando versiones antiguas en el trabajo real y estamos acumulando sesiones enormes.
  >
  > Mi decisión es corregir esa dirección. Kairo debe poder iniciar trabajo útil inmediatamente, entender un proyecto completo y organizar sus células sin exigir que configures todo desde cero.
  >
  > ## 1. Un equipo aprobado no debería ser obligatorio para empezar
  >
  > La frase:
  >
  > > Este proyecto no tiene un equipo Kairo aprobado, así que la delegación cae al modelo por defecto de la sesión.
  >
  > No representa el comportamiento final que queremos.
  >
  > Propongo tres modalidades:
  >
  > | Modalidad                      | Comportamiento                                                                                                  |
  > | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
  > | Equipo estándar adaptativo     | Disponible inmediatamente. Kairo forma células básicas según las capacidades y modelos efectivamente accesibles |
  > | Equipo optimizado por proyecto | Analiza el proyecto completo y propone una composición especializada                                            |
  > | Equipo personalizado           | El usuario modifica roles, restricciones o asignaciones y guarda su configuración                               |
  >
  > El equipo estándar no debe ser una lista fija de Sonnet, Sol y Luna. Debe ser una plantilla de capacidades: análisis, implementación, calidad, documentación y coordinación. Kairo selecciona modelos dinámicamente.
  >
  > Para una consulta o exploración de bajo riesgo, podemos permitir una sesión provisional sin aprobación manual. Para escritura y delegaciones gobernadas, el usuario autoriza el alcance una vez y Kairo opera dentro de él.
  >
  > Esto no debe saltarse P17: si una tarea vinculada no tiene una ruta autorizada, sigue siendo rechazada. El equipo estándar necesita generar y validar su propia ruta, no ocultar la falta de contrato.
  >
  > ## 2. El análisis del proyecto debe ser realmente integral
  >
  > Actualmente, `team analyze` parece estar demasiado condicionado por acceso a modelos y datos de cuota. Necesitamos separar la comprensión del proyecto de la disponibilidad del ejecutor.
  >
  > El análisis debería examinar:
  >
  > | Dimensión     | Qué debe descubrir                                                                   |
  > | ------------- | ------------------------------------------------------------------------------------ |
  > | Objetivos     | Problema que resuelve, usuarios, prioridades, alcance y criterios de éxito           |
  > | Documentación | README, ODD, ADR, especificaciones, decisiones históricas y conocimiento consolidado |
  > | Arquitectura  | Capas, módulos, dependencias, patrones, integraciones y límites del sistema          |
  > | Tecnologías   | Lenguajes, frameworks, bases de datos, servicios, herramientas y sus versiones       |
  > | Calidad       | Tests, cobertura disponible, CI/CD, deuda técnica y controles de seguridad           |
  > | Operación     | Despliegue, infraestructura, observabilidad, ambientes y costos                      |
  > | Organización  | Tareas, células necesarias, paralelismo posible, restricciones y riesgos             |
  > | Evolución     | Alternativas tecnológicas, oportunidades de simplificación y mejoras justificables   |
  >
  > El resultado debe ser un Project Intelligence Profile con referencias verificables, incertidumbres explícitas y una propuesta de células.
  >
  > No hace falta usar modelos para descubrir que un repositorio contiene Python, que utiliza PostgreSQL o que tiene pruebas de integración. Eso puede obtenerse con inspección estática.
  >
  > La IA debería concentrarse en interpretar los objetivos, evaluar decisiones arquitectónicas y proponer equipos.
  >
  > ### Sobre `no_quota_data` y el error de análisis
  >
  > Que Codex aparezca como `available=false reason=no_quota_data` no demuestra que carezca de acceso. Y que su ventana de cinco horas esté al 95 % tampoco demuestra que esa sea la causa de `Team analyze failed`.
  >
  > Necesitamos un error específico de análisis, no un mensaje genérico que mande a `doctor`.
  >
  > La falta de telemetría de cuota no debería impedir analizar un proyecto. Debe marcarse como `unknown`, separarse de la verificación real de acceso y permitir una propuesta provisional sin conceder elegibilidad o crédito que no estén demostrados.
  >
  > ## 3. Hay que empezar a utilizar el Kairo nuevo localmente
  >
  > Este punto es especialmente importante.
  >
  > Estamos preparando `0.37.0-beta.1`, pero tus otros proyectos siguen operando con instalaciones anteriores. Por eso muchas mejoras que diseñamos todavía no forman parte de tu experiencia cotidiana.
  >
  > Quiero introducir un canal de dogfooding local, independiente de la publicación pública.
  >
  > | Entorno                    | Propósito                                                                 |
  > | -------------------------- | ------------------------------------------------------------------------- |
  > | Release candidate          | Código congelado y validaciones de aceptación                             |
  > | Canary local               | Probar el paquete nuevo en proyectos reales con restricciones controladas |
  > | Instalación estable actual | Mantener tus proyectos funcionando mientras no se valide el reemplazo     |
  >
  > Primero haría un piloto en un repositorio secundario con respaldo, ejecutando el binario del candidato por ruta absoluta y utilizando una configuración aislada. Después ampliaría la cobertura a otros proyectos.
  >
  > No recomendaría instalar globalmente el candidato todavía: siguen abiertos el hallazgo #10 de confianza de Codex y el desfase entre el plugin del marketplace y el core.
  >
  > El soporte sin Git también sigue siendo parte del objetivo, pero no debemos afirmar que ya existe si todavía no se implementó.
  >
  > Decisión: apruebo preparar el canal canary local como diseño y procedimiento de validación. Su ejecución sobre proyectos personales requiere un entorno aislado que no dependa de modificar las configuraciones globales.
  >
  > ## 4. Las sesiones de la captura pesan demasiado para ignorarlo
  >
  > Ejemplos visibles en tu gestor de sesiones
  >
  > OD-MVP-MA20 validación final
  >
  > # 19.7 MB
  >
  > MA33 y memoria Kairo
  >
  > # 14.8 MB
  >
  > Recapitulación general
  >
  > # 5.3 MB
  >
  > Test Fitness
  >
  > # 5.6 MB
  >
  > Tamaños almacenados mostrados en la interfaz; no equivalen directamente a tokens de contexto activo.
  >
  > No podemos concluir únicamente por esos tamaños que cada sesión está cargando 19 MB al modelo. Pueden incluir transcripciones, herramientas, resultados, logs y otros registros.
  >
  > Pero sí justifican una auditoría de:
  >
  > - Qué contenido vuelve a cargarse en cada sesión.
  > - Cuánto aporta realmente al contexto del modelo.
  > - Qué información está duplicada entre Engram, Obsidian, ODD e instrucciones.
  > - Qué resultados de pruebas demasiado extensos podrían resumirse y conservarse como archivos referenciables.
  > - Qué checkpoints permiten continuar sin recuperar toda la historia.
  >
  > No quiero que Kairo elimine información útil sólo para reducir tamaños. Quiero persistencia completa de la evidencia y recuperación selectiva del contexto.
  >
  > Aquí encaja `session-lens` como herramienta de diagnóstico de Claude, complementada por telemetría propia de Codex y del router. No necesitamos fabricar otro gestor de memoria.
  >
  > ## 5. También debemos corregir el sesgo hacia stacks predeterminados
  >
  > Tu ejemplo de Next.js, React, Tailwind y PostgreSQL ilustra otro problema: un analista no debe recomendar tecnologías simplemente porque son populares o porque el modelo genera código fácilmente con ellas.
  >
  > El análisis arquitectónico debería partir de los objetivos y restricciones del proyecto, y después comparar alternativas realmente diferentes.
  >
  > Por ejemplo, para una aplicación podríamos considerar arquitecturas server-rendered, SPA con backend separado, soluciones tradicionales monolíticas, sistemas distribuidos o incluso alternativas que no utilicen JavaScript, según los requisitos.
  >
  > Kairo debería consultar fuentes como documentación oficial, resultados de benchmarks pertinentes, datos de adopción y herramientas de comparación cuando aporten evidencia. Artificial Analysis queda para evaluación de modelos, no como autoridad universal para seleccionar stacks.
  >
  > Regla: no recomendar un stack por defecto si todavía no se conocen los requisitos que justificarían su elección.
  >
  > ## 6. Cómo priorizaría estas decisiones
  >
  > | Prioridad | Trabajo                                                         | Momento                                      |
  > | --------- | --------------------------------------------------------------- | -------------------------------------------- |
  > | P0        | Terminar #10, distribución del plugin y seguridad del paquete   | Antes de beta                                |
  > | P0        | Comprobar asignación y ejecución real de células multiproveedor | Gate de beta                                 |
  > | P1        | Canary local con el candidato                                   | Antes de publicación pública, una vez seguro |
  > | P1        | Equipo estándar adaptativo sin configuración manual repetida    | Siguiente incremento funcional               |
  > | P1        | Análisis integral de proyectos y diagnósticos útiles            | Siguiente incremento funcional               |
  > | P2        | Equipos sin Git y sesiones temporales                           | Después del gate de beta                     |
  > | P2        | Optimización profunda de Engram, Obsidian y contexto            | Iteración posterior                          |
  >
  > No abriría ahora seis ramas nuevas. Podemos registrar estos requisitos en ODD mientras terminamos el release.
  >
  > ### Decisión final
  >
  > Kairo debe dejar de comportarse como un conjunto de comandos que requieren preparación manual antes de cada tarea.
  >
  > El flujo al que queremos llegar es:
  >
  > Abrir proyecto → comprender contexto → disponer de un equipo provisional → autorizar el alcance → formar células adaptativas → ejecutar entre proveedores → registrar resultados → conservar memoria útil.
  >
  > Y si es una tarea personal desde la terminal, debe funcionar sin obligarte a crear un repositorio Git.
  >
  > La prioridad inmediata sigue siendo publicar una beta segura, pero la siguiente evolución funcional tiene que centrarse en equipos autónomos realmente utilizables, no en añadir más modelos a un catálogo.

  Status:
  - This decision records requirements and opens no implementation branch now: "No abriría ahora seis ramas nuevas. Podemos registrar estos requisitos en ODD mientras terminamos el release."
  - The local canary channel is approved as design and validation procedure only; its execution on personal projects requires an isolated environment that does not depend on modifying global configurations. Nothing was installed or executed by this entry.
  - The P0 items stay first. Finding 10 and the plugin distribution blocker are already recorded in L83 and L84; dependency triage is also in L84 section 5. Real multi-provider cell assignment and execution as the beta gate: existing coverage not verified in the sections read for this entry (assumption: MA19 and MA10 may relate).
  - Tasks MA37 to MA41 were added for the P1 and P2 rows; no P0 task was created.
  - Verified cross reference: branch `fix/team-analyze-error-detail` holds commit `2fea40bf4` "fix(team): show the real reason when team analyze fails", which is not contained in `main` as of 2026-11-13; it relates to the section 2 requirement for a specific analyze error. Nothing else in this decision is implemented.
