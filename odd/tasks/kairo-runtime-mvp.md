Objective: close and publish the first functional public version of Kairo Runtime (MVP) under the release contract fixed by S125 of odd/tasks/router-provider-authority.md.
Branch: not created yet. Source decision: S125 / L101 in odd/tasks/router-provider-authority.md. No implementation authorized; this document is the closed delivery plan awaiting Sam's approval.
Delivery: ask-on-risk. Test runner: `npm test` (node --test); plugin tests under `integrations/claude-code/kairo-router`.

## Specs

Quotes are Sam's exact strings from S125. Anything not stated by Sam is marked "Assumption".

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
- M15 (authorization): "Autorizo registrar esta decisión de alcance y preparar un plan cerrado de entrega del MVP, pero todavía no otra implementación."

## Release contract

The closure rule (M8) is the single release gate. Every future finding is classified exactly once:

- BLOCKER: it demonstrates at least one of the four consequences in M8 (mandatory-constraint violation at execution; independence, admission or execution accredited without enough evidence; main supported install/work/recovery route broken; reproducible compatibility, stability or performance regression that prevents normal use).
- KNOWN_DEBT: it meets none of the four. It is documented in the known-limitations section of the Milestone D docs and does not block publication.

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

### A - Close the minimum boundary (M9, M6, M7)

Exit evidence:
- Reproduced defects of the supported governable routes (F1-F6, F8, and F7 if reproduced in the real flow) fixed, each with a regression test that failed first.
- A fixed acceptance test set exists, runs through real inputs (real startRun plus supervisor, real hook, `team exec`), and passes under `npm test` and the plugin tests.
- Zero launches on rejected, expired or foreign directives, asserted in that set.
- F9 classification written per operation; governable operations on announced routes pass the boundary.
- Hook redundant reads removed; a performance test covers the normal path and the timeout path. Threshold: hook p95 under 2000 ms including the timeout path. Assumption, needs approval (Sam stated only that the hook must not habitually exceed its execution budget).
- F12/F13 claims corrected and performance tests committed.

### B - Installable integration (M10)

Exit evidence:
- Worktrees core-hook-t0..t4, core-hook-snapshot and u2-u5 consolidated into one release branch (name Assumption, needs approval; not created yet). The 13 D files are not merged (M14).
- Package built; fresh install in a clean scratch project passes.
- Upgrade from the previous installed state passes.
- Disable passes and Kairo-off behaviour in existing projects is unchanged for the host (no Kairo launch gating, no errors).
- Diagnosis, recovery and uninstall leave the host working (M4 last capability).

### C - Real pilot (M11)

Exit evidence, on new and existing scratch projects, via Claude Code (kairo-router hook) and Codex (team exec/service/startRun):
- Routing observed with availability and explicit exclusion reasons.
- Per-task independence observed, with provisional states when evidence is missing.
- Fallbacks observed and explained, none silent.
- Hook and launch latency measured under controlled activation. Pass threshold Assumption, needs approval (same hook p95 under 2000 ms).
- Any finding classified BLOCKER or KNOWN_DEBT; BLOCKERs return to Milestone A scope only if they meet M8.

### D - Publication (M12)

Exit evidence:
- Documentation published for install, compatibility, limitations (including KNOWN_DEBT list), and troubleshooting.
- Version tagged and package published.
- Improvement roadmap kept in a separate document, not in this feature.

## Announced integrations (proposal)

Proposal for Sam's approval (derived from M3, M11; the final list is Sam's decision):

- Governed: Claude Code via the kairo-router hook; Codex via `team exec`, service and `startRun`.
- Compatibility mode without credit: OpenCode, Pi, Cursor, Gemini and generic adapters, unless one implements the boundary before release.

## Out of scope

- T6-T11 of router-provider-authority, unless indispensable for the minimum contract (M5). Assumption: no T6-T11 capability is identified as indispensable yet; if Milestone A or C evidence shows one is, it is raised to Sam as a decision and not added silently.
- Remote `VERIFIED` attestation (M4).
- Universal host compatibility and the advanced roadmap capabilities (M4).
- The 13 D files: historical backup only, not an integration target and not mandatory debt to merge (M14).
- New general design rounds, new security subsystems, and anticipatory observability infrastructure (M13).

## Tasks

Closed list. Route TBD for all; status for all: not authorized (M15).

- MA1 (M6, M8; Milestone A): identity and reuse fixes for F1, F2, F3, F4, F8 on startRun, supervisor, launch gate and hook. Route TBD. Status: not authorized.
- MA2 (M6, M8; Milestone A): contract and exhaustion fixes for F5, F6 (fail closed on corrupt contract, `team exec` gate). Route TBD. Status: not authorized.
- MA3 (M6; Milestone A): confirm F7 in the real hook and `team exec` flow; fix only if reproduced. Route TBD. Status: not authorized.
- MA4 (M1, M2, M3, M6; Milestone A): classify F9 operations as governable or auxiliary; route governable ones through the boundary; make auxiliary ones respect confirmed exhaustion. Route TBD. Status: not authorized.
- MA5 (M7; Milestone A): remove redundant core reads in the hook path; no new protocol. Route TBD. Status: not authorized.
- MA6 (M6; Milestone A): record F10, F11 as KNOWN_DEBT unless reproduced; correct F12 claims; add F13 performance tests. Route TBD. Status: not authorized.
- MA7 (M9; Milestone A): build and run the fixed acceptance test set on real inputs. Route TBD. Status: not authorized.
- MA8 (M10, M14; Milestone B): consolidate worktrees into one release branch, excluding the 13 D files. Route TBD. Status: not authorized.
- MA9 (M10, M4; Milestone B): package, fresh install, upgrade, disable, Kairo-off, diagnosis, recovery and uninstall checks. Route TBD. Status: not authorized.
- MA10 (M11; Milestone C): pilot on new and existing scratch projects via Claude Code and Codex. Route TBD. Status: not authorized.
- MA11 (M12; Milestone D): install, compatibility, limitations and troubleshooting docs. Route TBD. Status: not authorized.
- MA12 (M12; Milestone D): tag version, publish package, open separate roadmap document. Route TBD. Status: not authorized.

## Log

- L1: see S125 in odd/tasks/router-provider-authority.md (verbatim). Authorization quote: "Autorizo registrar esta decisión de alcance y preparar un plan cerrado de entrega del MVP, pero todavía no otra implementación."
