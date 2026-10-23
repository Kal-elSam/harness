# Session checkpoint and restart
Objective: checkpoints are saved automatically at stable points, session closes are assisted (never blind), and one command restarts a fresh agent session from the latest checkpoint. Branch: to be created from main (builds on the context-fill modules already on main). Runner: `node --test`. Delivery: ask-on-risk.

## Specs
- S1: "esos cierres deberian de ser autoamicos? o cual es la mejor manera pra cntrolar esos puntos?" — answer approved by Sam ("si"): checkpoints are automatic; closing or clearing a session is assisted and never automatic in the middle of a task.
- S2: Automatic checkpoint triggers: each closed task (work-unit commit), before a context compaction (Claude Code PreCompact hook, if its payload allows it — verify first), and before delegating a large unit. The checkpoint reuses `writeCheckpoint` in `src/global/observability/context-fill-checkpoint.js` (STATE.md under the handoff dir) and mirrors the active feature document state to Engram.
- S3: Assisted close: Kairo suggests a fresh session only at a stable point (task closed, clean tree, checkpoint saved) AND when a trigger fires (context fill over the threshold for the task type, or a change of objective). The suggestion includes a ready resume prompt (feature document, next task, "read until ## Log"). The user confirms; nothing closes on its own.
- S4: "creo que necsitmaos un comando para reinciar una nueva seison desde el ultimo punto de checkpoint". One command writes or refreshes the checkpoint, then starts a new agent session (Claude, Codex, Pi) seeded with the latest checkpoint and resume prompt. Assumption: name it `kairo continue` (the existing `kairo resume` reopens a Kairo session, a different meaning); a matching slash command inside the agent session.
- S5: Thresholds are per task type (small task: none; large feature: at each closed delivery; investigation: when the hypothesis changes), configurable, never one fixed number.

## Tasks
- [ ] T1 (S2, S4) map existing context-fill hook, checkpoint and SessionStart injection; verify PreCompact payload and agent CLI options to start a seeded session — explorer
- [ ] T2 (S4) `kairo continue` command + slash command
- [ ] T3 (S2) automatic checkpoint triggers
- [ ] T4 (S3, S5) assisted close suggestion with thresholds per task type

## Log
- L1 (2026-10-16, Sam): "esos cierres deberian de ser autoamicos? o cual es la mejor manera pra cntrolar esos puntos?" then "si, creo que necsitmaos un comando para reinciar una nueva seison desde el ultimo punto de checkpoint".
- 2026-10-16 parent: existing on main: `src/global/observability/context-fill-hook.js` (measures context fill, commits c731522d5, 79162fe3a), `context-fill-checkpoint.js` (writeCheckpoint, loadCheckpoint, sessionStartOutput, installSessionStartHooks), `context-fill-handoff.js`; Claude settings already run `scripts/context-fill-hook.js claude`. The delivery/kairo-runtime-clean branch does not contain these modules.
