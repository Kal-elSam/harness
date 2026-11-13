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

## Tasks

- T1 (S1-S5) route inline, status in review by the product owner, amended after the rehearsals (Log L6). Design of the phase 1 procedure and its validation (this document, Log L3). Evidence: none yet, nothing executed.
- T2 (S2) route delegated (runner), status done. Evidence: Log L4 and L5 (first rehearsal FAIL on a real finding, second rehearsal PASS). Commit: none (the parent owns git). Model-free rehearsal of the procedure on a throwaway git repository, with the guards.
- T3 (S1, S2) route delegated (runner), status ACCEPTED_WITH_OBSERVATION by the product owner on 2026-11-13 (Log L8); closed. Evidence: Log L7, commit b9ad712cf. Run on 2026-11-13 on the repository chosen by the product owner (/Users/kal-el/Desktop/Inversion); every command verdict PASS and the repository guard unchanged; round label INCONCLUSIVE because of one Codex process seen in the baseline inventory (Log L7). Pilot on that repository.
- T4 (S1, S2, S8-S11) status: preparation authorized on 2026-11-13 (Log L8), in progress: the six preparation items of S9; no team analyze, no admission activation and no model call until a specific execution contract is approved. Context: the Codex trust fix is verified end to end and integrated in the candidate since 2026-11-13 (release/v0.37.0 at 10b64c801). Phase 2, multi-provider delegation.
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
