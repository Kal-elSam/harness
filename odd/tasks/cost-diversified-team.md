# Cost-diversified team
Objective: team formation assigns roles by each model's quota cost, not by model name, so expensive models only take roles that need them. Branch: `delivery/kairo-runtime-clean`. Runner: `node --test`.

## Specs
- S1: "no te bases en nombres de modelos, basate en cuato cobra cada modelo, claramente modelso de ultima genracion como astra cobra mas caro que un haiku, entonces la medicioon no es nombre es cuaota como tal". Each candidate model carries a quota-cost weight derived from provider data (price / quota consumption), never from name matching.
- S2: "para que pondremos a astra a hacer test? [...] esa misma tarea podrian hacerlo los modelos mas baratos de claude o codex". Low-demand roles (e.g. tester, explorer) go to the cheapest model that meets the role's aptitude floor; high-cost models are reserved for roles whose floor only they meet (diversification).
- S3: "tambien considera cuota, esfuerzo, porcentaje de la cuota disponible". Available quota % per provider weighs the choice.
- S4 (assumption): the analyst model stays chosen manually by the user ("la eleccion de modelo para el analisis del proyecto lo hace el usuario manualmente").

- S5: Delegation re-routes on quota (Sam chose A): when a task is delegated and the role's assigned provider is exhausted or under pressure, route it to the next-cheapest model that meets that role's aptitude floor, and tell the user about the change.
- S6: Pace to the reset: "la idea es que podamos identificar cuanto nos queda de cuota, contexto y saber a que hrs es el receteo de cada proveedor y con eso en mente diversificar y administrar bien para que nunca dejemos de trabajar; la idea de que lleguemos a 0% antes del receteo no es buena porque tendriamos que esperar a que se recee". Example values: "Context 73% left · 5h 95% left · weekly 41% left · Codex 5h 38% · wk 90% left". Every window (5h, weekly) is judged by remaining % against time left until its reset (burn pace), not raw % alone; a provider burning faster than its reset allows becomes more expensive, one with surplus before reset becomes cheaper.
- S7 (assumption): "Context % left" is the orchestrator session's context, not provider quota; it is surfaced alongside quota in the routing explanation but does not change provider cost weights in this unit.

- S8: Per-role demand tiers. Demanding roles (Architect, Debugger, Reviewer) require a strong model; light roles (Explorer, Tester) accept a cheap one; Builder is standard. Each tier has its own absolute quality/aptitude floor (not a relative "~93% of QUALITY" retention), and within a tier the cheapest qualified model wins (S1-S3 unchanged). Live evidence 2026-10-15: the relative floor let glm-5.3-flash win Explorer/Architect/Builder/Debugger/Tester.
- S9: Unknown quota is a last resort: a provider whose quota cannot be read (e.g. OpenCode Go usage HTTP 403) never beats a qualified candidate from a provider with known, healthy quota; it is used only when no known-quota candidate qualifies.
- S10: "lo limitamos por ahora a claude y codex": team formation candidates are limited to the claude and codex providers through one configurable allowlist (default ["claude","codex"]), not by deleting other providers' code.

- S11: "debemos sacar provecho a todos los proveedores y modelos disponibles, por que de que me serviria entonces usar 4 de codex y uno de claude, estoy recargando el trabajo solo a un lado". Team formation balances the workload across allowlisted providers in proportion to each provider's usable quota (remaining share and reset pace, S6), so no provider carries most roles while another has headroom; cost (S1-S3) and role demand floors (S8) still apply within that balance. Live evidence 2026-10-15: 4 codex roles + 2 claude Haiku roles.

- S12: Reviewer independence stays a hard gate (pre-existing policy "S5 R1", tests in test/model-intelligence.test.js "Reviewer blocks visibly when no independent provider is eligible" and "buildAiTeam never forces Reviewer onto a decisively worse independent alternative"): Reviewer must come from a provider different from Builder's; with no eligible independent candidate, or only a decisively worse one, Reviewer is blocked visibly, never assigned to the Builder's provider.
- S13 (assumption, parent calibration from live scores): demanding floor 0.60 instead of 0.65. Live Architect/Reviewer scores: Claude Opus 5.5 .6415, Codex gpt-6-astra .6595, gpt-5.6-terra .6135, Sonnet 5.5 .5800. A .65 floor excluded Opus 5.5 by .009 while admitting Astra by .010, a margin inside evidence noise, which defeats S11.

- S14: Project profile drives role demand: technologies, architecture, complexity and risks from the project analysis (project-analysis.js / computeProjectProfile) change each role's required capabilities and demand floor for that project, instead of stopping at the picker's context string.
- S15: Official vendor benchmark snapshots (official-benchmark-snapshots.js: gpqa-diamond, terminal-bench) count as scored evidence when AA lacks that metric for a model, with their lower trust (verified:false) reflected in weight, not ignored.
- S16: Kairo run telemetry (cost, duration, success) is attributed per role and per model and feeds role scoring and efficiency, not only a per-model tiebreak.
- S17: Owned role-aptitude evidence gets a production producer (role-aptitude runner on a real path). It spends quota, so it only runs when Sam explicitly authorizes a run; never automatically.
- S18: Effort-benchmark outcomes (scripts/effort-eval/outcome-tasks/results.jsonl) feed a low-weight per-model prior; small sample, never decisive.

- S19: "el mas barato gana? se supone que hay roles importantes como orquestador y arquitecto o reviews por ejemplo, obvio lo barato es importante pero no toma el mayor peso, asi que si debe ser mas fuerte acorde al rol". Within a tier the pick is a role-weighted trade-off between capability and quota-adjusted cost, not cheapest-qualified: demanding roles (Architect, Reviewer, Debugger, and the orchestrator if it is a team role) weight capability far above cost; light roles (Explorer, Tester) weight cost highest; Builder in between. Provider balance (S11), floors (S8/S13/S14), unknown-quota last resort (S9) and Reviewer independence (S12) still apply. Supersedes "cheapest qualified wins" in S2/S8.

## Tasks
- [x] C1 (S1-S3; ded2f1c8d; GREEN 32/0; parent full JS 3147 pass / 0 fail; all 17 Claude/Codex catalog models priced from AA) cost weight + cost-aware role assignment — delegated team-builder-codex (Claude quota 3%)
- [x] C2 (S5-S7; 5d1719863; GREEN 38/0; parent full JS 3163 pass / 0 fail; parent review caught Codex unpaced + unknown-reset over-reroute, fixed; S7: no reliable context % source in service, none invented) reset-paced cost + quota-aware delegation re-route — delegated team-builder-codex (balanced quota)
- [x] C3 (S8-S10, S12-S13; 8141819e1) role demand tiers + unknown-quota last resort + claude/codex allowlist — delegated team-builder-codex
- [x] C4 (S11; 8141819e1; parent full JS 3207 pass / 0 fail; live: claude Explorer/Tester haiku + Reviewer opus-5-5, codex Architect/Builder/Debugger terra = 3/3) quota-proportional provider load balancing across roles — after C3
- [x] C5 (S14; 946347ecc; parent full JS 3229/0 twice, one unidentified flaky failure in an earlier run; live: Architect+Debugger gpt-6-astra, Builder terra, Explorer/Tester haiku, Reviewer opus-5-5) project profile -> role demand + S19 role-weighted capability vs cost
- [ ] C6 (S15) official snapshots as scored evidence
- [ ] C7 (S16) per-role telemetry
- [ ] C8 (S17) owned aptitude producer — only with Sam authorization per run
- [ ] C9 (S18) effort-benchmark prior

## Log
- L1 (2026-10-15, Sam): "ok continua, pero no te bases en nombres de modelos, basate en cuato cobra cada modelo [...] la medicioon no es nombre es cuaota como tal".
- L2 (2026-10-15, Sam): "A, dale, en eso hay que considerar siempre tambien, estos valores Context 73% left · 5h 95% left · weekly 41% left · Codex 5h 38% · wk 90% left [...] esta adaptabilidad nos ayudara a tener siempre oportunidad de trabajar y llegar al reseteo adecuadamente".
- L3 (2026-10-15, Sam): "pero solo la semanal? y la mas importante es la de 5h, tanto para claude y codex, y esto aplica para cualquier proveedor" -> clarified: every window (5h + weekly) is paced and the tightest governs; generic for any provider reporting windows. Live: OpenCode Go usage HTTP 403 -> unknown.
- L4 (2026-10-15, Sam): "si, hacelo así" (S8-S10).
- L5 (2026-10-15, Sam): "a eso me refiero, debemos sacar provecho a todos los proveedores y modelos disponibles [...] estoy recargando el trabajo solo a un lado".
- 2026-10-15 parent: C3 correction had made Reviewer fall back to the Builder's provider; that reverses deliberate policy S5 R1 nobody asked to change (parent error in the C3 brief). S12 restores it; S13 recalibrates the demanding floor.
- L6 (2026-10-15, Sam): "debemos ser capaces de analizar toda la informacion disponible, todo lo que los roles necesitan mas todo lo que hemos hablado [...] hay muchisima informacion actualmente que podemos usar". Explorer inventory: profile, official snapshots, per-role telemetry, owned aptitude, effort outcomes unused or partial.
- L7 (2026-10-15, Sam): "dale, en ese orden" (C5 -> C9, C8 only with explicit authorization).
- L8 (2026-10-15, Sam): S19 quote above. Live 2026-10-15: Architect went to gpt-5.6-terra (.6135) over opus-5-5 (.6415) / gpt-6-astra (.6595) because cheapest-qualified.
