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

Scope tip `c37ed2347` (containment/canary commits), base `95477e794` /
tree `51c0e417…`, agent `codex` (Cursor runtime itself is **unassessable**
for immutable receipts).

| Field | Value |
|---|---|
| risk | high |
| review_due | true (`high_risk`) |
| reason | `process_boundary` on `codex-delegated-sandbox.js` (`shell_process`) |
| changed_paths / lines | 14 / 1496 |
| target_identity | `sha256:a84d4ebaa752870bc2158727f2dda3b88f9d40b7da041c2cdb4444d4fdfd943b` |
| lineage | `review-2c1545c135018126` |
| preflight | STATUS → START `--consent=relay` → **`consent_required`** (blocking) |
| receipt | **none** — waiting fresh human consent; Claude B-1/B-2 `declined` **not** reused |
| canary | protocol ready; no live run / credentials / promotion / wiring |

Note: Claude bridge B-3 assess `under_budget` is **not** approval and does **not**
advance this candidate’s reviewed boundary. Splitting plans does not reset the
last reviewed boundary arbitrarily.

## TDD

Suites already reported by agents this session — not re-run this turn.

## Next step

1. **Blocked on Gentle consent** for this Cursor canary candidate (see chat envelope).
2. Live canary still needs separate authorization after/alongside review choice.
3. `verified_effective` only after live contained evidence (separate owner decision).
