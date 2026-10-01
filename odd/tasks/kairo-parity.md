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
- [ ] U2 — Setup in Settings: load / preview / apply-confirmed (sidecar + dispatch) and Rust Settings panel flow. Route: delegated writer.
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
  - Commit hashes: see git log for `feat(kairo-ui-rpc): add ops.runs.show...` (single work unit).
- U1 limitations: run id validated with `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$` (custom ids outside it report invalid_id); events bounded to last 50 and projected to timestamp/type/summary only; Rust detail lines are not wrapped (long summaries are clipped by the panel width); no live provider check.

## Next step

U2 (setup in Settings).
