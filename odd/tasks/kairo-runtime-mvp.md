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
- M16 baseline recorded: measured session-start context for three states (Kairo enabled, Kairo disabled, Kairo not installed), separating initial context from first-task consumption, and broken down by source: global instructions and CLAUDE.md/AGENTS.md; Kairo and Gentle AI additions; host/agent/plugin duplication; tool/MCP/capability descriptions; needed-at-start versus on-demand. The M16 target (at least 50% reduction of Kairo-attributable startup overhead without removing essential controls) is implemented in a later milestone (MA15), not here. Non-Kairo sources are reported as such and not attributed to Kairo. No new memory system, no new compaction mechanism, no new monitoring engine.
- M17 baseline recorded: current panel inventory of the defects Sam lists (Unknown role shown as assigned, "waiting until unknown", opencode-go unavailable noise, roles multiplied per historical run, 73-verdict list flooding the panel, quota without update time or staleness) and identification of the existing state source the panel must consume.

### B - Installable integration (M10, M17)

Exit evidence:
- Worktrees core-hook-t0..t4, core-hook-snapshot and u2-u5 consolidated into release/v0.37.0 (approved as integration target; not created yet; no automatic merge authorized). The 13 D files are not merged (M14).
- Package built; fresh install in a clean scratch project passes.
- Upgrade from the previous installed state passes.
- Disable passes and Kairo-off behaviour in existing projects is unchanged for the host (no Kairo launch gating, no errors).
- Diagnosis, recovery and uninstall leave the host working (M4 last capability).
- Compact plus detailed panel (M17) consuming an existing state source with the semantic fixes (MA16), if not authorized earlier.
- BYOK AA onboarding (M24, MA18): a fresh install without an AA key works; a key set later is validated with explicit error messages; the key is stored locally outside the repository and never appears in traces; degraded mode (no key) shows no invented rankings or current data.

### C - Real pilot (M11, M16)

Exit evidence, on new and existing scratch projects, via Claude Code (kairo-router hook) and Codex (team exec/service/startRun), published as 0.37.0-beta.1 for the pilot:
- Routing observed with availability and explicit exclusion reasons.
- Per-task independence observed, with provisional states when evidence is missing.
- Fallbacks observed and explained, none silent.
- Hook and launch latency measured under controlled activation. Pass threshold: hook p95 under 2000 ms over the full operation (approved, M20).
- M16 target measured against the Milestone A baseline (MA15 scope).
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

## Tasks

Closed list (MA1-MA18 plus MA1b; MA19 added by OD-MVP-ORCHESTRATION). Route TBD for all. Every task carries Result, Acceptance and Closure (M18); once the three hold the task closes and non-blocking improvements go to the later-version backlog. Milestone A MA1-MA7 plus MA13-MA14 are authorized by OD-MVP-1 (MA14 is done); MA1b is authorized by OD-MVP-MA1b (L5); MA8-MA12 and MA15-MA18 are not authorized yet.

- MA1 (M6, M8; Milestone A). Status: done (closed per M18): 65bfe5c1a (MA1), fae107434 (MA1b), 4d226db14 (MA1c), a085f99c8 (MA1d); authentic direct-Codex review obtained (M23), one F8 blocker fixed in MA1d, recheck BLOCKER RESOLVED; F3 and F8 are done under MA1b. Result: identity and reuse fixes for F1, F2, F3, F4, F8 on startRun, supervisor, launch gate and hook. Acceptance: real startRun plus supervisor and real hook reject reused, expired, foreign and future-issued directives with zero launches; each regression test failed first. Closure: tests pass in the fixed acceptance set (MA7) under `npm test` and plugin tests.
- MA1b (M23; Milestone A). Status: done (closed per M18): fae107434 (MA1b), with follow-ups 4d226db14 (MA1c) and a085f99c8 (MA1d); authorized by OD-MVP-MA1b, L5. Result: F3 zero clock skew in core and hook (condition issuedAt <= now && now < expiresAt && expiresAt - issuedAt <= 300_000) plus F8 no directive reuse after a new current exhaustion that contradicts it; no other component touched, protocol architecture unchanged. Acceptance: t4-ma1b tests including the case issuedAt = now + 1 ms, core/hook parity tests updated, and full suites green. Closure: closure report section MA1b plus an authentic review by direct Codex invocation (no wrapper) whose report names the exact commit and files inspected; a mismatch discards the review.
- MA2 (M6, M8; Milestone A). Status: done (closed per M18; commits e63f074a9, 94dcffc85). Result: contract and exhaustion fixes for F5, F6 (fail closed on corrupt contract, `team exec` gate). Acceptance: corrupt or unmarked contract fails closed on every supported governable route and exhaustion is respected; regression test failed first. Closure: tests pass in the fixed acceptance set (MA7).
- MA3 (M6; Milestone A). Status: in progress (authorized by OD-MVP-1). Result: F7 confirmed or ruled out in the real hook and `team exec` flow; fix only if reproduced. Acceptance: reproduction attempt through the real flow recorded; if reproduced, fix with failing-first test, else KNOWN_DEBT record. Closure: outcome (BLOCKER fixed or KNOWN_DEBT) recorded in the findings table.
- MA4 (M1, M2, M3, M6; Milestone A). Status: authorized (OD-MVP-1). Result: F9 operations classified governable or auxiliary; governable ones routed through the boundary; auxiliary ones respect confirmed exhaustion. Acceptance: written per-operation classification exists; governable operations on announced routes pass the boundary and auxiliary ones respect confirmed exhaustion, each asserted by a test. Closure: classification committed and tests pass in the acceptance set (MA7).
- MA5 (M7; Milestone A). Status: rolled back (OD-MVP-MA5 ROLLBACK_APPROVED, 2026-11-10), not committed; F13 moved to KD11. Result: redundant core reads removed from the hook path; no new protocol. Acceptance: performance test covers normal and timeout paths and shows hook p95 under 2000 ms over the full operation, with internal timeouts leaving margin. Closure: performance test committed and passing.
- MA6 (M6; Milestone A). Status: authorized (OD-MVP-1). Result: F10 and F11 recorded as KNOWN_DEBT unless reproduced; F12 claims corrected; F13 performance tests added. Acceptance: records exist for F10/F11; reports match observed evidence; F13 tests run and pass, including the hook timeout path. Closure: records and tests committed.
- MA7 (M9; Milestone A). Status: authorized (OD-MVP-1). Result: fixed acceptance test set built and run on real inputs. Acceptance: set covers real startRun plus supervisor, real hook and `team exec`, asserts zero launches on rejected directives, and passes under `npm test` and plugin tests. Closure: set committed with a passing run recorded.
- MA8 (M10, M14; Milestone B). Status: not authorized. Result: worktrees consolidated into release/v0.37.0, excluding the 13 D files. Acceptance: branch builds and `npm test` plus plugin tests pass; no D file present. Closure: branch state and test run recorded.
- MA9 (M10, M4; Milestone B). Status: not authorized. Result: package, fresh install, upgrade, disable, Kairo-off, diagnosis, recovery and uninstall verified. Acceptance: each check passes in a clean scratch project and the host keeps working after disable and uninstall. Closure: check results recorded.
- MA10 (M11; Milestone C). Status: not authorized. Result: pilot of 0.37.0-beta.1 on new and existing scratch projects via Claude Code and Codex. Acceptance: Milestone C exit evidence observed, including hook p95 under 2000 ms over the full operation. Closure: pilot report recorded with every finding classified BLOCKER or KNOWN_DEBT.
- MA11 (M12; Milestone D). Status: not authorized. Result: install, compatibility, limitations and troubleshooting docs. Acceptance: a reader can install, diagnose and uninstall by the docs alone; KNOWN_DEBT list included. Closure: docs committed.
- MA12 (M12; Milestone D). Status: not authorized. Result: 0.37.0 tagged, package published, separate roadmap document opened. Acceptance: tag and published package match the pilot-validated build; roadmap lives outside this feature. Closure: tag, publication and roadmap document recorded.
- MA13 (M16; Milestone A). Status: authorized (OD-MVP-1). Result: session-start context baseline measured for Kairo enabled, disabled and not installed, by source, separating initial context from first-task consumption. Acceptance: context measured at three moments (right after session start, after preparing the first task, after finishing it) for Kairo enabled, disabled and not installed (M21); a recorded table per state with the source breakdown in the Milestone A exit evidence, non-Kairo sources reported as such, no new memory or compaction mechanism built. Closure: baseline recorded in this document.
- MA14 (M17; Milestone A). Status: done. Result: current panel defect inventory and mapping of the existing state source the panel must consume. Acceptance: each defect Sam lists is confirmed or marked not reproduced with evidence, and the existing state source is named with its file path. Closure: inventory and mapping recorded in this document. Result inventory: "unknown (unknown)" shown as an assigned role at integrations/claude-code/kairo-router/hooks/register.ts:338-343 (planTable); "waiting until unknown" at register.ts:340-341; "No quota data: opencode-go" noise at register.ts:168-172 (providers with empty windows are listed); roles multiplied via src/global/team/routing-input-cache.js:253-273 (run records and launch history); verdict list flood at integrations/claude-code/kairo-router/hooks/pane.ts:18-24 (renders every verdict string); quota shown without generatedAt or stale although the Pacing type has both (register.ts:7, 167-172). State sources for the compact view: `kairo team pacing --json --no-wait` (quota windows, generatedAt) plus `kairo team routes --json` (role routes, wait reasons); verdict producer not yet located. Seventh panel defect (KD8): the Pacing line shows remaining quota without saying "remaining", so it was misread as used; label fix belongs to M17.
- MA15 (M16; Milestone B or C). Status: not authorized. Result: context reduction implemented to the target of at least 50% reduction of Kairo-attributable startup overhead without removing essential controls, through the four M21 measures: (1) minimal bootstrap audit of CLAUDE.md, AGENTS.md, agents, skills and MCP tools; (2) compact Engram storing decisions and pointers to documents, not ODD spec copies; (3) on-demand CodeGraph and selective Context7; (4) per-task context budget showing source and use. Acceptance: re-measurement against the MA13 baseline shows the target met and essential controls still enforced. Closure: the five M21 demonstrations (no unnecessary load every session; relevant context retrieved when needed; no massive duplication of instructions and memories; security controls kept while optimizing; measurable reduction against a comparable baseline) are recorded with the before/after measurement; installing all five tools is NOT required.
- MA16 (M17; Milestone B). Status: not authorized. Result: compact plus detailed two-level panel consuming an existing state source, with the semantic fixes (Unknown not shown as a role, understandable wait reasons, no roles multiplied per historical run, quota with update time and staleness). Acceptance: the MA14 defect inventory is re-checked and every defect is gone; no new monitoring engine added. Closure: panel tests pass and before/after captured.
- MA17 (M21; Milestone B). Status: not authorized. Result: Graphify evaluated against CodeGraph before any dependency is added. Acceptance: a written comparison on the same project shows what Graphify adds beyond CodeGraph, its context cost and its duplication risk with Engram and CodeGraph, ending in adopt or reject. Closure: decision recorded; no Graphify dependency added unless the comparison shows added value.
- MA18 (M24; Milestone B). Status: not authorized yet. Result: BYOK Artificial Analysis onboarding: optional personal AA key configurable at clean install and when configuring Kairo later; no shared credentials in the package; local secure storage outside the repository and traces; explicit key check with explained access errors; degraded mode without a key that invents no rankings or current data; model-evaluation API kept separate from the Claude/Codex subscriptions used to run work. Acceptance: fresh install without an AA key installs and runs basic Kairo functions; a key set later is validated with explicit error messages; the key is absent from the repository and from traces; degraded mode shows no invented rankings. Closure: tests pass and the Milestone B and C exit evidence for M24 is recorded.

- MA19 (M27; Milestone not yet assigned — Assumption pending Sam). Status: authorized (OD-MVP-ORCHESTRATION). Result: an acceptance matrix of three integration scenarios showing sequential, parallel and routing execution as verifiable capabilities of Kairo Runtime 0.37.0 using the existing mechanisms, including failures, quotas and cross review. Acceptance: the three scenarios are defined in this document and each one is observed passing end to end; no new workflow engine; provider selection is not duplicated; parallelism is not required when tasks have dependencies; parallel execution does not bypass quotas, admission or per-task review. Closure: matrix recorded with observed evidence per scenario. First step: define the three scenarios.

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
