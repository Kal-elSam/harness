# Gentle role-model bridge

Objective: Kairo's approved team (project analysis → roles → model per role) is actually applied to the agents, through gentle-ai's own state plus a temporary Kairo bridge for Claude Code (gentle-ai issues #5550, #5610, #5252).
Branch: feat/gentle-role-model-bridge (from refactor/retire-ui-pi @ 3d704852a). Delivery: ask-on-risk. Test runner: `npm test` (node --test).

## Specs

- S1. User (verbatim): "de acuerdo, procede, tambien esta considerando el analisis de proyecto, creacion de roles, y asignacion de modelos?" — the flow covers project analysis, role activation, model assignment, and application to agents.
- S2. User chose option A (verbatim): "sí, vamos con A". Option A as presented: "Kairo escribe en `claude_phase_assignments` de gentle-ai, que es su propia fuente de verdad, con backup previo, y además crea los agentes `odd-*.md` marcados como "puente de Kairo" para que se apliquen hoy. Cuando gentle-ai publique su arreglo, el puente se retira solo y tus elecciones ya quedan en su lugar."
- S3. Fix `kairo fleet configure --from gentle`: it reads legacy `claude_model_assignments` (src/global/fleet-shared.js:7-27); gentle-ai 4.2 stores `claude_phase_assignments` with `{ model, effort? }` objects. Read the current field; keep legacy as fallback.
- S4. Role mapping (assumption, from the 2026-10-22 mapping; not a user decision): Explorer → `odd-explorer`; Builder, Frontend Builder, Backend Builder, Debugger, Refactorer → `odd-worker`; Tester, Verifier → `odd-verify`. Reviewer / Security Reviewer, Architect, Planner, DevOps, Documenter have no ODD counterpart: report them as unmapped, never drop silently. When several Kairo roles map to one ODD role, the choice rule must be explicit and tested.
- S5. Write the approved picks into `~/.gentle-ai/state.json` `claude_phase_assignments` for the `odd-*` keys only: preview by default, write only with `--yes`, backup first, atomic write, every other field semantically identical after re-parse with the original indentation kept (revised in L5: gentle-ai itself re-serializes this file), refuse when the file's schema is not the expected one.
- S6. Bridge agent files `~/.claude/agents/odd-explorer.md`, `odd-worker.md`, `odd-verify.md` with `model:` frontmatter and a Kairo bridge marker. Never overwrite or delete a file without the marker. Retire (remove our marked files) when gentle-ai ships its own consumer for these roles.
- S7. Without routing, bridge files are never used: the orchestrator must delegate ODD work to those agent names. Scope of that guidance is open (see Log L4).
- S8. No push, PR, or merge without explicit user approval.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S3 | delegated team-builder-codex (Pacing → Codex; parallel with T2) | done | ea7936990; RED 3 -> GREEN 8/0; parent added skip-entries-without-model (RED 1 -> GREEN); npm test 3151/0 |
| T2 | S1, S4 | delegated team-builder-codex (parallel with T1, disjoint files) | done | eb437aee6; RED 0/9 -> GREEN 9/0; mapGentleRolePicks(projectTeam) -> picks, unmapped, alternatives |
| T3 | S2, S5 | delegated team-builder (Codex CRITICAL) | done | 0776b41c5 + 933f8c3da; verified L5-L6 |
| T4 | S2, S6 | delegated team-builder (Codex CRITICAL) | done | d3eec4eb7 + 933f8c3da; verified L5-L6 |
| T5 | S7 | pending design | pending | |
| T6 | S1-S7 | CLI `kairo team apply` (preview, `--yes`) + help + docs | pending | |

## Log

- L1 (2026-10-22, user): "de acuerdo, procede, tambien esta considerando el analisis de proyecto, creacion de roles, y asignacion de modelos?"
- L2 (2026-10-22): mapping by team-researcher-codex. Kairo already has analysis (team/project-profile.js, project-analysis.js), fixed 14-role catalog with project-derived activation (intelligence/role-registry.js:20-282), assignment (model-intelligence.js, model-cost.js, project-strategy.js), approval to ~/.harness/sessions/<projectKey>/project-strategy.json (service.js:1998-2014). Nothing applies the approved team to agents. gentle-ai 4.2.0 roles: odd-explorer, odd-worker, odd-verify, default, review-*; picks in ~/.gentle-ai/state.json claude_phase_assignments; no supported external setter; upstream PRs #5269, #5612 open, not released.
- L3 (2026-10-22, user): "sí, vamos con A".
- L4: open design point for T5: gentle-ai's orchestrator guidance delegates to built-in agents without a model argument (#5610). Bridge files need the orchestrator to call them by name; decide where that guidance lives before T5.
- L5 (2026-10-22): independent verifier (team-reviewer-codex, static only: mktemp and npm test blocked by its sandbox) on 3d704852a..d3eec4eb7. Confirmed by parent: (1) fleet-models.js:54-58 seedFleetProfile stores loader objects as model strings; real state has default {model:"sonnet"} so claudeDefault becomes an object (T1 regression). (2) gentle-role-map drops adapterId, so a Codex/OpenCode model id reaches Claude config via state writer and bridge. (3) S5 byte-for-byte unmet; S5 revised to semantic preservation because gentle-ai re-serializes state.json itself. (4) same-timestamp backups overwrite each other. (5) dangling foreign symlink in agents dir is treated as absent and replaced. One correction batch (team-builder) fixes 1, 2, 4, 5.
- L6 (2026-10-22): correction batch 933f8c3da (team-builder Sonnet; RED 7 -> GREEN 55/0 focused). Parent recheck limited to L5 blockers, scratch home probes: (1) seedFleetProfile with real-format state gives "sonnet"/"opus" strings; (2) mapper reports Builder on adapter codex as incompatible, writer and bridge refuse, state.json hash unchanged; (3) same-timestamp backups -> .kairo-backup.<ts> and <ts>-1; (4) dangling symlink still a symlink after apply and retire. All four pass. npm test 3175/0. T1-T4 verified.
