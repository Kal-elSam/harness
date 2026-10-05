# Kernel Run Spawn Bridge (design only)

## Status

**DESIGN ONLY. Implementation and production wiring are NOT authorized.** This document records the aligned design and the evidence behind it. It does not claim any adapter has verified write containment.

## Objective

Connect the kernel seam `spawnAdapter(decision, request)` (`src/global/kernel/service.js`) to the existing executor `startRun`, returning a validated `WorkResult` (`src/global/kernel/contracts.js`, commit `363480a0f`), with no new executor, no UI and no Gentle fields.

## Related trackers (do not duplicate)

- `odd/tasks/kernel-work-result-contract.md`: the validated `WorkResult` + `delegate` seam (done).
- `odd/tasks/delegated-execution-containment.md`, `odd/tasks/codex-delegated-write-compat.md`, `odd/tasks/delegated-write-admission-handoff-claude.md`: owner of the write-containment admission matrix (`src/global/runtime/delegated-write-admission.js`) and Codex OS-wrap helpers.

## Evidence (isolated canary, 2026-10-05, codex-cli 0.160.0)

- Codex adapter default flags at the time (`--sandbox workspace-write --approve-for-me`) were rejected by the installed CLI (exit 2, no provider call). Since fixed by another change (`197c671e6`: `--approve-for-me` only). That fix is compatibility, not verification.
- Direct `codex exec --approve-for-me` in a git-initialized isolated workspace: in-workspace write allowed; sibling-directory write and an absolute tmpdir write both succeeded. Contained = false. Negative evidence for treating `source_declared` as containment; consistent with the matrix keeping Codex non-launchable under the strict floor.
- Attempt 3 stdout/event stream was NOT preserved and was not repeated. claude, cursor, opencode and pi were never run for real.
- Codex appended an entry for the canary workspace to `~/.codex/config.toml`. The cleanup became moot: the entry disappeared before any cleanup ran. Nothing in this work wrote that file. The cause of the change is unknown (a running Codex managed app-server daemon is a candidate; unconfirmed). No other change to that file was identified; no pre-change content backup exists.
- Evidence files live in the session scratchpad (`canary/evidence/EVIDENCE.md`), outside the repo.

## Design (aligned with the existing strict admission)

1. **Reuse `startRun`; no parallel permission table, no `blocked` status.** Admission is the existing gate: `startRun({ requireVerifiedWriteContainment: true, permissions: [], allowUnsafePermissions: false, ... })`. `prepareRun` runs `assertDelegatedWriteAdmission` (`run-manager.js:126-127`) before `createRunId`/`createRunRecord`, so a rejection creates no run.
2. **Rejection before a run is separate from `WorkResult`.** It surfaces as the thrown `DelegatedWriteAdmissionError` / `PermissionAuthorityError` and propagates through `delegate`. No `WorkResult`, no `runId`, no fabricated result. Plain-argument checks the gate does not cover (non-empty `decision.model.modelId`, `decision.model.adapterId === decision.provider`) also throw.
3. **Normalization failure after a run exists keeps the `runId`.** `COMPLETED` with real transcript text -> `completed` (summary from real text fields only, never the JSON fallback). `COMPLETED` without real text -> `failed`, error "no summary produced", `workerId = runId`. `FAILED` -> `failed` with the supervisor's error. `CANCELLED` -> `cancelled`. If events cannot be read or parsed, return `failed` with `workerId = runId` and an explicit error. Result normalization is read-only with respect to the run: it never cancels, never calls `stopRun` and never writes run state, so the real run state stays as the supervisor left it.
4. **Cancellation is explicit and caller-driven, never implicit.** Normalization does not cancel anything. Slice B-3 will offer an explicit `onStart({ runId, stop })` callback; only when the caller invokes `stop` does the bridge call `stopRun`. The bridge never cancels on its own initiative (no retry-by-cancel, no cancel on a normalization failure). A `cancelled` `WorkResult` reports run state, not process death: existing tests prove `stopRun` calls `kill` on a fake child, while a real child exiting, grandchildren and SIGTERM-ignoring children remain unproven.
5. **Separation of authorities.** The `WorkResult` is a Kairo execution result. Review verdicts, receipts and authority remain Gentle's (`gentle-ai review ...`); the bridge defines no Gentle fields and derives no verdict.
6. **Honest consequence today.** Every adapter is non-`verified_effective` in the matrix (codex `source_declared`; claude/cursor/opencode `unverified`; pi `read_only_only`), so a strict-floor bridge launches nothing. Offline tests with fakes are possible; production wiring is blocked until the matrix owner promotes an adapter with applicable effective evidence. This design promotes none.

## Out of scope

Production wiring (`host/extension/index.js`), executors, AbortSignal/timeouts, UI, SIGKILL escalation, promoting adapters, further real canaries, any Gentle contract, editing `~/.codex/config.toml`.

## Candidate slices (none authorized)

Committing this document authorizes no implementation. The strict admission stays exactly as it exists today and no adapter is promoted by any slice below.

### Offline preparation (fakes only; each needs its own explicit authorization)

- [x] B-1 Pure normalization (run metadata + events -> `WorkResult`, keep `runId`), fake `startRun`, offline tests. No cancellation.
- [x] B-2 Factory composing admission arguments + `startRun` + normalization, fake `startRun`; assert `requireVerifiedWriteContainment: true`, `permissions: []`, `allowUnsafePermissions: false`, and that an admission rejection creates no run.
- [ ] B-3 Explicit caller-driven cancel callback `onStart({ runId, stop })`; `stop` calls `stopRun` only when the caller invokes it.
- [ ] B-4 Integration through real `startRun` with a fake spawn (no real process, no provider).

### Production wiring (separate decision, not part of the offline preparation)

- [ ] B-5 Host wiring in `host/extension/index.js`. Blocked until the admission-matrix owner promotes an adapter to `verified_effective` with applicable effective evidence, plus its own explicit authorization.

## Offline test plan (fakes only)

Success with real summary; success without summary -> failed keeping `runId`; JSON-dump transcript not accepted as summary; non-zero exit and idle timeout distinguishable; cancel via `stopRun` with no retry and cancel-after-completion no-op; strict-floor rejection for every adapter creates no run and no `WorkResult`; model/adapter mismatch and empty model throw; two parallel delegations independent; manual/wait routes never reach the bridge.

## Constraints

- Artifacts in English; Spanish only in chat.
- Work on branch `feat/herd-shell-layout` (other plans active in this worktree).
- TDD strict when implementation is authorized (runner `node --test`).

## Next step

Decide whether to authorize B-1..B-4 (offline only, fakes, no provider). B-5 (production wiring) and any adapter promotion belong to the admission-matrix owner and a separate authorization.

## Authorization and progress log

- 2026-10-05: user authorized B-1 and B-2 only (offline, fakes, strict TDD, node --test). Not authorized: B-3, B-4, B-5, promotion of any adapter, provider calls. Route: one delegated writer (2 new source files + 2 new test files; Writer trigger). B-1 lives in `src/global/kernel/run-result-normalizer.js`, B-2 in `src/global/kernel/run-spawn-adapter.js`, so each work unit gets its own commit. TDD: strict, runner `node --test`, RED observed before implementation. RDD: assess each work-unit commit.
- 2026-10-05: B-1 (`4be774e87`) and B-2 (`9d6d283b5`) done, offline only. Writer evidence: RED = `ERR_MODULE_NOT_FOUND` for each new test file before its module existed (import-level RED, not per-test); GREEN 14/14 (normalizer) and 15/15 (factory). Parent re-ran normalizer + factory + delegate suites: 36 pass, 0 fail. Writer's full `npm run test:cool`: 2450 tests, 2449 pass, 0 fail, 1 skip (not re-run by the parent).
- Facts found while implementing: `prepareRun` runs `adapter.availability()` and the launchable check BEFORE admission, and availability can probe real CLIs; admission still runs before `preflight`, `createRunId` and `createRunRecord`. The real-`startRun` admission test therefore injects a stub adapter (available, launchable, `preflight` throws if called) and asserts for codex, claude, cursor, opencode and pi: `DelegatedWriteAdmissionError`, `preflight` never called, `homeDir` still empty (no run record). Argument errors use a new `RunSpawnArgumentError` (codes `run_spawn_invalid_request|provider|model`, `run_spawn_adapter_mismatch`). Normalizer accepts summary only from `data.text`, string `data.content`, string `data.result` or `type:'text'` blocks; never the `formatTranscriptEventText` JSON fallback.
- Not authorized and not done: B-3, B-4, B-5, adapter promotion, wiring, provider calls. Nothing in the production path calls the new factory.
- RDD assess (EXCLUDE untracked, committed-only): B-1+B-2 alone (`c37ed2347..9d6d283b5`): risk medium, 4 paths, 557 lines, `review_due: true` (`slice_budget_reached`). Range since the last reviewed boundary (`f3addf118`): high, 48 paths, 4641 lines, driven by other plans' commits (e.g. `process_boundary` in `context-fill-checkpoint.js`), not by this work.
