# Delegated execution containment (authorized writes)

This document covers **productive delegated runs** (`startRun`, execution
worktrees, orchestrated Builder→Debugger→Tester). It is **not** Bootstrap
Analysis isolation.

| Path | Goal | Write posture | Evidence lives in |
|---|---|---|---|
| **Bootstrap Analysis** | Investigate a disposable snapshot | Writes denied outside the SBPL allowlist; investigation-only | [`bootstrap-isolation.md`](bootstrap-isolation.md) |
| **Delegated execution** | Implement an approved plan | Writes **authorized** inside a bounded cwd / worktree | This doc |

Never reuse Bootstrap `verified` / `sandbox-exec` canaries as proof that a
delegated run is confined. Never claim a delegated run inherits Bootstrap’s
external SBPL profile.

## Track A — CLI flag compatibility (ordinary path)

Installed Codex (`codex exec`) **rejects** combining `--sandbox` with
`--approve-for-me`. Ordinary safe default is therefore:

```text
codex exec --json --approve-for-me <task>
```

`--approve-for-me` alone selects the provider `workspace-write` sandbox and
auto-reviews approvals for headless runs. This is **compatibility**, not an
isolation guarantee and not `verified_effective`.

Evidence: `test/codex-execution-adapter.test.js` (live CLI mutual-exclusion
confirmed on 0.160.0).

## Track B — OS wrapper reuse (evaluation / optional strict path)

Do **not** invent a second executor. Reuse the existing Bootstrap *mechanism*
(`sandbox-exec` around the same `codex` argv) by wrapping
`execution-adapters/codex.js`’s launch:

- Module: `src/global/runtime/codex-delegated-sandbox.js`
- Allowlist (adapted, not Bootstrap copy): **workspaceRoot** + **isolated
  `providerHome`** + **isolated `tempRoot`** only. Personal `~/.codex` is
  **forbidden** as a writable provider home. No broad `/private/tmp` write grant.
- `assertDelegatedWriteOsSandboxAvailable` — OS sandbox must be present before
  wrap/launch; failure → **no execute** (`delegated_write_os_sandbox_unavailable`)
- `wrapCodexLaunchWithOsSandbox` sets `CODEX_HOME` / `TMPDIR` to the isolated roots
- Inner argv uses `--dangerously-bypass-approvals-and-sandbox` (no nesting)
- Canary prep: `prepareDelegatedWriteCanaryPlan` lists explicit allowed /
  forbidden write paths. **`runDelegatedWriteCanary` requires
  `authorizeRealCanary: true`**; without it →
  `delegated_write_canary_authorization_required`. A new real run needs that
  specific authorization (not implemented as a silent pass).

Track B helpers are **not** wired into ordinary `startRun` and do **not** flip
the admission matrix by themselves.

Evidence: `test/codex-delegated-write-os-wrap.test.js`.

## Ordinary vs strict floor

| Mode | When | Gate |
|---|---|---|
| **Ordinary** | Default `startRun` / `prepareRun` | No verified-write admission. Existing adapters launch as before (permission authority still applies). Codex uses Track A flags. |
| **Strict verified-write floor** | Explicit `requireVerifiedWriteContainment: true` | `assertDelegatedWriteAdmission`: only `verified_effective` launches; force/yolo forbidden even with consent; missing effective evidence → no launch |

`source_declared` means the adapter **source** maps a normal launch to a write
sandbox posture (Codex `--approve-for-me` → provider workspace-write). It is
**not** `verified_effective` and does **not** satisfy the strict floor.

## What “contained” means (path model)

1. **Cwd bound to the execution worktree** when using orchestrated roles —
   `cwd: worktree.treePath`.
2. **Worktree id cannot escape** — `assertWorktreeId` + `worktreePaths`.
3. **Permission authority** — unsafe modes need consent on the **ordinary** path;
   under the **strict** floor those bypasses are rejected outright.
4. **Provider write sandbox** — Codex ordinary default is `--approve-for-me`
   (workspace-write posture; source-declared only until a canary promotes it).
5. **Kairo owns commits** in worktree role completion policy.

## Admission matrix (strict floor)

Source: `src/global/runtime/delegated-write-admission.js`.

| Adapter | Status | `verifiedEffective` | Strict floor launch? |
|---|---|---|---|
| **codex** | `source_declared` | **false** | **no** (until canary → `verified_effective`) |
| **claude** | `unverified` | false | **no** |
| **cursor** | `unverified` | false | **no** |
| **opencode** | `unverified` | false | **no** |
| **pi** | `read_only_only` | false | **no** (write floor); ordinary read-only runs unaffected |

Promote to `verified_effective` only with an applicable effective canary (in-cwd
write OK, outside denied), including auto-approval/native config behavior.
Track B OS wrap is a candidate enforcement layer for that canary — still
separate from Bootstrap Analysis evidence.

## Evidence

| Claim | Proof |
|---|---|
| Ordinary runs unchanged without the flag | `test/delegated-write-admission.test.js`, restored Claude/OpenCode run tests |
| Strict floor denies source_declared / unverified | same |
| Strict floor rejects yolo/force even with consent | `delegated_write_bypass_forbidden` |
| Codex ordinary flags match installed CLI | `test/codex-execution-adapter.test.js` |
| Adapted OS wrap helpers (no second executor) | `test/codex-delegated-write-os-wrap.test.js` |
| Bootstrap evidence stays separate | [`bootstrap-isolation.md`](bootstrap-isolation.md) |

## Related code

- `src/global/runtime/execution-adapters/codex.js` (Track A flags)
- `src/global/runtime/codex-delegated-sandbox.js` (Track B helpers)
- `src/global/runtime/delegated-write-admission.js`
- `src/global/runtime/run-manager.js` (`requireVerifiedWriteContainment` opt-in)
- `odd/tasks/codex-delegated-write-compat.md`
- `odd/tasks/delegated-write-admission-handoff-claude.md`
