# Cost-diversified team
Objective: team formation assigns roles by each model's quota cost, not by model name, so expensive models only take roles that need them. Branch: `delivery/kairo-runtime-clean`. Runner: `node --test`.

## Specs
- S1: "no te bases en nombres de modelos, basate en cuato cobra cada modelo, claramente modelso de ultima genracion como astra cobra mas caro que un haiku, entonces la medicioon no es nombre es cuaota como tal". Each candidate model carries a quota-cost weight derived from provider data (price / quota consumption), never from name matching.
- S2: "para que pondremos a astra a hacer test? [...] esa misma tarea podrian hacerlo los modelos mas baratos de claude o codex". Low-demand roles (e.g. tester, explorer) go to the cheapest model that meets the role's aptitude floor; high-cost models are reserved for roles whose floor only they meet (diversification).
- S3: "tambien considera cuota, esfuerzo, porcentaje de la cuota disponible". Available quota % per provider weighs the choice.
- S4 (assumption): the analyst model stays chosen manually by the user ("la eleccion de modelo para el analisis del proyecto lo hace el usuario manualmente").

## Tasks
- [x] C1 (S1-S3; ded2f1c8d; GREEN 32/0; parent full JS 3147 pass / 0 fail; all 17 Claude/Codex catalog models priced from AA) cost weight + cost-aware role assignment — delegated team-builder-codex (Claude quota 3%)

## Log
- L1 (2026-10-15, Sam): "ok continua, pero no te bases en nombres de modelos, basate en cuato cobra cada modelo [...] la medicioon no es nombre es cuaota como tal".
