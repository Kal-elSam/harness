# Codex cfprefs SHM diagnostic (offline prep)

## Status

**OFFLINE PREP CLOSED for authorization ask.** Profile delta helper + PID-linked
capture plan + two-arm grant package exist. **No live arm run yet.** No
production profile change, no promotion, no wiring.

## Objective

Prepare a controlled diagnostic that changes **only** the observed
`ipc-posix-shm-read-data` names `apple.cfprefs.<uid>v1` and
`apple.cfprefs.daemonv1`, keeping binary, model, auth, and every other SBPL
grant identical to run `delegated-write-20261005T123142`.

## Arms (authorization count = 2)

| Arm | Profile | Why it is a live arm |
|---|---|---|
| A — control | Run-3 baseline unchanged | Historical run-3 lacked PID linkage; control must be re-captured |
| B — treatment | Baseline + exact cfprefs SHM read-data allow only | Isolated delta under test |

Grant package: `docs/codex-cfprefs-shm-diagnostic-authorization.md`.
Do **not** ask for a single-run grant that pretends Arm A is already covered.

## Syntax validation (not a Codex proof)

- Exact rule form uses `(ipc-posix-name "…")` under `(allow ipc-posix-shm-read-data …)`.
- Offline `sandbox-exec` accepts the rule when appended to the run-3 profile
  (`/usr/bin/true` exits 0; typo filter unbound-variable exits non-zero).
- Apple precedent: `/System/Library/Sandbox/Profiles/system.sb` grants
  `(ipc-posix-shm-read* (ipc-posix-name-prefix "apple.cfprefs."))`.
  That validates filter syntax only — **it does not prove** Codex `-32600`
  clears.

### Recorded checks (2026-10-05, host uid 501)

| Check | Result |
|---|---|
| `node --test test/codex-delegated-write-canary-cfprefs-diagnostic.test.js` | **6 pass / 0 fail** |
| run-3 baseline `profile.sb` sha256 | `e07a911b9a650e048513af9a08c1038d7a3a4e4cc068c98c9a24ad7ef8926269` |
| baseline + exact cfprefs rule sha256 | `52ab51d657320ffd1a0c1c3574d862f4564d93ee61d1e554b94b34ad77df71d1` |
| `sandbox-exec -f <variant> /usr/bin/true` | exit **0** (parse+exec) |
| typo `ipc-posix-name-TYPO` | exit **65**, stderr `unbound variable` |
| allow-ops delta vs baseline | **+1** (`ipc-posix-shm-read-data` block only) |
| Apple `system.sb` contains `apple.cfprefs.` prefix grant | **true** (syntax witness) |

## PID-linked capture (corrected)

1. Bounded window: `startedAt..endedAt` plus pad (default 2s each side).
2. Offender identity from each Sandbox event: `process(pid)` parsed from the
   line — never link by process name alone.
3. Observed tree: `{ pid, ppid, comm }` for `sandbox-exec` and descendants.
4. Link `offenderPid ∈ treePids`. Foreign-PID cfprefs events in the same wall
   window ⇒ noise / `inconclusive_pid_unlinked` when nothing links.

## Code

- `src/global/runtime/codex-delegated-write-canary-cfprefs-diagnostic.js`
- `test/codex-delegated-write-canary-cfprefs-diagnostic.test.js`
- Capture checklist notes in `codex-delegated-write-canary-protocol.js`
- Protocol doc note in `docs/codex-delegated-write-canary-protocol.md`
- Auth ask: `docs/codex-cfprefs-shm-diagnostic-authorization.md`

## Explicitly out of scope until authorized

- Live Arm A / Arm B runs
- Allowing `apple.shm.notification_center` or `vfs.disk-space`
- Broad `ipc-posix-name-prefix "apple.cfprefs."` in the canary profile
- Changing `buildDelegatedWriteSandboxProfile` production grants
- Promotion / `verifiedEffective` / host wiring

## Experiment design (consolidated 2026-10-05; design only, nothing executed)

Hypothesis H1: the `ipc-posix-shm-read-data` denials on `apple.cfprefs.<uid>v1` and `apple.cfprefs.daemonv1` are what makes Codex fail with `thread/start failed: failed to load configuration: Failed to synchronize managed preferences (code -32600)` under the canary sandbox profile. Status today: correlation (same-millisecond kernel denials, no file-read denial in that run) plus elimination among logged denials; **not demonstrated**.

### Two arms

| Arm | Profile | Purpose |
|-----|---------|---------|
| A (control) | Baseline = the run-3 profile verbatim | Must reproduce the -32600 signature and the cfprefs denials now |
| B (treatment) | A + exactly the rule from `buildCfprefsShmReadDataAllowRule` (appended by `appendCfprefsDiagnosticDelta`) | Tests whether clearing only those two denials clears the failure |

- Identical in both arms: Codex binary (path and sha256 recorded), pinned model, account/session, the same `CODEX_HOME` and `TMPDIR` locations, the same command line as run 3 except profile path and prompt, the same prompt.
- The profile difference must be verified, not asserted: `profilePermissionsOtherwiseIntact(baseline, variant)` is true and a diff shows only the added rule. `apple.shm.notification_center` and `system-info vfs.disk-space` are NOT allowed in B; they are expected to stay denied in both arms (they also appear for unrelated processes) and are not part of the decision.
- Run A and B back to back in one short interval (A first, then B) so managed-preference and cache state are as close as possible. Record start/end ISO timestamps for each.

### Prompt (same in both arms, no writes)

Diagnostic prompt, identical text in A and B, for example: `Reply with the single word OK. Do not run any command and do not create, modify or delete any file.` It is NOT the containment canary prompt, and the write oracle is not used to decide anything here (its verdict is inconclusive by construction while startup fails).

### Success criterion for B (all required together)

1. Process exit code `0`.
2. stdout JSONL contains a real agent response: an `item.completed` event with `item.type == "agent_message"` and non-empty `text` (the event shape the repo's Codex parsers already use). A `turn.started` event alone is not enough.
3. No cfprefs denial linked to the observed process tree in B's sandbox-log window (see PID-linked capture), while A shows them linked. This absence counts as evidence only when capture coverage is complete (see Evidence contract); otherwise it is unknown, not clean.

The absence of the `-32600` message alone is NOT success. Exit 0 without an `agent_message`, or an empty/whitespace response, is not success.

### State confounders (record all; none may be silently ignored)

- **Provider-home state without copying credentials.** Nothing is copied. Both arms use the same isolated `CODEX_HOME` in place. Before and after each arm record a manifest of relative paths, sizes, mtimes and sha256 (for the auth file only its hash, never its content). If the manifest before B differs from the manifest before A (Codex may write caches or logs during A), list the exact files and downgrade any confirmation to "confirmed with state caveat".
- **Order effect.** A runs before B on the same home; the manifest comparison above is the only mitigation in a two-arm design. A third arm (A again after B) would remove it but is not required here.
- **Binary and model drift:** binary sha256 and the pinned model must match across arms; a mismatch invalidates the comparison.
- **Managed-preference and cache state (cfprefsd/MDM):** can change between arms; the short back-to-back interval and recorded timestamps are the control.
- **Provider/network variance:** affects only whether B succeeds after startup; it cannot explain the presence or absence of the startup signature.
- **Log volatility:** capture and preserve the unified-log extract for each arm immediately, with `buildSandboxLogWindow` and raw lines kept unmodified.
- **PID linkage:** decide only on events whose offender PID belongs to the observed process tree (`freezeObservedProcessTree`, `linkSandboxEventsToObservedTree`). Never link by process name alone. Foreign-PID cfprefs events in the same window are noise and yield `inconclusive_pid_unlinked` if nothing links.

### Using the historical run as arm A

Run `delegated-write-20261005T123142` MAY be cited as supporting precedent but **it is not a contemporaneous control**: it used the containment canary prompt (with write requests) instead of the diagnostic prompt, ran at a different time, and its provider-home state and PID window are not comparable to B's. If it replaces a fresh A, the strongest verdict available is "consistent with H1, not confirmed"; a "confirmed" verdict requires a contemporaneous A with the same prompt, binary, model and home.

### Evidence contract: capture coverage (fixed before any run)

Each arm's sandbox-log evidence is in exactly one of three states, and the verdict must say which:

- **Linked-present:** at least one cfprefs denial whose offender PID is in the observed tree. Presence is positive evidence even if coverage is otherwise incomplete.
- **Absent with complete coverage:** zero tree-linked cfprefs denials AND every coverage check below holds. This is valid evidence of absence.
- **Unknown coverage:** any coverage check fails or cannot be evaluated. Absence in this state is NOT "clean"; any verdict that depends on absence becomes `inconclusive_capture_incomplete`.

Coverage is complete only if ALL hold for the arm (record the result of each):

1. **Extraction ran in full:** the log query covered the whole padded window (`buildSandboxLogWindow`), exited without error, and returned Sandbox kernel lines for some process (an empty window is unknown, not clean; arm A's window is expected to contain them).
2. **Identity recorded:** real `startedAt`/`endedAt` from the spawn, the spawned `sandbox-exec` PID recorded as `sandboxExecPid`, and a non-empty observed tree. A tree that missed the short-lived process (the earlier runs lasted ~10-125 ms) is unknown coverage.
3. **Parser accountability, no silent drops:** every extracted line containing `Sandbox:` is either parsed into an event or listed as unparsed with its raw text, so raw count = parsed + listed-unparsed. Any unparsed line mentioning `cfprefs` or `ipc-posix-shm` makes coverage unknown (it could be the missing denial).
4. **Positive control:** the contemporaneous arm A shows tree-linked cfprefs denials through the same pipeline, proving the capture can see them. If A shows none, the experiment is already inconclusive (A did not reproduce).
5. **Raw evidence preserved:** the unmodified log extract and the raw lines are saved for each arm.

A clean B stays valid: B is never required to show a denial. A B with exit 0 + `agent_message` + zero tree-linked cfprefs denials **and complete coverage** is a valid confirmation of H1 for this startup failure; the same B with unknown coverage is `inconclusive_capture_incomplete`.

Implementation status: **not implemented.** `parseSandboxOffenderEvents` returns only the lines it matches (non-matching lines are dropped silently), and nothing computes coverage or the verdict, so checks 1-5 and the decision table are applied by hand and recorded in the evidence until code does it. The native review's advisory ids on the parser (`R3-parser-first-line-only`, `R4-parser-silent-miss`) are recorded, without descriptions, in `odd/tasks/kernel-run-spawn-bridge.md`; they point at the same risk and are for this plan's owner.

### Decision table (fixed before any run)

| A (contemporaneous) | B | Verdict |
|---|---|---|
| -32600 + cfprefs denials linked to the tree | success criterion met (exit 0 + agent_message + no linked cfprefs denial, with complete capture coverage) | H1 confirmed for this startup failure under this profile (necessity shown; no claim about later blockers or about containment) |
| same | same -32600 with NO linked cfprefs denials AND complete capture coverage | H1 refuted: those denials are not the cause |
| same | any outcome whose reading depends on "no linked cfprefs denial" while capture coverage is incomplete or unknown | `inconclusive_capture_incomplete`: absence is not evidence without complete coverage (a B that exited 0 with an `agent_message` is still recorded as an observation) |
| same | -32600 AND linked cfprefs denials still present | Invalid arm: the rule did not take effect (check syntax/uid); no verdict |
| same | -32600 gone but exit != 0 or no agent_message | Inconclusive: record the new blocker; H1 partially supported (that error cleared), not confirmed |
| A does not show -32600 | any | Inconclusive: the failure did not reproduce; no verdict |
| cfprefs events present but none linked to the tree | any | `inconclusive_pid_unlinked` |

**Do not confuse:** B with **no** tree-linked cfprefs denials (treatment applied / clean allow path) is **not** `inconclusive_pid_unlinked`. That label is only when cfprefs events exist but fail tree linkage. Target denial still present on B ⇒ **invalid arm**, not evidence against H1. `-32600` with treatment applied, valid capture, and **no** linked cfprefs deny ⇒ **evidence against H1**. "Valid capture" means complete coverage per the Evidence contract; a clean B with complete coverage is valid and is never required to show a denial, while absence under unknown coverage is `inconclusive_capture_incomplete`, not clean.

## Authorization and cost (not granted)

- Nothing here is authorized to run. Earlier grants are consumed and do not apply.
- Needs one explicit grant for this two-arm experiment that names the model and the account/session, and states there is no credential copy. A should fail at startup before any model call; B makes one real model call with a trivial prompt only if startup clears (and A would too if it unexpectedly cleared).
- Any adoption of the cfprefs allowance in the real canary profile is a separate decision for the canary owner: the repo's startup classifier deliberately records this failure as an unidentified resource with no preference-permission expansion, and this variant must remain a scratch diagnostic profile.

## Next step

Wait for the explicit grant above. Then write the variant with `appendCfprefsDiagnosticDelta`, capture with `buildPidLinkedSandboxCapturePlan`, run A then B, and judge with the decision table in this document. B-4 and B-5 of the bridge stay stopped regardless of the outcome.
