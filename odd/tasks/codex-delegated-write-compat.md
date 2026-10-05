# Codex delegated write — CLI compatibility + OS wrapper evaluation

## Objective

Executable offline canary protocol ready for later authorization. Oracle
consumes evidence only. **`verifiedEffective` stays false.** No live run,
credential copy, promotion, or startRun wiring in this tranche.

## Acceptance

- [x] Protocol: exact SBPL profile, disposable paths, capture before/during/after
- [x] `verifiedEffective: false` / `approval: false` on protocol + oracle
- [x] Offline suites green (denial = linked tool/process error; executed required)
- [x] RDD for Cursor canary range assessed via Gentle (separate from Claude B-1/B-2 decline)

## Protocol entry

- Code: `prepareDelegatedWriteCanaryProtocol` → `src/global/runtime/codex-delegated-write-canary-protocol.js`
- Doc: `docs/codex-delegated-write-canary-protocol.md`

## RDD (Cursor range — Gentle)

Scope tip `c37ed2347` (containment/canary commits), base `95477e794`, agent
`codex` (Cursor runtime itself is **unassessable** for immutable receipts).

| Field | Value |
|---|---|
| risk | high |
| review_due | true (`high_risk`) |
| reason | `process_boundary` on `codex-delegated-sandbox.js` (`shell_process`) |
| changed_paths / lines | 14 / 1496 |
| receipt | **none** — review not started; consent not requested this turn |
| vs Claude B-1/B-2 | **Separate candidate.** Claude’s `declined` on `c37ed2347..9d6d283b5` is **not** reused here |

`agent=cursor` assess: unassessable (immutable receipt runtimes: claude-code, opencode, codex only).

## TDD

`node --test test/codex-delegated-write-os-wrap.test.js`

## Next step

1. User authorization for live canary under the protocol command (separate).
2. Fresh Gentle consent if/when this Cursor range review starts — do not reuse Claude’s decline.
3. Only after a live `contained` with linked tool denials: consider `verified_effective` (separate owner decision).
