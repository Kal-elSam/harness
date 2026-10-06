# Kairo one window: offline readiness for Claude and Codex coordination

Linked work: `odd/tasks/kairo-global-connect.md` (T1-T6 done, base commit `d4a3b82b9`). Those six tasks are not redone.

## Objective

Keep our own interface as the command post: configure the team, converse, delegate, and see results without opening one terminal per provider. This unit delivers everything that can be built and verified offline; real Claude to Codex validation follows only with explicit authorization.

## Problem

- No test installs the packed tarball outside the checkout and starts the host, `kairo mcp`, or the conversation service from the installed copy.
- Setup operations (preflight, analyzer catalog, analysis, approve, edit) live only in the service; the shared operations layer and Pi do not expose them, and no UI separates the initial analyzer from the permanent orchestrator or installed from verified access.
- The Pi workspace snapshot reads `service.snapshot`, emits only blocked, idle, unknown for agents, and shows no tasks or runs; there is no draft / active / working / blocked status derived from tasks and runs.
- MCP install exists only for Cursor; Claude Code and Codex have no writer, no health check, and no tests.
- RDD mode is never read in production (`readRddMode` unwired, output format not pinned).

## Why

Show our own window working before automating the rest of the circuit (spec "Key Learnings").

## Scope

- T1 Clean-install smoke from the packed tarball with isolated state.
- T2 Setup operations in the shared layer (access verified vs installed, analyzer vs orchestrator labels, select analyzer, approve, edit) with confirmation for anything that spends or mutates; MCP and Pi expose them.
- T3 Pi workspace shows team, sessions, tasks and runs with draft / active / working / blocked, built on the shared operations; every action carries explicit project and session.
- T4 MCP install for Claude Code and Codex (plan by default, backup, consent, isolated-home tests); entries point at the same service.
- T5 Production RDD mode reader pinned to the real read-only `gentle-ai review mode status` output; `unknown` never means permission.
- T6 Continuity: reopen the interface, recover work, no duplicates; Claude Code and Codex entries show the same team and results as Pi and Cursor.

## Not authorized (needs separate explicit authorization)

- Real Claude to Codex run (accounts, sessions, project, operation, spend). Max two generative calls, no retries, no silent substitution, no credential copying.
- Automatic review_authorized, comments_recorded, correction_recorded transitions via Gentle contracts (after the real run validates the circuit).
- Writing the user's real `~/.claude`, `~/.codex`, `~/.cursor` or any personal config: tests use isolated homes only; real writes need backup and explicit approval.
- Push, PR, publication, permanent daemon.
- Unrelated pending files and the foreign CRT work: `src/global/host/extension/index.js` working-tree hunks, `src/global/host/extension/kairo-prototype-theme.js`, `test/kairo-prototype-theme.test.js`, `odd/tasks/crt-phosphor-theme.md`, `odd/tasks/cursor-credit-discipline.md`, `odd/tasks/plan-mode-model-agnostic.md`, `repo-template/.cursor/rules/cost-discipline.mdc`, `docs/assets/`, `report.json`, `scripts/inspect-opencode-tier.sh`.

## Constraints

- TDD: strict (source: `openspec/config.yaml`), runner `npm test`; RED, GREEN, REFACTOR.
- Offline: injected fakes (`deps.*`), temp git repos, isolated `HARNESS_HOME`; never the real home.
- Active team governs Kairo executions; no silent provider/model change.
- Explicit project and session on every action; reconnect never relaunches.
- Any new write tool updates the MCP name-policy tests deliberately.
- `index.js` carries foreign uncommitted CRT hunks: stage only our own hunks, verify `git diff --cached` before each commit.
- About 400 changed lines per task is a planning heuristic only.
- Commits: explicit paths only, Conventional Commits, no AI attribution (user rule). No push.
- Delivery strategy: `ask-on-risk`; forecast exceeds 400 lines overall, but no PR is planned here, so slicing is decided when the user asks for one.

## Route declaration

Mapping delegated (4+ files fired the trigger). Each task: one delegated writer.

## Tasks

- [ ] T1 Clean-install smoke from the packed tarball (isolated `HARNESS_HOME`, outside checkout): menu/help, resources, `kairo mcp` handshake lists tools, conversation service loads, Pi fork dependency checklist. Route: delegated.
- [ ] T2 Setup operations in shared layer: access verified vs installed, analyzer vs orchestrator labels, select analyzer, approve, edit assignment; confirmation for mutations; MCP and Pi expose them. Route: delegated.
- [ ] T3 Pi workspace on the shared circuit: draft / active / working / blocked from team, tasks and runs; sessions and tasks displayed. Route: delegated.
- [ ] T4 MCP install for Claude Code and Codex (JSON and TOML writers, plan by default, backup, health check, isolated-home tests). Route: delegated.
- [ ] T5 Production RDD mode reader pinned to real `gentle-ai review mode status` output. Route: delegated.
- [ ] T6 Continuity and identity across Pi, Cursor, Claude Code and Codex entries; reopen recovers work, no duplicates. Route: delegated.

## Pending behind authorization

- [ ] P1 Real Claude to Codex validation in an isolated test project.
- [ ] P2 Automatic review / comments / correction transitions via native Gentle contracts.

## Acceptance

- Packed tarball installs outside the checkout and opens our interface and MCP service with isolated state.
- Installed vs verified access and analyzer vs orchestrator are visible and distinct.
- Interface shows draft / active / working / blocked from real task and run data.
- Claude Code and Codex MCP entries show the same team and results as Pi and Cursor.
- Failure cases covered: access missing, confirmation declined, cancel of another session, real interruption, corrupt evidence.
- `npm test` green; no real provider execution in this unit.

## Progress

- Mapping complete (packaging, onboarding flow, Pi host UI, MCP install, RDD reader).

## Next step

T1 RED test for the clean-install smoke.
