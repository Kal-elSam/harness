# Jev shadow comparison

## Objective
Compare TypeSafe Jev's task-effort classification (light/standard/heavy) against
Kairo's local `classifyEffort(taskText)` baseline in shadow mode, to decide later
whether Jev adds real value over the deterministic local rule.

## Why
`classifyEffort` (src/global/intelligence/execution-router.js:245) is local,
deterministic, and free. Jev must demonstrate incremental value against it, not
just answer one example correctly.

## Authorized scope (this batch)
- Local-only work: labeled fixture, isolated evaluator, mock-based tests.
- NO network calls to api.typesafe.ai. NO changes to routing, providers, models,
  permissions, or execution. Real API run is manual and requires explicit
  user confirmation first.

## Constraints
- TYPESAFE_API_KEY is read from env at call time only; never logged or persisted.
- Fixture contains no private code, secrets, or real conversations.
- Labels are human ground truth (not derived from classifyEffort output).

## TDD
Mode: off (no explicit project/session config). Runner: `node --test`.
Mock-based tests are required by the plan itself.

## Delivery
Branch: feat/jev-shadow-comparison. Forecast < 400 authored lines; single PR,
no chain. RDD: off (default) — ordinary checks only.

## Tasks
- [ ] T1 — Labeled fixture `scripts/jev-shadow/tasks.json`: 12–18 clear cases
  (ES + EN) with expected tier, plus 4–6 ambiguous cases in a separate array
  (no expected tier, flagged for human review).
- [ ] T2 — Isolated evaluator `scripts/jev-shadow/evaluate.mjs` + thin TypeSafe
  client: injectable transport, Choice question, env key, comparison report
  (agreements, disagreements, accuracy vs labels, confidence, latency, tokens).
- [ ] T3 — Mock tests `test/jev-shadow-eval.test.js`: canned transport, no
  network, key never appears in output. Green via `node --test`.
- [ ] T4 — (PENDING, future) Manual real run against api.typesafe.ai after
  explicit user confirmation. Verify client endpoint/payload against TypeSafe
  docs at that moment.
- [ ] T5 — (PENDING, future) Human review of disagreements, especially risky
  misclassifications; only then consider an integration proposal.

## Progress
(Updated after each task. Commit IDs recorded as evidence.)

## Next step
T1–T3 via one delegated writer, then orchestrator spot check.
