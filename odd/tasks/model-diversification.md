# Model diversification and editable roles

Objective: Kairo distributes real work across every qualified, executable model the user has (subscriptions, API keys, available models), per role, instead of one best model doing everything; roles become editable per project.
Branch: feat/model-diversification (from feat/gentle-role-model-bridge @ 5d6cf4039), worktree ../kairo-diversification. Delivery: ask-on-risk. Test runner: `npm test` (node --test).

## Specs

- S1. User (verbatim): "buscamos 100% de diversificacion, no me sirve de nada que sonnet o luna o astra o opus haga todas las tareas, es perdida de tiempo y recursos aun cuando realmente si pueda hacer todo, un equipo real no trabaja asi, por eso tenemos detecciones de suscripciones, de api key, de modelos disponibles, y la delegacion equitativa es la clave, por que hay quienes trabajan solo con claude y esta bien pero hay quienes mezclan diferentes proveedores y debemos poder ayudarles a sacar el maximo provecho de todos sus modelos disponibles"
- S2. User (verbatim): "en teoria cuantos roles podemos llegar a tener? estos podran ser editables?" — roles editable per project, no fixed ceiling.
- S3. User (verbatim): "se debe de tomar media entre ambos ... deberiamos de tener diferente niveles no solo critico y conserve" — Kairo quota pacing gets the blended pace and graded tiers already shipped in the team-pacing mod (b61f3a9).
- S4. User chose option A (verbatim): "sí, vamos con A". Option A as presented: "proporcional al cupo que le queda a cada proveedor, con un piso de calidad por rol ... Primero se reparte entre proveedores y después entre los modelos de cada uno, para que un proveedor con muchos alias no se lleve más trabajo del que le toca."

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S3 | delegated team-builder-codex | done 512e4b9bc; RED 11 -> GREEN 28/0; npm test 3198/0 | port blended pace + HEALTHY/WATCH/CONSERVE/CRITICAL into src/global/intelligence/quota-pacing.js |
| T2 | S1, S4 | delegated team-builder (Sonnet, parallel with T1) | done 2a381bea2; RED module missing -> GREEN 12/0; selectDistributedModel | per-role distribution state (targets, deficits, in-flight reservations) fed by run records |
| T3 | S1, S4 | delegated team-builder (Sonnet; Codex run stopped after L6) | done 78038dc3b; RED 8 -> GREEN 10/0; npm test 3208/0; verifier pending | router picks the most under-served qualified model per task (project-router.js) |
| T4 | S2 | pending | pending | project role file merged with defaults into a project-scoped registry |

## Log

- L1 (2026-10-22, user): S1, S2 and S3 messages quoted above.
- L2 (2026-10-22): map by team-researcher-codex. Pool: model-candidate-catalog.js:424-684 (adapterId, modelId, access, entitlement); capacity per adapter (subscription-pressure-source.js:36-44). quota-pacing.js:43-96 uses full-window average only and continuous pressure, no tiers. Team composition already balances (provider-balance.js:6-29 targets proportional to remaining x pace, soft surcharge; model-intelligence.js family limits), but runtime reuses one approved assignment per role (project-router.js:180-233): no per-task distribution. Run records already carry provider, model, role (runtime/run-types.js:77-129). Roles: 14 hardcoded (role-registry.js:20-277); capability scoring is generic (model-intelligence.js:424-501), so custom-role selection is feasible; execution chain, gentle bridge, and telemetry assume fixed ids.
- L3: open decision S4. Risk noted by the mapper: stronger diversification can trade away cheapest-model utility; "all available" must mean all qualified, executable candidates, not every catalog entry. Headroom must be split per shared quota bucket first, then among that provider's models.
- L4 (2026-10-22, user): "sí, vamos con A" (S4 resolved: headroom-proportional with per-role quality floors).
- L5 (2026-10-22): T1 512e4b9bc and T2 2a381bea2. Earlier 131-146 suite failures came from the new worktree lacking node_modules; parent symlinked ../kairo-runtime-clean/node_modules (identical package.json, untracked, not committed). Full suite 3198/0. T2 extra behaviors: all providers exhausted -> least-used candidate, flagged; actual share counts only runs on current candidates.
- L6 (2026-10-22, user): "por que 2 proveedores, en teoria se analizo todos los modelos disponibles y todos los proveedores disponibles y se toma la decision para elegir adecuadamente con base a todas las metricas parametros y logica que tenemos ya en base no? por que dices 2 nadamas?" Parent verified: the approved strategy stores only model + one fallback per role (project-strategy.js:123-153), so the first T3 spec (approved assignment plus stored alternatives) would rotate between at most 2 models. T3 spec corrected: candidates are the full current qualified pool for the role across every provider and model (model-intelligence ranking over the model-candidate catalog, after entitlement, executability and the role quality floor), recomputed at routing time so new keys or models join automatically. Stopped run discarded (two untracked test files deleted).
