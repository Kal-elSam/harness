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

- [ ] B-1 Pure normalization (run metadata + events -> `WorkResult`, keep `runId`), fake `startRun`, offline tests. No cancellation.
- [ ] B-2 Factory composing admission arguments + `startRun` + normalization, fake `startRun`; assert `requireVerifiedWriteContainment: true`, `permissions: []`, `allowUnsafePermissions: false`, and that an admission rejection creates no run.
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
