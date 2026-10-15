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

## Tasks
- [x] C1 (S1-S3; ded2f1c8d; GREEN 32/0; parent full JS 3147 pass / 0 fail; all 17 Claude/Codex catalog models priced from AA) cost weight + cost-aware role assignment — delegated team-builder-codex (Claude quota 3%)
- [x] C2 (S5-S7; 5d1719863; GREEN 38/0; parent full JS 3163 pass / 0 fail; parent review caught Codex unpaced + unknown-reset over-reroute, fixed; S7: no reliable context % source in service, none invented) reset-paced cost + quota-aware delegation re-route — delegated team-builder-codex (balanced quota)
- [ ] C3 (S8-S10) role demand tiers + unknown-quota last resort + claude/codex allowlist — delegated team-builder-codex

## Log
- L1 (2026-10-15, Sam): "ok continua, pero no te bases en nombres de modelos, basate en cuato cobra cada modelo [...] la medicioon no es nombre es cuaota como tal".
- L2 (2026-10-15, Sam): "A, dale, en eso hay que considerar siempre tambien, estos valores Context 73% left · 5h 95% left · weekly 41% left · Codex 5h 38% · wk 90% left [...] esta adaptabilidad nos ayudara a tener siempre oportunidad de trabajar y llegar al reseteo adecuadamente".
- L3 (2026-10-15, Sam): "pero solo la semanal? y la mas importante es la de 5h, tanto para claude y codex, y esto aplica para cualquier proveedor" -> clarified: every window (5h + weekly) is paced and the tightest governs; generic for any provider reporting windows. Live: OpenCode Go usage HTTP 403 -> unknown.
- L4 (2026-10-15, Sam): "si, hacelo así" (S8-S10).
