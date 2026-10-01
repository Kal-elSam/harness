# Kairo Pi connect evidence — instrument and verify approval -> Architect -> set_model -> engine state

Locator: `odd/tasks/kairo-pi-connect-evidence.md`
Worktree: `agentic-harness-worktrees/kairo-pi-connect`
Branch: `feat/kairo-pi-connect-evidence` (base `f0305570c`, Cursor integrated tip)
Engram mirror: `odd/kairo-pi-connect-evidence/tasks` (project `harness`)

## Objective

Make the host's Pi engine status observable and testable end to end, so approval, Pi connection and ASK answer are proven separately. The packaged approved-team run (`59fc20358`) produced an ASK answer but no evidence of `engine.status`: `ready_line()` is a stub returning `None`, the sidecar stdout is not captured, and the pass criterion is a visual proxy.

## Problem (verified)

- `scripts/kairo-ui-packaged-approved-team-pty-e2e.py`: `ready_line()` returns `None`; the "engine/team ready" check reads screen text only; docstring claims "engine connected" PASS.
- ASK is independent of the engine (`decide_submit`), so an ASK answer cannot discriminate engine state.
- The in-host approval path (`team.approve` -> `applyEngineAndMaybeTranscript({reapplyArchitect:true})`) was never exercised by that e2e (approval was seeded before launch).

## Scope

### In
1. Transparent sidecar tee to `sidecar.jsonl` (stdout untouched), separate redacted stderr log; wait on the real `ready` event, not on screen text.
2. In-host approval: a suggested strategy prepared WITHOUT calling the analyst, approved through the real UI and service; instrumented FAKE Pi child that records `set_model` and `get_state`.
3. Cases: automatic launchable Architect (positive), empty model list, `set_model` failure; timeout or missing protocol = explicit failure. Do not require `ready=connected` before approval.
4. Reuse `loadKairoProviderModels` seams; no new catalog or policy.

### Out
- Production behavior changes (only if a demonstrated defect needs it; then stop and report).
- Real providers, credentials, network, repeating the authenticated prompt, published Pi. A real run needs new authorization.
- Cursor's keyboard evidence work and files Cursor is editing.

## Constraints

- Strict TDD (RED -> GREEN), runners: `node --test <files>`, `cargo test --manifest-path crates/kairo-ui/Cargo.toml`, PTY e2e with a REBUILT binary.
- Evidence must be labeled **simulated Pi**: validates harness and wiring, does not certify the published Pi.
- Never infer "connected" from absence of errors on screen.
- Claude owns `kairo-ui-packaged-approved-team-pty-e2e.py` for this change.

## Tasks

- [x] E1 — Sidecar tee + stderr log + wait-on-`ready` in the packaged e2e harness (replace the `ready_line()` stub).
- [x] E2 — Fake instrumented Pi + in-host approval flow; positive case: approval -> `set_model` to the expected Architect -> explicit `connected` event with coherent model identity.
- [x] E3 — Negative cases: empty list, `set_model` failure, timeout/missing protocol -> explicit status and cause.
- [ ] E4 — Rebuilt-binary PTY run, targeted tests and applicable suites; record hashes, checks and limits here and in the mirror.

## Acceptance

See the objective list: positive and negative cases proven from recorded protocol events; timeouts fail explicitly; evidence labeled simulated Pi; no providers/network; no "done" from a checkbox alone.

## TDD

Mode: strict (user global rule). Runners above.

## Delivery

Work-unit commits on `feat/kairo-pi-connect-evidence`, handed to Cursor by hash. No push/PR. RDD: native switch unchanged; risk assessed per commit; declined or omitted reviews are not approvals.

## Progress / evidence

- Worktree created from `f0305570c`; deps installed.
- **E1-E3 done (all evidence is simulated Pi: fake child, temp HOME/HARNESS_HOME, `PATH=/usr/bin:/bin`, no providers/network/credentials).**
  - Commits: `a426c5711` (tee + fake Pi + Node scenarios + packaged harness waits on real `ready`), `eb4421e08` (PTY simulated-Pi harness + seed + docs `docs/ai/kairo-pi-connect-evidence.md`).
  - RED (observed before code): `node --test test/sidecar-evidence.test.js` and `test/simulated-pi-connect.test.js` -> `ERR_MODULE_NOT_FOUND` (helpers/host missing); `test/kairo-ui-tee-sidecar.test.js` -> 2 failed (wrapper missing); `python3 scripts/test_kairo_sidecar_evidence.py` -> `FileNotFoundError` (module missing). GREEN after implementation: 5 + 8 + 2 Node tests, 7 Python tests.
  - Harness discrimination: sidecar that never emits `ready` -> `real ready event never arrived ... within 25.0s`, exit 1; mutant (positive with fake Pi failing `set_model`) -> 3 FAIL checks.
  - PTY run (rebuilt `crates/kairo-ui/target/release/kairo-ui`, all 7 scenarios): exit 0, evidence `/tmp/claude-501/sim-final/<scenario>/`. Positive `sidecar.jsonl`: `ready.engine` `no_model` ("No active strategy with automatic launchable projectTeam routes") -> `team` `team.approve ok` -> `engine` `connected` model `codex::sim-architect-1` provider `kairo`; `fake-pi-requests.jsonl`: `get_state, get_state, set_model {provider: kairo, modelId: codex::sim-architect-1}, get_state`.
  - Packaged approved-team harness (`kairo-ui-packaged-approved-team-pty-e2e.py`): `ready_line()` stub and screen proxy removed; now runs the real sidecar behind the tee (`KAIRO_PI_MODE=real`) and fails explicitly if `ready` is absent after 25 s, then asserts `ready.engine.status == connected`. NOT executed (needs authorization); only compiled and the auth-gate refusal (exit 2) checked.
  - Limits: fake Pi sets `name == modelId`; adapter launchability injected via `resolveAdapter`; approval uses the real service with provider probes disabled; PTY `silent-set-model` starts from an active strategy (the in-host approval path would wait the default 8 s `bridge.request` timeout).
  - **Production defect observed (not fixed, out of scope):** when `team.approve` is refused (`approveProjectStrategy` -> `{ok:false, reasons}`), `kairo-ui-rpc-stdio.js` (`team.approve` branch, ~L1875-1895) still emits `notice` "Team active: undefined roles." after the refused `team` record. Reproduced with `approveProjectTeam` stubbed to `{ok:false}`. Needs its own failing test + fix decision.

## Next step

E4 (parent): re-run the checks, decide on the refused-approve notice defect, and register the final hashes here and in the mirror.
