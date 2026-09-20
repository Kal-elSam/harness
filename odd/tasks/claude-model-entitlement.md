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
  - Commit: `962a558` (`fix(project-team): fail closed on access`)
  - Evidence: `buildScoredCandidatePools` derives entitlement-safe recommendations and explicit manual selections from one hydration pass; service/project catalogs preserve `entitlement` + `entitlementReason`; focused suite passed 143/143 at this commit in isolation (`node --test test/model-candidate-catalog.test.js test/project-strategy.test.js test/conversation-service.test.js`). Re-run after INC5-02/03 touched the same shared test files (`project-strategy.test.js`, `conversation-service.test.js`): now 139/139 — no regression, the count itself shifted because those two files gained/lost assertions in later commits, not because this commit's own logic changed.
- [x] INC5-02 Route `/project analyze` through the same interactive overlay flow used by first analysis and overlay re-analysis
  - Commit: `4d0b0b3` (`fix(project-team): unify analysis flow`)
  - Evidence: `/project analyze` opens `ProjectOverlay` with `forceReanalyze`, bypassing suggested/active/stale strategies before initialization so exactly one preflight runs. The parallel `pendingProjectAnalysis` + `/project analyst` text state machine and its dead dashboard state were removed. Explicit unverified Claude choices now carry a visible picker tag and confirmation warning that extra credits may be required; denied candidates remain excluded by the catalog contract from INC5-01.
  - Check: focused cockpit/strategy/service suite passed 278/278 (`node --test test/project-overlay.test.js test/cockpit-app.test.js test/cockpit-view.test.js test/project-strategy.test.js test/conversation-service.test.js`).
- [x] INC5-03 Reduce the persistent PROJECT TEAM panel to role/model/provider plus concise strategy status; keep selection evidence in the overlay's explicit evidence view
  - Commit: `dfcd73a` (`fix(cockpit): simplify project team panel`)
  - Evidence: the dashboard now renders only Project Analyst, Orchestrator, and required operational role assignments with aligned model/provider columns plus the existing suggested/stale status line. The always-visible operational-picks introduction, Orchestrator footnote, quality-leader/retention lines, and per-role availability warnings were removed. `projectTeamEvidenceLines` remains unchanged and retains quality, retention, fallback, decision, and availability evidence behind the overlay's explicit `e evidence` control.
  - Check: focused view/overlay suite passed 123/123 (`node --test test/cockpit-view.test.js test/project-overlay.test.js`).
- [x] INC5-04 Run targeted tests and full `npm test`; record observed evidence
  - Full suite: 1912/1912 passing (`node --test`), verified independently after all three commits.
- [x] INC5-05 Commit each verified work unit and record commit identities
  - `962a558` fix(project-team): fail closed on access — 7 files, +231/-43
  - `4d0b0b3` fix(project-team): unify analysis flow — 11 files, +147/-301
  - `dfcd73a` fix(cockpit): simplify project team panel — 3 files, +24/-47
  - Total: 13 unique files, +393/-382 = 775 authored changed lines
  - Delivery: `feature-branch-chain` — three PR slices, each preserving its own commit, retargeted to `main` as the prior slice merges (merge commits, not squash, matching this stream's own #307-#310 pattern)

### Increment 5 delivery

- Authorized scope: the three user-confirmed corrections above; no access-path/provider/environment refactor
- Actual: 775 authored changed lines across 13 files (additions + deletions) — over the ~400-line planning heuristic once all three commits were counted together
- Delivery strategy: `feature-branch-chain` — each of the three real commits ships as its own PR slice, chained onto the previous, merged with a real merge commit (not squash); only the last slice retargets to `main`
- RDD: disabled/unmanaged (`gentle-ai review mode status`, default source)
- TDD: ordinary functional checks; source remains project convention; runner `npm test`
- Next step: open the three chained PRs, get Node 20/22/24 CI green on each, merge in order, then release 0.29.1

## Progress

- Created: 2026-09-19
- INC1–4 complete and released (0.26.1 / 0.27.0 / 0.28.0 / 0.29.0)
- Reopened: 2026-09-19 after verified 0.29.0 user feedback
- Increment 5 code complete, full suite green (1912/1912), task doc closed: 2026-09-20
- Current branch: `fix/project-team-trust-flow` — pending PR chain + 0.29.1 release
