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

- U3 evidence (strict TDD, evidence-first; U3 stays UNTICKED because item (b), real provider ASK events, is still NOT-VERIFIABLE locally; item (a) was later verified, see the real Pi cold start entry below):
  - No-model startup, sidecar/bridge layer: `bridge no_model` (missing Architect, `set_model` failure) and the sidecar `ready` `no_model` record are VERIFIED-NO-GAP (existing tests in `test/pi-rpc-bridge.test.js`, `test/kairo-ui-rpc-stdio.test.js`; Rust `engine.rs` renders `Chat blocked: no_model — <reason>`). JSONL errors (`success:false` + `error`) reach `engine.reason` verbatim: VERIFIED-NO-GAP.
  - Startup stderr: FIXED. RED: `node --test test/pi-rpc-bridge.test.js` failed 2 tests (reason was only `Agent process exited with code 1`, stderr was discarded in `attachChild`). Fix: bounded (2000 chars) stderr tail appended to exit/error reasons in `src/global/host/pi-rpc-bridge.js`. GREEN: pi-rpc-bridge + kairo-ui-rpc-stdio 115 pass / 0 fail.
  - ASK/Pi event shapes vs vendored fork types (`AgentEvent`, `AssistantMessageEvent` in `third_party/pi/packages/{agent,ai}/src/types.ts`; `agent_settled` exists in `rpc-mode.ts`): field names (`assistantMessageEvent.delta`, `.error.errorMessage`, `toolCallId`, `toolName`, `partialResult`, `result`, `isError`) match `apply_sidecar_event`: VERIFIED-NO-GAP. Two Rust regression tests added with full-envelope fork-shaped records (lifecycle records ignored, no phantom rows; aborted stream error row). Both passed on first run (no fix needed). Cargo: 331 pass / 0 fail.
  - ASK own `provider_event` flow (answer, error, cancel, switch, quit, restore): covered by `ask-real-progress-and-cancel` tests plus the fake-provider PTY e2e; no new mismatch demonstrated.
- U3 NOT-VERIFIABLE: (a) [SUPERSEDED: verified and fixed on 2026-10-01 with the authorized real Pi cold start, commit `50f9b4984`; the published package returns a placeholder model, not an explicit `no_model`]; (b) STILL PENDING: any real provider (Codex `exec --json` schema, Claude, Cursor, OpenCode) ASK events, thinking/tools presence. Needs separate user authorization for provider/network use; a bounded plan is in `docs/ai/kairo-parity-provider-plan.md` (not executed).

- U4 closing evidence (parent, HEAD `3d5945702`): `pnpm test` full Node suite: 2421 tests, 2409 pass, 6 fail, 6 skipped. `cargo test --manifest-path crates/kairo-ui/Cargo.toml`: 331 pass / 0 fail. The 6 Node failures also fail identically on the base `56c530cf2` (re-run on a detached worktree: analyst-ranking-trace, analyst-preflight-analyze-wire, conversation-service, analyst-catalog-evaluation; 126 tests, 120 pass, 6 fail on both). They are inherited from the Cursor baseline (analyst area), not caused by this branch, and not fixed here (out of scope, owned by Cursor).
- Commits delivered to Cursor: `f30f4c2c0` (U1), `10dd3bd02` + `a066e4fd3` (U2), `3d5945702` (U3 stderr fix); tracker docs `f1ba9b69f`, `af4297086`, `bbc0e261d`, `03e019165`.
- Native review: U1 and U2 candidates declined by the user; **U3 approved and acknowledged** (not pending consent). U1/U2 remain declined. Functional tests are not approval.
- Contracts: ops `ops.runs.show` -> `ops_run_show`, `ops.reviews.show` -> `ops_review_show`, `settings.setup.load|preview|apply` -> `settings_setup_load|preview|apply` (documented in the header of `kairo-ui-rpc-stdio.js`).
- NOT 100% functional: any real provider run (Codex, Claude, Cursor, OpenCode) is still pending authorization. Keep **stderr remediation** ahead of authenticated provider tests. The 6 Node analyst failures Claude reported on `56c530cf2` were addressed on Cursor's integrate branch (T29 conversation-service + T27 test rewrite); they are not open on the integrated HEAD.
- Native review (sync): U1/U2 declined; **U3 approved + acknowledged** — do not list U3 consent as pending.

- U3 real Pi cold start (user-authorized 2026-10-01, local only): ran the published `@kal-elsam/kairo-pi-coding-agent@0.87.1-kairo.5` `--mode rpc --no-session --offline` in an isolated temp HOME/PI_CODING_AGENT_DIR, scrubbed env (no keys, no network use). Observed: `get_state` returns `success:true` with a PLACEHOLDER model `{id:"unknown",provider:"unknown",api:"unknown",...}` (not null); `prompt` returns `success:false` "No API key found for the selected model." Gap: `classifyPiEngineFromState` classified that placeholder as `connected`. RED: new test in `test/pi-rpc-bridge.test.js` failed (actual connected). Fix: treat the all-"unknown" placeholder as `no_model`; a real model with id "unknown" but another provider stays connected. GREEN: node pi-rpc-bridge + kairo-ui-rpc-stdio 116 pass / 0 fail; cargo 331 pass / 0 fail. Item (a) is now VERIFIED/FIXED — do not re-list as pending authorization. Item (b) real providers remains pending. Note: this published-Pi RPC check is **not** the same as an end-to-end packaged Kairo host (prebuilt `kairo-ui`) no-model path.

- U3 stderr redaction fix (integrated as `23ec9c4d9` / origin note `95d20f435`): `attachChild` now redacts the ASSEMBLED stderr window when the reason is formatted (new `redactText` in `src/global/runtime/run-redact.js`, reused, with tests), over a 8000-char raw window; a short leading partial token is dropped when the raw window was cut; surfaced tail stays <=2000 chars. RED: 4 new tests in `test/pi-rpc-bridge.test.js` failed (secret forms leaked, chunk split, boundary straddle, bounded). GREEN: pi-rpc-bridge + kairo-ui-rpc-stdio + run-redact 126 pass / 0 fail; cargo 331 pass. Addresses advisory findings R1-stderr-tail-unredacted and R4-stderr-chunk-boundary (and bounds R4 stderr-tail-lifetime). Other advisory findings remain open.

- Packaged-host no_model check: default = **integración con Pi simulado** (placeholder child). Real published-Pi variant authorized and **PASS** 2026-10-01 (`KAIRO_PACKAGED_NO_MODEL_REAL_PI=1`, offline, temp HOME, no credentials): mode `REAL_PUBLISHED_PI_OFFLINE`, `ready.engine.status=no_model`, UI `Chat blocked: no_model`. Observed reason: **"No active strategy with automatic launchable projectTeam routes"** — certifies host blocks chat without an active team; does **not** yet prove cold start with an approved team + usable provider (another `no_model` shape). Temp proj must be a git repo (extension/Architect); first attempt without `git init` correctly stayed `unavailable` (no silent sim). Missing CLI → exit 2, no sim fallback. Evidence: `/tmp/kairo-acceptance-prep/packaged-no-model-real-pi/`.

- U3 real-provider happy-path runs (user-authorized 2026-10-01; model/credential/commands in `docs/ai/kairo-parity-provider-plan.md`): Codex `gpt-6-luna` (ChatGPT login), Claude `claude-haiku-4-5` (claude.ai Pro login), OpenCode Go `opencode-go/space-bunny-free` (OpenCode Go api credential). One `OK` prompt each, exit 0, answer `OK`; real event shapes match the `quick-ask.js` parsers. Consumption seen: Codex 18 949 input tokens, Claude about $0.0093, OpenCode 24 621 tokens (cost 0). Verified only the success path. U3 stays UNTICKED: provider error paths, cancel/switch/quit/restore with a real provider, tool/thinking events and Cursor remain pending; Claude's `is_error` is not checked by the parser (risk from code reading, not observed).

- U3 Claude `is_error` defect (found by reading `quick-ask.js` after the real runs; confirmed with a fixture, no provider call): a clean-exit `{is_error:true, result:"..."}` was reported as `answered` and emitted as the final text. RED: `test/quick-ask.test.js` test 7 failed (actual `answered`, expected `error`) in `b72305be2`. Fix mirrors the Cursor guard already in the same file: `is_error === true` -> `error`, no `final` event. GREEN: quick-ask 33/33; Node full 2429 tests, 2417 pass, same 6 inherited failures. The real success shape (`is_error:false`) test is kept and passes.

- Review of range `75f54aecc..fd877dcc7` (8 files, 265 lines, target sha256:153cc9c5…9948; includes the unreviewed stderr redaction `23ec9c4d9` and the quick-ask `is_error` fix `fd877dcc7`): assessed `high` (process_boundary in pi-rpc-bridge.js); native review DECLINED for this candidate by the user (`declined_this_candidate`, target matched). OMITTED, not a functional failure and not an approval; no receipt. Reviewed boundary stays at `75f54aecc`.

## Next step

Close remaining delivery evidence without new features: (1) packaged approved-team→Claude haiku = **team+OK PASS, Pi `connected` NOT verified** (`docs/ai/kairo-packaged-approved-team-plan.md`; ASK `OK` ≠ Pi connected); compose first-key theft fixed locally (`odd/tasks/empty-compose-no-steal.md` — Editor keeps draft/history; Sidebar keeps nav shortcuts; no providers); (2) human product visual acceptance; (3) Cursor provider (still pending); (4) foreign-platform package runtime exec. Do **not** re-run Codex/Claude/OpenCode Go adapter `OK` prompts. Claude `is_error` fixture fix integrated (`b72305be2`/`fd877dcc7`); native review of redaction+`is_error` range **DECLINED** (OMITTED — covers the previously unreviewed redactor too). Cursor integrated Node suite stays authoritative over Claude's older 6 inherited analyst fails. Separate: "provider responds" ≠ "integrated product works with that provider".
