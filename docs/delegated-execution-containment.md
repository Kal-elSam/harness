# Delegated execution containment (authorized writes)

This document covers **productive delegated runs** (`startRun`, execution
worktrees, orchestrated Builder→Debugger (fix)→Test Runner). It is **not** Bootstrap
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
- `buildDelegatedWriteSandboxProfile({ workspaceRoot, codexHome })` — adapted
  allowlist: workspace/worktree (r/w), provider home (r/w), temps
  (`/private/tmp`, `/private/var/folders`), system reads — **not** a Bootstrap
  snapshot root and not Bootstrap evidence
- `wrapCodexLaunchWithOsSandbox(launch, { profilePath })` — `sandbox-exec -f … codex …`
- Inner argv must use `--dangerously-bypass-approvals-and-sandbox` (nesting
  provider sandbox under outer SBPL breaks tool calls)

Track B helpers remain evaluation-only, not the strict Codex path. They are
**not** wired into ordinary `startRun` and do **not** flip the admission matrix.

Evidence: `test/codex-delegated-write-os-wrap.test.js`.

## Ordinary vs strict floor

| Mode | When | Gate |
|---|---|---|
| **Ordinary** | Default `startRun` / `prepareRun` | No verified-write admission. Existing adapters launch as before (permission authority still applies). Codex uses Track A flags. |
| **Strict verified-write floor** | Explicit `requireVerifiedWriteContainment: true` | `assertDelegatedWriteAdmission`: only `verified_effective` launches; force/yolo forbidden even with consent; missing effective evidence → no launch |

`source_declared` means the adapter **source** maps a normal launch to a write
sandbox posture (Codex `--approve-for-me` → provider workspace-write). It is
**not** `verified_effective` and does **not** satisfy the strict floor.

## Strict Codex cwd-only profile (0.162.1)

Strict runs do not use Track A or the bypass-based Track B wrapper. They use
one named inline permission profile, with **no `extends`**:

```text
codex exec --json -c 'default_permissions="kairo_cwd"' \
  -c 'permissions.kairo_cwd.filesystem={":root"="read","/canonical/cwd"="write"}' \
  -c 'approval_policy="never"' --ignore-user-config <task>
```

The shared `buildCodexWriteProfile` resolves cwd with `realpathSync`, requires
an absolute path, TOML-escapes quotes and backslashes, and rejects controls and
unpaired surrogates. No `--sandbox`, `--approve-for-me` or bypass flag appears
on this path. Ordinary runs retain their existing argv.

Before admission, `verifyCodexWriteSandbox` runs **no model calls**:

```text
codex sandbox -C /canonical/cwd -P kairo_cwd \
  -c 'permissions.kairo_cwd.filesystem={":root"="read","/canonical/cwd"="write"}' \
  --ignore-user-config -- <probe>
```

Within a 15-second deadline it proves an actual in-cwd write, denied writes
without leaked files in a fresh home-outside directory, TMPDIR and `/tmp`,
and a successful echo control. Probe output must match known markers; launch
errors, signals, timeouts, unknown output, failed controls and cleanup errors
refuse admission. Probe files and the fresh outside directory are removed.
If an outside location lies inside cwd, proof is unavailable and the run fails
closed rather than claiming outside containment.

Evidence is an in-memory, single-use, cwd-bound receipt with a 15-second
admission lifetime, never persisted or used to promote the static table.
Preparation and the actual supervisor launch each run their own preflight;
detached supervisors never trust preparation-time evidence. Force/yolo remains
forbidden even with a passing canary or consent. Other adapters are unchanged.

Offline proof: `test/codex-write-containment.test.js`,
`test/codex-execution-adapter.test.js`, `test/delegated-write-admission.test.js`.
Live proof: `test/codex-write-canary-live.test.js`, gated on macOS and an available
`codex sandbox` CLI exactly like the read-only canary. Run it from the parent
shell: nested Codex seatbelts may prevent home probe setup or `sandbox_apply`;
such a failure does not establish a defect in the profile.

Schema reference: [Codex 0.162.1 permission profiles](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/permissions_toml.rs).
The live parent probes recorded in `odd/tasks/codex-write-canary.md`, L7, are
the verified posture, not a result produced by the offline tests.

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
| **codex** | `source_declared` | **false** | **yes, only after a fresh launch-time canary** |
| **claude** | `unverified` | false | **no** |
| **cursor** | `unverified` | false | **no** |
| **opencode** | `unverified` | false | **no** |
| **pi** | `read_only_only` | false | **no** (write floor); ordinary read-only runs unaffected |

Promote to `verified_effective` only with an applicable effective canary (in-cwd
write OK, outside denied), including auto-approval/native config behavior.
Codex now computes this evidence per launch with the cwd-only profile below,
separate from Bootstrap Analysis evidence. The static matrix stays source-declared.

## Evidence

| Claim | Proof |
|---|---|
| Ordinary runs unchanged without the flag | `test/delegated-write-admission.test.js`, restored Claude/OpenCode run tests |
| Strict floor denies missing, copied, reused or wrong-cwd evidence / unverified adapters | `test/delegated-write-admission.test.js` |
| Strict floor rejects yolo/force even with consent | `delegated_write_bypass_forbidden` |
| Codex ordinary flags match installed CLI | `test/codex-execution-adapter.test.js` |
| Adapted OS wrap helpers (no second executor) | `test/codex-delegated-write-os-wrap.test.js` |
| Bootstrap evidence stays separate | [`bootstrap-isolation.md`](bootstrap-isolation.md) |

## Related code

- `src/global/runtime/execution-adapters/codex.js` (Track A flags)
- `src/global/runtime/codex-delegated-sandbox.js` (Track B helpers)
- `src/global/runtime/delegated-write-admission.js`
- `src/global/runtime/run-manager.js` (`requireVerifiedWriteContainment` opt-in)
- `test/delegated-write-admission.test.js` (admission contract)
- `test/codex-delegated-write-os-wrap.test.js` (adapted OS wrap helpers)
