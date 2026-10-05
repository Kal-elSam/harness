# Delegated execution containment (authorized writes)

## Objective

Correct admission: strict verified-write floor only when explicitly requested;
reject bypass under that floor even with consent; require effective evidence;
never equate `source_declared` with verified.

## Acceptance

- [x] Ordinary `startRun` does not apply the strict gate
- [x] `requireVerifiedWriteContainment: true` → only `verified_effective` (none today)
- [x] force/yolo rejected on strict floor even with allowUnsafePermissions
- [x] Docs/tests state `source_declared` ≠ verified
- [x] Claude handoff updated

## Evidence

- Focused suites: delegated-write-admission, claude-supervised-run, run-manager, pi-runtime, codex-execution-adapter
