# Codex cfprefs SHM diagnostic — authorization request (not executed)

Status: **prepared, not authorized, not run.**

This package is for a **controlled managed-preferences startup diagnosis**.
It is **not** the containment canary grant in
`docs/codex-delegated-write-canary-authorization.md`.
A positive H1 outcome does **not** promote `verifiedEffective` and does **not**
wire `startRun`.

Previous Gentle receipts (including `review-4b66cfffd44c6167` and the startup
range receipt on `a8abec3c8..d0533b5cf`) do **not** cover this diagnostic prep.

---

## Arms (real count = 2)

Authorize **exactly two** live process invocations — one per arm. Same binary,
model, account/session, disposable roots, and argv shape. **Only** the SBPL
profile differs as stated. No retries inside an arm; a failed arm needs a
**new** grant.

| Arm | Profile | Purpose |
|---|---|---|
| **A — control** | Run-3 baseline body unchanged (no cfprefs SHM allow) | Re-observe `-32600` / `managed_preferences_sync` **with** PID-linked Sandbox capture |
| **B — treatment** | Baseline + exact `(allow ipc-posix-shm-read-data (ipc-posix-name "apple.cfprefs.<uid>v1") (ipc-posix-name "apple.cfprefs.daemonv1"))` only | Test whether those two reads clear the sync error |

**Not arms (do not authorize under this package):**

- Broad `ipc-posix-name-prefix "apple.cfprefs."`
- `apple.shm.notification_center` or `vfs.disk-space` grants
- Containment probe success / promotion / host wiring
- Extra “just in case” retries

Historical run `delegated-write-20261005T123142` is **context**, not Arm A:
it lacked offender-PID linkage. Arm A must be re-run with the corrected capture.

---

## How to authorize (plain language)

Say you authorize **this two-arm cfprefs diagnostic** and name:

1. the **model id** to pin, and  
2. the **account / session** (identity — not merely `CODEX_HOME`).

Constraints that must be unambiguous:

- **2 runs** only (Arm A then Arm B), each a single process invocation
- isolated `CODEX_HOME` / `TMPDIR` under the disposable layout
- no credential copy by the harness
- no other SBPL deltas beyond Arm B’s exact rule
- no auto-promotion / no `startRun` wiring
- PID-linked capture required on both arms (window + offender identity + observed tree)

Until that grant exists, agents must not spawn either arm.

---

## Shared constants (both arms)

| Item | Value |
|---|---|
| Adapter | Codex CLI via `/usr/bin/sandbox-exec` + SBPL |
| Binary | Absolute pinned package path (never bare `codex`) |
| Model | Named at grant time |
| Account / session | Named at grant time |
| Layout | Same disposable paths as the containment canary prep |
| Capture | `buildPidLinkedSandboxCapturePlan` + offender parse / tree linkage |
| Profile helper | Arm B via `appendCfprefsDiagnosticDelta` only |

---

## After both arms (evaluation — not automatic)

| Observation | Reading |
|---|---|
| A still `-32600` with PID-linked `apple.cfprefs.*` deny; B clears `-32600` and shows no PID-linked cfprefs deny | H1 supported (syntax/runtime grant may still leave a **later** startup blocker) |
| B still `-32600` with PID-linked cfprefs deny | H1 falsified or grant incomplete |
| Either arm lacks PID-linked cfprefs signal | `inconclusive_pid_unlinked` — do not claim H1 |
| B clears sync then hits a new startup error | Next sequential blocker — document; not containment |

---

## Offline prep already recorded

See `odd/tasks/codex-cfprefs-shm-diagnostic.md` (syntax checks + test evidence).
Apple `system.sb` precedent validates `(ipc-posix-name…)` **syntax only**.
