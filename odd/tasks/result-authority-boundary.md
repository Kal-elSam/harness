# Result authority boundary (host-neutral)

## Objective

Verify `reviewRef` compatibility, distinguish approval provenance from Gentle authority, bind official Gentle candidate/context when published, and prepare association on the kernel `WorkResult` contract without inventing envelopes or approval fallbacks.

## Problem

`authority: gentle` on `reviewRef` marks receipt provenance, not that work was approved. Team-strategy approve and any non-empty advisory id (`advisoryReceiptId`; `rev-*` is conventional for `kairo review`, not enforced) can be confused with Gentle. Candidate/context from status was dropped. Claude is freezing a host-neutral result/summary contract; Cursor must prepare the authority seam on that shape.

## Why

Delivery requires a verifiable authority boundary independent of host (Pi/Cursor/Claude IDE). No invented Gentle envelope; no approve/reject fallback.

## Scope

- Extend `mapOfficialReviewStatus` to pass through applicability/action/candidates
- Extend association return with `approval` + `gentleContext` (reviewRef v1 unchanged)
- Accept kernel `WorkResult` and Claude contract statuses (`completed`|`failed`|`cancelled`) without editing kernel
- Docs + focused tests
- Tracker `odd/tasks/result-authority-boundary.md`

## Non-goals

- Invent approve/fail/reject verdicts
- Spawn Gentle review / judgment-day
- Wire DAG/delegations / productive execution
- Edit `src/global/kernel/**`
- Overwrite Claude’s `odd/tasks/kernel-work-result-contract.md`

## Constraints

- Pass-through only for Gentle fields
- Advisory never becomes approval provenance `gentle_receipt`
- Team strategy approve is orthogonal, never review authority
- Terminal work status never grants approval by itself
- Host-independent: kernel `WorkResult` + contract-shaped results + minion result
- Association never mutates the input result object

## Acceptance criteria

- [x] `reviewRef` v1 fields unchanged for prior offline cases
- [x] Approval provenance distinguishes none / gentle_receipt / advisory / team_strategy
- [x] Official candidates/applicability/action bound when Gentle publishes them
- [x] WorkResult association works with nullable summary
- [x] No invented approval boolean/verdict
- [x] `completed` / `failed` / `cancelled` associate without mutation; none approve from finish or `authority: gentle` alone
- [x] Advisory/official, RDD off, unavailable re-verified
- [x] Tests green + selective commit (no kernel, no productive wiring)
- [x] Integrated check against Claude-committed `isWorkResult` / `createWorkResult` (`363480a0f`)

## TDD

- Mode: strict
- Runner: `node --test test/kairo-control-plane-review-association.test.js test/kairo-control-plane-review-status.test.js`

## Tasks

- [x] RA-1 Tracker + RED tests for provenance / candidate / WorkResult
- [x] RA-2 mapOfficialReviewStatus candidate/context pass-through
- [x] RA-3 approval + gentleContext association (reviewRef compatible)
- [x] RA-4 Docs + commit
- [x] RA-5 Compatibility with Claude contract statuses; no approval from terminal/authority alone
- [x] RA-6 Re-verify advisory/official + RDD off + unavailable; evidence + local commit
- [x] RA-7 Post-Claude-commit: association against real `isWorkResult` (no obsolete wait)

## Progress

- 2026-10-05: opened from Cursor plan “resultado y autoridad”.
- 2026-10-05: boundary implemented; 14 pass with status suite.
- 2026-10-05: contract status coverage + no-mutation; preserved Claude kernel tracker untracked.
- 2026-10-05: corrected docs — `advisoryReceiptId` is any non-empty string (`rev-*` not enforced). Association tests use non-empty WorkResult summary for dirty/real contract compatibility.
- 2026-10-05: Claude landed `363480a0f` + closed `kernel-work-result-contract.md` (`6ee6f3767`). Integrated association suite now asserts `isWorkResult` on `createWorkResult` completed/failed/cancelled; obsolete “await Claude commit” expectation removed.

## Verification evidence

- `node --test test/kairo-control-plane-review-association.test.js test/kairo-control-plane-review-status.test.js`: 19 pass (2026-10-05), including non-`rev-*` advisory id.
- Post-integration (2026-10-05): association + status + persistence lock suites: 28 pass (includes `isWorkResult` integrated cases).

## Next step

Optional DAG/`delegations[]` wiring still without inventing verdicts or productive Gentle spawn. Not authorized here.
