# Delegated execution containment (authorized writes)

## Objective

Close evidence and prelaunch admission for productive delegated writes (separate from Bootstrap). Unverified adapters do not launch. Deliver admission matrix to Claude.

## Scope

- `src/global/runtime/delegated-write-admission.js` + wire in `run-manager.js`
- `docs/delegated-execution-containment.md`
- `odd/tasks/delegated-write-admission-handoff-claude.md`
- Tests: `test/delegated-write-admission.test.js` (+ adjusted Claude/OpenCode/Pi run tests)

## Acceptance

- [x] Path+authority model documented (≠ Bootstrap)
- [x] Admission matrix: Codex `source_declared` eligible under conditions; Claude/Cursor/OpenCode `unverified` denied; Pi read-only only
- [x] `prepareRun` calls `assertDelegatedWriteAdmission` before preflight/spawn
- [x] Failure is throw / no run (not WorkResult)
- [x] Handoff artifact for Claude to close admission / promote `verified_effective`

## Evidence

- `node --test test/delegated-write-admission.test.js test/delegated-execution-containment.test.js test/claude-supervised-run.test.js test/pi-runtime.test.js test/codex-execution-adapter.test.js test/run-manager.test.js`: 41 pass
