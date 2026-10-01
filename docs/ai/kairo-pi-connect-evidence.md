# Kairo Pi connect evidence (simulated Pi)

How to prove, from recorded protocol, that approval leads to an Architect `set_model` and an explicit engine state. All evidence here is labeled **simulated Pi**.

## What it proves

- The host wiring: `team.approve` (real UI keys + real conversation service) -> `loadKairoProviderModels` -> `resolveArchitectRouteForRpc` -> `set_model` (provider `kairo`, Architect model id) -> `get_state` -> an explicit `engine` record.
- Every case is asserted from recorded events, never from screen absence:
  `sidecar.jsonl` (the exact stdout JSONL the Ratatui host read) and `fake-pi-requests.jsonl` (every request the fake Pi received).
- The harness itself: a missing `ready` or `engine` record is an explicit FAIL (timeout), never an inferred pass.

## What it does NOT prove

- The published `@kal-elsam/kairo-pi-coding-agent`, or any real Pi process.
- A real provider, real credentials, or Architect launchability on a real machine (adapter availability is injected through the existing `resolveAdapter` seam).
- ASK answers or analysis (ASK is independent of the engine).

A real-Pi run needs fresh authorization; see `docs/ai/kairo-packaged-approved-team-plan.md`.

## Pieces

| File | Role |
| --- | --- |
| `scripts/fixtures/kairo-ui-tee-sidecar.mjs` | Wrapper sidecar around the real `runKairoUiRpcStdio`. Copies stdout bytes unchanged to `<EVIDENCE_DIR>/sidecar.jsonl`; writes stderr to `sidecar.stderr.log`, redacted. `KAIRO_PI_MODE=real` injects nothing (used by the packaged approved-team e2e). |
| `scripts/fixtures/sidecar-evidence.mjs` | Tee + JSONL parse helpers (unit-tested). |
| `scripts/fixtures/fake-pi-child.mjs` | Instrumented fake Pi child (`get_state`, `set_model`, `get_messages`); behaviors `connected`, `set-model-fail`, `placeholder`, `silent`, `silent-set-model`. |
| `scripts/fixtures/simulated-pi-host.mjs` | Scenario table, strategy seeding (no analyst), and the options injected into the real sidecar. |
| `scripts/seed-simulated-suggested-team.mjs` | CLI around the seeding, used by the PTY harness. |
| `scripts/kairo-sidecar-evidence.py` | Python side: `wait_for_ready` (25 s, explicit `EvidenceTimeout`), `wait_for_record`, `requests_of_type`. |
| `scripts/kairo-ui-simulated-pi-connect-pty-e2e.py` | PTY harness over the scenarios below. |

## Scenarios

| Scenario | Expected engine state and cause |
| --- | --- |
| `positive` | before approval `no_model` (not required connected); after `A`: fake Pi got `set_model` `{provider: kairo, modelId: codex::sim-architect-1}`, then `engine` `connected` with the same model id/provider/label |
| `no-architect-route` | `no_model`, "No Architect assignment ..."; no `set_model` |
| `unlaunchable-route` | `no_model`, "No active strategy with automatic launchable projectTeam routes"; no `set_model` |
| `set-model-fails` | `no_model`, "... set_model failed: ..." |
| `placeholder-model` | `no_model`, "No model selected" |
| `silent-get-state` | `ready.engine` `unavailable`, "timed out waiting for get_state" |
| `silent-set-model` | `no_model`, "set_model failed: ... timed out waiting for set_model" |

## Run

```bash
# Node level (fast): tee/parse helpers, wrapper transparency, all scenarios
node --test test/sidecar-evidence.test.js test/kairo-ui-tee-sidecar.test.js test/simulated-pi-connect.test.js
python3 scripts/test_kairo_sidecar_evidence.py

# PTY level (local rebuild only)
cargo build --release --manifest-path crates/kairo-ui/Cargo.toml
KAIRO_UI_BINARY=$PWD/crates/kairo-ui/target/release/kairo-ui \
  python3 scripts/kairo-ui-simulated-pi-connect-pty-e2e.py
# one scenario: KAIRO_SIM_PI_SCENARIOS=positive ; evidence dir: KAIRO_PTY_EVIDENCE_DIR
```

Artifacts land under `KAIRO_PTY_EVIDENCE_DIR` (default `<tmp>/kairo-simulated-pi-connect/<scenario>/`), never in the repo. The harness uses a temp `HOME`/`HARNESS_HOME` and `PATH=/usr/bin:/bin`, so no provider CLI is reachable.

## Known limits

- The fake Pi answers `set_model` with `name == modelId`; the real route name (`<display> · Architect`) is not reproduced.
- `team.approve` with the strategy already refused emits `Team active: undefined roles.` (observed; tracked in `odd/tasks/kairo-pi-connect-evidence.md`, not changed here).
