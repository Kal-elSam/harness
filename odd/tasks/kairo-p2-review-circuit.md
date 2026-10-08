# Kairo P2: automatic review → comments → correction (plan only)

Linked: `odd/tasks/kairo-one-window-offline.md` (P2 pending), `odd/tasks/kairo-readonly-p1.md` (P2 not authorized), `odd/tasks/kairo-global-connect.md` (T4 transitions + Gentle reader).

## Status

**Authorized slice: P2 safe observation, no execution.** Full automation (evidence-to-transition mapper, action executor) stays plan-only. This slice never starts reviews, corrections or providers, never advances review transitions automatically, never treats `next_transition` as evidence and never publishes executable commands.

Limits that remain: automating review transitions requires an official, verifiable Gentle contract binding receipt/task/run/candidate plus a specific authorization. Persistent memory being blocked by missing session identity is an environment matter, not relevant to this code.

### Authorized slice: objective and steps

Objective: make the persisted circuit and Gentle project context honestly observable per run.

1. Tracker records this authorized slice.
2. `transition-store.readTransitions(root, taskId, { runId })`: validate the whole file, then filter to the run; append requires a same-run predecessor; legacy read unchanged.
3. `service.js`: transitions and projections read for the CURRENT execution's `runId`; no execution means no old progress shown as the current circuit.
4. `operations.js`/`task-result.js`: project-level receipt/gate, `taskReview: "not_established"`, `task_binding_unavailable` diagnostic, `actionsEnabled: false`; no `next_transition`, no commands.
5. Tests, focused suites, full `npm test`.

Acceptance: run A never satisfies or advances run B; corruption anywhere still fails closed; re-read leaves the log byte-identical; no approval or review transition from project receipt/pending action; incompatible/unavailable/RDD-off disables actions.

### Checklist (ODD, direct inline; TDD enabled, runner `node --test <file>` / `npm test`)

- [x] P2-1 Tracker status (this edit).
- [x] P2-2 Store run isolation. RED: 3 of 6 new tests failed first; GREEN 19/19 with legacy suite. Commit 423bed7c5.
- [x] P2-3 Service passes `execution.runId`. RED observed by stashing service.js (5 failing); GREEN. Updated the legacy readTeam fake-store test to assert run-scoped reads.
- [x] P2-4 Observation projection (diagnostic, actionsEnabled, receipt/gate).
- [x] P2-5 Tests in `test/conversation-p2-observation.test.js` and `test/conversation-transition-run-isolation.test.js`; full `npm test`: 2828 tests, 2827 pass, 0 fail, 1 skipped (known pre-existing).
- [x] P2-6 Commits: 423bed7c5 (store isolation), 6dd0dacef (service + observation projection).

Route: direct inline (small, understood, 2 non-trivial source files; no delegation available/needed in this worker).

---

## Objective

Advance Kairo's persisted circuit after `result_observed` through native Gentle contracts:

`delegated → result_observed → review_authorized → comments_recorded → correction_recorded`

using **confirmed published evidence** bound to task + execution + candidate — never pending announcements alone.

## Key distinction (mandatory)

| Concept | Meaning | May write a Kairo transition? |
|---------|---------|-------------------------------|
| Pending action | Gentle `next_transition` says what to do next | **No** |
| Executed action | An authorized actor ran the verbatim Gentle command / human completed the step | **No** by itself |
| Confirmed evidence | Gentle publishes receipt/lineage/status proving that step completed, bound to this task's run + candidate | **Yes** (append only) |

Learning: pending ≠ executed ≠ confirmed evidence.

## Corrections to the prior prep plan

### C1 — Interrupted already observes a result

Today `readTaskResult` records `result_observed` whenever `composeTaskResult` returns `status: "terminal"` (`service.js` ~1761–1762). `interrupted` is a terminal run state (`TERMINAL_RUN_STATES`). So an interrupted execution **does** get `result_observed`.

"Result observed" means evidence was seen, **not** success. Stopping the review circuit on interrupt would be a **new product policy**, not an existing guarantee. P2 must decide explicitly (under authorization) whether interrupt/fail/cancel may enter review, or whether review requires a success-class terminal — and document that choice; do not pretend the store already blocks it.

### C2 — `next_transition` is not proof of completion

`next_transition` is a pending pointer. Recording `review_authorized`, `comments_recorded`, or `correction_recorded` **only because** Gentle advertised the next step is forbidden.

Required before each append:

- Published Gentle evidence (receipt id/digest, lineage, or equivalent official field from status/contract), not inventado.
- Binding to **this** `taskId`, **this** `runId` (execution link), and **this** review candidate / target identity Gentle published for that work.
- Fail closed if any bind is missing, ambiguous, or only project-scoped.

Project receipt / `gentle.state: project_receipt` / `taskReview: not_established` remain project context. They never approve a task and never alone justify a review-side transition.

### C3 — Who executes authorized actions

Two roles, both required for "automatic" end-to-end; do not conflate them:

| Role | Duty | May launch / mutate Gentle authority? |
|------|------|----------------------------------------|
| **Evidence sync (observer)** | Re-read Gentle status; map confirmed published evidence → append transition kinds; project next pending | **No.** Never start/grant/acknowledge/decline. |
| **Action executor** | When policy + user consent + RDD permit, run Gentle's **verbatim** `next_transition.execute.command` (or relay consent and stop) | **Yes, only** the exact published command, with candidate consent; never invent argv. |

A bridge that "only observes and never launches" can keep `transitions.jsonl` honest after humans or another actor finish steps, but **cannot** by itself complete automatic review → comments → correction. Full automation needs an explicit executor path (service/MCP/Pi op or control-plane primary), gated separately from the reader.

Default shape when authorized:

1. Observer: sync evidence → transitions (idempotent).
2. Executor: optional, consent-gated, verbatim Gentle only; after it finishes, observer re-reads and appends only on confirmed evidence.
3. Reader (`gentle-reader.js`) stays read-only forever; mutating seam is a different module/allow-list.

## Existing hooks (unchanged facts)

- Auto: `executePlan` → `delegated`; terminal `readTaskResult` → `result_observed` (incl. interrupt/fail/cancel/completed).
- Manual: `service.recordTransition` for external kinds only; no MCP/Pi tool today.
- Read: `gentle-reader.js` + `rdd-mode-reader.js`; mutating verbs refused.
- Association: `taskReview` always `not_established`; project receipt ≠ task approval.
- Store: ordered, idempotent per `(kind, runId)`, opaque evidence, corrupt fail-closed.

## Missing connections (implementation later)

1. Evidence→kind mapper with task/run/candidate binding (not `next_transition`-only).
2. Explicit product rule for which terminal classes may enter review (C1).
3. Action executor path distinct from observer (C3).
4. MCP/Pi surface only if authorized (observe sync vs execute Gentle step).
5. Projection gaps: `pubTaskResult` currently drops gentle `receipt` / `gate` / `nextTransition`.

## Idempotency, interruption, recovery

- Append still idempotent per `(kind, runId)`; never rewrite; out-of-order refused.
- Reconnect / re-read: zero provider launches; zero appends without new confirmed evidence.
- Mid-flight interrupt of executor: no transition until Gentle publishes completion evidence; re-status and sync.
- Corrupt transitions: refuse append; preserve bytes.
- **Two executions, same task:** transitions are keyed by `runId`. Evidence bound to run A must not append or advance kinds for run B. If the task's current execution link points at B, A's evidence is ignored for B's circuit (typed skip / no-op), never cross-applied. Acceptance case required (below).

## Acceptance tests (offline, fake Gentle; when implementing)

1. Confirmed evidence sequence advances the three review-side kinds in order with opaque evidence bound to task+run+candidate.
2. `next_transition` alone (pending, no published completion evidence) → **no** review-side append.
3. Project receipt without task/run/candidate bind → **no** `review_authorized`; `taskReview` stays `not_established`.
4. Re-read / reconnect: transitions bytes stable; `startRun === 0`.
5. RDD off / Gentle unavailable / incompatible → no review-side advance.
6. Out-of-order / corrupt → typed refusal; file intact.
7. **Two runs same task:** complete evidence for `run_a` does not append kinds under `run_b`; link pointing at `run_b` stays at its own `next`; no cross-advance.
8. Executor (when present): only verbatim published command; invented argv refused; after fake success, observer appends only when status publishes binding evidence.
9. Documented C1 policy covered by tests (whatever authorized rule is chosen for interrupt/fail/cancel vs success-only review entry).

## Files to change (when authorized — not now)

| Path | Role |
|------|------|
| `src/global/conversation/gentle-transition-bridge.js` (new) | Evidence bind + kind map; observer only |
| `src/global/conversation/gentle-action-executor.js` (new, if automation authorized) | Verbatim execute + consent gate |
| `src/global/conversation/service.js` | Wire observer; optional executor entry |
| `src/global/conversation/operations.js` + MCP/Pi | Expose sync / execute step if authorized |
| `test/conversation-p2-transitions.test.js` (new) | Cases above |
| This tracker | Check off after observed proof |

Do not touch foreign CRT / credit-discipline / unrelated pending paths.

## Gate

- [ ] P1 result known (Claude).
- [ ] Explicit P2 authorization (spend/consent/executor scope named).
- [ ] C1 policy chosen under that authorization.
- [ ] Then implement task-by-task under ODD; not before.

## Next step

Wait for P1 outcome + specific P2 auth. No code for P2 until then.

- Evidence (P2 surfaces): test/conversation-p2-surfaces.test.js drives the real MCP handler over the real service (service/MCP only on the consolidation line; the Pi tool half was dropped, Pi parity deferred/not applicable) with a hostile fake Gentle; project receipt/gate visible, taskReview not_established, task_binding_unavailable, no command/argv/next_transition/execute/invocation anywhere, transitions.jsonl sha256 identical, startRun 0, only read-only Gentle argv. Pure coverage (source-line result; the consolidation evidence is in odd/tasks/kairo-consolidation.md).
