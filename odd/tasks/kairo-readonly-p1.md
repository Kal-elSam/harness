# Kairo read-only execution and P1 Claude to Codex

> Integration note (kairo-consolidation G8): this document was picked from the source line and is kept as context. Figures below that describe the source line (real provider runs, cost, `npm test` counts such as 2750) are NOT evidence for the consolidated branch; the consolidation evidence lives in `odd/tasks/kairo-consolidation.md`. Pi tools and the Pi schemas are not part of the integrated scope (Pi parity deferred, not applicable).

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

- [x] R1 Propagate `read-only` mode: preview, confirmationTarget, `executePlan`, shared operations, MCP schemas, run permissions. Stale or mismatched mode refused; default behavior unchanged. Route: delegated. Source line: RED 9/10 failing in test/conversation-readonly-mode.test.js, then GREEN 11/11 (source-line observation, not claimed for this branch). Consolidated branch: see the consolidation tracker. `read-only` NOT added to claude/codex ADAPTER_PERMISSION_MODES: execute is refused before reserve/launch with `read_only_unsupported`.
- [ ] R2 Effective containment in adapters: Codex `--sandbox read-only` without `--approve-for-me`; Claude tool allow-list plus `--restricted` plus verifiable write containment (sandbox-exec) with fail-closed `isolation_unavailable`. Route: delegated.
- [ ] R3 Offline security tests: propagation, stale confirmation, incompatible options, missing isolation, mode changes; no-model write attempts against source and `.git` must fail under both wrappers. Route: delegated (with R2).
- [ ] R4 Verify the two-call spend limit is enforceable (flags such as turn/token caps) before any provider run. Gate: if not enforceable, stop and ask. Route: inline analysis.
- [ ] R5 Prepare P1 without a generative call: real catalogs, temporary team via shared APIs, two deterministic tasks approved through the existing flow. Route: delegated.
- [ ] R6 Execute Claude then Codex through preview, confirmation, shared execution; transfer result; compare to code. Gated by R3 and R4 and authorization.
- [ ] R7 Restore original strategy atomically (preserve both versions if modified concurrently); compare sources against the state immediately before P1; report evidence, identities, available consumption, limitations.

## Acceptance

- Claude result transferred automatically to Codex, visible through shared operations; sources intact; original team restored.
- Failed, skipped or pending checks reported honestly; no fabricated results or receipts.

## Progress

- Initial state recorded, strategy backed up, execution path mapped.
- R1 done: `mode` (standard|read-only) propagated through preview, confirmationTarget (read-only only, standard shape unchanged), executePlan (permissions, prompt, link `mode`), shared operations, MCP zod schemas, projections (`pubExecution.mode`, `pubPreview.mode`).

## Next step

R2 (adapter containment: Codex `--sandbox read-only`, Claude tools plus sandbox-exec, fail-closed `isolation_unavailable`) and R3 offline security tests, RED first; then add `read-only` to the adapters' ADAPTER_PERMISSION_MODES only when containment is verified.
