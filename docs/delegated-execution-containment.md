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

Delegated execution containment is **path + authority**, not OS deny-by-default
for the whole process tree:

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

Honest limit: adapter `workspace-write` / permission flags are
**application-enforced** by the provider CLI. They are not the same class of
evidence as Bootstrap’s macOS `sandbox-exec` canary. Document the real layer;
do not inflate it to `verified` Bootstrap isolation.

## Adapter write posture (delegated runs)

| Adapter | Default productive launch | Unsafe / elevated | Contained by |
|---|---|---|---|
| **Codex** | `--sandbox workspace-write --approve-for-me` | `yolo` → full bypass | cwd + Codex workspace-write + permission authority |
| **Claude** | permission-mode defaults from adapter | `force` / `yolo` with consent | cwd + Claude permission modes + authority |
| **Cursor** | adapter launch with force/yolo when authorized | `force` / `yolo` with consent | cwd + Cursor flags + authority |
| **OpenCode** | force when authorized | `force` with consent | cwd + authority |
| **Pi** | `read-only` only | no force/yolo | cwd + Pi `--tools` read set — **no authorized write mode** |

Pi is review/read compatible for bounded review; it does **not** offer a
delegated “authorized write” permission mode in `ADAPTER_PERMISSION_MODES`.

## Evidence (separate from Bootstrap)

| Claim | Proof |
|---|---|
| Worktree paths stay under `worktreesDir` | `test/execution-worktree.test.js` (`assertWorktreeId` / traversal rejection) |
| Orchestrated chain runs inside `treePath` | `execution-worktree-orchestrator.js` + orchestrator tests |
| Codex default is workspace-write, not Bootstrap SBPL | `test/codex-execution-adapter.test.js` |
| Unsafe permissions need consent / adapter support | `test/runtime-permission-authority.test.js` |
| Role completion polices agent writes | `test/execution-worktree.test.js` (secrets, rogue commits, size) |
| Bootstrap matrix does not cover this path | [`bootstrap-isolation.md`](bootstrap-isolation.md) + `test/bootstrap-isolation-boundary.test.js` |

Focused contract tests: `test/delegated-execution-containment.test.js`.

## Related code

- `src/global/runtime/run-manager.js`, `run-permissions.js`
- `src/global/runtime/execution-worktree-{manager,orchestrator,store,types}.js`
- `src/global/paths.js` (`worktreePaths`)
- Execution adapters under `src/global/runtime/execution-adapters/`
- Kernel `delegate` / `WorkResult` is a **result seam**, not filesystem
  containment — see `odd/tasks/kernel-work-result-contract.md`
