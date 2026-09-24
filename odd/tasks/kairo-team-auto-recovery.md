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
- PR 3 `feat/kairo-team-auto-recovery-03-availability-fallback` -> PR 2: R4
  (availability fallback in resolveProjectRoute). +108/-27.
- PR 4 `feat/kairo-team-auto-recovery-04-team-recovery` -> PR 3: R5 (recovery
  orchestration) plus the review fix for bounded retries. ~+545/-25: over
  budget, of which ~355 lines are tests. There is no cohesive smaller cut (the module, its tests, and the
  wiring belong together), so it is reported, not squeezed.
- PR 5 `feat/kairo-team-auto-recovery-05-pi-notices` -> PR 4: R6, R7
  (Pi recovery trigger, route sync, grouped notices). +317/-63.
- PR 6 `feat/kairo-team-auto-recovery-06-end-to-end` -> PR 5: R8 (end-to-end
  test). +144.
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
- [x] R4 — Availability fallback (49643c4). On an availability block,
  `resolveProjectRoute` returns ROUTED to the stored fallback that
  `routableAlternative` accepts, with assignmentSource
  "availability-fallback", `blockedAssignment` naming the replaced model, and
  why "... temporarily unavailable (...) — uses its fallback ... until the
  team is recovered". Entitlement blocks still only suggest and ask for
  confirmation; a human override (no stored fallback) keeps waiting. Tests
  that pinned "never substitute" for availability were rewritten, and the
  confirm-flow tests moved to an entitlement block so that flow stays
  covered. The new service tests fail on the old router (verified). Full
  suite 2163 pass; Node 20.14 123/123.
- [x] R5 — Recovery orchestration (86224a2). `team-recovery.js` (pure; I/O
  injected) plus `service.recoverProjectTeam({cwd})`. It recovers only an
  ACTIVE team, once per fingerprint (claimed as "started" before analyzing).
  On first sight with nothing affected it records a baseline and does not
  analyze. It skips without claiming when the lock is held, so a later
  refresh retries. Analyst priority: available + scored + entitled; quality,
  then efficient, then any other. The recovery analysis runs with
  `persist: false` (NEW flag on runLockedBootstrapAnalysis), so the active
  team is never overwritten before verification. The team is activated only
  if the analysis succeeds, the fingerprint is unchanged after it, and at
  least one role is routable; overrides carry over; activation records
  {source, fingerprint}. Every failure keeps the previous team and records
  the reason. Known limit: snapshot usage probes are cached (60 s
  Codex/Claude, 5 min Go); a change hidden by the cache becomes a new
  fingerprint on a later refresh. Tests: module 13/13 (success, failure,
  availability changed mid-analysis, no analyst / unverified, no usable
  provider, lock held, once per fingerprint, overrides kept); service
  wiring 1, which first failed on an incomplete fixture profile and
  correctly kept the previous team. Full suite 2177 pass / 0 fail / 1
  skipped; Node 20.14 137/137.
  REVIEW FIX (7b6a374, user review 2026-09-24): a failed recovery recorded
  its fingerprint like a success, so every later refresh skipped it and a
  transient failure left the team unrecovered. Now only
  activated/baseline close a fingerprint. Failed, crashed ("started"), or
  superseded attempts retry on a later refresh: at most 3 attempts per
  fingerprint, 10 then 20 min backoff, then `retries-exhausted` with
  `lastOutcome` (R7 surfaces it as a notice pointing to /project analyze).
  The attempt count is persisted in the recovery store, so the bound holds
  across processes. Tests +4 (retry after backoff and not before; bounded
  at 3 with exhausted reported; crashed attempt retried; decide matrix);
  store round-trips `attempts`. Full suite 2181 pass / 0 fail / 1 skipped;
  Node 20.14 120/120.
- [x] R6 — Pi recovery trigger + route sync (15875e4). Verified in Pi's own
  types (core/extensions/types.d.ts): `registerProvider` "Register or
  override", `models` replaces the provider's models, and after load it
  "takes effect immediately"; `unregisterProvider` exists. The one-shot
  `registered` guard became `registerRoutes` sync: unchanged set -> no
  re-register; changed -> re-register; empty -> unregister (no stale
  route). Fresh live availability at session_start phase 2 starts
  `recoverKairoProjectTeam` (workspace-snapshot.js; never throws). It is
  not awaited by session_start (it can run an analysis for minutes) and is
  exposed as `extension.recovery()`. An activated team re-syncs routes and
  re-renders. No recovery runs when the live probe failed.
- [x] R7 — Notices (15875e4). Blocked team rows carry the provider's
  structured `limit`. `availabilityNotices` (replaces the per-role, every-
  refresh `blockedRoleNotifications`) groups roles per provider+window
  (window limit) or provider+warning (entitlement/Cursor). Only FRESH live
  refreshes notify: a key is shown once while it lasts and again after it
  clears and returns. Command/first-paint refreshes neither notify nor
  forget. Recovery outcomes are notified once per (fingerprint, outcome,
  reason): activated (info, role -> model), kept-previous/error (warning:
  reason, retries later, manual next step), retries-exhausted (warning:
  last outcome, manual next step); quiet outcomes stay quiet. The notice
  text only claims automatic recovery, never a fallback it cannot
  guarantee.
- [x] R8 — End-to-end (8bf6c63): the real extension + service recovery +
  runTeamRecovery + route loader over one in-memory store; only probes,
  analyst, and storage are faked. Go limited with Codex/Claude available:
  no new Go assignment, the recovered team is active (activation source
  automatic-recovery), Pi routes resolve to it (none to Go), exactly one Go
  window notice, nothing says "exhausted", and one analysis. Repeated
  refreshes: no second analysis, no repeated notice. Full suite 2190 pass /
  0 fail / 1 skipped; the touched host + recovery suites pass 86/86 on Node
  20.14.

## Acceptance criteria
- Simulated Go limited with Codex or Claude available: no new assignment uses
  Go, the recovered team is active, and Pi routes resolve to it.
- Availability changes during analysis, failed analysis, unverified
  entitlement, and no usable provider all keep the previous strategy and say
  why.
- Repeated refreshes trigger no duplicate analysis and no repeated notice.
- No message claims exhaustion from a window-limited signal.

## Next step
All tasks done. User reviews and merges PRs 1-6 into the tracker in order, then the tracker (#344) into main.
