# Provider parity routing

Objective: Kairo forms and re-forms the delegated team from the providers and models that are really available, with parity across all of them; only the Orchestrator is user-chosen.
Branch: to be created from main (feat/provider-parity-routing). Delivery: ask-on-risk. Test runner: npm test (node test runner, ~150 s full suite).

## Specs

- S1 (inventory, step 0): "identificar realmente proveedor y modelso dis[pnipbes, por que si no esta disponible no podremos usarlos". A provider counts as available only when its CLI is present, its session is authenticated, its real model catalog is readable, and its quota is readable; checked without running a model (assumption: these four checks are the definition of available).
- S2 (live quota reading): "kairo debe de leer  Opus 5.5 (medium) · Context 86% · Claude 5h 4% · week 87% · Codex 5h 50% · week 92%". Today the pacing line reports "No quota data: claude, codex, opencode-go" while the status line reads real values.
- S3 (dynamic re-forming): "entonces el orquetador dira, vale claude ya queda poco % antes del reset, combiene trbaajr con modelos de codex entonceshasta el rset que es 1:30-, ese es el analsis que buscamos ,entonces el orquetados y analsita reajsutarn el equipo nuevo con lo disponuble y asi".
- S4 (parity): "no etamos siendo equitativos con los porveedores que tenemos tengamos 1 o 2 o los que sean, debe de ver paridad, el unico rol que elegimos nosotros es el eorquetador por eu es el modelo qeu elegimos default".
- S5 (option A): "vamos con A". Inside a price band, peers count as equivalent; waiting only happens when nobody in the band can take the task; the "wait for better" admission rule goes away.
- S6 (no upward band escalation): "astra para Refactorer? no se me hace adecuado muhco modelo apra tabajo de campo no?". A role must not land on a provider's most expensive model because its own band was filtered out (price-tier.js FALLBACK standard: ["demanding","light"]).
- S7 (plan always, in background): "este analisis debe ser siemnpre y en segundo plano, se suponeuq que klairo lo deberia de hacer junto con el orquestador". Kairo produces the Step | Role | Model (provider) | Inline or delegated plan itself; it is not left to the orchestrator to remember.

## Tasks

- T0 [S1,S2] Map: provider inventory sources and why pacing reads no quota — delegated explorer (kairo-codex, gpt-6-luna) — done (partial: zero-role cause for opencode-go/cursor/gemini still open)
- T1 [S1] Inventory command (CLI, auth, catalog, quota per provider) — route TBD — pending
- T2 [S2] Fix pacing quota reading — route TBD — pending
- T3 [S5] Option A: band peers equivalent, remove "wait for better" — delegated team-builder-codex (gpt-6.1-sol), worktree ../agentic-harness-worktrees/provider-parity-routing, branch feat/provider-parity-routing — done (RED: expected ROUTED, got WAIT_FOR_PROJECT_TEAM; GREEN: router tests 43/0, npm test 3524/0 outside the Codex sandbox)
- T4 [S6] Band fallback must not escalate field roles to the priciest model — route TBD — pending
- T5 [S3,S4] Re-form team from inventory with parity until next reset — route TBD — pending
- T6 [S7] Kairo-generated plan table on each prompt — route TBD — pending

## Log

- L1 (2026-10-26) Original request: "vamos con A, pero por que no veo el plan de accion que te habia pedido? por que no se que modelos y que roles vana atbrajar, y por lo que veo sol oestas t rabajando con modelso de claude"
- L2 Evidence: approved team = 6 claude + 7 codex roles, 0 for opencode-go, cursor, gemini, although CLIs claude, codex, opencode, cursor-agent, gemini are installed. Refactorer routed to GPT-6-Astra ("codex has no standard model in the pool; using its demanding band"). kairo team route --refresh returns only {"refreshed":true}; kairo doctor checks config, not availability. kairo team route --role takes display names ("Refactorer").
- L3 Next: T0 mapping in a fresh session (orchestrator context at 86%).
- L4 (2026-10-26) User: "dale continua". T0 launched on kairo-codex (Explorer, gpt-6-luna). First launch stopped: the wrapper needs a standalone "kairo-model: MODEL" line, and its fallback ran kairo team route --role explorer (lowercase), which fails with unknown_role because routes accept display names ("Explorer"). Relaunched with the kairo-model line; the lowercase-role defect is added to the T0 questions.
- L5 T0 map: two provider lists disagree: src/global/registry.js:3-11 (cursor, codex, opencode, claude, pi) and src/global/provider-connections/allowlist.js:18-25 (codex, claude, cursor, opencode-go); gemini and opencode-zen are in neither. No single check covers CLI + auth + catalog + quota per provider (S1 gap). Pacing hook runs `kairo team pacing --json --no-wait` (register.ts:160-174); with a stale cache it returns empty windows while refresh runs detached (src/global/team/pacing-cli.js:85-123), and the statusline reads a separate cache path (statusline-cli.js:1-3): likely S2 cause, unconfirmed. "Wait for better" is src/global/team/project-router.js:260-273 (spot-checked: `wait = !bestNow ? earliest : qualityDrop > waitFraction ? preferredWait : null`). Wrapper fallback text lives in src/global/hosts/claude-code.js:15-17. Open: why opencode-go/cursor/gemini get zero roles. New defect: `kairo team verdict --agent kairo-codex` fails with "Unknown agent \"kairo-codex\" in the project role catalog", so verdicts for host wrapper launches cannot be recorded.
- L6 (2026-10-26) T3: builder reported 49 npm test failures, all sandbox EPERM; parent reran npm test outside the sandbox: 3524 pass, 0 fail. Parent review removed a duplicated test and made a loose assertion exact (close-now). qualityDrop/waitFraction removed from trace.admission (no other readers). Risk: item 3 (shared router output). Kairo verdict could not be recorded for host wrapper agents (see L5).
