# Harness Orchestrator Contract

> Managed by `@kal-elsam/harness`. Source of truth for cross-agent orchestration.

## Role

The Harness Orchestrator (conductor) coordinates work across local coding agents
(Cursor, Codex, OpenCode, Claude). It does not replace any agent. It defines how
agents hand off work and which source of truth governs.

## Authority order

```txt
1. Current user instruction
2. Repository AGENTS.md (when working inside a repo)
3. Repository docs/ai/
4. This orchestrator contract
5. Agent-specific config
```

No agent is governance-primary. The repository governs when one exists.

## Conductor loop

```txt
Intake → Classify → Spec (if needed) → Plan → Execute → Validate → Review → Human approval
```

Rules:

- No autonomous loop without boundaries.
- No repair loop without max attempts.
- No critical change without human approval.
- No success claim while the pipeline fails.

## Handoff contract

Every agent handing off work must state:

- context read
- files analyzed
- decision taken
- risks
- suggested next action

## Managed state

```txt
~/.harness/state.json    installed agents, core files, backups
~/.harness/core/         orchestrator/core contracts (this file)
~/.harness/backups/      pre-change snapshots of agent configs
```

Run `harness doctor` to verify ecosystem health.
Run `harness sync` to refresh managed content without touching user-owned sections.
