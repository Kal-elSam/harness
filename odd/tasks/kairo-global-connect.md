# Kairo global: connect what exists

## Objective

One local install, per-project teams, and one conversation that can delegate, collect results, and continue from another host (Pi and Cursor via MCP) without copy-paste.

## Problem

`src/global/conversation/service.js` already delegates, plans, executes, and reads task results, and the CLI uses it. MCP (`src/global/mcp/kairo-mcp.js`) and Pi do not: MCP has no session, team, delegation, or result tools, MCP reads fall back to the process cwd, and Gentle state is always `unavailable` (`gentle_reader_not_wired`).

## Why

Prove one complete reusable circuit (delegate, result, review, correction) instead of adding another interface.

## Scope

- Shared read-only queries in the conversation service: sessions, team/providers (installed, auth, eligibility, blocked reason).
- MCP tools over the shared service, extending the existing server; explicit project binding for reads and writes.
- MCP delegation with preview-then-confirm, reusing `planExecution` / `executePlan({confirmationTarget})`.
- Production Gentle reader wired into `readGentleContext`; persisted transitions (delegation, result, authorized review, comments, correction).
- Pi consumes the same operations.
- Continuity tests: reconnect and repeated queries cause zero extra launches.

## Not authorized

No permanent daemon, automatic parallelism, new dashboard, or removal of Pi. MCP is transport, not coordinator. No push, PR, or publication. Unrelated pending files stay untouched: `odd/tasks/cursor-credit-discipline.md`, `odd/tasks/plan-mode-model-agnostic.md`, `repo-template/.cursor/rules/cost-discipline.mdc`, `docs/assets/`, `report.json`, `scripts/inspect-opencode-tier.sh`.

## Constraints

- TDD: strict (source: `openspec/config.yaml`), runner `npm test`; RED, GREEN, REFACTOR.
- Offline tests with injected fake providers and Gentle (`deps.*` seam).
- Project identified explicitly, never by accidental process cwd; ambiguous session refs rejected, never guessed.
- Detection never selects a team or starts work; reconnect never authorizes launches.
- A project Gentle receipt is never read as approval of a task.
- New MCP write tools must update `KAIRO_MCP_WRITE_TOOLS` and the name-policy test deliberately (`test/mcp-readonly.test.js:28`).
- About 400 changed lines per task is a planning heuristic only.
- Delivery strategy: `ask-on-risk`. Commit only this feature's paths, no AI attribution (user rule), Conventional Commits.

## Route declaration

Mapping delegated (4+ files fired the trigger). Each implementation task: delegated direct writer (2+ non-trivial files).

## Tasks

- [x] T1 Service queries: public `listSessions` and `readTeam` (roles, providers/models, tasks, states, blockers) with ambiguous-ref rejection. Route: delegated.
- [x] T2 MCP read tools `kairo_sessions`, `kairo_team`, `kairo_task_result` over the service, explicit project binding. Route: delegated.
- [x] T3 MCP delegation: preview plus confirmed execute reusing the service confirmation target; cancel; policy tests updated. Route: delegated.
- [x] T4 Production Gentle reader and persisted transitions, honoring Gentle permissions. Route: delegated.
- [x] T5 Pi consumes the same service operations. Route: delegated.
- [ ] T6 Continuity tests across environments: zero relaunch on repeat query and reconnect, interrupted run, corrupt result, cancel, declined consent. Route: delegated.

## Acceptance

- Cursor MCP and Pi show identical team, session, task, and run for the same project.
- Repeated queries and reconnect launch nothing.
- Failure cases covered: provider unavailable, ambiguous session, interrupted run, corrupt result, cancel, declined consent.
- `npm test` green. Real cross-provider run only with explicit execution and spend authorization.

## Progress

- Mapping complete (service, MCP, CLI, providers, sessions, Pi bindings).
- T1 done (commit 4b253e371): `listSessions`, `resolveSession` (typed SESSION_REF_AMBIGUOUS / SESSION_REF_UNKNOWN), `readTeam` added to the service. RED observed (9 tests failing with `service.X is not a function`), GREEN 9/9. Full `npm test`: 2531 tests, 2530 pass, 0 fail, 1 skipped (pre-existing skip).
- T2 done: `kairo_sessions`, `kairo_team`, `kairo_task_result` added to the existing MCP server via `src/global/mcp/conversation-read-tools.js`. Project comes only from the explicit workspace binding (`resolveWorkspaceWriteBinding`); unbound or half-bound refuses with `workspace_*` and the service is never built or called. Service is built lazily and injectable (`deps.conversationService` / `deps.createConversationService`). Outputs are public projections with credential/path scrubbing. Registered for bound and unbound servers; not write tools. RED observed (new test file failed at import: missing export `KAIRO_MCP_CONVERSATION_READ_TOOLS`), GREEN 10/10 in `test/mcp-conversation-read.test.js`. Deliberate assertion updates in `test/mcp-readonly.test.js` and `test/workspace-binding.test.js` (bound server now also registers the three read tools; standalone VSIX entry stays publish-only). Full `npm test`: 2541 tests, 2540 pass, 0 fail, 1 skipped (pre-existing).
- T3 done: `kairo_plan_execution` (read-only preview, registered bound and unbound), `kairo_execute_plan` and `kairo_cancel_execution` (write tools, bound only) in `src/global/mcp/conversation-delegate-tools.js`, wired in `kairo-mcp.js`. Execute requires the confirmationTarget from a preview, re-previews server-side (refuses `confirmation_required`, `confirmation_stale`, `provider_unavailable`, `session_ref_ambiguous`), then launches only via `service.executePlan`; the service execution link makes a repeated confirmed execute return `reused: true` with no second launch (verified with a fake mirroring that contract). Inputs carry no paths. Gap: service `cancelExecution` has no session ownership check, so cancel accepts no `ref`. RED observed (new test file failed at import: missing export `KAIRO_MCP_CONVERSATION_DELEGATE_TOOLS`), GREEN 14/14 in `test/mcp-conversation-delegate.test.js`. Deliberate updates to `KAIRO_MCP_WRITE_TOOLS` assertions in `test/mcp-readonly.test.js` and `test/workspace-binding.test.js`. Full `npm test`: 2555 tests, 2554 pass, 0 fail, 1 skipped (pre-existing).
- T4 done (commits cc84bd0b0 reader, plus transitions commit): `src/global/conversation/gentle-reader.js` is the DEFAULT `readGentleContext` (`deps.gentle.{probe,runCommand,readRddMode}` seam). It probes capabilities, then runs only the advertised `review status ... --next-transition` bootstrap (refused unless argv is `review status`; no mutating verb ever passed), bounded to 8s, with typed results `gentle_binary_missing`, `gentle_timeout`, `gentle_nonzero_status`, `gentle_parse_failed`, `gentle_incompatible`, `gentle_reader_failed`; it never throws. RDD mode stays `unknown` unless a read-only reader is injected (the `review mode status` output format is not pinned in this repo). Project receipt still projects as `scope: project_context`, `taskReview: not_established`. Transitions: `src/global/conversation/transition-store.js` appends `transitions.jsonl` beside `execution.json` (enum delegated, result_observed, review_authorized, comments_recorded, correction_recorded; opaque `<scheme>:<id>` evidence, no paths/secrets; idempotent per kind+run; ordered; corrupt file -> typed `transitions_corrupt`, never overwritten). `executePlan` records `delegated`, `readTaskResult` upserts `delegated`/`result_observed` and returns `transitions {state, entries, next}`, `readTeam` tasks carry `nextTransition`, `recordTransition` (review-side kinds only, requires an execution, launches nothing). Run record/events syntax corruption -> `errorCode: result_corrupt`. MCP projections expose `nextTransition`, `errorCode`, `transitions` scalars. RED observed (reader test and transitions test failed at import: module not found; service default returned `gentle_reader_not_wired`), GREEN 12/12 reader and 13/13 transitions (REAL service with fake startRun and temp git repo: executePlan x3 launches once, readTaskResult x2 byte-stable). Full `npm test`: 2581 tests, 2580 pass, 0 fail, 1 skipped (pre-existing). Gaps: no service hook yet writes `review_authorized`/`comments_recorded`/`correction_recorded` automatically (explicit `recordTransition` only; no MCP tool for it); MCP projection test added after the code (no separate RED).
- T5 done (commits 75d8fbe2f shared layer, plus Pi tools commit): `src/global/conversation/operations.js` is the single projection + operation layer (`createConversationOperations`: sessions, team, taskResult, plan, execute, cancel; typed `ConversationOperationError`); the MCP read and delegate handlers now delegate to it (existing MCP tests unchanged and green). Pi registers the same six tool names (`kairo_sessions`, `kairo_team`, `kairo_task_result`, `kairo_plan_execution`, `kairo_execute_plan`, `kairo_cancel_execution`) from the NEW module `src/global/host/extension/conversation-tools.js` via a minimal import/registration hunk in `index.js` (`registerKairoConversationTools`, guarded `pi.registerTool?.`); project = `resolveProjectRoot(ctx.cwd)`, refuses `project_unbound` without a host ctx (no process cwd fallback). Session start/binding untouched. RED observed (new test failed at import: conversation-tools.js not found), GREEN 6/6 in `test/pi-conversation-identity.test.js` (real service, fake startRun, temp git repo: Pi and MCP deep-equal for sessions, team, plan, task result; execute launches once, second confirmed execute reuses; reload/resume/reload session_start plus repeated Pi queries leave startRun at 0; ambiguous ref, missing/stale confirmation rejected). Gaps: the shared-layer refactor had no separate RED (existing MCP tests guard it); Pi cancel has no session ownership check, same as MCP; Pi has tools only (no new slash commands); execute result differs in `active` between first launch and reuse by design (run state evolves).

## Next step

T6 continuity tests across environments: interrupted run, corrupt result, cancel, declined consent (reuse the identity harness).
