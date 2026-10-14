# U10 verification evidence

Covered: S8 part (2) only. No agent/model calls, network, runner, staging, or
commits. All authored changes stay under the two authorized edit surfaces.

## Observed checks

- `node --test test/effort-outcome-corpus.test.js`: initial RED 0 passed /
  7 failed; initial GREEN 7 passed / 0 failed. Added scope-effects regression:
  RED 7 passed / 1 failed; final GREEN 8 passed / 0 failed.
- `node scripts/effort-eval/outcome-tasks/validate.mjs`: exit 0; 24 tasks,
  EN 12 / ES 12, mechanical 8 / ordinary 8 / reasoning 8, risk-sensitive 8.
  Every untouched fixture fails its external check.
- SHA-256: `d6f76f596439e0af04fa92cf4c843e750f0735434a75918dd33d99710643e494`.
- `node --test test/*.test.js`: exit 1; 3038 tests, 3014 passed, 19 failed,
  5 skipped, 0 cancelled. Ran once while the parallel writer was in progress.
- `git status --short`: our additions are
  `scripts/effort-eval/outcome-tasks/` and
  `test/effort-outcome-corpus.test.js`; other modified source/tests are in
  the parallel writer's surfaces and were not edited by U10.

## Full-suite failing names

These 16 match the user-supplied environmental failure classes; no baseline
rerun was performed in this unit:

- extracted tarball lives outside the checkout and has no node_modules
- every package-root resource the CLI resolves exists in the tarball
- static import closure stays inside the tarball and uses only declared dependencies
- extracted CLI runs with a scrubbed env and writes nothing outside HARNESS_HOME
- registry-backed clean-install smoke is wired as an explicit npm script
- local conversation UI is loopback-authenticated with allowlisted actions
- verify script proves selection, no-cargo launch, capture and PTY on a real npm pack
- packed tarball includes release scripts and full SDD skill packs
- packed tarball excludes the vendored third_party/ Pi fork source
- claude wrapper profile: source, new file and .git writes all fail with EPERM and the tree is unchanged
- claude wrapper profile: writes outside the repository still succeed (Claude config/cache/tmp stay usable)
- real preflight canary passes for a temp repo and leaves no canary file behind
- a symlinked repository root is contained through its real path
- sandbox-exec execs the target: the spawned pid is the target process (liveness stays valid)
- codex :read-only profile: source, new file and .git writes fail with EPERM and the tree is unchanged
- real codex preflight canary passes and leaves no file behind

Three failures are in the parallel writer's in-progress test surfaces, not
the U10 files:

- ask routing exposes an effort prediction without changing existing routing fields
- run listing exposes predictions and preserves legacy records unchanged
- run metadata records effort as a prediction without retaining task text or changing its fingerprint

## Parent follow-up

Re-run the full suite after parallel work settles and outside the sandbox.
Actual packaging proof requires the parent; existing effort-eval
`.npmignore` contains `**`, which covers this nested corpus by npm ignore
semantics. Parent reviews and commits corpus/provenance before predictions
or outcomes. No execution or product decision is made here.

Proposed commit: `test(effort): add held-out outcome corpus`.

Risk: none. Synthetic security examples do not alter production auth,
credentials, payments, routing, dependencies, or existing public contracts.
Checks are trusted local acceptance programs, not security isolation.

