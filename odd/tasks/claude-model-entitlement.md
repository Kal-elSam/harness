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
- Unverified Claude models are manual-only: excluded from Project Analyst and PROJECT TEAM recommendations, quality leaders, orchestrators, and fallbacks
- `/models --verify-access` cost statement before any spawn; no re-probe without `--refresh`
- Every projectTeam row has a non-empty explanation; quality leader + retention when they differ
- Full `node --test` green after each increment

## Increment 5 — PROJECT TEAM trust flow

User feedback invalidated the previous `unverified recommendable` contract and the always-expanded dashboard evidence. The feature is reopened with these coordinated corrections:

- [x] INC5-01 Make unverified Claude candidates manual-only while preserving them in the explicit role-edit catalog with a credit/access warning
  - Evidence: `buildScoredCandidatePools` derives entitlement-safe recommendations and explicit manual selections from one hydration pass; service/project catalogs preserve `entitlement` + `entitlementReason`; focused suite passed 143/143 (`node --test test/model-candidate-catalog.test.js test/project-strategy.test.js test/conversation-service.test.js`).
- [ ] INC5-02 Route `/project analyze` through the same interactive overlay flow used by first analysis and overlay re-analysis
- [ ] INC5-03 Reduce the persistent PROJECT TEAM panel to role/model/provider plus concise strategy status; keep selection evidence in the overlay's explicit evidence view
- [ ] INC5-04 Run targeted tests and full `npm test`; record observed evidence
- [ ] INC5-05 Commit each verified work unit and record commit identities

### Increment 5 delivery

- Authorized scope: the three user-confirmed corrections above; no access-path/provider/environment refactor
- Forecast: 180–300 authored changed lines, generated files excluded
- Delivery strategy: `ask-on-risk`; forecast is below the ~400-line chaining threshold, so one feature branch and one PR slice
- RDD: disabled/unmanaged (`gentle-ai review mode status`, default source)
- TDD: ordinary functional checks; source remains project convention; runner `npm test`
- Next step: implement INC5-02 to unify the analysis flow, then simplify the panel

## Progress

- Created: 2026-09-19
- INC1–4 complete and released (0.26.1 / 0.27.0 / 0.28.0 / 0.29.0)
- Reopened: 2026-09-19 after verified 0.29.0 user feedback
- Current branch: `fix/project-team-trust-flow`
