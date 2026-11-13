# Local canary (OD-KAIRO LOCAL_CANARY_PREPARATION_APPROVED)

Objective: use Kairo 0.37.0 locally in other projects before its publication, starting read-only, without replacing the current installation.
Branch: feat/router-provider-authority. Delivery: ask-on-risk. Test runner: not applicable to phase 1 (the procedure is validated by a model-free rehearsal, task T2).

## Specs

Quoted verbatim from the decision (Log L1). No requirement was added; design choices are marked as proposals or assumptions in the Log.

- S1. The three phases, verbatim:
  - "Fase 1 — Uso local controlado"
  - "Preparación autorizada"
  - "Usar el candidato desde una ubicación aislada en un proyecto secundario, sin reemplazar tus binarios actuales. Inicialmente, análisis, diagnóstico, exploración y operaciones de solo lectura."
  - "Fase 2 — Delegación multiproveedor" / "Tras cerrar #10" / "Permitir implementaciones con Claude y Codex en worktrees separados, comprobando permisos, rutas y configuración."
  - "Fase 3 — Instalación local habitual" / "Pendiente" / "Instalar una versión validada para tus diferentes proyectos, con plugin compatible y procedimiento de actualización y recuperación."
- S2. The five start conditions, verbatim:
  - "1. Invocar Kairo desde el build local validado, no desde `PATH`, donde conviven varias versiones antiguas."
  - "2. Utilizar `HARNESS_HOME` temporal o dedicado para no alterar los equipos existentes."
  - "3. No ejecutar `setup --yes`, `sync`, `retire` ni otras operaciones que escriban configuración global sobre tu instalación actual."
  - "4. Comenzar por `doctor`, inspección del proyecto y evaluación de capacidades."
  - "5. Activar delegaciones de escritura sólo después de validar el aislamiento y la compatibilidad del plugin."
  - Context: "Propongo un piloto en uno de tus repositorios secundarios, con estas condiciones:"
- S3. What is authorized now, verbatim: "Autorizo preparar ahora el uso local de 0.37.0 en otros proyectos, sin esperar a la publicación pública." Also: "Puedes empezar a utilizar Kairo 0.37.0 localmente antes de publicarlo en npm. No necesitamos esperar a que todos los gates de producción estén cerrados."
- S4. What is not authorized, verbatim: "No autorizo todavía sustituir tu instalación global ni utilizar el adaptador Codex corregido en proyectos personales sin cerrar su prueba E2E."
- S5. Pending requirement, verbatim: "No hace falta aprobar un equipo optimizado para empezar a inspeccionar un proyecto. La formación automática de equipos estándar todavía es un requisito pendiente, así que no voy a presentarla como una capacidad ya disponible." Automatic standard team formation is not presented as available anywhere in this document.

Specs S6 to S11 are quoted verbatim from the decision of Log L8 (2026-11-13). No requirement was added.

- S6. The T3 classification, verbatim. Table of section "1. Clasificación definitiva de T3":
  - "Identidad del proyecto" / "PASS"
  - "Integridad del repositorio" / "PASS"
  - "Aislamiento del home" / "PASS"
  - "Configuración global de Codex" / "PASS"
  - "Comandos de diagnóstico" / "PASS según comportamiento esperado"
  - "Inventario previo de procesos" / "INCONCLUSIVE"
  - "Utilidad operativa sin equipo" / "NO DEMOSTRADA"
  - "T3 queda `ACCEPTED_WITH_OBSERVATION`, no `PASS` integral."
- S7. Evidence rule, verbatim: "Conservar el registro L7 y el commit `b9ad712cf`. No alterar retrospectivamente la evidencia ni repetir pruebas para obtener una etiqueta más favorable."
- S8. The two routes of T4, verbatim:
  - "Ruta A — Capacidades existentes": "Validar el flujo actual de equipo propuesto, aprobación explícita, admisión, enrutamiento y ejecución con Reviewer independiente."
  - "Ruta B — Equipos estándar adaptativos": "Registrar e implementar posteriormente un mecanismo para operar sin repetir `team analyze` y `team approve` por cada proyecto."
  - "No mezclar ambas rutas."
- S9. The six items authorized initially for T4, verbatim ("Autorizo inicialmente:"):
  - "1. Verificar que el plugin `0.9.1` corresponde al core `0.37.0-beta.1`."
  - "2. Preparar un `HARNESS_HOME` aislado con una estrategia válida para Inversion."
  - "3. Determinar las rutas disponibles de Claude, Codex y OpenCode sin confundir `entitlement_unverified` con indisponibilidad."
  - "4. Examinar cómo `team analyze` propone el equipo y qué costo en cuota podría tener."
  - "5. Preparar una tarea reversible de alcance mínimo, con Builder y Reviewer de proveedores distintos."
  - "6. Definir las guardas para ejecutar esa tarea sin tocar las configuraciones globales."
- S10. Limits of the T4 authorization, verbatim: "Esta autorización no incluye todavía ejecutar `team analyze`, activar admisión ni lanzar modelos. Esas operaciones deberán estar respaldadas por un contrato de ejecución específico." and "Tampoco autorizo instalar Kairo globalmente ni modificar las inversiones o datos financieros de Inversion."
- S11. Priority, verbatim: "El siguiente hito debe producir evidencia de enrutamiento y ejecución reales, con trazabilidad, límites de permisos y revisión cruzada."

Specs S12 to S16 are quoted verbatim from the decision of Log L11 (2026-11-13). No requirement was added.

- S12. The approved configuration, verbatim. Table of section "1. Configuración aprobada" ("Componente" / "Decisión"):
  - "Proyecto" / "Inversion"
  - "Entorno" / "Worktree aislado"
  - "Tarea" / "Crear `docs/operations/configuration.md`"
  - "Analista" / "`codex/gpt-6.1-sol`"
  - "Builder" / "Codex, seleccionado por capacidades y disponibilidad"
  - "Reviewer" / "Claude, proveedor distinto del Builder"
  - "Sondeos de entitlement Claude" / "Máximo 1 en total, después del reinicio de cuota"
  - "Snapshot saneado del código" / "Autorizado con restricciones"
  - "Ejecuciones de modelos durante preparación" / "0"
  - "Cambios en aplicación, datos o configuración global" / "Prohibidos"
  - "El modelo analista es una elección inicial para este piloto, no una asignación fija de Kairo. Si no está disponible, no sustituirlo silenciosamente por otro."
- S13. The snapshot rules, verbatim (section "2. Snapshot de Inversion"):
  - "Autorizo proporcionar al analista un snapshot limitado a la información necesaria para comprender el proyecto."
  - "Debe incluir arquitectura, objetivos, tecnologías, estructura, dependencias y documentación relevante."
  - "Debe excluir credenciales, archivos `.env`, claves, tokens, datos financieros reales, información personal y otros secretos. También deben excluirse archivos ignorados que no hayan sido revisados explícitamente."
  - "Antes de utilizarlo, generar un manifiesto con archivos incluidos, exclusiones y hashes. No enviar el repositorio completo indiscriminadamente."
- S14. The task scope, verbatim (section "3. Alcance de la tarea"):
  - "La tarea debe producir exclusivamente documentación de operaciones y configuración, basada en evidencia real del proyecto."
  - "No autorizo modificar código de producción, dependencias, variables de entorno, datos de inversión ni infraestructura."
  - "El Reviewer debe comprobar tanto la exactitud técnica del documento como la ausencia de secretos y afirmaciones inventadas."
- S15. The five conditions to advance, verbatim (section "4. Condiciones para avanzar"):
  - "1. Preparar el kit después del reinicio de cuota de Claude, si se requiere esa disponibilidad."
  - "2. Validar la compatibilidad core `0.37.0-beta.1` y plugin `0.9.1`."
  - "3. Ensayar rutas, admisión, worktree, permisos y guardas sin consumir modelos."
  - "4. Verificar que la tarea está autorizada y que Builder y Reviewer pertenecen a proveedores distintos."
  - "5. Presentar el contrato final de ejecución, incluyendo límites de cuota y condiciones de STOP."
  - "No repetir sondeos por resultados `unverified`. Eso es incertidumbre de entitlement, no prueba de indisponibilidad."
- S16. What T4 must demonstrate, verbatim (section "5. Qué quiero demostrar con T4"):
  - "El objetivo no es simplemente conseguir que Codex cree un archivo y Claude lo revise."
  - "Quiero comprobar que Kairo coordina el ciclo completo: entiende el proyecto, asigna capacidades, autoriza la ejecución, utiliza ambos proveedores, verifica el resultado y registra correctamente evidencia, trazabilidad y consumo."
  - "También quiero distinguir qué decisiones fueron automáticas y cuáles fijamos manualmente para el piloto. No declararemos probado el enrutamiento autónomo si seguimos asignando los modelos a mano."

Specs S17 to S22 are quoted verbatim from the decision of Log L13 (2026-11-13). No requirement was added.

- S17. The five rules, verbatim. Table of section "1. Decisión sobre las cinco reglas" ("Regla" / "Decisión" / "Condición"):
  - "1. `claude -p /usage`" / "Aprobada con límite" / "Una lectura como máximo por comando de estado autorizado. Contabilizarla; no asumir costo cero"
  - "2. MCP Engram" / "Modificada" / "Permitir el proceso conocido, pero no escrituras persistentes de memoria durante el piloto"
  - "3. Identidad Engram en `.git`" / "Aprobada" / "`NOTE` si ya existe y permanece intacta"
  - "4. Procesos transitorios R5" / "Aprobada" / "Reutilizar identificación estricta por ejecutable, argumentos y ascendencia"
  - "5. Checkout principal de Inversion" / "Aprobada" / "Puede tener cambios sin commit, pero debe permanecer idéntico durante cada bloque"
- S18. Rule 1 details, verbatim (section "Regla 1 — Cuota de Claude"):
  - "Acepto que Kairo realice la lectura de uso desde los comandos de estado que ya forman parte del contrato."
  - "Pero hay una diferencia importante: que el código clasifique una operación como costo cero no demuestra que el proveedor no contabilice consumo."
  - "Por tanto:"
  - "Registrar cantidad de invocaciones y variaciones observables de cuota."
  - "No ejecutar comandos de estado repetidamente sólo para monitorear."
  - "No hacer sondeos adicionales de entitlement fuera del límite aprobado."
  - "Conservar el inicio de la unidad con modelos para después del reinicio de cuota previsto."
- S19. Rule 2 details, verbatim (section "Regla 2 — Engram"):
  - "Aquí sí cambio la propuesta."
  - "Reconocer el proceso Engram como conocido no implica autorizar a Builder o Reviewer a modificar memorias persistentes."
  - "Durante T4, permitimos lectura de contexto, pero las herramientas de escritura deben quedar deshabilitadas mediante una restricción efectiva, o Engram debe operar sobre un almacén temporal aislado."
  - "Si ninguna de esas condiciones puede garantizarse, se ejecuta T4 sin ese MCP."
  - "Un servidor MCP desconocido debe provocar STOP antes del lanzamiento, o interrupción y clasificación `INCONCLUSIVE` si se descubre durante la ejecución."
  - "Esto evita que una tarea de documentación termine alterando memorias globales sin autorización."
- S20. Rules 3 to 5, verbatim (section "Reglas 3–5 — Sin cambios sustanciales"):
  - "El archivo de identidad de Engram en `.git` es una observación siempre que preexista y permanezca intacto. Una creación o modificación inesperada no es una simple nota."
  - "La allowlist de R5 se mantiene estricta y limitada al kit, sin generalizar permisos a cualquier proceso Codex."
  - "El checkout principal puede contener trabajo sin commitear. El worktree del piloto partirá de un commit identificado y no debe incorporar ni alterar silenciosamente esos cambios locales."
- S21. The functional contract of T4, verbatim (section "2. Contrato funcional de T4"):
  - "Proyecto" / "Inversion — worktree aislado"
  - "Analista" / "Codex / GPT-6.1-Sol"
  - "Builder" / "Codex"
  - "Reviewer" / "Claude"
  - "Único archivo de trabajo autorizado" / "`docs/operations/configuration.md`"
  - "El contenido del documento debe derivarse de la configuración real y saneada del proyecto. No inventar variables, servicios, pasos de despliegue ni comportamientos no comprobados."
  - "También quiero que la evidencia separe expresamente:"
  - "Selección manual del analista y de los proveedores."
  - "Selección efectiva realizada por el router de Kairo."
  - "Ejecución real del Builder."
  - "Revisión independiente del Reviewer."
  - "Resultado de admisión, ledger y trazas."
  - "Así evitaremos declarar autonomía demostrada cuando parte del flujo todavía esté configurada manualmente."
- S22. The next gate, verbatim (section "3. Próximo gate"):
  - "Autorizo cerrar el contrato y preparar la unidad B. No autorizo todavía las llamadas reales a modelos."
  - "Antes de ejecutarlas, el Runner debe presentar un resumen breve de las llamadas previstas, el estado de aislamiento de Engram, los límites de consumo y las condiciones de STOP. No hace falta otra ronda de ensayos completos."
  - "La unidad B debe quedar preparada para ejecutarse después del reinicio de cuota de Claude."
- S23. Real preflight authorization (L15), verbatim:
  - "El Runner debe registrar el estado inicial y comprobarlo después de cada bloque. Si detecta modificaciones inesperadas, STOP."
  - "Crear una rama y un worktree sí modifica metadatos Git compartidos. Esas modificaciones específicas están autorizadas, pero deben distinguirse de cambios al checkout principal."
  - "No deben cambiar su contenido, HEAD, índice, stash ni referencias preexistentes."
  - "Generar exclusivamente el manifiesto: rutas, tamaños, hashes, exclusiones y justificación de los archivos seleccionados."
  - "No enviar todavía código al analista."
  - "Registrar el resultado real como `PASS`, `FAIL` o `INCONCLUSIVE`, conservar evidencia y presentar el manifiesto antes de cualquier ejecución con modelos."
- S24. Preflight round 2 authorization (L17), verbatim:
  - "Ordenar ambas listas de referencias de forma determinista antes de compararlas."
  - "Comparar nombres y valores de referencias, no solamente cantidades."
  - "Permitir exclusivamente la nueva referencia `refs/heads/kairo/t4-pilot-2`."
  - "Rechazar cualquier referencia preexistente modificada o eliminada."
  - "Probar el comparador con datos sintéticos, incluyendo referencias que se ordenen antes y después de la nueva rama."
  - "No modificar el código del producto."
  - "El baseline de la segunda ronda debe reconocer que ya existe `kairo/t4-pilot-1` y su worktree. No deben clasificarse como alteraciones nuevas ni eliminarse para facilitar la prueba."
  - "Si surge otro fallo atribuible únicamente al procedimiento, quiero el diagnóstico concreto antes de autorizar más rondas."
  - "También queda pendiente limpiar los worktrees y ramas temporales una vez que dejen de ser necesarios, preservando primero la evidencia."
- S25. Preflight round 3 conditions (L19), verbatim:
  - "Autorizo clasificarlas como fixtures si el Builder comprueba que son literales utilizados exclusivamente en pruebas, que no provienen de secretos reales ni datos personales y que no se reutilizan como credenciales en ejecución."
  - "Registrar archivo, ubicación, tipo y huella de cada hallazgo aprobado."
  - "Exigir que el snapshot siga siendo idéntico al revisado."
  - "No aceptar coincidencias nuevas simplemente porque el número total siga siendo el mismo."
  - "Mantener el STOP para credenciales potencialmente reales o valores de procedencia desconocida."
  - "Si alguna de las nueve cadenas no puede verificarse, excluirla del snapshot o detener P3."
  - "La tarea cambia de creación a revisión y actualización del documento existente:"
  - "Único archivo modificable: ese documento. Ningún otro archivo, dependencia, dato financiero, configuración o infraestructura."
  - "El Reviewer Claude debe verificar su exactitud, alcance y ausencia de secretos."
  - "Podemos continuar utilizando el mismo kit, siempre que se vuelvan a comprobar las guardas inmediatamente antes del lanzamiento."
  - "No autorizo ampliar ese límite silenciosamente para desbloquear la prueba."
- S26. G4 verification rule (L20), verbatim:
  - "Respecto a G4, mantengo desactivado el wrapper para ejecución real por ahora."
  - "Permito continuar con su verificación sin modelos, pero las doce respuestas locales no pueden presentarse como doce modelos realmente indisponibles. Deben diferenciarse los modelos no sondeados de aquellos cuyo entitlement fue efectivamente comprobado."
  - "Si Kairo no distingue esos estados y la simulación altera la selección del Reviewer, será un defecto de descubrimiento de capacidades que debemos registrar, no ocultar mediante el kit."

## Tasks

- T1 (S1-S5) route inline, status in review by the product owner, amended after the rehearsals (Log L6). Design of the phase 1 procedure and its validation (this document, Log L3). Evidence: none yet, nothing executed.
- T2 (S2) route delegated (runner), status done. Evidence: Log L4 and L5 (first rehearsal FAIL on a real finding, second rehearsal PASS). Commit: none (the parent owns git). Model-free rehearsal of the procedure on a throwaway git repository, with the guards.
- T3 (S1, S2) route delegated (runner), status ACCEPTED_WITH_OBSERVATION by the product owner on 2026-11-13 (Log L8); closed. Evidence: Log L7, commit b9ad712cf. Run on 2026-11-13 on the repository chosen by the product owner (/Users/kal-el/Desktop/Inversion); every command verdict PASS and the repository guard unchanged; round label INCONCLUSIVE because of one Codex process seen in the baseline inventory (Log L7). Pilot on that repository.
- T4 (S1, S2, S8-S26) status: guards approved with changes on 2026-11-13 (Log L13); units A, B1 and B2 prepared and validated model-free; real kit never run; real preflight round 1 stopped at P0 by a kit comparison defect (Log L16), no unexpected change in the main checkout; round 1 classified INCONCLUSIVE; comparator correction and preflight round 2 with `kairo/t4-pilot-2` authorized (Log L17), run: P0 to P2 PASS, STOP at P3 on the secret-like content scan of the snapshot manifest, round INCONCLUSIVE (Log L18); round 3 with `kairo/t4-pilot-3` conditionally authorized (Log L19), run: all ten blocks PASS, `ROUND RESULT: PASS` (Log L21); G4 model-free verification and the execution authorization for G1, G6 and G7 pending; execution authorization pending; no real model call authorized yet. Earlier: scenario approved for kit preparation and model-free rehearsal on 2026-11-13 (Log L11); real execution not authorized yet; next gate: the final execution contract (S15 item 5). Earlier: preparation authorized on 2026-11-13 (Log L8), the six preparation items of S9; no team analyze, no admission activation and no model call until a specific execution contract is approved. Context: the Codex trust fix is verified end to end and integrated in the candidate since 2026-11-13 (release/v0.37.0 at 10b64c801). Phase 2, multi-provider delegation.
- T5 (S1) status pending. Phase 3, habitual local installation with a compatible plugin and an update and recovery procedure.
- T6 (S8) route B, adaptive standard teams (operate without repeating team analyze and team approve for each project); status open, not started; later, never mixed with T4; tracked as MA38 in odd/tasks/kairo-runtime-mvp.md.

## Log

### L1 (2026-11-13) The decision, verbatim

Puedes empezar a utilizar Kairo 0.37.0 localmente antes de publicarlo en npm. No necesitamos esperar a que todos los gates de producción estén cerrados.

Lo que sí necesitamos es separar uso local controlado de instalación estable para todos tus proyectos.

## Estado actual

| Modalidad                               | Estado                                        |
| --------------------------------------- | --------------------------------------------- |
| Kairo instalado actualmente (0.36.0)    | Disponible, pero sin las últimas correcciones |
| Kairo 0.37.0 en entorno temporal        | Ya se ha probado                              |
| Kairo 0.37.0 en otros proyectos locales | Pendiente de habilitar el piloto              |
| Actualización global a 0.37.0           | Todavía no recomendada                        |
| Publicación en npm                      | Bloqueada                                     |

El principal obstáculo es el hallazgo #10: todavía estamos validando que el adaptador de Codex no modifique silenciosamente tu configuración global.

## Mi propuesta: empezar con un Local Canary

Fase 1 — Uso local controlado

Preparación autorizada

Usar el candidato desde una ubicación aislada en un proyecto secundario, sin reemplazar tus binarios actuales. Inicialmente, análisis, diagnóstico, exploración y operaciones de solo lectura.

Fase 2 — Delegación multiproveedor

Tras cerrar #10

Permitir implementaciones con Claude y Codex en worktrees separados, comprobando permisos, rutas y configuración.

Fase 3 — Instalación local habitual

Pendiente

Instalar una versión validada para tus diferentes proyectos, con plugin compatible y procedimiento de actualización y recuperación.

## Qué necesitamos para empezar

Propongo un piloto en uno de tus repositorios secundarios, con estas condiciones:

1. Invocar Kairo desde el build local validado, no desde `PATH`, donde conviven varias versiones antiguas.
2. Utilizar `HARNESS_HOME` temporal o dedicado para no alterar los equipos existentes.
3. No ejecutar `setup --yes`, `sync`, `retire` ni otras operaciones que escriban configuración global sobre tu instalación actual.
4. Comenzar por `doctor`, inspección del proyecto y evaluación de capacidades.
5. Activar delegaciones de escritura sólo después de validar el aislamiento y la compatibilidad del plugin.

No hace falta aprobar un equipo optimizado para empezar a inspeccionar un proyecto. La formación automática de equipos estándar todavía es un requisito pendiente, así que no voy a presentarla como una capacidad ya disponible.

## Mi decisión

`OD-KAIRO — LOCAL_CANARY_PREPARATION_APPROVED`

Autorizo preparar ahora el uso local de 0.37.0 en otros proyectos, sin esperar a la publicación pública.

No autorizo todavía sustituir tu instalación global ni utilizar el adaptador Codex corregido en proyectos personales sin cerrar su prueba E2E.

### ¿Cuándo podrás usarlo normalmente?

No puedo darte una fecha fiable con los bloqueantes actuales. El camino más corto es:

Cerrar R5/#10 → integrar la corrección → verificar plugin y paquete → habilitar el canary con delegación → ampliar a tus demás proyectos.

No necesitamos terminar antes el rediseño de células, el soporte sin Git o la integración avanzada con Obsidian. Esas mejoras pueden llegar incrementalmente.

Mi recomendación es empezar ya con el canary de solo lectura y habilitar el trabajo autónomo multiproveedor en cuanto cerremos #10. Así podremos validar Kairo sobre proyectos reales, en lugar de seguir dependiendo exclusivamente de pruebas artificiales.

### L2 (2026-11-13) Verified facts about the machine and the code

Verified by commands on 2026-11-13 (orchestrator):
- The first kairo on PATH is ~/.local/bin/kairo, reporting 0.36.0. It is an npm link to the development checkout ~/Desktop/agentic-harness, on whatever branch is checked out there (today feat/router-provider-authority), so the installed 0.36.0 is live development code and not a pinned release. Two older copies also sit on PATH: ~/Library/pnpm/kairo reporting 0.2.2 and /opt/homebrew/bin/kairo reporting 0.16.0.
- The candidate worktree release-v0.37.0 is at b0e3bb9b4, version 0.37.0-beta.1, clean.
- Home resolution: src/global/paths.js lines 6 to 8, resolveHomeDir returns the HARNESS_HOME variable when set, else the user home.
- The Claude entitlement probe is a real model call: src/global/observability/claude-model-entitlement.js builds the arguments -p hi --model MODEL --output-format json and spawns claude (lines 42 to 43 and about 126).
- In round 4 of the finding 10 validation, a team route refresh in a temporary Kairo home ran these claude commands only: the usage print, auth status, the version. It made zero model-reaching claude calls, created no Codex session file, and left the protected Codex files unchanged. So a refresh starts provider programs but was not observed to call a model.
- Two resident Codex processes exist on this machine (an app-server daemon update loop started by launchd and its child app-server), release 0.169.0 under the Codex home packages folder.

Mapped by reading the candidate code (from code reading, not executed):
- Layout under the Kairo home: .harness with state.json, runs, reviews, monitor, backups, usage, worktrees and more (src/global/paths.js lines 10 to 37).
- Direct reads of the real home that ignore HARNESS_HOME: src/global/runtime/codex-delegated-sandbox.js line 45, src/global/runtime/codex-write-containment.js line 93, src/global/team/codex-sandbox.js line 86, src/global/observability/agent-session-telemetry.js lines 126 and 185, src/global/integrations/engram-evidence.js lines 108 and 122, src/global/team/claude-hooks.js line 131, src/global/runtime/monitor/monitor-platform.js line 13 (launch agents). No global git config write and no shell profile edit were found.
- doctor: no write and no auto-repair path found (its messages only tell the user to run sync or monitor disable). It runs opencode auth list when opencode is on PATH (src/global/intelligence/backends/opencode-evidence.js lines 24 to 34), always performs a GET to the local Ollama tags endpoint (src/global/intelligence/backends/ollama.js lines 23 to 27), and fetches the OpenRouter and OpenCode model lists only when a key is set (backends/openrouter.js lines 25 to 34, backends/opencode-catalog.js lines 66 to 70).
- team show, team routes, team route without refresh, team admission status and team verdict with the pending option read caches and ledgers only (src/global/team/team-cli.js lines 607 to 611, routing-input-cache.js lines 340 to 362, launch-decision.js lines 521 to 533, admission-contract.js lines 213 to 221, launch-ledger.js lines 337 to 343). They need a git repository (resolveProjectRoot, src/global/architect/architect-store.js lines 50 to 58).
- team route with refresh writes the routing cache and may persist manual picks and reform the team strategy under the Kairo home (src/global/team/service.js lines 1629 to 1660) and starts codex app-server (src/global/observability/codex-usage.js line 100, codex-models.js line 42) and cursor-agent models (cursor-models.js line 80).
- team analyze, even as a preview without its yes option, calls readSetup and preflightProject, which take a provider snapshot and run provider probes (service.js lines 1787 to 1788, 1848 to 1860, 1287, 1316 to 1322). With the yes option and an analyst it spends provider usage and writes a pending proposal (team-cli.js lines 282 to 289).
- team pacing without its no-wait option refreshes when the cache is stale (src/global/team/pacing-cli.js lines 85 to 100). Hooks run pacing with no-wait, which starts a detached refresh through the checkout's own bin/kairo.js (src/global/team/background-refresh.js lines 28 to 40).
- No environment variable or flag that disables provider probes was found.
- The plugin version and the core commit are compared only on admission enable and activate (admission-contract.js lines 144 to 151 and 240). The read-only commands neither fail nor warn on a plugin mismatch as far as traced.
- Running from a checkout needs Node 22.19.0 or newer and the dependencies, which are present in that worktree. No build step and no start-up self-update check were found.
- Not traced: whether doctor and team show work outside a git repository; whether codex app-server writes into the real Codex home during a refresh (round 4 observed no protected change); the workspace scope of doctor.

### L3 (2026-11-13) Phase 1 procedure (PROPOSAL for product owner review; NOT executed)

Built only from the decision (L1) and the facts (L2). Steps a runner or the owner can follow. Locations marked "assumption" are proposals, not decisions.

1. Build identity. Use the candidate worktree /Users/kal-el/Desktop/agentic-harness-worktrees/release-v0.37.0 at commit b0e3bb9b4 (version 0.37.0-beta.1) with a clean tree. Invoke it as `node` followed by the absolute path of its bin/kairo.js, never a kairo found on PATH (S2 condition 1). At the start of every session check the identity: HEAD equals b0e3bb9b4, tree clean, the version string, and Node version at least 22.19.0. This candidate does NOT contain the Codex trust fix (branch fix/codex-trust-override, not yet integrated), which is one more reason why phase 1 launches no Codex execution.
2. Dedicated Kairo home. Assumption: /Users/kal-el/Desktop/agentic-harness-worktrees/canary-home, created empty (the owner may choose another location). It is never the real home state. HARNESS_HOME is set only in the terminal session of the canary: no shell profile edit and no alias written to disk (S2 condition 2).
3. Honest limit. HARNESS_HOME is not a sandbox. It relocates Kairo's own state only; several modules read the real home directly (L2) and every provider child runs with the real HOME and credentials. The procedure therefore relies on a command allowlist plus before and after guards, not on HARNESS_HOME alone.
4. Allowlist for phase 1, in this order. The team commands need a git repository. With an empty Kairo home they are expected to report that no team exists, which is the documented current behavior (automatic standard teams are a pending requirement, S5).
   1. version: prints the version of the candidate; touches nothing.
   2. doctor: reports health; no write and no auto-repair path found (from code reading). Network reads: runs opencode auth list when opencode is on PATH, always one GET to the local Ollama tags endpoint, and model-list fetches for OpenRouter and OpenCode only when a key is set.
   3. team admission status: reads the admission contract state; caches and ledgers only (from code reading).
   4. team show: reads the team state of the project; caches and ledgers only (from code reading).
   5. team routes: reads the routing cache; caches and ledgers only (from code reading).
   6. team route without refresh: reads the cached routing decision; caches and ledgers only (from code reading).
   7. team verdict with the pending option: reads the ledgers; caches and ledgers only (from code reading).
5. Gated commands. Not part of the default phase 1. Each runs only with an explicit go from the product owner, every time, because it starts provider programs with the real credentials and can spend quota:
   - team route with refresh: writes the routing cache and may persist manual picks and reform the team strategy under the Kairo home; starts codex app-server and cursor-agent models. Round 4 observed no model-reaching claude call, but a refresh was only observed once.
   - team analyze, also in preview: takes a provider snapshot and runs provider probes; with the yes option and an analyst it spends provider usage and writes a pending proposal.
   - team pacing without its no-wait option: refreshes when the cache is stale.
6. Forbidden in the canary: setup (with or without yes), sync, update, upgrade, install or init, retire, uninstall, rollback, components install or configure, hooks, plugin installation, team approve, assign, reject and rebuild, team admission enable, activate and disable, team exec, team escalate, the record commands, team roles init (it writes .kairo/roles.json inside the project), aa-key config, obsidian config.
7. Guards before and after every session. Hash, size and modification time only, never contents:
   - the real Codex config file;
   - the real Claude settings files and the plugin folder listing;
   - the real Kairo home (~/.harness) listing fingerprint;
   - the three Codex links (the local bin link, the standalone current link, the daemon current link);
   - the inventory of Codex processes: the two known resident processes are expected; any other Codex process started by a canary command in phase 1 is a finding;
   - the project working tree: git status must be unchanged.
   Reuse or adapt, rather than rewrite, the helpers that already exist in the kit directory /Users/kal-el/Desktop/agentic-harness-worktrees/release-v0.37.0-pilot-evidence/final-e2e-trust-fix-r4-codex-0.168.0: codex-guard.sh, realhome-check.sh and procs.sh.
8. Stop rule. Any guard difference stops the session. Nothing is restored automatically. The difference is classified and reported to the product owner.
9. Rollback. Remove the dedicated Kairo home. Nothing else is created by phase 1. No global install, link or configuration is changed, so there is nothing else to undo.
10. Validation before the pilot (task T2). A model-free rehearsal on a throwaway git repository runs the allowlist once with the guards, to confirm empirically that each allowlisted command is read-only on this machine (the code map is from reading, not from running), and to record the exact output of each command for a home with no team.
11. Evidence. One folder per session next to the other pilot evidence, with the guard outputs and the command outputs. Each session ends with a result of PASS, FAIL or INCONCLUSIVE.
12. Open points for the product owner:
    - which secondary repository the pilot uses (T3);
    - the location of the dedicated Kairo home (assumption in step 2);
    - whether doctor's network reads (step 4.2) are acceptable in phase 1;
    - whether any gated command (step 5) should be allowed in the pilot.

### L4 (2026-11-13) First rehearsal (kit release-v0.37.0-pilot-evidence/local-canary-rehearsal-1): ROUND RESULT FAIL, on a real finding

Facts: candidate release-v0.37.0 at b0e3bb9b4, version 0.37.0-beta.1, invoked as node (22.23.0) followed by the absolute path of bin/kairo.js; an empty dedicated Kairo home and a throwaway git repository created inside the kit; no model call. R2 (version) PASS. R3 (doctor, run from the throwaway repository) got verdict FAIL and raised the stop flag, so the five team commands did not run. Reason: after doctor the throwaway repository held two new untracked files, .atl/skill-registry.md (11102 bytes, with the header "Auto-generated by gentle-ai skill-registry refresh") and .atl/.skill-registry.cache.json (64 bytes). doctor wrote nothing under the dedicated Kairo home; its only child program was opencode (doctor runs opencode auth list, src/global/intelligence/backends/opencode-evidence.js line 34); the candidate source never writes that folder (it only reads .atl/skill-registry.md, src/global/intelligence/skill-catalog.js line 83); the user's OpenCode configuration carries the gentle-ai integration. Attribution, by inference from that evidence: the opencode child started in the project directory generated the registry there. Every other guard was clean: protected Codex files unchanged (36 files, 5 folders), real Kairo home and Codex links unchanged, the two approved resident Codex processes unchanged and no other Codex process; only the host-written file .claude.json changed size or modification time (a note). doctor exited with status 1 and the text "DRIFT DETECTED — run "kairo sync" to auto-repair managed content", which is expected for an empty Kairo home; sync stays forbidden in the canary. This contradicts the code-reading map of L2, which had doctor as read-only: on this machine doctor run inside a project is not read-only for that project.

### L5 (2026-11-13) Second rehearsal (kit release-v0.37.0-pilot-evidence/local-canary-rehearsal-2): ROUND RESULT PASS

Facts: candidate release-v0.37.0 at 10b64c801 (after the local fast-forward of the same day it contains the Codex trust fix), clean, version 0.37.0-beta.1; node 22.23.0; an empty dedicated Kairo home, a throwaway git repository and an empty neutral working directory (not a git repository) inside the kit; no model call. The seven allowlisted commands ran once each: version exit 0, output 0.37.0-beta.1; doctor, run from the neutral working directory, exit 1, reporting the state file of the Kairo home as missing and drift detected, child program opencode; team admission status exit 0, state inactive, reason absent; team show exit 1, "No draft team yet. Run kairo team analyze."; team routes exit 0, "No approved team for this project."; team route for the reviewer agent without refresh exit 1, decision ERROR with code no_approved_team; team verdict with the pending option exit 0, "No pending verdicts.". For every command: nothing written under the dedicated Kairo home, nothing written in the neutral working directory, the throwaway repository unchanged, no unapproved Codex process, no child program except opencode for doctor. With doctor run from the neutral directory the gentle-ai registry files appeared nowhere. Guards after: protected Codex files unchanged (36 files, 5 folders), global links unchanged, the two approved resident Codex processes unchanged; .claude.json size or modification time changed (host-written, a note). So on this machine the seven allowlisted commands are read-only when doctor is run from a neutral directory, and a home without a team answers with the messages above (automatic standard teams remain a pending requirement, S5).

### L6 (2026-11-13) Amendments to the phase 1 procedure of L3 (proposal, for product owner review)

- Step 1: the candidate is release-v0.37.0 at 10b64c801 and contains the Codex trust fix; phase 1 still launches no Codex execution, because that is the scope of phase 1.
- Step 4: doctor is run from a neutral working directory outside the project (it is an agent-global command), never from inside the project; the project stays a protected state for every command.
- Step 7: add the neutral working directory to the listings taken before and after each command.
- Known behavior to expect in a home without a team: the exit statuses and messages of L5; a non-zero exit of team show and team route there is not a failure of the canary.
- Product observation for later, not part of the canary: Kairo could start opencode auth list from a neutral directory so that doctor never leaves files in a project. Not implemented.
- Limits of the rehearsals: one run each, on a throwaway repository; the process and socket sampling runs every 0.2 seconds, so very short connections can be missed; the gated commands (team route with refresh, team analyze, team pacing) were not run.

### L7 (2026-11-13) Pilot on a real repository (kit release-v0.37.0-pilot-evidence/local-canary-pilot-1): seven commands PASS, repository unchanged, round label INCONCLUSIVE

Product owner's instruction (Spanish, verbatim): "Ejecutar los mismos siete comandos de T3, conservando el HARNESS_HOME dedicado, el cwd neutro para doctor y todas las guardas aprobadas. Alcance: exclusivamente lectura. Sin sync, setup, team analyze, delegaciones, instalaciones globales ni modificaciones al repositorio." and "No basta con confirmar que Kairo no escribe archivos. También quiero conocer su comportamiento real al abrir otro proyecto: qué detecta doctor, qué información puede consultar sin equipo aprobado y qué capacidades siguen bloqueadas."

Repository: /Users/kal-el/Desktop/Inversion; physical path and git top level equal to that path; its own git repository (the .git folder inside it), one worktree, no remote, branch feat/phase-1-foundation, HEAD c4fee688b4aba9aa347e906873641e32feb933e2, clean working tree, 89 tracked files, about 35755 entries outside .git; it already held an .atl folder and an odd folder; not part of the Kairo Runtime repository. Single match; no other project was looked for.

Candidate: release-v0.37.0 at 10b64c801, clean, version 0.37.0-beta.1, invoked as node 22.23.0 followed by the absolute path of bin/kairo.js; an empty dedicated Kairo home and an empty neutral working directory inside the kit; no model call.

Results per command: version, exit 0, 0.37.0-beta.1; doctor (from the neutral directory), exit 1; team admission status, exit 0, state inactive, reason absent, the contract path derived under the dedicated home with project key 51aca7792ee99b0d; team show, exit 1, "No draft team yet. Run kairo team analyze."; team routes, exit 0, "No approved team for this project."; team route for the reviewer agent without refresh, exit 1, decision ERROR, code no_approved_team, message "No approved team for this project. Analyze and approve a project team first."; team verdict with the pending option, exit 0, "No pending verdicts.". Every command: verdict PASS; nothing written under the dedicated Kairo home; nothing written in the neutral directory; no child program except opencode for doctor; no socket seen; no unapproved Codex process during the command.

Repository guard, compared before and after every command and at the end: unchanged in all seven items (git status including ignored files, HEAD, branch, refs, stash count and worktree count, the listing of every entry outside .git with size and modification time, the tracked content summary, the .git top level, the hash of the index, HEAD and config files, and the hash of every file in .atl and odd). The gentle-ai registry files appeared nowhere new.

Other guards at the end: protected Codex files unchanged (36 files, 5 folders); global links unchanged; .claude.json changed size or modification time (host-written, a note); final Codex process inventory exactly the two approved resident processes.

Why the round label is INCONCLUSIVE: the baseline inventory taken before any command saw a third Codex process, pid 11091, with the arguments app-server --listen stdio://, version unreadable, which was gone from the next inventory onward. This kit predates the transient class approved for round 5 of the trust validation, so it classified that process as foreign and, by its own rule, marked the round INCONCLUSIVE. The process matches the pattern of the readers started by Kairo's installed routing hook (L91 of odd/tasks/kairo-runtime-mvp.md), but its origin was not verified in this run. It was seen before the first command of the pilot ran. No protected state changed.

What doctor reported (agent-global scope, home = the dedicated Kairo home): the state file of the home missing ("Run kairo install first"); backups: no snapshots; intelligence providers: OpenCode Go configured with entitlement unverified, OpenCode CLI runtime not authenticated by Kairo, cloud invoke still needing consent; monitor disabled (opt-in); Artificial Analysis key configured from the environment; context diagnosis: 0 instruction files, 0 duplications, 0 MCP servers; status DRIFT DETECTED with the advice to run sync (forbidden in the canary). doctor's output named no Claude and no Codex provider. Run from the neutral directory, doctor's context diagnosis reads neither the pilot repository nor the real home.

What can be consulted without an approved team: the version; the doctor report above; the admission contract state of the project (inactive, absent) and its project key; that no draft team, no approved team, no route and no pending verdict exist.

What stays blocked without an approved team: any route for any role (code no_approved_team), and therefore any delegation; the only path Kairo offers is to analyze and approve a project team, and team analyze is a gated command of this canary (it starts provider programs with the real credentials and can spend usage) while team approve and the admission enable and activate commands are forbidden in phase 1. None of the seven read-only commands inspects the contents of the project: nothing specific to the repository was detected or reported beyond its path and project key.

Reading of the three layers the product owner named: local isolation, validated on the throwaway repository (L5) and confirmed on this repository (repository guard unchanged); compatibility with another project: the candidate resolves the project root, derives a project key and answers every read-only command without error on a real repository with its own .atl and odd folders; autonomous multi-provider operation: not exercised, it is task T4.

Limits: one run; the round label is INCONCLUSIVE as explained; the project key check of the kit does not cover the admission status command itself; sampling every 0.2 seconds.

### L8 (2026-11-13) The decision OD-KAIRO T3_ACCEPTED / T4_AUTHORIZED, verbatim

## Decisión: `OD-KAIRO — T3_ACCEPTED / T4_AUTHORIZED`

Elijo la opción 1: aceptar T3 y avanzar a T4. No repetir el canary.

La evidencia demuestra que Kairo 0.37.0-beta.1 puede ejecutarse contra Inversion sin modificar el repositorio, el home dedicado ni la configuración de Codex.

La etiqueta `INCONCLUSIVE` proviene de una limitación del inventario de procesos anterior a la ejecución, no de un fallo observado durante los siete comandos.

### 1. Clasificación definitiva de T3

| Componente                    | Resultado                          |
| ----------------------------- | ---------------------------------- |
| Identidad del proyecto        | PASS                               |
| Integridad del repositorio    | PASS                               |
| Aislamiento del home          | PASS                               |
| Configuración global de Codex | PASS                               |
| Comandos de diagnóstico       | PASS según comportamiento esperado |
| Inventario previo de procesos | INCONCLUSIVE                       |
| Utilidad operativa sin equipo | NO DEMOSTRADA                      |

T3 queda `ACCEPTED_WITH_OBSERVATION`, no `PASS` integral.

Conservar el registro L7 y el commit `b9ad712cf`. No alterar retrospectivamente la evidencia ni repetir pruebas para obtener una etiqueta más favorable.

## 2. T4: comenzar la validación operativa real

Autorizo preparar T4 sobre Inversion, pero con un objetivo diferente: demostrar que Kairo puede realizar trabajo útil mediante células multiproveedor, no simplemente responder a comandos.

Hay que distinguir dos rutas.

Ruta A — Capacidades existentes

Validar el flujo actual de equipo propuesto, aprobación explícita, admisión, enrutamiento y ejecución con Reviewer independiente.

Ruta B — Equipos estándar adaptativos

Registrar e implementar posteriormente un mecanismo para operar sin repetir `team analyze` y `team approve` por cada proyecto.

No mezclar ambas rutas. T4 debe comprobar primero si la arquitectura existente funciona; el equipo estándar es una mejora funcional, no una excusa para alterar las garantías de admisión.

### 3. Contrato de T4

Autorizo inicialmente:

1. Verificar que el plugin `0.9.1` corresponde al core `0.37.0-beta.1`.
2. Preparar un `HARNESS_HOME` aislado con una estrategia válida para Inversion.
3. Determinar las rutas disponibles de Claude, Codex y OpenCode sin confundir `entitlement_unverified` con indisponibilidad.
4. Examinar cómo `team analyze` propone el equipo y qué costo en cuota podría tener.
5. Preparar una tarea reversible de alcance mínimo, con Builder y Reviewer de proveedores distintos.
6. Definir las guardas para ejecutar esa tarea sin tocar las configuraciones globales.

Esta autorización no incluye todavía ejecutar `team analyze`, activar admisión ni lanzar modelos. Esas operaciones deberán estar respaldadas por un contrato de ejecución específico.

Tampoco autorizo instalar Kairo globalmente ni modificar las inversiones o datos financieros de Inversion.

## 4. Hallazgo importante: `doctor` no entiende suficientemente el proyecto

El resultado de T3 confirma una limitación que debemos atender.

`doctor` desde un directorio neutro valida principalmente la instalación y el entorno, pero no equivale a analizar un proyecto.

Quiero separar formalmente:

- `kairo doctor`: salud de instalación, proveedores, configuración y herramientas.
- `kairo project inspect`: inventario local y determinista de arquitectura, documentación, tecnologías y estructura.
- `kairo team analyze`: interpretación del contexto y propuesta de células.

`project inspect` es una capacidad propuesta, no un comando existente. Su diseño debe permitir obtener información útil sin consumir cuota ni requerir un equipo previamente aprobado.

Esto responde directamente al problema observado: Kairo reconoce Inversion, pero todavía no lo comprende.

## 5. Prioridad inmediata

No quiero más ciclos de validación que únicamente demuestren que Kairo no modifica archivos.

El siguiente hito debe producir evidencia de enrutamiento y ejecución reales, con trazabilidad, límites de permisos y revisión cruzada.

Instrucción para el equipo:

> Registrar T3 como `ACCEPTED_WITH_OBSERVATION`. Cerrar esa fase y preparar T4 sobre Inversion, con alcance reversible, home aislado, plugin compatible y contrato de ejecución explícito. No gastar cuota ni modificar el proyecto hasta tener definido el escenario.

La siguiente decisión será sobre la ejecución concreta de T4, no sobre repetir T3.

### L9 (2026-11-13) T4 preparation: facts for the six items (code reading of the candidate release-v0.37.0 at 10b64c801, plus read-only checks; nothing was executed against Inversion and no quota was spent)

#### Item 1. Plugin 0.9.1 and core 0.37.0-beta.1

- Verified by command: the candidate carries core 0.37.0-beta.1 and plugin 0.9.1 in its tree (integrations/claude-code/kairo-router/.claude-plugin/plugin.json). The development checkout that the kairo on PATH points to carries core 0.36.0 and plugin 0.8.0 in its tree. The plugin installed in Claude Code is kairo-router@kairo 0.7.5 (the plugin cache holds 0.7.2, 0.7.3 and 0.7.5).
- From code reading: the core reads the checkout's own plugin.json and records that version in the admission contract when the contract is enabled (src/global/team/admission-contract.js lines 149 to 150, 240, 252). The core never compares it with the installed plugin. The only version check is in the plugin itself and only prints a restart notice (hooks/register.ts lines 291 to 299).
- From code reading: the contract becomes effective when the three consumers hook, team-exec and service-route report the protocol kairo.launch-directive/v1 (admission-contract.js lines 29, 64 to 69, 81). The hook's report is supplied by the caller of the activate command.
- Conclusion: plugin 0.9.1 corresponds to the candidate core, but it is not the plugin that a Claude process on this machine loads.

#### Item 2. Isolated Kairo home with a valid strategy for Inversion

- From code reading: the strategy lives at sessions/PROJECT_KEY/project-strategy.json under the Kairo home (src/global/team/project-strategy-store.js lines 21 to 23, 37 to 50). A strategy counts as approved when its status is active and it has an approvedAt value, set by the approve operation after its blockers pass (src/global/team/service.js lines 2483 to 2585). A route refuses any strategy that is not active (src/global/team/project-router.js line 284). Routing and exec also need a routing cache written against the same approvedAt and younger than 30 minutes (src/global/team/routing-input-cache.js lines 35 and 241 to 246; src/global/team/team-exec.js lines 61 to 73). The profile fingerprint is not re-checked on the route or exec path.
- From code reading: approve and assign work only on a draft (status suggested). A draft comes from analyze with an analyst and the yes option, or from rebuild when a stored analysis exists. Assign changes an existing seat or an unseated role and cannot create a role that the draft does not hold. Manual picks, reject and copying a strategy file do not create an approved seat (src/global/team/setup-operations.js lines 225 to 290; src/global/team/team-cli.js lines 300 to 330 and 488 to 550).
- Conclusion: with an empty dedicated home there is no supported way to an approved strategy for Inversion without one analyst model call.
- From code reading: the project key of a linked git worktree is the key of its main checkout (src/global/next/project-key.js), so a worktree shares the strategy, cache and ledger of the main checkout, while the project root used for execution is the worktree itself (src/global/architect/architect-store.js lines 50 to 62).

#### Item 3. Routes of Claude, Codex and OpenCode ("not proven" is not "not available")

- Codex: verified by the round 5 run of the trust validation: a seat on codex with gpt-6-luna was ROUTED and executed through team exec from this code. Reading the Codex account and model list starts codex app-server and is not a model call.
- Claude, from code reading: a Claude seat waits when the model entitlement is unverified. The entitlement probe is a real model call, claude -p hi --model MODEL (src/global/observability/claude-model-entitlement.js line 42), run by the verify access operation with refresh, capped at 12 probes (src/global/team/service.js lines 135 and 1910). Observed in rounds 4 and 5: in a fresh home the three Claude seats showed WAIT_FOR_PROJECT_TEAM with entitlement unverified and no evidence. State: not proven. The claude program is installed and its auth status is read without a model call.
- OpenCode, from code reading: an execution adapter exists (src/global/runtime/execution-adapters/opencode.js: opencode run --format json, with --auto only for the widest permissions). Doctor reported OpenCode Go as configured with entitlement unverified. The router needs the entitlement to be allowed or not applicable, so unverified blocks routing (src/global/intelligence/backends/opencode-evidence.js lines 5, 91, 106 to 110). State: not proven, not routable today; not the same as unavailable.
- Other programs installed (verified by command, presence only): cursor-agent and gemini.

#### Item 4. How team analyze proposes the team and what it can cost

- From code reading: options analyst, yes, goal, json, cwd, dry-run (src/cli.js lines 879 to 900). The yes option without an analyst is refused (analyzer required). There is no automatic analyst choice. Without the yes option it is a preview with no analyst call.
- From code reading: with an analyst and yes it makes one analyst call (src/global/team/service.js lines 1112 to 1200). The analyst works on a sanitized snapshot of the project capped at 400 files, 256 KiB per file and 4 MiB in total, with a structural profile in the prompt (src/global/team/sanitized-snapshot.js lines 77 to 79 and 206; src/global/team/project-analysis.js line 48). So project source text is sent to the analyst's provider.
- From code reading: before the analyst call it checks eligibility with status reads (claude auth status, the Codex app-server catalog, cursor-agent models, HTTP catalog reads for OpenCode Go and Artificial Analysis). These are not model calls. The Claude entitlement probes are not part of analyze.
- Estimate (inference from code, not run): one model-reaching call for analyze in the best case; if the Claude seat must be proven, additional Claude probes of a few tokens each, up to 12.

#### Item 5. A reversible minimal task with Builder and Reviewer on different providers

- From code reading: team exec builds the launch with no permissions (src/global/team/team-exec.js line 247). For Claude that gives claude -p with stream-json output, permission mode auto and no permission prompts, in the project root, for ANY role, so a Reviewer on Claude can also write. The read-only form of the adapter exists but team exec never requests it (src/global/runtime/execution-adapters/claude.js lines 72 to 100). The Claude child environment keeps PATH, HOME and CLAUDE_CONFIG_DIR and drops HARNESS_HOME (claude.js lines 9 to 31).
- From code reading: for Codex the launch is the per-invocation untrusted projects override, the model, exec, json, approve-for-me and the task, in the project root. Approve-for-me means the workspace-write sandbox. Team exec cannot request the strict mode with verified write containment (src/global/runtime/execution-adapters/codex.js lines 23 to 66).
- From code reading: team exec runs in the project root, never in a separate worktree; the execution worktree orchestrator has no production caller.
- From code reading: the installed plugin registers hooks for session start, prompt submit and tool calls (Edit, Write, Bash, Agent) and calls a bare kairo found on PATH (hooks/register.ts lines 600, 709 to 717, 885).
- Inference, not tested: a claude process started by team exec loads the installed plugin 0.7.5. Its hooks call the kairo on PATH (0.36.0) against the real Kairo home, because HARNESS_HOME is not passed. Its write guard, which treats a session without an agent id as the orchestrator, would deny Edit and Write in that child.
- From code reading: roles include Builder and Reviewer. Reviewer is declared independent of Builder (src/global/intelligence/role-registry.js lines 69, 136, 161, 216). The router excludes the writer's provider for the reviewer (src/global/team/project-router.js lines 352 to 384). A verdict is recorded with team verdict, agent, result and execution id. Task credit is provisional (src/global/team/launch-ledger.js lines 329 to 372; src/global/team/task-governance.js lines 70 to 81 and 148 to 149).
- Verified by command: Inversion is a Rust workspace (crates finance, pil, reporting, security, storage; a dashboard), 89 tracked files, one Markdown file (odd/tasks/phase-1-foundation.md), clean. Its own specification says, verbatim: "IA sin autoridad financiera. Los agentes podrán analizar información y generar recomendaciones, pero nunca acceder directamente a credenciales bancarias, ejecutar inversiones o autorizar movimientos de fondos." It lists as a pending deliverable the operations documentation docs/operations/configuration.md, backups.md and recovery.md (its S14).

#### Item 6. Guards

- Guards already built and exercised: the pinned Codex binary and its hash; the Codex process inventory with the two approved resident processes and the transient class of round 5; the real Codex config hash and the 36 protected files and 5 folders; the real Kairo home and Claude settings fingerprints; the three Codex links; the strict repository guard of the pilot (seven items); the ledger and routing trace correlation by execution id; the served model read from the session.
- New guards needed for T4: an allowlist of paths the Builder may change in the working copy; proof that the Reviewer changed nothing; proof that the main checkout of Inversion stays unchanged; a check of what the Claude child's hooks touched in the real Kairo home.

Gaps of the mapping, stated as gaps: which command reaches the strict Codex containment; the exact command form of the access verification; whether rebuild makes a model call; the behavior of the plugin 0.7.5 hooks against the candidate command line. None of this was run.

### L10 (2026-11-13) T4 execution contract: PROPOSAL for product owner decision (nothing executed)

Scenario proposed:

- Cell: Builder on Codex, Reviewer on Claude. Reasons: Codex writes inside its workspace-write sandbox with the trust override that round 5 verified; Claude as a writer would run with automatic permissions and, by inference, be blocked by the installed plugin's write guard; OpenCode is not routable today.
- Working copy: a linked git worktree of Inversion on a new branch, created outside the Inversion folder, so the main checkout's files stay untouched and the work is removed by deleting the worktree and the branch. It adds a branch and worktree metadata to Inversion's .git folder. A local clone would add nothing to Inversion but would be a different project identity. Proposed: the worktree.
- Task: write docs/operations/configuration.md as defined by Inversion's own S14 (every environment variable, file location and permission), derived only from the code of the repository, each statement with its source file and line, saying "not defined in the code" where that is the case. One new documentation file. No code change, no data, no credentials, no build. The Reviewer checks each statement against the code and returns a verdict with the list of wrong or unsupported statements.
- Models: Builder codex gpt-6-luna (the one already verified on this route) unless the product owner names another; Reviewer claude-sonnet-5-5; analyst to be named by the product owner.

Sequence, each step marked with: model call yes or no; starts a provider program; writes under the dedicated Kairo home; writes in the working copy; needs the product owner's interactive terminal:

1. Baseline guards and creation of the working copy. Model call: no. Provider program: no. Dedicated home: no. Working copy: created. Product owner's terminal: no.
2. team analyze with the analyst and the yes option and a goal. Model call: yes, ONE analyst call. Provider program: yes. Dedicated home: writes the draft. Working copy: no. Product owner's terminal: no. It sends a sanitized snapshot of the repository source to the analyst's provider.
3. team assign for the Builder and for the Reviewer when the draft seats differ from the proposed cell. If the draft has no Builder or no Reviewer role, STOP (assign cannot create a role). Model call: no. Provider program: no. Dedicated home: writes. Working copy: no. Product owner's terminal: no.
4. team approve with the yes option. Model call: no. Provider program: no. Dedicated home: writes the approved strategy. Working copy: no. Product owner's terminal: no.
5. Admission enable and activate, run by the product owner in his own terminal, against the dedicated home only. Model call: no. Provider program: no. Dedicated home: writes. Working copy: no. Product owner's terminal: yes.
6. Routing refresh. Model call: no (none observed in rounds 4 and 5). Provider program: yes (status reads; starts codex app-server and other provider programs). Dedicated home: writes the routing cache. Working copy: no. Product owner's terminal: no.
7. Only if the Claude Reviewer seat still waits: the access verification. Model call: yes, Claude entitlement probes of a few tokens each; the number allowed must be fixed in the contract. Provider program: yes. Dedicated home: writes. Working copy: no. Product owner's terminal: no.
8. Open a task. Model call: no. Provider program: no. Dedicated home: writes. Working copy: no. Product owner's terminal: no.
9. Builder execution: team exec with provider codex, the Builder role and the task id, in the working copy. Model call: yes, ONE run. Provider program: yes. Dedicated home: writes ledger and trace. Working copy: writes inside the workspace-write sandbox. Product owner's terminal: no.
10. Check of the Builder's change: only the allowed path changed; anything else is FAIL and STOP. Model call: no. Provider program: no. Dedicated home: no. Working copy: read only. Product owner's terminal: no.
11. Reviewer execution: team exec with provider claude, the Reviewer role and the same task id. Model call: yes, ONE run. Provider program: yes. Dedicated home: writes ledger and trace. Working copy: must be byte-identical to step 10 afterwards. Product owner's terminal: no.
12. Record the verdict with the execution id. Model call: no. Provider program: no. Dedicated home: writes. Working copy: no. Product owner's terminal: no.
13. Closure: deactivate the contract, guards after, seal the evidence. Model call: no. Provider program: no. Dedicated home: writes. Working copy: stays. Product owner's terminal: no (in rounds 4 and 5 of the trust validation the runner's closure block ran the deactivation, exit 0). The working copy and branch stay for the product owner to inspect and are removed only on his word.

Budget proposed: analyst 1; Builder 1; Reviewer 1; Claude entitlement probes only if needed and at most a number fixed by the product owner; zero retries; any STOP ends the run with a safe closure.

Containment of the Claude child, proposal to be proven before any quota: start team exec with a PATH whose first entry is a kit folder holding a kairo wrapper that runs the candidate with the dedicated home, so that the hooks of the installed plugin reach the candidate and the dedicated home instead of the kairo on PATH and the real home. Unknown: whether the hooks of plugin 0.7.5 work against the candidate's command line. If that cannot be shown without a model, the alternative is to accept and measure what the hooks write in the real Kairo home, which the product owner must decide.

Known limits to accept or reject: the direct exec route carries no directive block (Governance stays a known gap); Claude runs with automatic permissions, so "the Reviewer wrote nothing" is detected by a guard, not prevented; team exec cannot request strict Codex containment; task credit is provisional; the plugin 0.9.1 is not the installed one; the analyst reads repository source.

Before any quota (authorized preparation, no model): build the kit; rehearse on a throwaway repository everything that needs no model (working copy creation, guards, the wrapper, analyze as a preview, the routing refresh, the path allowlist check with a fake change, the closure).

Decisions asked from the product owner: the cell (Builder Codex, Reviewer Claude); the working copy (worktree or clone); the task; the three models including the analyst; the limit of Claude entitlement probes; acceptance that the analyst receives a sanitized snapshot of Inversion's source; the containment choice for the Claude child; the known limits.

### L11 (2026-11-13) The decision OD-KAIRO T4_MULTIPROVIDER_PILOT_APPROVED, verbatim

## Decisión: `OD-KAIRO — T4_MULTIPROVIDER_PILOT_APPROVED`

Sí. Apruebo el escenario T4 para preparar el kit y ensayarlo sin modelos. La ejecución real queda pendiente de una autorización posterior, cuando el preflight esté completo.

### 1. Configuración aprobada

| Componente                                          | Decisión                                             |
| --------------------------------------------------- | ---------------------------------------------------- |
| Proyecto                                            | Inversion                                            |
| Entorno                                             | Worktree aislado                                     |
| Tarea                                               | Crear `docs/operations/configuration.md`             |
| Analista                                            | `codex/gpt-6.1-sol`                                  |
| Builder                                             | Codex, seleccionado por capacidades y disponibilidad |
| Reviewer                                            | Claude, proveedor distinto del Builder               |
| Sondeos de entitlement Claude                       | Máximo 1 en total, después del reinicio de cuota     |
| Snapshot saneado del código                         | Autorizado con restricciones                         |
| Ejecuciones de modelos durante preparación          | 0                                                    |
| Cambios en aplicación, datos o configuración global | Prohibidos                                           |

El modelo analista es una elección inicial para este piloto, no una asignación fija de Kairo. Si no está disponible, no sustituirlo silenciosamente por otro.

### 2. Snapshot de Inversion

Autorizo proporcionar al analista un snapshot limitado a la información necesaria para comprender el proyecto.

Debe incluir arquitectura, objetivos, tecnologías, estructura, dependencias y documentación relevante.

Debe excluir credenciales, archivos `.env`, claves, tokens, datos financieros reales, información personal y otros secretos. También deben excluirse archivos ignorados que no hayan sido revisados explícitamente.

Antes de utilizarlo, generar un manifiesto con archivos incluidos, exclusiones y hashes. No enviar el repositorio completo indiscriminadamente.

### 3. Alcance de la tarea

La tarea debe producir exclusivamente documentación de operaciones y configuración, basada en evidencia real del proyecto.

No autorizo modificar código de producción, dependencias, variables de entorno, datos de inversión ni infraestructura.

El Reviewer debe comprobar tanto la exactitud técnica del documento como la ausencia de secretos y afirmaciones inventadas.

### 4. Condiciones para avanzar

1. Preparar el kit después del reinicio de cuota de Claude, si se requiere esa disponibilidad.
2. Validar la compatibilidad core `0.37.0-beta.1` y plugin `0.9.1`.
3. Ensayar rutas, admisión, worktree, permisos y guardas sin consumir modelos.
4. Verificar que la tarea está autorizada y que Builder y Reviewer pertenecen a proveedores distintos.
5. Presentar el contrato final de ejecución, incluyendo límites de cuota y condiciones de STOP.

No repetir sondeos por resultados `unverified`. Eso es incertidumbre de entitlement, no prueba de indisponibilidad.

## 5. Qué quiero demostrar con T4

El objetivo no es simplemente conseguir que Codex cree un archivo y Claude lo revise.

Quiero comprobar que Kairo coordina el ciclo completo: entiende el proyecto, asigna capacidades, autoriza la ejecución, utiliza ambos proveedores, verifica el resultado y registra correctamente evidencia, trazabilidad y consumo.

También quiero distinguir qué decisiones fueron automáticas y cuáles fijamos manualmente para el piloto. No declararemos probado el enrutamiento autónomo si seguimos asignando los modelos a mano.

Autorización final: preparar y ensayar T4 sin modelos. El siguiente gate será la ejecución real sobre el worktree de Inversion, una vez validado el contrato.

The decision narrows the proposal of L10 in these points: the analyst is codex/gpt-6.1-sol with no silent substitution; the Builder is on Codex and is to be selected by capabilities and availability rather than fixed by hand; at most one Claude entitlement probe in total, after the Claude quota reset; the analyst snapshot needs a manifest of included files, exclusions and hashes before it is used and must leave out ignored files that were not reviewed; the Reviewer must also check for secrets and invented statements; the record of the run must separate automatic decisions from the ones fixed by hand for the pilot. Kit preparation waits for the Claude quota reset of 13:00 local time, as condition 1 of the decision allows.

### L12 (2026-11-13) T4 preflight kit (unit A) and its three model-free rehearsals on a throwaway repository

Kit:

- release-v0.37.0-pilot-evidence/t4-pilot-1 is the real kit and has never been run. Three rehearsal copies were generated from it (t4-pilot-1-rehearsal, t4-pilot-1-rehearsal-2, t4-pilot-1-rehearsal-3). Each is identical to the real kit after name substitution, except that its first block creates a throwaway git repository inside the kit.
- Blocks, all with zero model calls: P0 identity, pinned Codex binary, wrappers, closed PATH and the single worktree addition; P1 guards before; P2 static check of the installed plugin against the candidate command line; P3 snapshot manifest and its checks; P4a analysts list; P4b and P4c analyze preview without the yes option; P4d proof of no model call; P5 final manifest; P9 guards after and the preflight report.
- The model-gated blocks (the real analyze, the Claude entitlement probe, the Builder and Reviewer executions) are not built yet.

Rehearsal 1:

- P0, P1 and P2 PASS. P3 raised its STOP on a planted fake token, as designed.
- P4a FAIL on real side effects of the user's own tooling, not of Kairo's code. The opencode program, started by Kairo's provider eligibility reads in the working copy, wrote the gentle-ai registry folder .atl there. An engram process wrote engram-project-identity.json in the main checkout's .git. The provider programs started the user's MCP servers and helpers (engram, mssql-mcp, npm). One claude -p /usage read occurred.
- The analysts list held four candidates, all on provider codex (gpt-6-astra, gpt-6-luna, gpt-6.1-sol, gpt-6.1-terra), with codex::gpt-6.1-sol exactly once.
- From code reading during the kit work: team analyze builds the analyst snapshot with the sanitizer (src/global/team/sanitized-snapshot.js line 195, called at src/global/team/service.js line 1148) from the file system, not from git, AFTER its provider eligibility reads. It includes hidden folders such as .atl. It writes the snapshot under the system temporary directory and deletes it when the call ends (service.js line 1206). So a registry folder created by opencode at that moment would reach the analyst, and nothing stays on disk to compare afterwards.
- A linked git worktree carries no ignored or untracked file, so an ignored environment file of the main checkout never reaches the snapshot of the working copy. The real pilot repository ignores .atl/ (its .gitignore line 33) and already holds .git/engram-project-identity.json.

Corrections made to the kit after rehearsal 1:

- A closed PATH (the kit wrapper folder, then /usr/bin, /bin, /usr/sbin, /sbin). The wrapper folder holds exactly five entries: the kairo wrapper for the candidate with the dedicated home, the pinned codex link, the claude logging wrapper, and links to node and git. P0 stops if opencode, cursor-agent, gemini or a second kairo is reachable.
- A final manifest block P5 that rebuilds the snapshot after every status command and compares it with P3 by path, size and hash.
- Separate note classes: ENGRAM-IDENTITY, MCP-CHILDREN, CLAUDE-USAGE-READ, TOOL-MISSING, FORBIDDEN-PROVIDER-PROGRAM.

Rehearsal 2:

- P0 to P3 PASS. The closed PATH worked: the three programs were unreachable, the analysts list was unchanged, and the working copy, main checkout and dedicated home were unchanged. No .atl and no engram identity file was written. Child programs seen: claude, codex, engram, git and git-remote-https.
- P4a then got a false FAIL from a defect of the kit. The claude logging wrapper wrote each call in several writes, and the records of two claude programs started at the same time (auth status, and the usage read) interleaved into one line, which the classifier read as a print-mode call.
- Corrected: one record per call, in one write, with an invocation id. A malformed line now gives INCONCLUSIVE with the note CLAUDE-LOG-MALFORMED. Tested with 40 concurrent calls.

Rehearsal 3:

- ROUND RESULT PASS. Every block P0, P1, P2, P3, P4a, P4b, P4c, P4d, P5 PASS.
- P2: 13 kairo invocations of the installed plugin 0.7.5, all accepted by the candidate command line, no gap (a static check).
- P3 and P5: 7 included files, 969 bytes, 3 exclusions, 1 value redacted by the sanitizer, every check clean. The final manifest is identical to P3 (hash 60475e5a6d9deb91d09c320b99143f889e047e6d54c99af7f530dbdd0c080faa).
- P4a: codex::gpt-6.1-sol listed once, access subscription, quota tier CONSERVE.
- P4b, the preview in human form, exit 0: "Analyze a sanitized snapshot of this project", "No project goal given. Add --goal \"TEXT\" or .kairo/goal.md.", "Analyst: GPT-6.1-Sol (codex). This spends provider usage.", "Preview only. Run kairo team analyze --analyst gpt-6.1-sol --yes to create a draft team.".
- P4c, the preview in JSON form, exit 0: applied false, spend true, strategyStatus none, analyst provider codex, modelId gpt-6.1-sol, candidateKey codex::gpt-6.1-sol.
- P4d: zero new Codex session files (1451 before and after), zero print-mode claude calls other than the usage read, three usage reads in total (one per status command).
- For each of the three status commands: child programs claude, codex, engram, git (twice) and git-remote-https; one socket of the command process to a TCP 443 address; nothing written under the dedicated home.
- Guards at the end: protected Codex files unchanged (36 files, 5 folders), global links unchanged, the two approved resident Codex processes unchanged, no unconfirmed transient process, main checkout and working copy unchanged. The host-written file .claude.json changed size or modification time (a note).

Open points for the final execution contract, as the kit lists them. Rulings are needed from the product owner on:

1. Whether one claude -p /usage read per Kairo status command counts as a model call.
2. The MCP servers that provider programs load from the real home configuration, which would also be available to the Builder and Reviewer models in the real executions (with the closed PATH only engram started; mssql-mcp and npm did not appear).
3. The engram identity file.
4. The transient-process originator rule (the approved list is the round 5 file; the kit's own commands are tracked as descendants).

Unconfirmed: the analyst's eligibility text, produced only inside the real analyze call; the manifest against the real analyst call; whether provider programs behave the same under the closed PATH during a real execution; what a provider program fetched over the network (a git ls-remote and a git-remote-https child were seen).

State: the real kit has not been run; the pilot repository has not been touched by the kit; no model call was made. The product owner is working in the pilot repository (its HEAD moved several times during the day and it has uncommitted changes), so the real preflight needs a short quiet window of the main checkout.

### L13 (2026-11-13) The decision OD-KAIRO T4_EXECUTION_GUARDS_APPROVED_WITH_CHANGES, verbatim

## Decisión: `OD-KAIRO — T4_EXECUTION_GUARDS_APPROVED_WITH_CHANGES`

Apruebo avanzar con T4, pero modifico las reglas 1 y 2. Las reglas 3, 4 y 5 quedan aprobadas con precisiones de aislamiento.

El preflight ya demostró suficiente estabilidad: todos los bloques pasaron, el snapshot permaneció idéntico y no hubo escrituras sobre Inversion. No necesitamos repetirlo completo.

## 1. Decisión sobre las cinco reglas

| Regla                              | Decisión            | Condición                                                                                      |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| 1. `claude -p /usage`              | Aprobada con límite | Una lectura como máximo por comando de estado autorizado. Contabilizarla; no asumir costo cero |
| 2. MCP Engram                      | Modificada          | Permitir el proceso conocido, pero no escrituras persistentes de memoria durante el piloto     |
| 3. Identidad Engram en `.git`      | Aprobada            | `NOTE` si ya existe y permanece intacta                                                        |
| 4. Procesos transitorios R5        | Aprobada            | Reutilizar identificación estricta por ejecutable, argumentos y ascendencia                    |
| 5. Checkout principal de Inversion | Aprobada            | Puede tener cambios sin commit, pero debe permanecer idéntico durante cada bloque              |

### Regla 1 — Cuota de Claude

Acepto que Kairo realice la lectura de uso desde los comandos de estado que ya forman parte del contrato.

Pero hay una diferencia importante: que el código clasifique una operación como costo cero no demuestra que el proveedor no contabilice consumo.

Por tanto:

- Registrar cantidad de invocaciones y variaciones observables de cuota.
- No ejecutar comandos de estado repetidamente sólo para monitorear.
- No hacer sondeos adicionales de entitlement fuera del límite aprobado.
- Conservar el inicio de la unidad con modelos para después del reinicio de cuota previsto.

### Regla 2 — Engram

Aquí sí cambio la propuesta.

Reconocer el proceso Engram como conocido no implica autorizar a Builder o Reviewer a modificar memorias persistentes.

Durante T4, permitimos lectura de contexto, pero las herramientas de escritura deben quedar deshabilitadas mediante una restricción efectiva, o Engram debe operar sobre un almacén temporal aislado.

Si ninguna de esas condiciones puede garantizarse, se ejecuta T4 sin ese MCP.

Un servidor MCP desconocido debe provocar STOP antes del lanzamiento, o interrupción y clasificación `INCONCLUSIVE` si se descubre durante la ejecución.

Esto evita que una tarea de documentación termine alterando memorias globales sin autorización.

### Reglas 3–5 — Sin cambios sustanciales

El archivo de identidad de Engram en `.git` es una observación siempre que preexista y permanezca intacto. Una creación o modificación inesperada no es una simple nota.

La allowlist de R5 se mantiene estricta y limitada al kit, sin generalizar permisos a cualquier proceso Codex.

El checkout principal puede contener trabajo sin commitear. El worktree del piloto partirá de un commit identificado y no debe incorporar ni alterar silenciosamente esos cambios locales.

## 2. Contrato funcional de T4

Proyecto

Inversion — worktree aislado

Analista

Codex / GPT-6.1-Sol

Builder

Codex

Reviewer

Claude

Único archivo de trabajo autorizado

`docs/operations/configuration.md`

El contenido del documento debe derivarse de la configuración real y saneada del proyecto. No inventar variables, servicios, pasos de despliegue ni comportamientos no comprobados.

También quiero que la evidencia separe expresamente:

- Selección manual del analista y de los proveedores.
- Selección efectiva realizada por el router de Kairo.
- Ejecución real del Builder.
- Revisión independiente del Reviewer.
- Resultado de admisión, ledger y trazas.

Así evitaremos declarar autonomía demostrada cuando parte del flujo todavía esté configurada manualmente.

## 3. Próximo gate

Autorizo cerrar el contrato y preparar la unidad B. No autorizo todavía las llamadas reales a modelos.

Antes de ejecutarlas, el Runner debe presentar un resumen breve de las llamadas previstas, el estado de aislamiento de Engram, los límites de consumo y las condiciones de STOP. No hace falta otra ronda de ensayos completos.

La unidad B debe quedar preparada para ejecutarse después del reinicio de cuota de Claude.

## 4. Prioridad de producto

T4 tiene que resolver una pregunta concreta:

¿Puede Kairo coordinar una implementación real entre Codex y Claude, con límites de seguridad y evidencia verificable, sobre uno de tus proyectos locales?

Si la respuesta es afirmativa, pasamos a ampliar el canary y acercarnos al uso diario de Kairo.

No vamos a bloquear ese avance por no tener todavía los equipos estándar automáticos, pero ese requisito permanece como la siguiente mejora funcional importante.

Decisión definitiva: reglas 1, 3, 4 y 5 aprobadas con las condiciones indicadas; regla 2 modificada para impedir escrituras persistentes no autorizadas. Preparar T4, sin gastar modelos todavía.

### L14 (2026-11-13) T4 kit units B1 (MCP isolation) and B2 (model-gated blocks) prepared; zero model calls; the real kit `t4-pilot-1` was never run

Status:

- Unit B1, MCP isolation by kit wrappers. The codex wrapper prepends eight `-c mcp_servers.NAME.enabled=false` options (codegraph, computer-use, context7, engram, graphify, node_repl, rea, runpod), executes the pinned binary and fails closed with exit 97. The claude wrapper has four modes: status unchanged; usage adds `--mcp-config <empty> --strict-mcp-config`; execution replaces `--permission-mode auto` by `--restricted --tools Read,Grep,Glob --disallowedTools Edit,Write,NotebookEdit,Bash --mcp-config <empty> --strict-mcp-config --permission-mode dontAsk`; probe adds the strict empty MCP config; any other print shape is refused with exit 97.
- Mini rehearsal 4 (`t4-pilot-1-rehearsal-4`): STOP. Finding: the unchanged `claude -p /usage` read started `engram mcp --tools=agent`. Correction: the usage mode adds the strict empty MCP config.
- Mini rehearsal 5 (`t4-pilot-1-rehearsal-5`): P0, P1 and P4a PASS; no MCP-LIKE child; codex wrapper `added=8` on both app-server calls; claude records `mode=status` and `mode=usage` with delta `+--mcp-config,+--strict-mcp-config`; the usage read still worked; 0 new Codex session files; Engram store unchanged. Round label INCONCLUSIVE only because P2, P3, P4b, P4c and P5 were skipped on purpose.
- Unit B2, prepared only. New card blocks: S0 (owner summary, 0 model calls), G1 (analyze, 1 analyst call), G2 (team shaping and approval, 0), B1 (owner admission in his terminal, 0), RF (routing refresh, re-runnable, 0), G3 (routing, 0), G4 (Claude entitlement probe; 0 in this candidate), G5 (task and prechecks, 0), G6 (Builder on Codex, 1), G7 (Reviewer on Claude, 1), G8 (verdict, 0), G9 (report, 0), Z1 to Z3 (closure, always run). New kit files: `mg-lib.sh`, `goal.txt`, `builder-task.txt`, `reviewer-task.txt`, `tools/argv-precheck.mjs`, `fixtures/no-net.cjs`. Reservation files `analyze.reserved`, `probe.reserved`, `builder.reserved`, `reviewer.reserved`; owner markers `manifest-approved.txt` and `manual-assign.txt` are created only by the orchestrator after an owner decision. `check-forbidden.sh` now holds per-block exact command forms.
- Rule 5 applied in P0: the main checkout of the pilot repository may hold uncommitted changes; its status, branch and HEAD are recorded and it must stay identical during each block.
- Function-level tests with fake programs and stub evidence, outside every kit, under zsh and bash 3.2.57: t1 128/128, t2 65/65, t3 68/68, t4 37/37, t6 9/9, t7 22/22; t5 (zsh, the real blocks G1 to Z3 end to end against a fake candidate, nine scenarios) all passed. Orchestrator spot check: `zsh -n` and `bash -n` clean on the kit scripts; the kit holds no run folder, reservation or approval file; the pilot repository has 1 worktree and no `kairo/*` branch; `~/.codex/config.toml` sha256 `d85e4fd029ad8300c2d31bd6bdb71359cbc287ad948b473a6d2c907f114a98e3` unchanged.
- Finding: the access verification cannot be limited to one probe. `runVerifyAccessCli` reads only cwd, json and refresh (`src/global/team/team-cli.js` 405 to 431); `--refresh` probes the whole documented Claude catalog, 13 models (`service.js` 1992; `claude-models.js` 28 to 42), in batches of 12 (`service.js` 135, 2009 to 2012); without `--refresh` it probes nothing. G4 therefore never runs it and prints `OWNER DECISION NEEDED: the access verification cannot be limited to one probe`. Open owner ruling when G3 reports PROBE NEEDED.
- Finding: the router's `availability-fallback` can re-route the Reviewer to another provider, so G3 requires provider claude and not only a ROUTED answer.
- Confirmed: with no active team, `team analyze --yes` persists the draft as `sessions/<projectKey>/project-strategy.json` with status `suggested` under the dedicated home (`project-strategy-store.js` 23; `service.js` 2263 to 2272).
- Unconfirmed forms and their handling: `--role Builder` never ran in a card (a wrong role name fails G3 or G5 before any spend); the Builder decision row is accepted only as P12g or P12 (otherwise STOP in G5); whether `team exec` prints the Claude final text as plain text (an unreadable VERDICT line records nothing and prints OWNER DECISION NEEDED); the Claude served model is read from the ledger field `observedModelId` (absent gives UNCONFIRMED).
- Result rules pending owner confirmation: a Secrets FAIL gives overall INCONCLUSIVE for the owner to decide; an UNCONFIRMED Reviewer served model does not block PASS.
- Next: real preflight P0 to P5 and P9 on the pilot repository with a quiet main checkout; owner approval of the P5 manifest; S0 summary; execution authorization (S22). Model calls so far in T4: 0.

### L15 (2026-11-13) Owner decision `OD-KAIRO — T4_REAL_PREFLIGHT_APPROVED`: real preflight P0 to P5 and P9 authorized on the pilot repository, no model call

## Decisión: `OD-KAIRO — T4_REAL_PREFLIGHT_APPROVED`

Sí. Autorizo ejecutar ahora el preflight real de T4 sobre Inversion, exclusivamente P0–P5 y P9, sin llamadas a modelos.

No hace falta esperar al reinicio de cuotas para esta fase.

### Alcance autorizado

| Operación                                    | Decisión      |
| -------------------------------------------- | ------------- |
| Crear worktree aislado                       | Autorizado    |
| Crear rama `kairo/t4-pilot-1`                | Autorizado    |
| Generar manifiesto del snapshot              | Autorizado    |
| Ejecutar P0–P5 y P9                          | Autorizado    |
| Ejecutar `team analyze` con modelo           | No autorizado |
| Activar admisión o ejecutar Builder/Reviewer | No autorizado |
| Sondear los 13 modelos Claude                | No autorizado |
| Modificar configuración global               | Prohibido     |
| Push, merge o publicación                    | No autorizado |

### Condiciones importantes

1\. Checkout principal

No puedo bloquear tu Mac ni garantizar que ningún otro proceso modifique Inversion.

El Runner debe registrar el estado inicial y comprobarlo después de cada bloque. Si detecta modificaciones inesperadas, STOP.

Crear una rama y un worktree sí modifica metadatos Git compartidos. Esas modificaciones específicas están autorizadas, pero deben distinguirse de cambios al checkout principal.

No deben cambiar su contenido, HEAD, índice, stash ni referencias preexistentes.

2\. Snapshot del proyecto

Generar exclusivamente el manifiesto: rutas, tamaños, hashes, exclusiones y justificación de los archivos seleccionados.

No enviar todavía código al analista.

Excluir secretos, datos financieros personales, credenciales y archivos ignorados no revisados.

3\. Engram y proveedores

Mantener las restricciones aprobadas: memoria persistente protegida, procesos conocidos identificados y cero sondeos adicionales de entitlement.

4\. Cierre

Registrar el resultado real como `PASS`, `FAIL` o `INCONCLUSIVE`, conservar evidencia y presentar el manifiesto antes de cualquier ejecución con modelos.

### Siguiente paso

Cuando P0–P5 y P9 terminen, revisaremos únicamente:

- Integridad del checkout y del worktree.
- Manifiesto saneado.
- Rutas y contratos efectivos.
- Riesgos pendientes de G1, G4, G6 y G7.

Autorización definitiva: ejecutar el preflight ahora. Durante esos bloques conviene que no edites Inversion, pero no necesitamos mantener tu proyecto inmovilizado después del cierre.

Nuestro próximo objetivo es ejecutar el primer flujo real Builder Codex → Reviewer Claude y comprobar que Kairo lo coordina correctamente.

Status:

- Authorized now: the isolated worktree, the branch `kairo/t4-pilot-1`, the snapshot manifest, blocks P0 to P5 and P9.
- Not authorized: `team analyze` with a model, admission, Builder or Reviewer executions, a probe of the 13 Claude models, global configuration changes, push, merge, publication.
- The Runner was launched on 2026-11-13 with an added independent read-only checkpoint of the main checkout before P0 and after every block (HEAD, branch, status hash, tracked diff hashes, index summary hash, stash hash and count, pre-existing refs hash, worktree count). Result pending.

### L16 (2026-11-13) Real T4 preflight, round 1 (`t4-pilot-1`): STOP at P0 by a defect of the kit's ref comparison; P1 to P5 not run; zero model calls; no unexpected change in the main checkout

Status:

- A first Runner launch was redirected to a Codex-hosted runner and stopped before P0 because the orchestrator's added checkpoint helper passed the git command as one scalar variable, which zsh does not split; no kit block ran. The Runner was relaunched on Claude with the bypass marker: a Codex-hosted Runner would be a foreign codex process for the kit and would create Codex session files.
- P0 (14:20 to 14:21 local time): exit 1, STOP. The worktree `t4-pilot-1/run/work` and the branch `kairo/t4-pilot-1` were created at `bc794973206611cda1cc3363e4998f5ac13929ad` (main checkout branch `feat/phase-1-foundation`, 0 status entries). Guard items status, tree, lsfiles, gitfiles, atlodd and engram: identical. Item meta: only REFS-SHA256 and WORKTREES differ (worktrees 1 -> 2): expected. Item gitdir: exactly one new entry, `./worktrees`: expected. Item refs: `DIFFERS beyond the expected (new 2, removed or changed 1)`. Verdict line: `STOP  P0: the worktree addition failed or changed more than the expected .git entries (nothing is restored): worktree rc=0, unexpected entries=0, guard items: refs`.
- Cause, verified read-only on the stored evidence `run/ev/rg.main.p0-pre/refs` (2 lines) and `run/ev/rg.main.p0-post/refs` (3 lines): `diff` shows exactly one added line, `bc794973206611cda1cc3363e4998f5ac13929ad commit refs/heads/kairo/t4-pilot-1`. `rg_cmp_p0` in `run-lib.sh` feeds `comm` with the unsorted output of `git for-each-ref`; its lines start with the commit hash, so they are not in the order `comm` needs. Unsorted: new=2, old=1. With both files sorted (`LC_ALL=C sort`): new=1, old=0. The STOP is a false positive of the kit, not a change in the repository. The rehearsals did not show it because their pilot repositories had no ref whose line sorts after the new one.
- P9 ran because the card says "A STOP flag stops the later blocks (they record SKIPPED); P9 always runs." It stopped with `STOP  there is no P1 baseline`. P1, P2, P3, P4a, P4b, P4c, P4d and P5 did not run. No manifest exists (`run/snapshot` and `run/snapshot-final` are empty). The card printed no round label.
- Independent checkpoint of the main checkout (S23), stored in the session scratchpad folder `t4-preflight-real-2/main-checkpoints.txt`: PRE-P0 14:20:42, after-P0 14:21:05, after-P9 14:21:16. HEAD, branch, status hash, tracked diff hashes, index summary hash, stash hash and count, and the hash of the pre-existing refs are identical in the three lines; the worktree count went from 1 to 2.
- Other facts: `~/.codex/config.toml` sha256 `d85e4fd029ad8300c2d31bd6bdb71359cbc287ad948b473a6d2c907f114a98e3`, 14748 bytes, unchanged. No Claude usage read, no provider status read, no Codex or Claude program started by the kit (P4 never ran). No `*.reserved` file. Candidate HEAD `10b64c801`, core 0.37.0-beta.1, plugin 0.9.1, `codex-cli 0.168.0` with the pinned hash.
- Classification proposed to the owner: round 1 is INCONCLUSIVE (the preflight did not complete; the P0 guard verdict is a FAIL caused by a kit defect; no safety property was violated). The evidence of round 1 is kept unchanged; the run folder of `t4-pilot-1` is spent.
- State left in the pilot repository: the linked worktree `t4-pilot-1/run/work` and the branch `kairo/t4-pilot-1`, both at the base commit and with no change; nothing was restored or removed. Removal happens only on the owner's word.
- Next: owner decision on correcting the comparison (sort both listings before `comm`) and on a second preflight round in a fresh kit copy. No new round is authorized yet.

### L17 (2026-11-13) Owner decision `OD-KAIRO — T4_PREFLIGHT_R2_APPROVED`: comparator correction and second preflight round authorized with `kairo/t4-pilot-2`, no model call

## Decisión: `OD-KAIRO — T4_PREFLIGHT_R2_APPROVED`

Sí. Autorizo corregir el comparador y ejecutar una segunda ronda del preflight sin modelos, utilizando `kairo/t4-pilot-2`.

El incidente está suficientemente identificado. No justifica modificar Kairo Runtime ni repetir los ensayos completos anteriores.

### 1. Corrección autorizada

El cambio debe limitarse al kit de validación:

- Ordenar ambas listas de referencias de forma determinista antes de compararlas.
- Comparar nombres y valores de referencias, no solamente cantidades.
- Permitir exclusivamente la nueva referencia `refs/heads/kairo/t4-pilot-2`.
- Rechazar cualquier referencia preexistente modificada o eliminada.
- Probar el comparador con datos sintéticos, incluyendo referencias que se ordenen antes y después de la nueva rama.

No modificar el código del producto.

### 2. Segunda ronda

| Elemento                  | Decisión           |
| ------------------------- | ------------------ |
| Rama nueva                | `kairo/t4-pilot-2` |
| Worktree nuevo            | Autorizado         |
| Preflight                 | P0–P5 y P9         |
| Llamadas a modelos        | 0                  |
| Sondeos de cuota          | 0                  |
| Checkout principal        | Sin modificaciones |
| Configuración global      | Protegida          |
| Evidencia de ronda 1      | Conservar          |
| Push, merge o instalación | Prohibidos         |

El baseline de la segunda ronda debe reconocer que ya existe `kairo/t4-pilot-1` y su worktree. No deben clasificarse como alteraciones nuevas ni eliminarse para facilitar la prueba.

### 3. Clasificación de la primera ronda

Mantener:

`ROUND RESULT: INCONCLUSIVE`

Y conservar los resultados individuales:

- P0: `FAIL — KIT_COMPARATOR_DEFECT`
- P1–P5: `NOT_EXECUTED`
- P9: `STOP — MISSING_BASELINE`
- Integridad del checkout principal: `PASS`

No cambiar retrospectivamente la evidencia registrada en L16.

### 4. Condición de cierre

Si R2 pasa, generamos el manifiesto saneado de Inversion y evaluamos la autorización de las tres llamadas reales: analista Codex, Builder Codex y Reviewer Claude.

Si surge otro fallo atribuible únicamente al procedimiento, quiero el diagnóstico concreto antes de autorizar más rondas. Evitemos continuar ampliando el kit sin obtener evidencia funcional.

También queda pendiente limpiar los worktrees y ramas temporales una vez que dejen de ser necesarios, preservando primero la evidencia.

Autorización definitiva: segunda ronda aprobada.

Nuestro objetivo inmediato sigue siendo conseguir la primera ejecución multiproveedor real de Kairo en Inversion. No volver a abrir etapas ya validadas ni introducir funcionalidades adicionales durante T4.

Status:

- Round 1 classification kept as ruled: `ROUND RESULT: INCONCLUSIVE`; P0 `FAIL — KIT_COMPARATOR_DEFECT`; P1–P5 `NOT_EXECUTED`; P9 `STOP — MISSING_BASELINE`; main checkout integrity `PASS`; L16 unchanged.
- The correction is limited to the validation kit, built in a fresh kit copy `t4-pilot-2`; `t4-pilot-1` and its run folder are kept as evidence, untouched.
- Orchestrator reading of the row "Sondeos de cuota | 0", stated to the owner: zero entitlement probes and zero quota polling beyond what the authorized blocks do by themselves; block P4a still makes the one counted Claude usage read of the authorized status command (guards rule 1, L13).
- Round 2 pending: correction and synthetic tests first, then P0 to P5 and P9.

### L18 (2026-11-13) Real T4 preflight, round 2 (`t4-pilot-2`): P0, P1, P2 PASS; STOP at P3 on the content scan of the snapshot manifest; P4a to P5 not run; `ROUND RESULT: INCONCLUSIVE`; zero model calls

Status:

- Kit correction (S24), in the fresh copy `t4-pilot-2` only: `refs_cmp_p0` sorts both listings with `LC_ALL=C`, compares whole lines (name and value), requires every pre-existing line byte-identical and exactly one new line, `refs/heads/kairo/t4-pilot-2` at the pilot HEAD. New `gitdir_cmp_p0`, `worktrees_cmp_p0`, `wc_admin_discover` and a PRE-EXISTING report recognize the round 1 branch and working copy and require them byte-identical. Synthetic tests passed under zsh and bash 3.2.57: new reference sorting before, in the middle and after; changed, removed, extra and misnamed references give STOP; a throwaway repository shaped like the real one after round 1 gives PASS with the administrative folder discovered as `work1`. The old comparison reproduces the round 1 defect on the stored evidence (2 new, 1 old). No product code changed; `t4-pilot-1` untouched.
- P0: `BLOCK P0: PASS (identity, pin, wrappers, PATH and the worktree addition verified; only the expected .git entries changed)`. Working copy `t4-pilot-2/run/work`, branch `kairo/t4-pilot-2`, base commit `bc794973206611cda1cc3363e4998f5ac13929ad`, administrative folder `work1`. `kairo/t4-pilot-1` and its folder `work` reported PRE-EXISTING and unchanged.
- P1: `BLOCK P1: PASS (every guard recorded; the two approved resident Codex processes present and nothing else; home and neutral directory empty; working copy clean)`. P2: `P2-RESULT: OK`; core `0.37.0-beta.1`, candidate plugin `kairo-router 0.9.1`, installed plugin `kairo-router@kairo 0.7.5` (a NOTE only).
- P3: `P3-RESULT: STOP hits=24 (manifest FAITHFUL-BY-CODE-READING)`; `BLOCK P3: STOP (manifest check hit: 1 check(s))`. The checks "no included file is ignored by git or untracked", "no included file is named like an environment file, a key, a certificate, a credential or a database or data dump", the per-file cap and the `.git` exclusion all PASS. The one HIT is "no included file holds a secret-like value after the sanitizer's own redaction": 24 files.
- Manifest of P3: `t4-pilot-2/run/snapshot/snapshot-manifest.txt`, 139 lines, 107 included files, 481496 bytes, 3 exclusions (`.git`, `.gitignore`, `Cargo.lock`), no cap hit, 1 file redacted by Kairo's sanitizer (`dashboard/src/App.test.tsx`). Included per top folder: crates 65, dashboard 30, docs 5, odd 1, .cargo 1, .github 1, root files 4. No final (P5) manifest exists.
- Diagnosis of the 24 files, done read-only by the orchestrator on the stored sanitized copy, by shape only (no value printed). Rule 2 (a run of 32 or more characters with a letter and a digit): `dashboard/pnpm-lock.yaml` 295 hits, all on package `integrity:` hash lines; `.github/workflows/ci.yml` 10 hits, 9 forty-character hexadecimal commit identifiers and 1 sixty-four-character hexadecimal value; 18 snake_case identifiers that contain digits in Rust test files; 9 test fixture strings in `crates/pil/tests`, `crates/security/tests` and `dashboard/src/App.test.tsx` shaped like words joined by hyphens around a ten-digit run, or a repeated ten-digit-six-letter pattern; 2 identifier-shaped references of the form words-digits-digits in `docs/operations/configuration.md` line 104 and `docs/security/threat-model.md` line 76. Rule 1 (a keyword followed by a value of 12 or more characters): 13 hits; 9 are unquoted code expressions (field accesses and type names), 3 are the same test fixture strings, 1 is a quoted lowercase name with an underscore, 1 is a quoted word/word value in `dashboard/src/api/client.ts`. No hit has the shape of a provider credential. The scan rules are broad heuristics; whether the test fixture strings are dummy values is the owner's knowledge.
- P4a, P4b, P4c, P4d and P5 did not run (STOP flag). P9 ran as the card requires: `ROUND RESULT: INCONCLUSIVE`; new Codex session files 0; MCP-LIKE children 0; process inventory 2 approved, 2 unchanged, 0 changed, 0 foreign; claude wrapper log 0 records; codex wrapper log 0 records; no provider status read; no usage read.
- Independent checkpoint of the main checkout (S23), `t4-preflight-real-r2/main-checkpoints.txt` in the session scratchpad: HEAD, branch, status hash, tracked diff hashes, index summary hash, stash hash and count and the hash of the pre-existing references identical before P0 and after every block; the worktree count went from 2 to 3. `~/.codex/config.toml` sha256 `d85e4fd029ad8300c2d31bd6bdb71359cbc287ad948b473a6d2c907f114a98e3`, 14748 bytes, unchanged.
- Finding for the pilot task: `docs/operations/configuration.md` already exists in the pilot repository since commit `c26a2ef` of 2026-11-13 12:32 ("docs(operations): add configuration, backup and recovery guides"), together with `docs/operations/backups.md` and `docs/operations/recovery.md`. The prepared Builder task says "create exactly one file" and the G6 scope check expects a new file; both no longer match the repository. Owner ruling needed.
- State left in the pilot repository: 3 worktrees (main checkout, `t4-pilot-1/run/work`, `t4-pilot-2/run/work`); branches `kairo/t4-pilot-1` and `kairo/t4-pilot-2` at `bc794973206611cda1cc3363e4998f5ac13929ad`; nothing removed. The run folder of `t4-pilot-2` is spent. No new round is authorized.

### L19 (2026-11-13) Owner decision `OD-KAIRO — T4_PREFLIGHT_R3_CONDITIONALLY_APPROVED`: strict P3 exception, Builder task changed to review and update, preflight round 3 with `kairo/t4-pilot-3`; the three model calls stay unauthorized

## Decisión: `OD-KAIRO — T4_PREFLIGHT_R3_CONDITIONALLY_APPROVED`

Apruebo el plan con dos condiciones: no dar por verificadas las nueve cadenas de prueba sin evidencia y no ejecutar modelos automáticamente después del preflight.

Quiero cerrar T4 sin seguir repitiendo rondas por defectos del kit, pero tampoco debemos debilitar las garantías de seguridad para conseguir un PASS.

### 1. Escaneo P3 — Aprobado con condiciones

Los avisos identificados parecen mayoritariamente falsos positivos: hashes de dependencias, identificadores de commits, nombres de pruebas y expresiones de código.

Sin embargo, no puedo confirmar que las nueve cadenas sean ficticias únicamente por su formato.

Autorizo clasificarlas como fixtures si el Builder comprueba que son literales utilizados exclusivamente en pruebas, que no provienen de secretos reales ni datos personales y que no se reutilizan como credenciales en ejecución.

La excepción de P3 debe ser estricta:

- Registrar archivo, ubicación, tipo y huella de cada hallazgo aprobado.
- Exigir que el snapshot siga siendo idéntico al revisado.
- No aceptar coincidencias nuevas simplemente porque el número total siga siendo el mismo.
- Mantener el STOP para credenciales potencialmente reales o valores de procedencia desconocida.

Si alguna de las nueve cadenas no puede verificarse, excluirla del snapshot o detener P3. No hace falta que me muestres los valores sensibles.

### 2. Tarea del Builder — Aprobada

La tarea cambia de creación a revisión y actualización del documento existente:

`docs/operations/configuration.md`

El Builder debe contrastarlo con el código y la configuración real de Inversion, corregir información desactualizada y documentar incertidumbres.

Único archivo modificable: ese documento. Ningún otro archivo, dependencia, dato financiero, configuración o infraestructura.

El Reviewer Claude debe verificar su exactitud, alcance y ausencia de secretos.

### 3. Ronda 3 — Autorizada

| Elemento                             | Decisión                   |
| ------------------------------------ | -------------------------- |
| Rama                                 | `kairo/t4-pilot-3`         |
| Worktree nuevo                       | Autorizado                 |
| Preflight P0–P5 y P9                 | Autorizado                 |
| Excepciones P3                       | Sólo hallazgos verificados |
| Manifiesto final                     | Obligatorio                |
| Llamadas a modelos durante preflight | 0                          |
| Cambios en checkout principal        | Prohibidos                 |
| Borrar rondas anteriores             | No autorizado              |
| Push o merge                         | No autorizado              |

Si R3 supera todas sus comprobaciones, no hace falta crear una cuarta ronda para ejecutar los modelos. Podemos continuar utilizando el mismo kit, siempre que se vuelvan a comprobar las guardas inmediatamente antes del lanzamiento.

### 4. Autorización de las tres llamadas

Por ahora, G1, G6 y G7 siguen pendientes de autorización de ejecución.

Antes de concederla quiero ver el manifiesto definitivo, la verificación de las nueve cadenas y la solución para G4: el sondeo de Claude de 13 modelos sigue excediendo el límite autorizado de uno.

No autorizo ampliar ese límite silenciosamente para desbloquear la prueba.

## 5. Clasificación de R2

Mantener `INCONCLUSIVE`:

- P0–P2: PASS.
- P3: STOP por política de detección demasiado amplia.
- P4–P5: no ejecutados.
- Integridad del repositorio: PASS.

El problema encontrado corresponde al procedimiento de validación; no tenemos evidencia de un defecto de aislamiento de Kairo.

Autorización definitiva: corregir P3, adaptar la tarea y ejecutar R3 sin modelos.

Si R3 pasa, nuestra siguiente decisión será sobre las tres llamadas reales de T4, no sobre otra ronda de preflight.

Status:

- Round 2 classification kept as ruled: `INCONCLUSIVE`; P0–P2 PASS; P3 STOP by an over-broad detection policy; P4–P5 not executed; repository integrity PASS; no evidence of an isolation defect of Kairo.
- In preparation in a fresh kit copy `t4-pilot-3`: verification of the nine fixture strings with evidence, the per-finding approved list for P3 (file, location, type, fingerprint) bound to the reviewed snapshot, the task texts for review and update of the existing `docs/operations/configuration.md`, and a solution proposal for G4 that keeps model-reaching probes at one.
- The working copy of round 3 starts from the reviewed commit `bc794973206611cda1cc3363e4998f5ac13929ad` so the snapshot stays identical to the reviewed one even if the main checkout moves (orchestrator measure; the main checkout is not changed).
- G1, G6 and G7 remain unauthorized; the owner will decide after seeing the final manifest, the fixture verification and the G4 solution.

### L20 (2026-11-13) Owner decision `OD-KAIRO — SELF_DOGFOOD_FIRST`, consequences for T4

The complete verbatim text is in `odd/tasks/kairo-runtime-mvp.md` (L100).

Status:

- Round 3 is not stopped; the approved set stays exactly as generated (8 verified literals, 347 approved findings bound to the reviewed manifest), no wider scan, no relaxed guard.
- The G4 wrapper measure stays disabled for real execution; its verification without models may continue.
- The twelve local refusals must never be presented as twelve unavailable models: not-probed models are reported separately from models whose entitlement was really checked; if Kairo does not distinguish those states and the simulation changes the Reviewer selection, that is registered as a capability-discovery defect, not hidden by the kit.
- T4, with three preselected models, demonstrates transport and coordination, not autonomous adaptive selection; T5 follows after T4 closes.

### L21 (2026-11-13) Real T4 preflight, round 3 (`t4-pilot-3`): all ten blocks PASS; `ROUND RESULT: PASS`; final manifest identical to the reviewed one; zero model calls

Status:

- Kit `t4-pilot-3` (S25): working copy pinned to the reviewed commit `bc794973206611cda1cc3363e4998f5ac13929ad`; `approved-findings.tsv` generated by `tools/p3-findings.mjs` from the reviewed sanitized copy, 347 records (dependency-integrity-hash 295, test-identifier 18, verified-test-fixture 12, pinned-commit-id 9, code-expression 8, doc-reference 2, quoted-identifier-literal 1, media-type-literal 1, checksum 1), 0 unclassified, header bound to the reviewed manifest hash; task texts rewritten for review and update of the existing `docs/operations/configuration.md`; G6 scope check admits only a modification of that file.
- Fixture verification (`fixture-verification.tsv`): 8 distinct literals, 12 findings, all VERIFIED-FIXTURE: each literal occurs only in its own test file in the committed tree of the base commit, is supplied by the test itself, has a dummy structure (an ascending digit run or a repeated 0123456789abcdef pattern) and no personal-data shape. Locations and fingerprint prefixes: `crates/pil/tests/authorization.rs:35` 19207ad078eb; `crates/pil/tests/authorization.rs:75` 93029328b0c1; `crates/pil/tests/backup.rs:26` f3251f1098c4; `crates/pil/tests/cli.rs:15` e00a8e1995a8; `crates/pil/tests/common/mod.rs:17` 20663d147b94; `crates/security/tests/authorization.rs:4` 3eb1bd439947; `crates/security/tests/authorization.rs:19` 40fb5749bc15; `dashboard/src/App.test.tsx:85` and `:87` c91a1770979a. The orchestrator re-derived the fingerprints and the occurrence lists independently from the committed objects and they match. Declared limit: real local secrets of the pilot repository were not compared, by design (no ignored or untracked file was read). Kairo's analyze has no exclusion option.
- Blocks, all exit 0: P0 `BLOCK P0: PASS (identity, pin, wrappers, PATH and the worktree addition verified; only the expected .git entries changed)`; P1 PASS; P2 `P2-RESULT: OK`; P3 `P3-RESULT: PASS (manifest FAITHFUL-BY-CODE-READING; 107 file(s), 481496 bytes)`; P4a, P4b, P4c `PASS (nothing outside the kit and the dedicated home changed)`; P4d `BLOCK P4d: PASS (zero new Codex session files, zero print-mode claude calls other than /usage, and the child programs listed)`; P5 `P5-RESULT: PASS`; P9 `ROUND RESULT: PASS`, `Blocks not run: none`.
- Working copy `t4-pilot-3/run/work`, branch `kairo/t4-pilot-3` at the base commit, administrative folder `work2`; PRE-EXISTING and byte-identical: working copies `work` and `work1`, references `kairo/t4-pilot-1` and `kairo/t4-pilot-2`; no MAIN-HEAD-MOVED note.
- Manifest: P3 and P5 print the same manifest hash `523a776da182bddf7215f3f53c8a84161297bb9464792de997167c7089fae8ea`, equal to the reviewed hash. 107 included files, 481496 bytes (crates 65, dashboard 30, docs 5, root 4, odd 1, .github 1, .cargo 1); 3 exclusions (`.git` pointer, `.gitignore`, `Cargo.lock`); no cap hit. Final manifest file: `t4-pilot-3/run/snapshot-final/snapshot-manifest.txt`.
- Analyst candidates listed by P4a: `codex::gpt-6-astra`, `codex::gpt-6-luna`, `codex::gpt-6.1-sol`, `codex::gpt-6.1-terra`; `codex::gpt-6.1-sol` present and unique. P4b: "Preview only. Run kairo team analyze --analyst gpt-6.1-sol --yes to create a draft team." P4c: `"applied":false,"spend":true,"strategyStatus":"none"`.
- Consumption: zero model calls; zero new Codex session files; one `claude -p /usage` read in each of P4a, P4b and P4c (budget 1 each, 3 in total); claude wrapper log 6 records (3 status, 3 usage, 0 refused); codex wrapper log 6 records, each `added=8`; no MCP-LIKE child; process inventory after each P4 block: approved 2, unchanged 2, changed 0, foreign 0.
- Notes, none a STOP: `PLUGIN-UPDATE-CHECK: unknown`; `/Users/kal-el/.claude.json` size or mtime changed during P4a to P4c (host-written, content never read); `ENGRAM-STORE-CHANGED [p1 -> p9]: ./engram.db-shm` (evidence only); installed plugin `kairo-router@kairo 0.7.5` differs from the candidate plugin `0.9.1`; no Engram identity file in the working copy.
- Independent checkpoint of the main checkout (S23), `t4-preflight-real-r3/main-checkpoints.txt` in the session scratchpad, 11 lines: HEAD `bc794973206611cda1cc3363e4998f5ac13929ad`, branch, status hash, tracked diff hashes, index summary hash, stash hash and count and the pre-existing references hash identical in every line; the worktree count went from 3 to 4. `~/.codex/config.toml` sha256 `d85e4fd029ad8300c2d31bd6bdb71359cbc287ad948b473a6d2c907f114a98e3`, 14748 bytes, unchanged.
- Open before the execution decision: the owner's review of the final manifest and of the fixture verification; the G4 solution (the wrapper measure stays disabled; its model-free verification is next); the owner's execution authorization for G1, G6 and G7. The same kit run continues to the model-gated blocks, with the guards rechecked right before each launch. No reservation or marker file exists.
