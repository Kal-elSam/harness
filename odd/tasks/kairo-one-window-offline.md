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

- [x] T1 Clean-install smoke from the packed tarball (isolated `HARNESS_HOME`, outside checkout): menu/help, resources, `kairo mcp` handshake lists tools, conversation service loads, Pi fork dependency checklist. Route: delegated.
- [x] T2 Setup operations in shared layer: access verified vs installed, analyzer vs orchestrator labels, select analyzer, approve, edit assignment; confirmation for mutations; MCP and Pi expose them. Route: delegated. Commits `ef436196f`, `6fd9fc9e9` (+ tracker commit).
- [x] T3 Pi workspace on the shared circuit: draft / active / working / blocked from team, tasks and runs; sessions and tasks displayed. Route: delegated. Commits `e5cdc7631` (status derivation + snapshot), widget commit + tracker.
- [x] T4 MCP install for Claude Code and Codex (JSON and TOML writers, plan by default, backup, health check, isolated-home tests). Route: delegated. Commit `0585622e5` (+ tracker commit).
- [x] T5 Production RDD mode reader pinned to real `gentle-ai review mode status --json` output. Route: delegated. Commit: see Progress.
- [x] T6 Continuity and identity across Pi, Cursor, Claude Code and Codex entries; reopen recovers work, no duplicates. Route: delegated. Commit `a91e889d6` (+ tracker commit).

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
- T1 done (delegated writer). `test/clean-install-offline.test.js` (offline, in `npm test`): packs, extracts outside the checkout, checks resources, import closure (declared deps only, no escapes) and scrubbed-env `bin/kairo.js --help`. Offline limit: declared npm deps are not installed in the extracted copy, so the CLI run accepts either exit 0 or a missing DECLARED dependency; full execution is covered by `npm run smoke:clean-install` (`scripts/clean-install-smoke.sh` + `scripts/lib/clean-install-mcp-handshake.mjs`). Smoke run once: help OK, MCP initialize + tools/list OK (12 tools; kairo_sessions, kairo_team, kairo_task_result, kairo_plan_execution listed; write tools absent when unbound), createConversationService loads (34 ops), Pi fork 0.87.1-kairo.4 installed, 0 files outside HARNESS_HOME. `npm test`: 2608 tests, 2607 pass, 0 fail, 1 skipped. No README place for smoke scripts, docs skipped.
- T2 done (delegated writer). Shared layer: `src/global/conversation/setup-operations.js` (new) + `operation-core.js` (scrubber/typed error moved out of operations.js, re-exported) + service `readSetup` (read-only facts) . Operations: `setup` (read: per provider `installed` vs `accessVerified` verified/unverified/denied/exhausted/unknown with reason; missing/stale entitlement = unverified; analyzer catalog; `initialAnalyzer` role `initial_analyzer` vs `permanentOrchestrator` role `permanent_orchestrator`; strategyStatus none/draft/active/stale; recovery pending), `planSetup` (preview + confirmation target or typed refusal), `runAnalysis` (generative/spend, marked in preview, one call, no retries), `approveTeam`, `setAssignment` (draft only, states from/to). Selecting the analyzer is an explicit parameter of the analysis preview (the service has no pre-analysis storage, nothing invented). Typed codes: confirmation_required, confirmation_stale, analyzer_required, analyzer_unavailable, access_unverified/denied/exhausted, strategy_active, strategy_not_draft, no_strategy, role_unknown, candidate_unavailable, analysis_in_progress. MCP: read `kairo_setup`, `kairo_setup_plan`; write (bound only) `kairo_setup_run_analysis`, `kairo_setup_approve_team`, `kairo_setup_set_assignment`; Pi registers the same five names. Analysis is refused while a team is active (it would replace it). Tests: `test/conversation-setup.test.js` (17), `test/mcp-conversation-setup.test.js` (9), shared fake harness `test/helpers/setup-harness.js`; name-policy / bound-list assertions updated deliberately (mcp-readonly, workspace-binding, mcp-conversation-delegate, pi-conversation-identity). RED observed first (17/17 and import-level failure), then GREEN. `npm test`: 2635 tests, 2634 pass, 0 fail, 1 skipped. Offline only: zero real provider calls (fake analyzer counts calls), zero startRun asserted. Out of scope: recovery proposal approve/reject operations, access verification probe (`verifyClaudeEntitlements` stays CLI-only, it spends).
- T3 done (delegated writer). `src/global/host/workspace-status.js` (new, pure; mapping table in the module header): team draft/active/stale/none/unknown; agent `working` only with a real non-terminal run whose execution record names the role, `blocked` for availability blocked (reason), stale team or latest run interrupted/result_corrupt/evidence_unreadable, `draft` for a draft team, `active` for active+available+no run, `unknown` otherwise (never permission/working); task draft/working/blocked plus honest terminals (done only when `result_observed` is recorded, never inferred). Shared layer: execution link now persists `role` (executePlan) and `executionFor` types corrupt/unreadable evidence instead of throwing; new light `service.readWork` (sessions + tasks, same projection as `readTeam().tasks` via shared `projectedPlans`/`taskRows`, no probes) exposed as `operations.work`; `pubExecution` gains `role`. Snapshot (`workspace-snapshot.js`) reads work through those operations, keeps all existing fields, adds `scope {projectRoot, sessionId}`, `status`, `workState`, `sessions`, `tasks` (id, projectRoot, sessionId, state, status, role, runId, nextTransition) and per-agent `status`/`statusReason`; a failed work read gives `workState: "unknown"`, never invented tasks. Widget: glyphs for draft/active, status supersedes legacy `state`, compact SESSIONS/TASKS section in the HERD panel (blocked-first, capped at 4 rows + "+N more", `TASKS ?` when unreadable); no colors/theme change. Tests: `test/workspace-status.test.js` (16), `test/workspace-shell-work.test.js` (10, real service + fake startRun: zero startRun across repeated loads/reconnect, interrupted/corrupt => blocked, MCP/Pi kairo_team vs snapshot parity), 9 new widget tests (widths 24/40/60/100); `workspace-shell-snapshot` agents assertion updated deliberately (new status fields). RED observed first (module missing 1/1; 10/10; 9 widget failures), then GREEN. `npm test`: 2671 tests, 2670 pass, 0 fail, 1 skipped. Gaps: fullscreen sidebar/compact summary show the new agent status but no tasks section (hitbox arithmetic untouched); legacy runs without a persisted role are never attributed to an agent; `index.js` detail views (`/kairo-team`) unchanged.
- T4 done (delegated writer). `src/global/mcp/client-config.js` (pure): Claude Code JSON `mcpServers.kairo` (user scope `~/.claude.json`, project scope `<project>/.mcp.json`), Codex minimal section-scoped TOML upsert of `[mcp_servers.kairo]` (no TOML dependency; rewrites only `command`/`args`/`cwd`, keeps all other bytes, comments and the `.env` sub-table; typed `config_unparseable` refusal on unterminated strings/arrays, array-of-tables, duplicate or inline/dotted `mcp_servers`). `src/global/mcp/client-install.js`: plan by default, `--yes` applies, `.kairo-backup.<ts>` before any write, atomic write, idempotent (no write/backup on re-run), paths home-scrubbed (`~/...`). `kairo mcp install --client cursor|claude-code|codex [--bind <abs project>] [--project-scope] [--yes] [--json]`; `--bind` must be absolute, existing, canonical (realpath), not `/` nor home, never implicit; writes `--workspace-bound --cwd <root>` (Codex also `cwd`); `--project-scope` is claude-code only and requires `--bind`; cursor rejects both. Health: `detectAgentMcpRegistration` now covers both clients (connected / not_connected / error for drifted or unparseable), feeding the existing connections/next/doctor surface. Format assumptions: Codex `command/args/cwd/env` confirmed in upstream codex-rs config tests via context7; Claude Code `mcpServers` in `~/.claude.json` / `.mcp.json` taken from known documented behavior (not re-fetched). Tests (temp HOME only): `test/mcp-client-config.test.js` (16), `test/mcp-install-clients.test.js` (14), `test/mcp-install-clients-handshake.test.js` (1: launches each written entry via `bin/kairo.js` with scrubbed env, initialize + tools/list: same tool set for claude-code, codex and cursor, write tools only when bound; bound sets equal for both clients). RED observed first (17/17 failing on missing module), then GREEN. `npm test`: 2704 tests, 2703 pass, 0 fail, 1 skipped. No real home config was read or written. Gaps: bound Claude Code user-scope entry has no `cwd` field, so it works only when Claude launches the server inside the bound project (otherwise fails closed with workspace_mismatch); no rule file is written for these clients; JSON rewrite re-serializes with 2-space indent (keys preserved, original whitespace not).
- T5 done (delegated writer). `src/global/conversation/rdd-mode-reader.js` (new): runs exactly `gentle-ai review mode status --cwd <abs root> --json` through the same bounded runner seam (8s, strict JSON); allow-list `isReadOnlyGentleArgv` accepts only that 6-token argv and `createGuardedRunner` (now also wrapping the existing `review status` runs in `gentle-reader.js`) refuses `enable`, `disable`, any `--scope`/`--expected-revision`/extra arg, relative or flag-like roots without invoking the runner. Strict parse by `gentle-ai.review-mode/v1` + `gentle-ai.rdd-mode-status/v1` (operation `status`); result `{mode: on|off|unknown, source, global, cloneLocal, error}`; typed errors gentle_binary_missing / gentle_timeout / gentle_nonzero_status / gentle_parse_failed / gentle_incompatible / gentle_reader_failed; text output is not parsed (gentle_parse_failed). Semantics (documented in the module): `on` = review permitted by the user-owned switch, candidate consent still separate, never task approval; `off` = user disabled it; `unknown` = not established, never permission, never `on`, enables nothing; Kairo never toggles the mode. Wiring: `gentle-reader.js` accepts a structured or legacy-string `readRddMode`, adds `rddSource`/`rddError`; production default is the new reader only when no `probe`/`runCommand`/`spawn` fake is injected (tests can opt in with `useProductionRddReader`); `readTaskResult.gentle` and `pubTaskResult` (so MCP `kairo_task_result` and the Pi tool identically) gain `rddMode` and `rddSource` (scrubbed, existing fields unchanged). The workspace snapshot does not carry rdd mode, so it is unchanged. Real read-only check once: `gentle-ai review mode status --cwd <repo> --json` printed exactly the pinned fixture (on / default, global "" , clone_local "", exit 0). Tests: `test/conversation-rdd-mode.test.js` (21): RED observed first (module missing), GREEN after. `npm test`: 2725 tests, 2724 pass, 0 fail, 1 skipped. Gaps: mode is read once per task-result read (no cache); no UI beyond the projection.

- T6 done (delegated writer). `test/conversation-entries-continuity.test.js` (12 tests, REAL service, REAL on-disk stores incl. the run store, temp git repo, temp HOME/HARNESS_HOME, scrubbed env). The entries are the ones the T4 installer wrote into a temp home: handlers-level for Pi, Cursor, Claude Code, Codex (fresh service per entry = reopen), process-level for Cursor, Claude Code and Codex launched through `bin/kairo.js` (stdio initialize + tools/call). The fake `startRun`/`stopRun` write REAL run records; no provider is ever launched. Covered: identity (team draft->active via setup ops, setup, sessions, task result with injected Gentle `rddMode on/default`, plan preview, run identity, transitions, status vocabulary) deep-equal in all four; real processes read the same on-disk state (compared to each other in full and to the service on provider-independent parts); reopen x3 per entry identical with zero extra `startRun`, transitions bytes unchanged, repeated confirmed execute from another entry is reused (one launch, one run record, one link); access missing (installed but unverified) blocks analysis and assignment with `access_unverified` from every entry, nothing written; missing/stale confirmation refused identically, no state change (draft team byte-identical, no run, no link, no transitions file); cancel with another session's `ref` refused (`session_mismatch`), run keeps running; corrupt run record, events and transitions file give identical typed outcomes, files never rewritten, nothing relaunched; REAL interruption (real child process, SIGKILL) reported `interrupted` -> blocked with derived next `review_authorized`, no relaunch; workspace snapshot status equals the status derived from `kairo_team` (none/draft/active, task draft/working) in every entry. RED observed for two real gaps, both fixed in `service.js`: (1) `readTaskResult` never ran liveness recovery, so a killed run still read `running` there until a team read happened (expected `interrupted`, actual `running`); (2) a corrupt run record made `recover` throw inside `projectedPlans`, so `kairo_team` and the snapshot failed with `read_failed` for the whole project (now best-effort recovery; the task shows typed `evidence_unreadable`, blocked). The other 10 tests are characterization tests that passed on first run. Liveness is real: `recoverRuns` marks active runs interrupted when neither the run pid nor the supervisor lock pid is alive (`run-liveness.js`); no new supervisor or daemon was added. `setup-harness.js` gained `diskStrategy`, `serviceDeps` and `makeService` options (existing tests unchanged and green). `npm test`: 2737 tests, 2736 pass, 0 fail, 1 skipped (pre-existing). `graphify update .` run.
## Next step

None offline. P1 and P2 wait for explicit authorization (see Final status).

## Final status

Acceptance criteria:
- Packed tarball installs outside the checkout and opens our interface and MCP service with isolated state: met (T1; declared npm deps are not installed in the offline extract, full execution is covered by `npm run smoke:clean-install`).
- Installed vs verified access and analyzer vs orchestrator are visible and distinct: met (T2).
- Interface shows draft / active / working / blocked from real task and run data: met (T3, T6 test 5 and 4); the fullscreen sidebar and compact summary show agent status but no tasks section.
- Claude Code and Codex MCP entries show the same team and results as Pi and Cursor: met at handlers level for all four and at process level for Cursor, Claude Code and Codex. Limit: a child process has no injectable Gentle, so its Gentle side is a typed unavailable (`rddMode unknown`); children are compared to each other in full and to the service on the provider-independent parts. The installer's Cursor entry is unbound by design; the bound Cursor launch is modeled as that entry plus explicit `--workspace-bound --cwd`.
- Failure cases (access missing, confirmation declined, cancel of another session, real interruption, corrupt evidence): met across entries.
- `npm test` green, no real provider execution in this unit: met (2736 pass, 0 fail, 1 pre-existing skip).

Not met / not done: the real Claude to Codex circuit (P1) and automatic review transitions (P2). Nothing real was run.

Stays behind explicit authorization:
- P1 Real Claude to Codex validation: needs explicit account/session, project, operation and spend authorization (max two generative calls, no retries, no silent substitution, no credential copying).
- P2 Automatic `review_authorized`, `comments_recorded`, `correction_recorded` transitions via native Gentle contracts, only after P1 validates the circuit.
- Writing the user's real `~/.claude`, `~/.codex`, `~/.cursor` configs (backup and explicit approval); push, PR, publication, permanent daemon.

Known gaps still open (from earlier tasks):
- Analysis is refused while a team is active (it would replace it); there is no explicit re-analysis flow.
- Recovery proposal approve/reject operations and a Claude access-verify operation are not exposed through the shared layer (the verify probe spends, so it stays CLI-only).
- Runs launched before role storage show only at task level (never attributed to an agent).
- Claude Code JSON entry is re-serialized with 2-space indent on install (keys preserved, original whitespace not).
- A user-scope bound Claude Code entry has no `cwd`: it works only when Claude launches the server inside the bound project (otherwise `workspace_mismatch`, fail closed). The same launch-in-project rule applied to the process-level entries in T6.
- Cancel without `ref` has no ownership check (by design); `transitions_corrupt` code is typed in the service but MCP/Pi expose only `transitions.state: corrupt`.
- Gentle/RDD mode is read once per task-result read (no cache); the mode never toggles from Kairo.
