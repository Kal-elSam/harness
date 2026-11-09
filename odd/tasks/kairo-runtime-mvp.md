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

## Release contract

The closure rule (M8) is the single release gate. Every future finding is classified exactly once:

- BLOCKER: it demonstrates at least one of the four consequences in M8 (mandatory-constraint violation at execution; independence, admission or execution accredited without enough evidence; main supported install/work/recovery route broken; reproducible compatibility, stability or performance regression that prevents normal use). M16 and M17 are mandatory release items (M19); a missed M16 or M17 acceptance criterion blocks.
- KNOWN_DEBT: it meets none of the four. It is documented in the known-limitations section of the Milestone D docs and does not block publication. Non-blocking improvements go to the later-version backlog (M18).

New observations are evaluated against this contract; they do not expand the roadmap automatically. Security defects are not ignored: they are BLOCKER when they meet a consequence, otherwise KNOWN_DEBT with a written record.

## Findings triage

The audit table was delivered in chat only. This table follows Sam's grouping (M6); no per-number description is claimed.

| Finding | Group | Release decision | Acceptance evidence |
| ------- | ----- | ---------------- | ------------------- |
| F1 | Identity and reuse | Blocks protocol activation | Real startRun plus supervisor rejects a reused, expired or foreign directive; zero launches; test in the fixed acceptance set |
| F2 | Identity and reuse | Blocks protocol activation | Same as F1 with real inputs |
| F3 | Identity and reuse | Blocks protocol activation | Same as F1 with real inputs |
| F4 | Identity and reuse | Blocks protocol activation | Same as F1 with real inputs |
| F8 | Identity and reuse | Blocks protocol activation | Same as F1 with real inputs |
| F5 | Contract and exhaustion failures | Blocks supported governance | Corrupt or unmarked contract fails closed on every supported governable route; exhaustion respected; regression test fails first |
| F6 | Contract and exhaustion failures | Blocks supported governance | Same as F5 |
| F7 | Project resolution | Confirm in the real flow; helper alone is not proof | Reproduce through the real hook and `team exec` flow; if reproduced, BLOCKER with fix and test; if not, KNOWN_DEBT |
| F9 | Other execution routes | Classify per operation: governable vs auxiliary | Written classification per operation (see Audit evidence); governable ones on announced routes pass the boundary; auxiliary ones respect confirmed exhaustion |
| F10 | Not reproduced | Does not block release on hypothesis alone | Recorded as KNOWN_DEBT unless a reproduction appears and meets M8 |
| F11 | Not reproduced | Does not block release on hypothesis alone | Same as F10 |
| F12 | Reports and performance | Correct claims | Reports and docs corrected to match observed evidence |
| F13 | Reports and performance | Establish performance tests | Performance tests committed, including the hook timeout path |

### Audit evidence (group level)

Read-only audit of worktree core-hook-t4 at 2d5a766bf plus uncommitted S121-S123 batches:

- Real startRun plus supervisor reproduced role/original-pair directive reuse and expiry during preparation; the gate does not bind the full effective decision; the handoff loses directive and decision; no spawn-time revalidation (src/global/runtime/run-manager.js, run-supervisor.js, src/global/team/launch-gate.js).
- The real hook accepted a directive issued 1 ms in the future (integrations/claude-code/kairo-router/hooks/launch-protocol.ts, src/global/team/launch-decision.js issuance skew).
- A corrupt unmarked contract becomes legacy and skips current markers; team exec with a corrupt linked contract bypasses the gate and emits an inactive diagnostic (launch-gate.js, src/global/team/team-exec.js).
- git exit status 1 with not-a-git stderr is misclassified NO_PROJECT (launch-gate.js root classifier).
- Ungoverned sinks: direct quick-ask, entitlement/auth model prompts, review, architect, OpenCode backend, bootstrap sandbox, Pi minions, continuation, generic capability adapter. Per S125: quick-ask, entitlement/auth probes and metadata queries are auxiliary (no decideLaunch, but must respect confirmed exhaustion); review-runner, architect, Kairo-managed minions and managed-task continuation are governable when they run delegated work; OpenCode, Pi and generic adapters stay in compatibility mode without credit unless they implement the boundary.
- Hook latency: on an inactive project the hook made two reads with an 1800 ms deadline each, 3612 ms observed, above the 2000 ms hook limit; S122 already noted one extra core read per launch for projects without effective activation. Fix = remove redundant reads, not a new protocol (M7).

## Milestones

Each milestone is complete only when its exit evidence is observed. Scope does not grow on new hypotheses (M9); new findings go through the Release contract.

### A - Close the minimum boundary (M9, M6, M7, M16, M17)

Exit evidence:
- Reproduced defects of the supported governable routes (F1-F6, F8, and F7 if reproduced in the real flow) fixed, each with a regression test that failed first.
- A fixed acceptance test set exists, runs through real inputs (real startRun plus supervisor, real hook, `team exec`), and passes under `npm test` and the plugin tests.
- Zero launches on rejected, expired or foreign directives, asserted in that set.
- F9 classification written per operation; governable operations on announced routes pass the boundary.
- Hook redundant reads removed; a performance test covers the normal path and the timeout path. Threshold (approved, OD-MVP-1 / M20): hook p95 under 2000 ms over the full operation. Internal timeouts must leave margin so the whole operation ends in a controlled way; the budget is not 2000 ms per query.
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

### C - Real pilot (M11, M16)

Exit evidence, on new and existing scratch projects, via Claude Code (kairo-router hook) and Codex (team exec/service/startRun), published as 0.37.0-beta.1 for the pilot:
- Routing observed with availability and explicit exclusion reasons.
- Per-task independence observed, with provisional states when evidence is missing.
- Fallbacks observed and explained, none silent.
- Hook and launch latency measured under controlled activation. Pass threshold: hook p95 under 2000 ms over the full operation (approved, M20).
- M16 target measured against the Milestone A baseline (MA15 scope).
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

## Tasks

Closed list (MA1-MA17). Route TBD for all. Every task carries Result, Acceptance and Closure (M18); once the three hold the task closes and non-blocking improvements go to the later-version backlog. Milestone A MA1-MA7 plus MA13-MA14 are authorized by OD-MVP-1; MA8-MA12 and MA15-MA16 are not authorized yet.

- MA1 (M6, M8; Milestone A). Status: authorized (OD-MVP-1). Result: identity and reuse fixes for F1, F2, F3, F4, F8 on startRun, supervisor, launch gate and hook. Acceptance: real startRun plus supervisor and real hook reject reused, expired, foreign and future-issued directives with zero launches; each regression test failed first. Closure: tests pass in the fixed acceptance set (MA7) under `npm test` and plugin tests.
- MA2 (M6, M8; Milestone A). Status: authorized (OD-MVP-1). Result: contract and exhaustion fixes for F5, F6 (fail closed on corrupt contract, `team exec` gate). Acceptance: corrupt or unmarked contract fails closed on every supported governable route and exhaustion is respected; regression test failed first. Closure: tests pass in the fixed acceptance set (MA7).
- MA3 (M6; Milestone A). Status: authorized (OD-MVP-1). Result: F7 confirmed or ruled out in the real hook and `team exec` flow; fix only if reproduced. Acceptance: reproduction attempt through the real flow recorded; if reproduced, fix with failing-first test, else KNOWN_DEBT record. Closure: outcome (BLOCKER fixed or KNOWN_DEBT) recorded in the findings table.
- MA4 (M1, M2, M3, M6; Milestone A). Status: authorized (OD-MVP-1). Result: F9 operations classified governable or auxiliary; governable ones routed through the boundary; auxiliary ones respect confirmed exhaustion. Acceptance: written per-operation classification exists; governable operations on announced routes pass the boundary and auxiliary ones respect confirmed exhaustion, each asserted by a test. Closure: classification committed and tests pass in the acceptance set (MA7).
- MA5 (M7; Milestone A). Status: authorized (OD-MVP-1). Result: redundant core reads removed from the hook path; no new protocol. Acceptance: performance test covers normal and timeout paths and shows hook p95 under 2000 ms over the full operation, with internal timeouts leaving margin. Closure: performance test committed and passing.
- MA6 (M6; Milestone A). Status: authorized (OD-MVP-1). Result: F10 and F11 recorded as KNOWN_DEBT unless reproduced; F12 claims corrected; F13 performance tests added. Acceptance: records exist for F10/F11; reports match observed evidence; F13 tests run and pass, including the hook timeout path. Closure: records and tests committed.
- MA7 (M9; Milestone A). Status: authorized (OD-MVP-1). Result: fixed acceptance test set built and run on real inputs. Acceptance: set covers real startRun plus supervisor, real hook and `team exec`, asserts zero launches on rejected directives, and passes under `npm test` and plugin tests. Closure: set committed with a passing run recorded.
- MA8 (M10, M14; Milestone B). Status: not authorized. Result: worktrees consolidated into release/v0.37.0, excluding the 13 D files. Acceptance: branch builds and `npm test` plus plugin tests pass; no D file present. Closure: branch state and test run recorded.
- MA9 (M10, M4; Milestone B). Status: not authorized. Result: package, fresh install, upgrade, disable, Kairo-off, diagnosis, recovery and uninstall verified. Acceptance: each check passes in a clean scratch project and the host keeps working after disable and uninstall. Closure: check results recorded.
- MA10 (M11; Milestone C). Status: not authorized. Result: pilot of 0.37.0-beta.1 on new and existing scratch projects via Claude Code and Codex. Acceptance: Milestone C exit evidence observed, including hook p95 under 2000 ms over the full operation. Closure: pilot report recorded with every finding classified BLOCKER or KNOWN_DEBT.
- MA11 (M12; Milestone D). Status: not authorized. Result: install, compatibility, limitations and troubleshooting docs. Acceptance: a reader can install, diagnose and uninstall by the docs alone; KNOWN_DEBT list included. Closure: docs committed.
- MA12 (M12; Milestone D). Status: not authorized. Result: 0.37.0 tagged, package published, separate roadmap document opened. Acceptance: tag and published package match the pilot-validated build; roadmap lives outside this feature. Closure: tag, publication and roadmap document recorded.
- MA13 (M16; Milestone A). Status: authorized (OD-MVP-1). Result: session-start context baseline measured for Kairo enabled, disabled and not installed, by source, separating initial context from first-task consumption. Acceptance: context measured at three moments (right after session start, after preparing the first task, after finishing it) for Kairo enabled, disabled and not installed (M21); a recorded table per state with the source breakdown in the Milestone A exit evidence, non-Kairo sources reported as such, no new memory or compaction mechanism built. Closure: baseline recorded in this document.
- MA14 (M17; Milestone A). Status: authorized (OD-MVP-1). Result: current panel defect inventory and mapping of the existing state source the panel must consume. Acceptance: each defect Sam lists is confirmed or marked not reproduced with evidence, and the existing state source is named with its file path. Closure: inventory and mapping recorded in this document.
- MA15 (M16; Milestone B or C). Status: not authorized. Result: context reduction implemented to the target of at least 50% reduction of Kairo-attributable startup overhead without removing essential controls, through the four M21 measures: (1) minimal bootstrap audit of CLAUDE.md, AGENTS.md, agents, skills and MCP tools; (2) compact Engram storing decisions and pointers to documents, not ODD spec copies; (3) on-demand CodeGraph and selective Context7; (4) per-task context budget showing source and use. Acceptance: re-measurement against the MA13 baseline shows the target met and essential controls still enforced. Closure: the five M21 demonstrations (no unnecessary load every session; relevant context retrieved when needed; no massive duplication of instructions and memories; security controls kept while optimizing; measurable reduction against a comparable baseline) are recorded with the before/after measurement; installing all five tools is NOT required.
- MA16 (M17; Milestone B). Status: not authorized. Result: compact plus detailed two-level panel consuming an existing state source, with the semantic fixes (Unknown not shown as a role, understandable wait reasons, no roles multiplied per historical run, quota with update time and staleness). Acceptance: the MA14 defect inventory is re-checked and every defect is gone; no new monitoring engine added. Closure: panel tests pass and before/after captured.
- MA17 (M21; Milestone B). Status: not authorized. Result: Graphify evaluated against CodeGraph before any dependency is added. Acceptance: a written comparison on the same project shows what Graphify adds beyond CodeGraph, its context cost and its duplication risk with Engram and CodeGraph, ending in adopt or reject. Closure: decision recorded; no Graphify dependency added unless the comparison shows added value.

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
