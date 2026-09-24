# Kairo team auto-recovery

## Objective
When a provider subscription is limited, Kairo treats it as provider
availability, not as a defect of each model. It routes in-flight work to a
verified eligible fallback right away, re-analyzes the project once per
availability change, and activates the recomputed team automatically, but
only when that analysis succeeds and the availability it was built for is
still current. It never claims tokens are exhausted when the evidence only
shows a temporary window limit.

## Problem (verified 2026-09-23 on main 1b27571)
- An ACTIVE team whose provider becomes ineligible degrades per role to
  WAIT_FOR_PROJECT_TEAM. `resolveProjectRoute`
  (`conversation/project-router.js:150`) deliberately never substitutes: "no
  automatic substitution; confirm the suggested alternative". Nothing
  re-analyzes, marks the team stale, or recomputes it.
- `checkCandidate` (`intelligence/execution-router.js:213`) reports "Codex/
  Claude quota nearly exhausted (X% left)" from a windowed remaining percent,
  which presents a temporary window limit as exhaustion. OpenCode Go already
  says "rate-limited".
- Pi routes are registered once per session: `registerRoutes` is guarded by
  `registered` (`host/extension/index.js:187`) and never refreshed after a
  team change.
- Blocked-role notices repeat on every refresh by design
  (`host/workspace-widget.js:352`, `notifyBlockedRoles` in
  `extension/index.js:150`).
- `/project analyze` has only a UI-instance re-entrancy guard
  (`cockpit/project-overlay.js:236`). There is no project-level lock, so an
  automatic trigger could race a manual analysis.
- There is no periodic availability poll. Refreshes happen at Pi
  `session_start` and on every `/kairo*` command.

Side finding: `selectExecutionProvider` is dead code (`service.js:541`), so
its WAIT_FOR_APPROVAL gate does not run in production. `classifyEffort` is
live only through `selectAskProvider` (the model tier for asks). The PR
descriptions of #341 and #342 overstated their effect on execution routing,
and the premise of the paused effort-tier design ("the effort tier picks the
execution model") holds only for asks.

## Scope and decisions
- ONE eligibility source: the snapshot `eligibility` built from
  `checkCandidate` (`service.js:727`) keeps feeding both recommendations and
  `resolveProjectRoute`. Denied or unverified entitlement and PAYG (Zen) stay
  excluded everywhere.
- Automatic substitution applies ONLY to availability blocks
  (`eligibility.ok === false`), using the role's stored fallback when
  `routableAlternative` accepts it. Entitlement blocks (denied/unverified)
  keep today's confirm-first behavior. This reverses a prior deliberate
  decision; the user authorized it in the plan.
- Trigger points: the existing refreshes (Pi `session_start` phase 2 and
  `/kairo*` commands). No new timer or poller.
- "Availability change" = a change in the per-provider availability
  fingerprint (ok vs limited, plus the limiting window). Exactly one
  re-analysis per project and fingerprint, guarded by a project-level lock
  that the manual `/project analyze` path also respects.
- The analyst must be eligible under the NEW availability and keep the file
  isolation `/project analyze` already requires (Codex sandbox, Claude
  restricted, Cursor sandbox).
- Activate only when the analysis succeeds AND the fingerprint at completion
  equals the fingerprint that triggered it. Otherwise keep the previous
  strategy and its usable fallbacks. Never activate from a failed check.
- If no provider is usable, say so precisely. Never invent availability.

Out: new polling, changing entitlement probing, reviving
`selectExecutionProvider`, and non-team routing.

## Constraints
- Node 20 compatible (CI 20/22/24).
- No PAYG and no unverified access, even as fallback.
- Behavior-first tests with fake adapters. No real provider calls in tests.

## TDD
Mode: off (no explicit project/session config). Runner: `node --test`.
Tests are written first anyway (RED observed before each change).

## Delivery
Branch: feat/kairo-team-auto-recovery (from main 1b27571). RDD: off (default).
Forecast: ~900-1,100 authored lines across R1-R8. Delivery: `ask-on-risk`, and
the user chose chain strategy **feature-branch-chain** (2026-09-23): recovery
is only safe complete, so nothing reaches main in pieces.
- Tracker: `feat/kairo-team-auto-recovery` (this doc), with a draft/no-merge
  tracker PR to main, merged only after R8 passes.
- PR 1 `feat/kairo-team-auto-recovery-01-foundations` -> tracker: R1, R2
  (window-limit wording, availability fingerprint). +257/-14.
- PR 2 `feat/kairo-team-auto-recovery-02-analysis-lock` -> PR 1: R3 (project
  analysis lock). +288/-53, mostly the analysis body moved unchanged into a
  helper.
- PR 3 `feat/kairo-team-auto-recovery-03-recovery` -> PR 2: R4, R5
  (availability fallback, recovery orchestration).
- PR 4 `feat/kairo-team-auto-recovery-04-pi-notices` -> PR 3: R6, R7, R8
  (Pi route refresh, deduplicated notices, end-to-end).
Each slice targets <=400 changed lines; any overage is reported, not squeezed.
The first plan had R1-R3 in one slice; at 612 changed lines it was split into
PR 1 and PR 2 before any PR was opened.

## Tasks
- [x] R1 — Availability wording (1bd7116). `checkCandidate` names the limiting
  window and its reset ("Codex weekly window is limited (2% left, resets …)")
  and returns a structured `limit` {provider, window, remainingPercent,
  resetsAt} for Codex, Claude, and Go. Cursor's visible warning says "limit
  reached" (its internal EXHAUSTED status matches ANY limit text, including
  rate limits). Tests were written first (5 RED, then GREEN). The 5 existing
  tests that pinned "nearly exhausted"/"quota exhausted" were updated because
  the requirement changes that text. Full suite 2147 pass / 0 fail / 1
  skipped; the touched suites pass 281/281 on Node 20.14. +95/-14.
- [x] R2 — Availability fingerprint. `availabilityFingerprint(eligibility)`
  gives a sorted, stable key per provider: ok, limited:<window>, or
  unavailable. Remaining percent and reset time are ignored so plain
  refreshes never look like a change. `availability-recovery-store.js`
  persists the last fingerprint acted on per project
  (sessions/<projectKey>/availability-recovery.json). Tests 7/7 RED -> GREEN
  on Node 22 and 20.14.
- [x] R3 — Project analysis lock (53c157f). `project-analysis-lock.js` takes an
  exclusive-create lock under sessions/<projectKey>/, which holds across
  processes. A lock whose holder process is dead, or that is older than 10
  min (the analyst timeout is 180 s), is taken over once. A stale holder's
  late release never frees the new holder's lock. The manual
  `runBootstrapAnalysis` takes it (owner "manual") and refuses to start
  while it is held. "At most one automatic re-analysis per fingerprint"
  moves to R5, which owns the recovery-store check. Tests: lock 4/4; service
  +2 (refuses while held and never touches the analyst; releases on
  failure); 9 existing analysis tests got an in-memory granted lock because
  they use a fake homeDir. Full suite 2160 pass / 0 fail / 1 skipped;
  touched suites 152/152 on Node 20.14.
- [ ] R4 — Availability fallback in `resolveProjectRoute`: ROUTED to the
  stored fallback on availability blocks only, labelled as a temporary
  fallback. Entitlement blocks are unchanged.
- [ ] R5 — Recovery orchestration: on a fingerprint change, pick an eligible
  isolated analyst, re-analyze, rebuild the strategy, re-check the
  fingerprint, and activate or keep the previous strategy. Cases covered:
  success, analysis failure, availability changing mid-analysis, unverified
  entitlement, no usable provider.
- [ ] R6 — Pi routes refresh when the active team changes (replace the
  one-shot `registered` guard safely).
- [ ] R7 — Notices: one notice per (provider, window) stating the recovery
  applied or the real blocker; no repeats on later refreshes.
- [ ] R8 — End-to-end check: OpenCode Go limited with Codex/Claude available
  means no new Go assignment, the new team is active, and Pi can run its
  routes. Strategy, routing, service, host, and full suites; Node 20.14 on
  the touched tests.

## Acceptance criteria
- Simulated Go limited with Codex or Claude available: no new assignment uses
  Go, the recovered team is active, and Pi routes resolve to it.
- Availability changes during analysis, failed analysis, unverified
  entitlement, and no usable provider all keep the previous strategy and say
  why.
- Repeated refreshes trigger no duplicate analysis and no repeated notice.
- No message claims exhaustion from a window-limited signal.

## Next step
Open PRs 1-2 (plus the tracker), then R4 on feat/kairo-team-auto-recovery-03-recovery.
