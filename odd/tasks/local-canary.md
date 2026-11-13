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

## Tasks

- T1 (S1-S5) route inline, status in review by the product owner. Design of the phase 1 procedure and its validation (this document, Log L3). Evidence: none yet, nothing executed.
- T2 (S2) route delegated (runner), status open. Model-free rehearsal of the procedure on a throwaway git repository, with the guards.
- T3 (S1, S2) route delegated (runner), status blocked: the secondary repository has not been chosen by the product owner yet. Pilot on that repository.
- T4 (S1, S2) status blocked until finding 10 is closed and the fix is integrated. Phase 2, multi-provider delegation.
- T5 (S1) status pending. Phase 3, habitual local installation with a compatible plugin and an update and recovery procedure.

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
