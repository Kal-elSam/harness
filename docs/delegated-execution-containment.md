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

## What “contained” means here

Delegated execution containment is **path + authority + admission**, not OS
deny-by-default for the whole process tree:

1. **Cwd bound to the execution worktree** — orchestrated roles call `startRun`
   with `cwd: worktree.treePath` (`~/.harness/worktrees/<id>/tree`), never the
   project’s own checkout and never a Bootstrap snapshot temp dir.
2. **Worktree id cannot escape** — `assertWorktreeId` + `worktreePaths` refuse
   traversal ids so joins cannot leave `worktreesDir`.
3. **Permission authority** — `authorizeRunPermissions` fails closed; unsafe
   modes (`force` / `yolo`) need `--allow-unsafe-permissions` (or cockpit
   confirm) and must be in the adapter’s supported set.
4. **Provider write sandbox (adapter-specific)** — e.g. Codex’s safe default is
   `--sandbox workspace-write` (writes intended for the workspace cwd), not
   Bootstrap’s outer `sandbox-exec`. Explicit `yolo` opts into
   `--dangerously-bypass-approvals-and-sandbox` (larger blast radius; consent
   required).
5. **Kairo owns commits** — role prompts forbid agents from `git add` /
   `git commit`; `completeRoleRun` admits real diffs under policy (secrets,
   size, rogue commits between roles interrupt).
6. **Prelaunch admission** — `assertDelegatedWriteAdmission` in `prepareRun`:
   unverified write floors **do not launch** (throw / no run; never a fabricated
   `WorkResult`).

Honest limit: adapter `workspace-write` / permission flags are
**application-enforced** by the provider CLI. They are not the same class of
evidence as Bootstrap’s macOS `sandbox-exec` canary. Document the real layer;
do not inflate it to Bootstrap `verified` or to `verified_effective` here.

## Admission matrix (handoff for Claude)

Source of truth: `src/global/runtime/delegated-write-admission.js`
(`DELEGATED_WRITE_ADMISSION`, `assertDelegatedWriteAdmission`).

| Adapter | Status | `mayLaunchAuthorizedWrite` | `verifiedEffective` | Conditions to launch | Notes for Claude |
|---|---|---|---|---|---|
| **codex** | `source_declared` | **yes** | **false** | non-empty cwd; empty/normal → `workspace-write`+`approve-for-me`; yolo needs unsafe consent | Eligible under conditions. Promote to `verified_effective` only after an effective canary (writes inside cwd OK, outside denied) with auto-approval/native config accounted for |
| **claude** | `unverified` | **no** | false | — | **Do not launch** until a declared/proven workspace write floor exists |
| **cursor** | `unverified` | **no** | false | — | **Do not launch** for productive writes |
| **opencode** | `unverified` | **no** | false | — | **Do not launch** (includes `opencode-go` / `opencode-zen` ids) |
| **pi** | `read_only_only` | **no** | false | `permissions: ["read-only"]` only | Read/review path may launch; no authorized-write mode |

Statuses:

- `verified_effective` — empirically proven workspace write floor (none today).
- `source_declared` — adapter source maps normal launch to an explicit write sandbox.
- `unverified` — no declared floor → admission denied.
- `read_only_only` — review/inspect only.

Product intent (writable containment): implementation may write **inside** the
bound project/worktree; not universal read-only; not Pi-only. Permission tokens
and containment capabilities stay separate.

## Evidence (separate from Bootstrap)

| Claim | Proof |
|---|---|
| Worktree paths stay under `worktreesDir` | `test/execution-worktree.test.js` |
| Orchestrated chain runs inside `treePath` | `execution-worktree-orchestrator.js` + tests |
| Codex default is workspace-write, not Bootstrap SBPL | `test/codex-execution-adapter.test.js` |
| Unsafe permissions need consent / adapter support | `test/runtime-permission-authority.test.js` |
| Role completion polices agent writes | `test/execution-worktree.test.js` |
| Admission matrix + unverified do not launch | `test/delegated-write-admission.test.js` |
| Bootstrap matrix does not cover this path | [`bootstrap-isolation.md`](bootstrap-isolation.md) |

## Related code

- `src/global/runtime/delegated-write-admission.js` (matrix + assert)
- `src/global/runtime/run-manager.js` (`prepareRun` calls assert before preflight)
- `src/global/runtime/run-permissions.js`
- `src/global/runtime/execution-worktree-{manager,orchestrator,store,types}.js`
- `src/global/paths.js` (`worktreePaths`)
- Execution adapters under `src/global/runtime/execution-adapters/`
- Kernel `delegate` / `WorkResult` is a **result seam**, not filesystem
  containment — see `odd/tasks/kernel-work-result-contract.md`
