# PROJECT TEAM: real model entitlement + self-explaining selections

## Objective

Close the gap where Claude models are treated as eligible from a static documented catalog, and make every PROJECT TEAM pick explain itself (including when the operational pick differs from the quality leader).

## Problem

A–D verified against code: no per-model Claude entitlement; ordinary winners have `reason: null`; `projectTeam` is efficient not quality; orchestrator has no capability profile.

## Why

Denied models (e.g. Fable 5.1 on Pro) must never enter automatic pools. Humans need readable reasons and honest quality-leader context.

## Scope

1. Claude entitlement probe + disk cache (additive, no behavior change)
2. Entitlement gates recommendation/automatic pools + route gate
3. `/models --verify-access [--refresh]` + one-line preflight notice
4. Selection explanations + quality leader visibility + honest labels

## Out of scope

- Dynamic routing / escalation
- Project-specific capability weights (future)
- Real Orchestrator RoleProfile (footnote only)

## Constraints

- Do not extend `claude-models.js` (hot sync path)
- Do not change `checkCandidate` signature
- Entitlement orthogonal to `accessMode`
- Probes sequential, never `Promise.all`
- `snapshot()` never spawns entitlement probes
- Fail closed: transient 529 → unverified, never denied/allowed

## TDD

- Mode: ordinary functional checks (`node --test`)
- Source: project convention (no strict TDD flag required for this feature)
- Runner: `npm test`

## Tasks

- [x] INC1-01 Add `claudeEntitlementPath` to `harnessHomePaths`
- [x] INC1-02 Implement `claude-model-entitlement.js` (classify + probe + sequential batch)
- [x] INC1-03 Implement `claude-entitlement-store.js` (read/write/resolve/merge + TTL + subscription invalidation)
- [x] INC1-04 Fixtures + unit tests RED→GREEN for probe and store
- [x] INC1-05 PR Increment 1 → CI → merge → release
  - PR: https://github.com/Kal-elSam/harness/pull/307 (awaiting CI)
- [x] INC2-01 Catalog identity: `entitlement` + `entitlementReason`; filter pools
- [x] INC2-02 `resolveProjectRoute` live entitlement gate (step 3.5)
- [x] INC2-03 Service plumbing (cache read only; no probe on snapshot)
- [x] INC2-04 Bootstrap analyzer denied sibling check
- [x] INC2-05 Regression tests RED→GREEN + PR/release
- [x] INC3-01 `verifyClaudeEntitlements` + `/models --verify-access [--refresh]`
- [x] INC3-02 Preflight one-line unverified notice
- [x] INC3-03 Tests RED→GREEN + PR/release
- [x] INC4-01 `explainTeamDecision` + refactor `modelsExplainLines`
- [x] INC4-02 `projectTeamEvidenceLines` + availability helper
- [x] INC4-03 Overlay / compact panel / honest subtitle / Orchestrator footnote
- [x] INC4-04 Tests RED→GREEN + PR/release

## Acceptance

- Denied Claude models excluded from recommendation + automatic pools
- Unverified recommendable but never auto-launchable
- `/models --verify-access` cost statement before any spawn; no re-probe without `--refresh`
- Every projectTeam row has a non-empty explanation; quality leader + retention when they differ
- Full `node --test` green after each increment

## Progress

- Created: 2026-09-19
- INC1–3 released (0.26.1 / 0.27.0 / 0.28.0)
- INC4-01…03 done on `feat/claude-model-entitlement-inc4` (1912 tests ×3 green)
- Next: INC4-04 PR/release 0.29.0
