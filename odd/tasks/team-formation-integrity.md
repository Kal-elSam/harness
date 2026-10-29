# Team formation integrity
Objective: Kairo forms and routes a two-provider team that respects role classes, never waits or silently drops a provider, and uses every capable tier. Branch: feat/team-formation-integrity (worktree agentic-harness-worktrees/team-formation-integrity).
Delivery strategy: stacked-to-main (user selected; parent owns git). Test runner: npm test (node --test); exact package.json script: `node --test 'test/**/*.js' 'test/**/*.mjs' 'test/**/*.cjs'`.

## Specs
- S1 (user, verbatim): "es que tenemos 2 provedores actualemnten si o si, no pueden fallar, por eso tenemos pool que se vanb a daptadndo acorde a las cuotas que vamos teniendo"
- S2 (user, verbatim): "hay roles que analizans y dan cosa pero como tal no deben ejecutar o buildear cosas, y otros que son la manos de obra, no vamos aponer a astra a ejcutar comando o buolder cosas , si puede ver verifgicar y asi, pero se suponeque quie por ejemplo astra o opus que son modelso fontrea delegan y toman decisiones, algo no eta funcionando como deberia, y como dices sonnet no esta en ningun lado"
- S3 Role classes are explicit and hard (approved with "ok dale"): analysis = Architect, Security Reviewer, Reviewer, Planner, Test Designer, Debugger (diagnosis); labor = Backend Builder, Refactorer, DevOps, Test Runner, Debugger (fix), Deliverer, Documenter, Explorer; verification = Verifier. One shared compatibility predicate used by formation, reform and runtime routing: frontier models only in analysis or verification; labor models never in Architect or Security Reviewer. Quota and cost still rank models inside the compatible set.
- S4 New roles (approved with "ok dale"): Tester splits into Test Designer (analysis) and Test Runner (labor); Debugger splits into Debugger (diagnosis, analysis) and Debugger (fix, labor). Existing stored teams and every role consumer keep working (migration of persisted strategies and role catalogs).
- S5 Reviewer and Security Reviewer are always from a different provider than every Builder when both providers are configured; no silent same-provider degradation. If impossible, formation fails loudly with the reason instead of approving.
- S6 Never wait while a compatible model on another provider is admissible: runtime routing considers every authorized compatible alternative before WAIT and keeps a per-candidate rejection trace. Entitlement handling runs before substitution.
- S7 Expired Claude entitlements (7-day TTL) re-probe automatically or fail loudly; a provider never disappears silently. Add CLI kairo team verify-access [--refresh] wrapping the existing service.verifyClaudeEntitlements.
- S8 Formation uses every capable tier: a per-model role cap that binds, and pool qualification and final formation share one preprocessing and comparability path (the Planner case excluding qualifying Sonnet .5757 above the .55 floor is a regression test).
- S9 Measured success blends with public capability instead of replacing it, and benchmark coverage differences are visible in decisions; no invented benchmarks, no silently lowered floors.
- S10 With scarce Claude quota, S3 and S5 still hold: cross-provider review uses the cheapest qualified Claude model and only at risk points (high-risk commits), not every task.
- S11 Explanations tell the truth: real cost source instead of the boilerplate "unknown cost ranks last", precise exclusion stage instead of "outside_band", and kairo team plan shows the underlying error instead of plan_failed.
- S12 (user, verbatim): "Three orchestration levels: the general orchestrator (user's session) only orchestrates; role orchestrators (frontier models in analysis roles) decide and delegate; workers (cheap labor models) do search, research, build, test and delivery. Analysis roles consult CodeGraph, Engram, Graphify and Obsidian first and delegate broad reading to a cheap worker instead of reading code themselves."
- Orchestrator stays the user's session model, outside Kairo selection.

## Tasks
| ID | Specs | Route | Risk | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| T1 | S3, S4 | delegated | item 3 (role catalog contract, persisted strategies) | partial: implemented; same 12 baseline suite failures; parent verification pending | uncommitted (parent owns git) |
| T2 | S3, S5 | delegated | item 3 | pending | — |
| T3 | S8, S9 | delegated | item 6 | pending | — |
| T4 | S1, S6, S7 | delegated | item 4 (routing order, admission) | pending | — |
| T5 | S10, S11 | delegated | none expected | pending | — |
| T6 | S12 | delegated | item 3 | pending | — |

## Log
- L1 2026-10-29 user (verbatim): "necsitamos deplegar, y correr neuvamente la creacio nde qiupo, necistmao ver que euqipo es el equ etenmos y que tan adecuado es, saber que equipo tenemos y si esta ok, la delegacion es demasido imporante y el inline tambien porq ue hay roles que analsis arquitectaen y orquestan yu aprte tenemos la mano de obra como tal"
- L2 2026-10-29 user (verbatim): "eso esta pesimo astra en 5 roles? que mierda es eso? que paso con todo lo demas quie teniamos sobre equidad, distribucion? donde esta todo lo que kairo se suponque aporta sobre como organizar yc rear el equipo adecuadamtne? acorde a todos los modelos que tnemos dipsonibles?? aocrde al poreycto? etc??"
- L3 2026-10-29 evidence: active team was 100% codex because Claude entitlements expired (7-day probedAt TTL, src/global/observability/claude-entitlement-store.js); re-probe restored 10 allowed Claude models. Fresh proposal 1a2134ba7d5307f274593983 (analyst claude-opus-5-5) not approved: Astra on Architect, Debugger, Reviewer; Opus only Security Reviewer below floor; Reviewer not provider-independent; Sonnet zero roles. Pacing percentages are remaining quota (pacing-cli.js:131); Claude weekly remaining 5 percent until Nov 1.
- L4 2026-10-29 root causes (Debugger diagnosis on gpt-6-astra, base 7cc40e903):
  1. withMeasuredQuality (src/global/intelligence/model-intelligence.js:564-580) replaces public capability with measured successRate after MIN_ROLE_RUNS; Astra Reviewer 9/9 became fit 1.0 versus public .6595; self-reinforcing because scarce-quota models never accumulate runs.
  2. Unequal benchmark coverage: Opus 5.5 review fit .6415 (HLE .614, SciCode .669, missing GPQA and MMLU-Pro) versus Astra .6595 against a .65 floor; Sonnet .58.
  3. Pool qualification and final formation diverge (project-strategy.js:452-480, model-intelligence.js:2292-2315, price-tier.js:75-82, model-intelligence.js:1086-1101); Planner pool excluded Sonnet and labeled it outside_band.
  4. Execution guard is relative price bands covering only Builder, Refactorer, Tester (role-registry.js:345-347, price-tier.js:46-48); DevOps, Deliverer, Documenter, Verifier uncovered; no labor-forbidden guard on analysis roles (model-intelligence.js:980-996).
  5. Runtime router returns WAIT before fallback when admission admits nobody, and entitlement handling runs after substitution (project-router.js:324-371, 390-435); admission assumes 10/30/40 percentage points per light/standard/demanding task without history (task-admission.js:18-21, 74-94).
  6. "unknown cost ranks last" is boilerplate (role-demand.js:179-182); Claude costs are known per AA task: Opus 10.04, Sonnet 10.02, Haiku .41, Astra 6.24, Sol 1.27, Terra .96, Luna .15.
  7. kairo team plan masks errors (src/global/team/team-cli.js:269-295).
- L5 2026-10-29 role-name blast radius: read-only `grep -rln --exclude-dir=fixtures -E 'Tester|Debugger' src test | sort` found 64 unique files (case-sensitive, either role name; fixture directories excluded). Top-level directories: `src` (21 files), `test` (43 files). Source subdirectories: `src/global/hosts` (1), `src/global/intelligence` (10), `src/global/observability` (2), `src/global/runtime` (2), `src/global/team` (6). Complete file list for T1:
  - `src/global/hosts/claude-kit.js`
  - `src/global/intelligence/capability-scoring.js`
  - `src/global/intelligence/gentle-role-map.js`
  - `src/global/intelligence/model-intelligence.js`
  - `src/global/intelligence/role-aptitude-invoke.js`
  - `src/global/intelligence/role-aptitude-probes.js`
  - `src/global/intelligence/role-aptitude-runner.js`
  - `src/global/intelligence/role-aptitude-validators.js`
  - `src/global/intelligence/role-catalog.js`
  - `src/global/intelligence/role-demand.js`
  - `src/global/intelligence/role-registry.js`
  - `src/global/observability/agent-session-telemetry.js`
  - `src/global/observability/artificial-analysis-models.js`
  - `src/global/runtime/execution-worktree-manager.js`
  - `src/global/runtime/execution-worktree-orchestrator.js`
  - `src/global/team/claude-hooks.js`
  - `src/global/team/project-analysis.js`
  - `src/global/team/project-profile.js`
  - `src/global/team/project-router.js`
  - `src/global/team/roles-init.js`
  - `src/global/team/team-decision.js`
  - `test/agent-session-telemetry.test.js`
  - `test/capability-scoring.test.js`
  - `test/claude-hooks.test.js`
  - `test/claude-kit.test.js`
  - `test/concentration-cap.test.js`
  - `test/cost-diversified-team.test.js`
  - `test/execution-worktree-orchestrator.test.js`
  - `test/execution-worktree.test.js`
  - `test/gentle-role-map.test.js`
  - `test/kernel-delegate.test.js`
  - `test/model-distribution.test.js`
  - `test/model-intelligence.test.js`
  - `test/phase-planner.test.js`
  - `test/project-analysis.test.js`
  - `test/project-demand.test.js`
  - `test/project-profile.test.js`
  - `test/project-router-distribution.test.js`
  - `test/project-router.test.js`
  - `test/project-strategy-store.test.js`
  - `test/project-strategy.test.js`
  - `test/provider-balance.test.js`
  - `test/role-aptitude-evidence.test.js`
  - `test/role-aptitude-invoke.test.js`
  - `test/role-aptitude-operational.test.js`
  - `test/role-aptitude-probes.test.js`
  - `test/role-aptitude-runner.test.js`
  - `test/role-aptitude-selection.test.js`
  - `test/role-catalog.test.js`
  - `test/role-demand-tiers.test.js`
  - `test/role-demand.test.js`
  - `test/role-pool-band.test.js`
  - `test/role-profiles.test.js`
  - `test/role-registry.test.js`
  - `test/role-telemetry.test.js`
  - `test/role-weighted-selection.test.js`
  - `test/roles-scope.test.js`
  - `test/team-analyze-cap.test.js`
  - `test/team-apply.test.js`
  - `test/team-equity-cap.test.js`
  - `test/team-exec.test.js`
  - `test/team-route.test.js`
  - `test/team-selection-repro.test.js`
  - `test/worker-events.test.js`
- Forecast: well above 400 authored changed lines; user selected stacked-to-main. Parent owns commits and delivery. T1 and T2 remain separate review units because they touch item 3.

- L6 2026-10-29 coordinator: chain strategy chosen by the user: stacked-to-main. Approved edit surfaces include all 21 source consumers in L5 plus price-tier.js, src/global/team/**, src/global/host/**, src/global/hosts/**, src/global/mcp/**, src/cli.js, test/**, docs/** and this task document. No commit, push or branch switch in T1.
- L7 2026-10-29 user (verbatim): "pero como es posible que astra me gatara como debugu el 50% casi, por eso ahji es donde ese rol deberia saber delegar cosas tambien me eplcico? por eso te decia que el equipo formatro esta mal, ponemos aa modelos frontera a hacer manos de hiombra bsuqueda en codigfo etc. cuando casi toda la ifnmpramcion esta disponible en codegrapgj, engram, gparsgio y obsidian, pero las delegaciones de trabajo no etan fucnionando adecuadamente nio como se espraria, el orquestador sigue haciendo tareas como tal en lugar de lo que realmetne debe de ahcer orquestador, digamos que tedmnrimoa varios nievels deorquestacion, orquyesador general de todo, orquesdot de rol, y trbajadores por que poner a astra a opus a sol a ahcer reasearch busuedadas build debugs revies test deliver por ejemplo es un desperdicio"
- L8 2026-10-29 T1: stable registry IDs are `Test Designer`, `Test Runner`, `Debugger (diagnosis)`, `Debugger (fix)` (consistent with existing human-readable IDs). Frontier means demanding provider list-price band from price-tier.js's full-catalog providerPriceTiers, not model names; single-price `any` is not frontier evidence, missing band fails closed. T1 defines/tests compatibility only; T2 owns enforcement. Existing strategy/proposal/catalog/cache readers share pure migration; no loader duplication or writes on read. Original active-base hash identity is retained for unchanged normalized legacy teams so pending approvals survive. Historical approval fixtures remain unchanged. New analysis aptitude probes reuse existing fixture materialization and prohibit edits. S12 is recorded only, not implemented.
- L9 2026-10-29 T1 evidence: initial role-split tests RED 25/25 failed then GREEN 25/25; read-only probe RED 1 failure then GREEN 27/27; legacy cache/routing RED 1 failure then GREEN 28/28. Source/test/doc consumer sweep exceeds 400 authored lines because role IDs, kit agents and historical role-based test consumers all need alignment; tests are retained. CodeGraph status/sync failed (unable to open database file), so directed source reads were used. Worktree lacks dependencies; verification uses exact scratch source copies with offline cached dependencies, never the live install.

- L10 2026-10-29 T1 regression discoveries: read migration must retain model/object reference identity for modern strategies (existing conversation-service strictEqual contract), preserve unchanged legacy base hashes for pending approvals, and never rename model IDs or unrelated metadata. Shared normalizer now uses structural sharing, scoped role-field/map expansion and own-property lookup. Added observed RED then GREEN cases for these boundaries. Final dedicated split/migration tests: 31 passing. Existing historical fixture bytes are unchanged; fixture consumers compare selection evidence against the intentionally expanded read view. Aptitude CLI and read-only-plan expectations now include both new analysis roles. Source scan finds retired single-role literals only in the migration shim.
- L11 2026-10-29 T1 final verification (exact source snapshot at `/tmp/kairo-t1-gp2eYN/delivery`, offline cached dependencies; isolated HOME/HARNESS_HOME/TMPDIR and host markers unset): `node --test` all new/touched files plus conversation-service and show/routes/roles-init/approve regression files: 1230 tests, 1228 pass, 2 fail. Both failures (`plan --all through existing argument parser shows full compact horizon`; `plan JSON retains all raw phases regardless of display horizon or --all`) reproduce at base 7cc40e903 (base team-plan: 15 pass / 2 fail). `npm test`: 3946 tests, 3934 pass, 12 fail; base `npm test`: 3911 tests, 3899 pass, 12 fail. Failure-name sets are identical; zero new failures. The remaining baseline failures concern checkpoint/hook CLI execution and native sandbox canaries, not T1. Exact names/counts: `/tmp/kairo-t1-gp2eYN/verification-summary.json`. Initial direct worktree suite could not resolve zod because dependencies are absent; scratch copies were used rather than modifying the live install or adding node_modules to the approved tree.
- L12 2026-10-29 T1 differential: base `git archive HEAD` and final snapshot ran `kairo team show` and `kairo team routes`, JSON and text, against the SAME scratch HARNESS_HOME containing a copied saved-strategy fixture with legacy Tester/Debugger entries. All eight checks pass: modern stdout/stderr/exit identical; legacy output differs only by expanded role rows, text column widths and derived routes fingerprint; stored team bytes unchanged. Script/log: `/tmp/kairo-t1-gp2eYN/differential-closure.mjs`, `differential-closure.log`. Scratch root retained: `/tmp/kairo-t1-gp2eYN`; every explicitly logged new scratch directory is listed in `scratch-paths.txt` (74 directories). No scratch cleanup performed. `git diff --check` and syntax checks pass. All changed files match the approved edit surfaces; branch and HEAD remain feat/team-formation-integrity / 7cc40e90330eee8514649c5f5029457580f107ab. No commit, push or branch switch. CodeGraph unavailable as noted in L9; Graphify refresh skipped because generated graph artifacts are outside the approved edit surfaces. S3 coverage is registry classes/shared predicate only (T2 enforcement intentionally untouched); S4 split, migration and consumer sweep covered. Parent independent verification/review remains pending. Proposed commit: `feat(team): split analysis and execution roles`. Risk: item 3 (role catalog and persisted strategy contracts).
- V1 (verifier, c90cdd525, T1 S3/S4): PASS. Legacy Tester/Debugger strategy, pending proposal and .kairo/roles.json load and expand; bytes unchanged by read; basedOn hash and proposal id still match; team show/routes identical to base for teams without old roles. Advisories only: predicate unaware of project-catalog custom roles (fails closed), sourceRole never set on registry entries.
