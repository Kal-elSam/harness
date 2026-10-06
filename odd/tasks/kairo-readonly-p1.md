# Kairo read-only execution and P1 Claude to Codex

Linked work: `odd/tasks/kairo-one-window-offline.md` (T1-T6 done, HEAD at start `8815c862a`) and `odd/tasks/kairo-global-connect.md`. Those tasks are not redone.

## Objective

Implement real write protection for delegated executions (a `read-only` mode through the shared production path), then validate Claude to Codex exchange in `/Users/kal-el/Desktop/agentic-harness` with workers that cannot modify code.

## Authorization (explicit user "si", 2026-10-06)

- Bounded implementation of the read-only contract and its tests.
- Temporary team: Explorer = Claude Haiku 4.5, Reviewer = Codex GPT-5.5.
- P1 analysis and contrast only; workers never modify code.
- Restore the original team afterwards.
- Not authorized: publication, push, personal config changes, retries, model substitution, P2 (no review transitions, no fabricated Gentle receipts).
- Spend: at most two generative calls, no Kairo retries. Two CLI processes do not guarantee two internal requests; if that limit cannot be verified and enforced, STOP before spending and ask for a revised authorization.

## Initial state (recorded before any change)

- HEAD `8815c862a7b4aeb2db923c0ec54ca89991019ea9`, branch `feat/herd-shell-layout`.
- Foreign pending changes, never modified or staged: `odd/tasks/cursor-credit-discipline.md`, `odd/tasks/plan-mode-model-agnostic.md`, `repo-template/.cursor/rules/cost-discipline.mdc`, `src/global/host/extension/index.js`, `src/global/host/extension/kairo-prototype-theme.js`, `test/kairo-prototype-theme.test.js`, `docs/assets/`, `odd/tasks/crt-phosphor-theme.md`, `report.json`, `scripts/inspect-opencode-tier.sh`.
- Original strategy bytes backed up (recoverable): `~/.harness/backups/p1-readonly-2026-10-06T18-49-51-385Z/project-strategy.json.orig`, sha256 `2945cbb4487f4728548c1d46dce5635ead24a635428df01733305685260452ae`, 28653 bytes, status at backup `suggested`. Manifest next to it.

## Mapping facts

- `run-permissions.js`: `read-only` is a SAFE token, but `ADAPTER_PERMISSION_MODES` only lists it for `pi`; `authorizeRunPermissions` rejects it for claude and codex (`unsupported_permission`).
- Claude adapter (`claude.js:59-67`): `--permission-mode auto --permission-prompts none`, no tool restriction, env scrubbed. Codex adapter (`codex.js`): default `--approve-for-me` (workspace-write), env unscrubbed.
- `executePlan` launches with `permissions: []`; `confirmationTarget` = `{role, selection, strategyFingerprint, candidateKey}` has no mode, so a read-only confirmation has nothing to bind to.
- Reusable isolation: macOS `sandbox-exec` wrappers (`conversation/codex-sandbox.js`, `cursor-sandbox.js`, `codex-delegated-sandbox*.js`), `delegated-write-admission.js` (claude `unverified`), `execution-worktree-manager.js`.
- Installed CLIs: claude 2.1.291 (`--restricted`, `--tools`, `--allowedTools`, `--disallowedTools`, `--permission-mode`), codex-cli 0.160.1 (`--sandbox read-only|workspace-write|danger-full-access`, `--approve-for-me`).

## Constraints

- TDD strict (`openspec/config.yaml`), runner `npm test`. Offline tests only; fake providers.
- Plan mode or a restrictive prompt alone is NOT containment. Claude needs tool restriction plus verifiable OS-level write containment over the repository, or the run is refused before launch (`isolation_unavailable`).
- Codex read-only: `--sandbox read-only`, never `--approve-for-me`, no automatic escalation.
- A read-only confirmation can never launch workspace-write; existing behavior without mode is unchanged.
- No provider run until containment tests (including no-model write canaries against source and `.git`) pass.
- Commit only own paths, Conventional Commits, no AI attribution, no push.

## Tasks

- [x] R1 Propagate `read-only` mode: preview, confirmationTarget, `executePlan`, shared operations, MCP and Pi schemas, run permissions. Stale or mismatched mode refused; default behavior unchanged. Route: delegated. Done: RED 9/10 failing in test/conversation-readonly-mode.test.js, then GREEN 11/11; mcp/pi/continuity/service suites green; full `npm test` 2750 tests, 2749 pass, 0 fail. `read-only` NOT added to claude/codex ADAPTER_PERMISSION_MODES: execute is refused before reserve/launch with `read_only_unsupported`.
- [x] R2 Effective containment in adapters: Codex `--sandbox read-only` without `--approve-for-me`; Claude tool allow-list plus `--restricted` plus verifiable write containment (sandbox-exec) with fail-closed `isolation_unavailable`. Route: delegated. Done: new `src/global/runtime/readonly-containment.js`; claude argv `--restricted --tools Read,Grep,Glob --disallowedTools Edit,Write,NotebookEdit,Bash --permission-mode dontAsk --permission-prompts none` wrapped in `/usr/bin/sandbox-exec -p "(version 1)(allow default)(deny file-write* (subpath <realpath root>))"`; codex argv `exec --json --sandbox read-only --ignore-user-config`; both adapters run a no-model write canary in `preflight` (also in the supervisor) and refuse with `isolation_unavailable`; `read-only` is exclusive (refused with force/yolo/allowUnsafePermissions, `read_only_incompatible`); `read-only` added to ADAPTER_PERMISSION_MODES for claude and codex only; cursor/opencode still refused.
- [x] R3 Offline security tests: propagation, stale confirmation, incompatible options, missing isolation, mode changes; no-model write attempts against source and `.git` must fail under both wrappers. Route: delegated (with R2). Done: test/readonly-containment.test.js (argv, profile, authority, canary logic, e2e through real service + run-manager + fake spawn), test/readonly-claude-sandbox.test.js and test/readonly-codex-sandbox.test.js (real canaries: EPERM on source write/append/create/mkdir/rename/delete, `.git` new file/HEAD/objects, git add/commit; tree hashes unchanged; sandbox-exec pid preserved), helper test/helpers/readonly-canary.js. Full `npm test`: 2780 tests, 2779 pass, 0 fail, 1 skipped (pre-existing).
- [x] R4 Verify the two-call spend limit is enforceable (flags such as turn/token caps) before any provider run. Gate: if not enforceable, stop and ask. Route: inline analysis. Result: NOT enforceable (claude 2.1.291 has only `--max-budget-usd`, no turn or request cap; codex-cli 0.160.1 has no turn, token or spend cap). Stopped before spending and asked. Revised authorization granted by the user ("si", 2026-10-06, after the revised P1 plan): project `/Users/kal-el/Desktop/agentic-harness`; current native sessions, no auth or billing changes; ONE execution per provider, max 90 seconds each (on expiry cancel exactly that run and verify termination); no retries, no substitutions, no guaranteed monetary ceiling; Explorer = Claude Haiku 4.5, Reviewer = Codex GPT-5.5; workers read-only; if Claude fails, Codex is NOT launched; restore the original strategy bytes on success or error; on concurrent modification preserve both versions and stop automatic restoration. The authorized limit bounds executions and time, not internal requests or money. No P2, no Gentle approval claims.
- [x] R5 Prepare P1 without a generative call: real catalogs, temporary team via shared APIs, two deterministic tasks approved through the existing flow. Route: delegated. Done (attempts 3-5): real catalogs queried; temporary team Explorer=claude::claude-haiku-4-5, Reviewer=codex::gpt-6.1-sol activated through shared APIs (gpt-5.5 and gpt-5.6-sol are not Reviewer candidates in the real catalog; user chose gpt-6.1-sol); deterministic tasks created with an injected non-generative createPlan and approved through the existing flow.
- [x] R6 Execute Claude then Codex through preview, confirmation, shared execution; transfer result; compare to code. Gated by R3 and R4 and authorization. Done with caveats: Claude (run run_muxawi44_205z4g, task 20261006231934-read-only-analysis-in-this-repository-ex-f1f49ebd) completed in 38.9s, cost reported by Claude 0.511 USD, 65 input / 3471 output tokens; automatic handoff to Codex worked; first Codex run (run_muxaxdqv_odxrai) was cancelled at the 90s deadline after turn.started with no events; user-authorized Codex-only re-run at 180s (run run_muxb7bu3_r9ojpm, task 20261006232759-read-only-review-verify-the-explorer-s-c-07dda0a0) completed in 30.7s, 140833 input / 776 output tokens, cost not reported, and its review exists in the run events (11 CONFIRMED, 2 WRONG of 13 claims) but Kairo reported "no summary produced": Codex agent_message items are not mapped to the result summary (open defect).
- [x] R7 Restore original strategy atomically (preserve both versions if modified concurrently); compare sources against the state immediately before P1; report evidence, identities, available consumption, limitations. Done: original strategy restored atomically after each real round (sha 2945cbb4487f4728548c1d46dce5635ead24a635428df01733305685260452ae verified); sources compared against the pre-run baseline incl. foreign pending files and .git: no differences; Kairo task artifacts remain untracked under .ai/tasks/.

## Acceptance

- Claude result transferred automatically to Codex, visible through shared operations; sources intact; original team restored.
- Failed, skipped or pending checks reported honestly; no fabricated results or receipts.

## Progress

- Initial state recorded, strategy backed up, execution path mapped.
- R1 done: `mode` (standard|read-only) propagated through preview, confirmationTarget (read-only only, standard shape unchanged), executePlan (permissions, prompt, link `mode`), shared operations, MCP zod and Pi schemas, projections (`pubExecution.mode`, `pubPreview.mode`).

- R2/R3 done. Limits not verifiable without a model call: `codex exec --sandbox read-only` itself is not run (the canary uses `codex sandbox -P :read-only`, same built-in policy name); Claude's own writes inside the repository (e.g. a project `.claude/` dir) are denied by the profile and unverified; `approval_policy` was not set (not confirmed from `codex exec --help`).

- P1 attempt 3 failed at CLI argument validation: pre-existing missing `--verbose` (Claude Code 2.1.292: "When using --print, --output-format=stream-json requires --verbose"), run run_muxad9ws_ejmcsl, 1 provider execution, Codex not launched, strategy restored (sha 2945cbb4...), sources intact. Fix authorized by the user: commit fb21063cb adds `--verbose` to both Claude launch paths; the terminal `result` line is no longer collapsed into a usage event (summary preserved), result usage/cost feed run metadata, assistant text under `message` is a fallback summary. Full `npm test`: 2793 tests, 2792 pass, 0 fail, 1 skipped (pre-existing). P1 to be re-run by the user.
- R6 defect fixed in commit 30599b4d9: the Codex adapter now maps `item.completed` with `item.type: agent_message` (non-empty text) to an assistant event, so the run transcript and the normalizer take the LAST agent_message as the summary (multi-paragraph preserved; command_execution items and usage never feed it; no agent_message still yields `no summary produced`; cancelled/failed runs keep their state, never a completed result). Token usage from `agent.token_usage` already reached run metadata with cost null. Tests: test/codex-agent-message-summary.test.js (RED 4/9 failing, then GREEN 9/9); related suites 262 tests, 0 fail; full `npm test` 2802 tests, 2800 pass, 1 skipped, 1 fail: `conversation-service.test.js` "snapshot populates real provider and integration status" (pre-existing, also fails without this change; it reads the real ~/.harness runs and now counts the P1 run, expecting plain 'ENABLED'). The real run run_muxb7bu3_r9ojpm events were used only as the shape reference; no new real Codex run was made. Fixtures are hand-written assumptions of the `codex exec --json` item schema beyond the observed events.

## Next step

R4 is analyzed by the controller (neither CLI has a per-request spend cap; no spend plumbing). Then R5 (prepare P1 without a generative call), gated by the R4 decision.
