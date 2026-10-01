# Kairo Parity — native Settings setup and Operations run/review detail

Locator: `odd/tasks/kairo-parity.md`
Worktree: `agentic-harness-worktrees/kairo-parity`
Branch: `feat/kairo-parity` (base `56c530cf2`, Cursor integrated baseline)
Engram mirror: `odd/kairo-parity/tasks` (project `harness`)

## Objective

Complete functional parity inside the Ratatui host: setup lives in Settings (not Clack), and Operations shows navigable run and review detail. Claude owns setup, Settings, Operations and the wiring in `kairo-ui-rpc-stdio.js` plus the central Rust modules. Cursor integrates the resulting commits.

## Scope

### In
- Settings: setup load / preview / confirmed apply, reusing `setup.js` core (`buildSetupPreview`, `resolveAgentIds`, `validateComponentIds`, `installGlobalHarness`).
- Operations: `ops.runs.show(runId)` and `ops.reviews.show(receiptId)` over existing run and review stores.
- Sidecar dispatch and Rust panels/bridge for the above.
- Runtime differences: no-model startup, ASK real events (only demonstrated incompatibilities).

### Out
- Visual prototypes, session-handoff, context-fill (preserved in the dirty herd-shell tree)
- Push, PR, merge, real-provider runs without separate authorization
- Re-doing terminal semantics already fixed; simulated streaming

## Constraints

- No Clack inside Ratatui. Preview never writes config; cancel/reject applies nothing.
- Receipts are read-only, secret-free, no invented authority. Run events are redacted (`run-redact.js`); task text is digest only.
- Protocol: JSONL ops, unsolicited `{type: snake_case}` records, no request id; domain errors are `{ok:false, reason}`.
- Only Claude edits the sidecar and central Rust modules in this window.

## TDD

Mode: strict (user global rule). Runners: `node --test <files>`, `cargo test --manifest-path crates/kairo-ui/Cargo.toml`. RED must be observed before each implementation.

## Delivery

Work-unit commits on `feat/kairo-parity` handed to Cursor by hash. No PRs, so no chained-PR strategy applies. Forecast ~1000-1400 authored lines across units.
RDD: native switch unchanged; review assessed per commit; functional tests are not approval.

## Tasks

- [x] U1 — `ops.runs.show` + `ops.reviews.show`: Node (ops-mutations/sidecar/dispatch) and Rust (ops_panel/bridge/main). Route: delegated writer (6+ non-trivial files).
- [x] U2 — Setup in Settings: load / preview / apply-confirmed (sidecar + dispatch) and Rust Settings panel flow. Route: delegated writer.
- [ ] U3 — Runtime: no-model startup diagnostics; ASK real-event validation (limited to demonstrated gaps). Route: delegated, evidence-first.
- [ ] U4 — Full suites, docs of contracts, hashes and limitations recorded here and in the mirror.

## Acceptance

- Preview changes nothing; reject applies nothing; confirm applies through existing installer and refreshes Settings; errors visible.
- Detail navigable; unknown IDs give an honest error; run cancel confirmed; receipts read-only without secrets.
- "Done" requires observed checks, never a checkbox alone. Provider and remote checks stay pending without authorization; not declared 100% functional.

## Progress / evidence

- Base verified: `56c530cf2` exists; worktree created; `pnpm install --frozen-lockfile` OK.
- Extension points mapped: dispatch insert between `kairo-ui-rpc-stdio.js:1463` and `project.refresh` (:1465); `settings-sidecar.js:164` `setup` stub; Rust `handle_ops_keys`/`handle_settings_keys` in `main.rs`.

- U1 evidence (strict TDD):
  - RED node: `node --test test/ops-mutations.test.js test/kairo-ui-rpc-stdio.test.js` failed (2 fail): ops-mutations import error "does not provide an export named showOpsReview"; RPC dispatch test failed (no `ops_run_show` record).
  - GREEN node: ops-mutations + ops-sidecar + kairo-ui-rpc-stdio: 115 pass / 0 fail.
  - RED rust: `cargo test --no-run` failed to compile: unresolved `OpsDetail`/`OpsDetailKind`, no `OpsPickMode::RunDetail`/`ReviewDetail`, no `selected_run_id`.
  - GREEN rust: `cargo test --manifest-path crates/kairo-ui/Cargo.toml`: 306 pass / 0 fail.
  - Keys: Enter (normal mode) picks a run for detail, `v` picks a review, Enter opens, Esc closes detail then returns to hub; `c` cancel still requires y/n confirm. Hint string now `... d dismiss · Enter run · v review`; V3 ops fixtures regenerated (only 60x30-ops changed).
  - Commit: `f30f4c2c0` feat(kairo-ui): add ops.runs.show and ops.reviews.show with navigable detail (single work unit, 1012+/22-). Parent spot check re-ran node suites: 115 pass / 0 fail.
- U1 limitations: run id validated with `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$` (custom ids outside it report invalid_id); events bounded to last 50 and projected to timestamp/type/summary only; Rust detail lines are not wrapped (long summaries are clipped by the panel width); no live provider check.

- U1 review: assessed `high` (process_boundary in main.rs, 13 files, 1091 lines, base 56c530cf2). Native review DECLINED for this candidate by the user (`declined_this_candidate`, target sha256:ca4c9dab…). No receipt exists; functional tests are not approval. Reviewed boundary stays at 56c530cf2, so U2 is assessed over the accumulated range.

- U2 evidence (strict TDD):
  - RED node: `node --test test/settings-setup.test.js` failed (module `settings-setup.js` missing); `settings-sidecar.test.js` failed (no export `SETUP_WIRED_LABEL`); RPC dispatch test failed (no `settings_setup_*` records).
  - GREEN node: settings-setup + settings-sidecar + kairo-ui-rpc-stdio + ops-mutations: 125 pass / 0 fail; setup*/apply-confirmation/adapter-matrix: 43 pass / 0 fail (shared setup code untouched).
  - RED rust: `cargo test --no-run` failed to compile: unresolved `SetupFlow`/`SetupStage` (state machine tests), then `no field setup on SettingsPanelState` (main.rs flow tests).
  - GREEN rust: `cargo test --manifest-path crates/kairo-ui/Cargo.toml`: 329 pass / 0 fail. Two render tests (setup panel, confirm modal) were added after the implementation (no RED for those two).
  - Ops: `settings.setup.load|preview|apply` -> `settings_setup_load|preview|apply`. Apply needs `confirm:true` and a fingerprint equal to a freshly recomputed preview (`not_confirmed` / `stale_preview` otherwise); it goes through `installGlobalHarness` and `assertExplicitApplyConsent`. Preview is a dry run (tested: temp home tree unchanged).
  - Keys (Settings): `s` opens setup; Space/Enter toggle, `p` preview, `a` open confirm modal, `y` apply, `n`/Esc cancel (Esc steps back one stage and sends nothing); success re-requests `settings.snapshot`. Late/mismatched responses are ignored by stage + selection guards. Integration-confirm flow unchanged (regression test).
  - Hardened a flaky U1 test (`run_cancel_still_requires_explicit_confirm`) that raced the recorder's partial line writes.
- U2 limitations: apply is all-or-nothing through the existing installer (no per-file selection); preview change list capped at 200 entries; setup replaces the Settings body while open; no real-home apply was run (tests use a temp home); workspace component catalog uses the project root only.

- U2 review: range `bbc0e261d..a066e4fd3` (2 commits, 15 files, 1957 lines, target sha256:5413747b…35a1) assessed `high` (process_boundary in main.rs). Range includes the U1 test-race fix (`recorded_ops` -> `wait_for_op`). Native review DECLINED for this candidate by the user (`declined_this_candidate`, target matched). No receipt exists; functional tests are not approval. Spot check by the parent: cargo 329 pass, node 125 pass.

- U3 evidence (strict TDD, evidence-first; U3 stays UNTICKED because two items are NOT-VERIFIABLE locally):
  - No-model startup, sidecar/bridge layer: `bridge no_model` (missing Architect, `set_model` failure) and the sidecar `ready` `no_model` record are VERIFIED-NO-GAP (existing tests in `test/pi-rpc-bridge.test.js`, `test/kairo-ui-rpc-stdio.test.js`; Rust `engine.rs` renders `Chat blocked: no_model — <reason>`). JSONL errors (`success:false` + `error`) reach `engine.reason` verbatim: VERIFIED-NO-GAP.
  - Startup stderr: FIXED. RED: `node --test test/pi-rpc-bridge.test.js` failed 2 tests (reason was only `Agent process exited with code 1`, stderr was discarded in `attachChild`). Fix: bounded (2000 chars) stderr tail appended to exit/error reasons in `src/global/host/pi-rpc-bridge.js`. GREEN: pi-rpc-bridge + kairo-ui-rpc-stdio 115 pass / 0 fail.
  - ASK/Pi event shapes vs vendored fork types (`AgentEvent`, `AssistantMessageEvent` in `third_party/pi/packages/{agent,ai}/src/types.ts`; `agent_settled` exists in `rpc-mode.ts`): field names (`assistantMessageEvent.delta`, `.error.errorMessage`, `toolCallId`, `toolName`, `partialResult`, `result`, `isError`) match `apply_sidecar_event`: VERIFIED-NO-GAP. Two Rust regression tests added with full-envelope fork-shaped records (lifecycle records ignored, no phantom rows; aborted stream error row). Both passed on first run (no fix needed). Cargo: 331 pass / 0 fail.
  - ASK own `provider_event` flow (answer, error, cancel, switch, quit, restore): covered by `ask-real-progress-and-cancel` tests plus the fake-provider PTY e2e; no new mismatch demonstrated.
- U3 NOT-VERIFIABLE (pending authorization): (a) real installed-package Pi RPC cold start without `session.model` emitting an explicit `no_model` (needs a real `kairo-pi-coding-agent` run; fork fix is unpublished/unproven as cause); (b) any real provider (Codex `exec --json` schema, Claude, Cursor, OpenCode) ASK events, thinking/tools presence. Needs separate user authorization for provider/network use.

## Next step

U3 pending authorization for the two NOT-VERIFIABLE items above (local scope done), then U4.
