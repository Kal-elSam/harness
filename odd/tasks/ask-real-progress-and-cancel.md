# ASK real progress, effective cancel and restorable history

Feature document (ODD). Parent feature: `odd/tasks/ratatui-host.md` (branch `feat/ratatui-host`, chain strategy `feature-branch-chain`). Created 2026-09-28.

## Objective

Keep the daily chat path `prompt -> service.submitTask -> askQuestion -> askProvider` and make it show **real provider progress according to each provider's capabilities**, cancel the correct in-flight execution, and restore the visible history. Do **not** require incremental text where an adapter only delivers a final answer, and do **not** route the chat through Pi to claim behaviors of another route.

## Problem (verified in code)

- `askProvider` (`src/global/intelligence/quick-ask.js:340`) has no `signal`/`onEvent`; the sidecar `prompt` handler is one `await`, so nothing is emitted while a turn runs.
- `abort` only forwards a Pi abort (`kairo-ui-rpc-stdio.js:1191`); Rust Esc only aborts when `is_streaming`, which is false during ASK, so Esc does nothing for ASK.
- Session switch/new/fork/stop do not touch an in-flight ASK; its late `task_result` renders in whatever session is now active; children can outlive the sidecar; `child.kill()` hits the direct PID only.
- ASK answers never enter Pi history, so they are lost on switch/restart/resume (`ask-history.json` has no ids/ordering).
- ASK Codex runs `codex exec --sandbox read-only ... -o <file>` (read-only; distinct from execution `workspace-write` and Bootstrap).

## Scope and constraints

- Authorized by the user (2026-09-28): implement this plan as-is, local commits only. No push/PR/merge, no remote ops, no sandbox permission widening, no credential reads, no provider/quota calls during development (mocks and injected spawn only). One real validation later needs **separate** authorization.
- ASK/PLAN/AGENT keep their rules. `askProvider` is shared with Bootstrap/project-analysis: default behavior with no `signal`/`onEvent` must stay byte-identical (existing arg-vector assertions unchanged; Codex keeps `-o` as the source of truth and adds `--json` only when `onEvent` is set; never `--approve-for-me`).
- R8 stays **partial**; total parity NOT declared.
- ~400 authored changed lines per task is a planning heuristic only.

## Resolved mode

- TDD: **strict** (source: project config / `odd/tasks/ratatui-host.md`). Runner: `node --test` (JS), `cargo test` in `crates/kairo-ui` (Rust; `unset CARGO_TARGET_DIR`). RED observed before implementation, then GREEN.
- Full suite once at the delivery boundary, not per iteration: `node --test --test-timeout=120000 <npm test globs>` + `cargo test`.

## Delivery

- Strategy: `feature-branch-chain` (already chosen for the U-plan); commits accumulate on `feat/ratatui-host`. Forecast: ~700-900 authored lines across A1-A5 (exceeds 400) -> slice boundaries below; each slice is a candidate for a later PR under the tracker branch. No push without a separate authorization.
- Slices: S1 = A1+A2 (JS provider events + cancel plumbing); S2 = A3 (Rust reducer/Esc); S3 = A4+A5 (persistence/restore + PTY mock).
- Native RDD: after each work-unit commit run `gentle-ai review assess --base-ref <last reviewed boundary> --committed-only --json`; medium/high relays the consent envelope; record the assessed tier and outcome per task.

## Tasks

- [x] A0 Diagnosis corrected in the parent doc (ASK route = `askProvider`, read-only Codex; distinguish incremental text vs tool activity vs final answer) — commit `bd27215d8`
- [x] A1 quick-ask: optional `{signal, onEvent}` on `askProvider` and adapters; process-group kill with TERM->KILL escalation and bounded wait; Codex `--json` only when `onEvent` set (`-o` stays source of truth); OpenCode JSONL already incremental -> emit events; Claude/Cursor: final answer only (no fake streaming). RED->GREEN in `test/quick-ask.test.js`
- [ ] A2 service + sidecar: thread `{signal,onEvent}` through `submitTask`/`askQuestion`; one active ASK with `AbortController` and `turnId`/`sessionId`; emit `provider_event` records `{turnId, sessionId, seq, provider, kind: progress|text|tool_start|tool_end|error|cancelled|done}`; `abort`, session switch/new/fork and `stop` cancel the ASK and wait for child close; ignore late/foreign-session events; a cancelled turn is never stored or shown as a successful answer; no duplicate `task_result`+`notice`; Pi abort kept for Pi-owned ops. Tests in `test/conversation-service.test.js`, `test/kairo-ui-rpc-stdio.test.js`
- [ ] A3 Rust: `provider_event` branch in the ingest chain (+ exclusion list), `ChatState::apply_provider_event` reusing the existing reducer, `ask_in_flight` flag (not `is_streaming`), Esc sends `abort` during ASK, cancelled/error rows, final answer rendered once. Inline `#[cfg(test)]` tests
- [ ] A4 Persistence/restore: per-Kairo-session append-only `ask-events.jsonl` (monotonic `seq`, `turnId`, `at`, Pi anchor), one user + one terminal record per turn, merged with Pi rows on restore without replacing or duplicating; `ask-history.json` stays the prompt-context source and `/clear` clears both. Restore reproduces the same visible sequence
- [ ] A5 PTY mock: extend the mock sidecar with `prompt`/`abort`; cancel ends the child and restores the terminal (alt-screen leave, exit 0) at 60/100/160
- [ ] A6 Close: full suite once (JS + Rust), update R8/acceptance wording in the parent doc, record tiers/outcomes; real Codex validation requires a separate authorization

## Acceptance criteria

- Codex ASK shows only events the CLI really exposes; adapters without incremental events show activity plus a single final answer, no artificial streaming, no duplicates.
- Esc/abort during ASK terminates the provider process tree (TERM then KILL after a bounded wait); late events are ignored; a cancelled turn is not saved as a success.
- Session switch/new/fork/quit during ASK cancel it without leaking children or rendering into the wrong session.
- Restore replays the same visible sequence (text, tools, errors, cancellation), with prior Pi history preserved, in order, without duplicates.
- Bootstrap/project-analysis behavior of `askProvider` unchanged when no options are passed.

## Progress

- (2026-09-28) Feature document created after read-only mapping of the ASK path (call chain, adapters, cancellation gaps, Rust reducer, persistence). No source written yet.
- (2026-09-28) A1 done: `askProvider` accepts optional `{signal,onEvent,killGraceMs}`; detached spawn + process-group TERM->KILL only with a signal, distinct `cancelled` result, Codex `--json` only with `onEvent` (`-o` stays the answer source), OpenCode text/error events, Claude/Cursor start+final only. Evidence: RED = new tests hung/failed against the old code (run cut by `--test-timeout`); GREEN = `node --test test/quick-ask.test.js` 32/32 (18 existing unchanged + 14 new), plus conversation-service 96, bootstrap-analyzer-adapters 21, codex-sandbox 25, project-analysis 13, sanitized-snapshot 9, all passing. **UNVERIFIED:** the Codex `exec --json` event schema (item.started/completed, item types, turn.failed, error) follows the documented schema as best known and was NOT checked against the real CLI; the mapping lives in one place (`mapCodexEvent` in `quick-ask.js`) and must be confirmed with `codex exec --help` or a real run at the separately authorized real validation.

## Next step

A1 (delegated writer, strict TDD): `askProvider` `{signal,onEvent}` + process-tree cancel, then A2.

## Route declaration

- A1: delegated writer (2 non-trivial files: `quick-ask.js`, `test/quick-ask.test.js`; preparation reading). A2: delegated writer (service.js, rpc-stdio, tests). A3: delegated writer (Rust). A4/A5: delegated writers. Trigger: writer trigger (2+ non-trivial files).
