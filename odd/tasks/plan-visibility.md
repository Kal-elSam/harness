Objective: quota messages that carry real value, a status line that never reports healthy quota as unavailable, and Kairo-routed work (inline included) shown as a plan of roles and models before implementation.
Branch: feat/plan-visibility (worktree ../agentic-harness-worktrees/plan-visibility). Delivery: ask-on-risk. Test runner: `npm test` (node --test); plugin tests under integrations/claude-code/kairo-router.

## Specs

- S1. Band message. User (verbatim): "Use claude now; codex has quota now, but at today's pace it would sit unused about 142h 22m (until Nov 2) [-]este mensaje que dejamos no me hace sentido para nada, y no aprtoa como tal nada, hay que cambiarlo o quitarlo, debe de ver un valor real". Approved proposal: "que la banda solo aparezca cuando hay algo para hacer. Por ejemplo, "Claude 5h se acaba ~12:50 a este ritmo; lo delegado pasa a Codex hasta 1:30 pm", o cuando un proveedor llega a 0%. Si todo está sano, no muestra nada." Source: integrations/claude-code/kairo-router/hooks/register.ts pacingBand.
- S2. Status line staleness. User (verbatim): "Codex quota unavailable (missing or stale) sale muyu seguido porque?" Approved proposal: "que la línea de estado dispare el refresco en background que ya existe (--no-wait) cuando el dato está viejo, y mientras tanto muestre el último valor con su antigüedad, por ejemplo Codex 5h 65% (4m ago), en vez de "unavailable"." Source: src/global/team/statusline-cli.js (USAGE_MAX_AGE_MS 2 min, no refresh).
- S3. Inline routing and plan visibility. User (verbatim): "y para el trabajo inline, kairo debera de routeralo, no solo subagentes, porq ue debe ser para todo, po reso es improatnte entonces que antes de impementar algo, nos diga que modelos y que roles haran que cosa, tanto si es inline o si es subagente, debemos poder tener esa visibvilidad". Agreed design: before the first implementation edit, Kairo shows the plan table (step, role, real routed model; inline steps as "Orchestrator (<session model>)"). The orchestrator only reads, decides, reviews and makes small edits (<= 20 changed lines); a larger inline Edit/Write/MultiEdit is BLOCKED by the kairo-router hook with a message naming the routed role and model to delegate to. User decision (verbatim): "bloquear". Exemption, user decision (verbatim): "vamos con A" = the orchestrator's ODD logbook files under odd/tasks/** are not blocked.
- S4. Router rewrite. Evidence 2026-10-26: a team-builder-codex launch ran as team-builder (sonnet, claude) because decidePacingRewrite in register.ts follows pacing nextWriter ("use claude"). Delegated launches must follow Kairo's equal provider split, not the next-writer preference.

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1 | delegated writer, ran as team-builder (sonnet, claude) | done | 50137dd2d; plugin 135/0; parent shortened the sentence inline |
| T2 | S2 | delegated writer, team-builder (sonnet, claude) | done; follow-up: refresh also when no Codex data exists | 6560d2138; statusline 7/0 |
| T3 | S3 | delegated writer team-builder-codex (gpt-6.1-sol) [no-redirect], correction by the same; odd/tasks exemption inline | done | e4553439a, d02b9f697 + exemption; plugin tests green |
| T4 | S4 | same writer as T3 | done | e4553439a; review confirmed no nextWriter pair rewrite remains |

## Log

- L1 (2026-10-26, user, verbatim): "si, y para el trabajo inline, kairo debera de routeralo, no solo subagentes, porq ue debe ser para todo, po reso es improatnte entonces que antes de impementar algo, nos diga que modelos y que roles haran que cosa, tanto si es inline o si es subagente, debemos poder tener esa visibvilidad ... apica eso tambien ... tambien eso"
- L2 (2026-10-26): T1 and T2 run as two parallel writers (Writer trigger a: independent units, disjoint edit surfaces). Equal provider split: one Claude writer, one Codex writer. Parent owns git and runs the seam check (full suite) once.
- L3 (2026-10-26, user, verbatim): "bloquear" (inline edits over 20 lines are blocked, not warned).
- L4 (2026-10-26): T1 was launched as team-builder-codex but ran as team-builder (sonnet, claude): the installed router rewrote it per nextWriter. Recorded as S4/T4.
- L5 (2026-10-26): seam check npm test 3509/0 after T1+T2. kairo-router plugin version must be bumped before the PR (0.4.1 on main; #457 bumps to 0.4.2).
- L6 (2026-10-26): Claude review (jd-judge-a, sonnet) of e4553439a: line counting approximate, [no-redirect] silently disabled the block, missing tests; fixed in d02b9f697. agentId on subagent events confirmed by the engine contract (claude-code.d.ts AgentInfo.id).
- L7 (2026-10-26, user, verbatim): "vamos con A" (odd/tasks/** exempt from the inline edit block).
- L8 (2026-10-27, Sam): "si dale, solo el filtro de reset". S2 keeps aged values without a time bound (the 30-minute bound from fix/statusline-stale-codex was dropped because it contradicts S2); a Codex window whose reset already passed now shows `reset` instead of its pre-reset percent and triggers the background refresh. Resets are normalized at observation time (cache savedAt). RED 2 -> GREEN statusline 9/9, npm test 3525/3525.
