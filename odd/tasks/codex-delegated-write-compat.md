# Codex delegated write — CLI compatibility + OS wrapper evaluation

## Objective

Fix ordinary Codex execution flags for the **installed** CLI (compatibility),
keep that fix separate from any isolation / `verified_effective` claim, and
evaluate reusing the existing macOS `sandbox-exec` wrapper **around** the
execution adapter — without inventing a second executor or copying Bootstrap
profiles unchanged.

## Problem

Installed Codex CLI (`codex exec`, verified on 0.160.0) rejects:

```text
error: the argument '--sandbox <SANDBOX_MODE>' cannot be used with '--approve-for-me'
```

Ordinary `buildCodexLaunch` previously emitted both. That was a **compatibility**
bug, not proof of containment. `--approve-for-me` alone selects the
`workspace-write` sandbox (CLI help + live banner).

## Why

Ordinary delegated runs must launch on the real CLI. Strict
`verified_effective` remains a separate floor (canary / OS wrapper), never
inferred from flag strings.

## Scope

- Track A: TDD fix of ordinary Codex permission args for installed CLI
- Track B: design + profile/wrap helpers for adapted OS sandbox around the
  existing executor spawn (workspace allowlist, provider home, temps)
- Docs: keep Bootstrap evidence separate

## Non-goals

- Promoting Codex to `verified_effective` without an applicable canary
- Replacing Bootstrap Analysis with this wrapper
- Creating a parallel “OS execution adapter” / second executor
- Kernel edits; starting native RDD review
- Wiring Track B into ordinary `startRun` this increment

## Constraints

- Flag fix ≠ isolation guarantee
- Outer `sandbox-exec` requires Codex internal sandbox **off** (no nesting)
- Adapted allowlist: workspace/worktree root (r/w), `CODEX_HOME` (r/w),
  temps (`/private/tmp`, `/private/var/folders`), system read paths —
  **not** a disposable Bootstrap snapshot root by name or evidence
- force/yolo still consent-gated on the ordinary path; forbidden under the
  strict verified floor

## Acceptance criteria

- [x] Ordinary launch args accepted by installed CLI contract: `--approve-for-me`,
      no combined `--sandbox` + `--approve-for-me`
- [x] Tests pin that posture; yolo still uses full bypass
- [x] Design/helpers for adapted SBPL + wrapLaunch helper (no second executor)
- [x] Docs state Track A vs Track B; Bootstrap canaries not reused
- [x] Admission matrix still `source_declared` / `verifiedEffective: false`

## TDD

- Mode: ordinary functional checks (project TDD config unchanged)
- Runner: `node --test test/codex-execution-adapter.test.js test/delegated-execution-containment.test.js test/codex-delegated-write-os-wrap.test.js test/delegated-write-admission.test.js`

## Tasks

- [x] CW-1 Tracker + doc design (Track A / Track B)
- [x] CW-2 RED→GREEN: ordinary Codex flags for installed CLI
- [x] CW-3 Adapted OS profile + wrapLaunch helper (reuse pattern, not Bootstrap copy)
- [x] CW-4 Docs + admission evidence strings; focused suites green

## Progress

- 2026-10-05: opened from Cursor plan “compatibilidad y contención”.
- 2026-10-05: live CLI confirms mutual exclusion of `--sandbox` and `--approve-for-me`.
- 2026-10-05: Track A flag fix + Track B helpers landed; admission unchanged.

## Verification evidence

- Focused suites (see TDD runner above)

## Next step

Optional: canary under Track B OS wrap → only then consider
`verified_effective` promotion (Claude/admission owner). Do not wire wrap into
ordinary `startRun` without that evidence.
