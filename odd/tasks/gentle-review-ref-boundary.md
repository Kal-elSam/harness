# Gentle reviewRef boundary

## Objective

Map the official Gentle control-plane bridge, define a read-only `reviewRef` association for work results, and pin offline cases that keep advisory Kairo receipts separate from Gentle authority.

## Problem

Delegation can finish with a minion result while review authority stays opaque. The control plane already maps Gentle status/`next_transition`, but results have no typed, read-only link. The local `kairo review` receipt can be mistaken for Gentle authority.

## Why

Kairo owns routing and cost; Gentle owns RDD consent, authority, and receipts. Without an explicit association contract, later delegation→review wiring will invent fields or elevate advisory receipts.

## Scope

- `src/global/control-plane/review-association.js` (new)
- `docs/gentle-companion.md` (bridge map + reviewRef contract)
- `test/kairo-control-plane-review-association.test.js` (offline cases)
- Reuse existing `mapOfficialReviewStatus` / provider states; do not spawn Gentle in these tests

## Non-goals

- Spawning `gentle-ai review` or judgment-day
- Injecting verdicts into Pi `on()` / hosts beyond association typing
- Changing `createMinionResult` required fields
- Orca UI reuse
- Shell/theme/pin work

## Constraints

- `next_transition` only when Gentle publishes it; never invent commands
- Advisory ids (`advisoryReceiptId`: any non-empty string; `rev-*` not required) never set `authority: gentle`


- Absent / RDD-off / incompatible → fail closed, no fabricated receipt
- Artifacts in English; Spanish only in chat

## Acceptance criteria

- [x] Bridge transitions documented against the live control-plane path
- [x] `reviewRef` is read-only and separable from advisory receipts
- [x] Offline cases green: pending, official, incompatible, unavailable, RDD off
- [ ] Focused tests pass; selective conventional commit

## TDD

- Mode: strict
- Runner: `node --test test/kairo-control-plane-review-association.test.js`
- RED observed: `ERR_MODULE_NOT_FOUND` for `review-association.js`, then GREEN (5 association + existing status tests).

## Tasks

- [x] GR-1 Map official bridge + transitions in docs
- [x] GR-2 `reviewRef` association API (tests first)
- [x] GR-3 Offline cases: pending / official / incompatible / unavailable / rdd_off
- [ ] GR-4 Commit + evidence

## Progress

- 2026-10-05: tracker opened for Cursor Gentle-boundary plan.
- 2026-10-05: association module + companion docs + 5 offline cases green.

## Verification evidence

- `node --test test/kairo-control-plane-review-association.test.js test/kairo-control-plane-review-status.test.js`: 10 pass.

## Next step

GR-4 selective commit. Later plans may attach `reviewRef` to DAG nodes / `delegations[]` without changing this contract.
