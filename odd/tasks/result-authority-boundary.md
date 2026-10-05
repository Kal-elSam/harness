# Result authority boundary (host-neutral)

## Objective

Verify `reviewRef` compatibility, distinguish approval provenance from Gentle authority, bind official Gentle candidate/context when published, and prepare association on the kernel `WorkResult` contract without inventing envelopes or approval fallbacks.

## Problem

`authority: gentle` on `reviewRef` marks receipt provenance, not that work was approved. Team-strategy approve and advisory `rev-*` receipts can be confused with Gentle. Candidate/context from status was dropped. Claude is freezing a host-neutral result/summary contract; Cursor must prepare the authority seam on that shape.

## Why

Delivery requires a verifiable authority boundary independent of host (Pi/Cursor/Claude IDE). No invented Gentle envelope; no approve/reject fallback.

## Scope

- Extend `mapOfficialReviewStatus` to pass through applicability/action/candidates
- Extend association return with `approval` + `gentleContext` (reviewRef v1 unchanged)
- Accept kernel `WorkResult` (`ok`, `workerId`, `summary` nullable)
- Docs + offline tests
- Tracker `odd/tasks/result-authority-boundary.md`

## Non-goals

- Invent approve/fix/reject verdicts
- Spawn Gentle review / judgment-day
- Wire DAG/delegations yet
- Change Pi `on()` / host injection
- Meaningful summary normalization (Claude ownership)

## Constraints

- Pass-through only for Gentle fields
- Advisory never becomes approval provenance `gentle_receipt`
- Team strategy approve is orthogonal, never review authority
- Host-independent: kernel `WorkResult` + existing minion result

## Acceptance criteria

- [x] `reviewRef` v1 fields unchanged for prior offline cases
- [x] Approval provenance distinguishes none / gentle_receipt / advisory / team_strategy
- [x] Official candidates/applicability/action bound when Gentle publishes them
- [x] WorkResult association works with nullable summary
- [x] No invented approval boolean/verdict
- [x] Tests green + selective commit

## TDD

- Mode: strict
- Runner: `node --test test/kairo-control-plane-review-association.test.js test/kairo-control-plane-review-status.test.js`

## Tasks

- [x] RA-1 Tracker + RED tests for provenance / candidate / WorkResult
- [x] RA-2 mapOfficialReviewStatus candidate/context pass-through
- [x] RA-3 approval + gentleContext association (reviewRef compatible)
- [x] RA-4 Docs + commit

## Progress

- 2026-10-05: opened from Cursor plan “resultado y autoridad”.
- 2026-10-05: boundary implemented; 14 pass with status suite.

## Verification evidence

- `node --test test/kairo-control-plane-review-association.test.js test/kairo-control-plane-review-status.test.js`: 14 pass.

## Next step

Claude freezes richer `WorkResult.summary` if needed; Cursor can then wire DAG/`delegations[]` using this boundary without inventing verdicts.
