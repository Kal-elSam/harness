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
- [x] T1 — Labeled fixture `scripts/jev-shadow/tasks.json`: 18 clear cases
  (ES + EN) with expected tier, plus 5 ambiguous cases in a separate array
  (no expected tier, flagged for human review). Commit f1f2e6b.
- [~] T2 — REOPENED 2026-09-23 (reason: client implemented an INVENTED
  contract — /v1/choice with {question, choices, input}; user verified the
  published contract is POST /v1/systemone with {state, model, questions} and
  the choice inside answers.<id>.choice). Fix client to the verified contract.
- [ ] T6 — Contract-shaped test: request hits exactly
  https://api.typesafe.ai/v1/systemone with the documented payload; response
  parsed from the documented {model, answers, usage} shape.
- [ ] T7 — Error sanitization: client redacts the key from EVERY error path
  (unrecognized tier echo, fetch rejection, non-JSON response); evaluate.mjs
  truncates stored transport errors. Canary tests cover all these paths.
- [ ] T8 — Fair comparison: localAccuracy and jevAccuracy computed over the
  SAME cases (labeled AND jev-answered); failures reported as
  jevFailures/jevFailureIds, never silently dropped.
- [ ] T9 — Labels marked PROVISIONAL (fixture description + report field)
  until human review in T5.
- [x] T3 — Mock tests `test/jev-shadow-eval.test.js`: canned transport, no
  network, key canary never appears in output/errors. 8/8 green; regression
  test/execution-router.test.js 37/37 green. Commit f1f2e6b.
- [ ] T4 — (PENDING, future) Manual real run against api.typesafe.ai after
  explicit user confirmation. Endpoint/payload shape in typesafe-client.mjs is
  an UNVERIFIED assumption marked VERIFY (T4); TYPESAFE_BASE_URL overrides the
  base URL without code changes.
- [ ] T5 — (PENDING, future) Human review of disagreements, especially risky
  misclassifications; only then consider an integration proposal.

## Progress
- 2026-09-23: T1–T3 done on branch feat/jev-shadow-comparison.
  - Commits: f1f2e6b (evaluator + fixture + tests), b6702c6 (this doc).
  - Checks: node --test test/jev-shadow-eval.test.js → 8/8 pass;
    node --test test/execution-router.test.js → 37/37 pass.
  - Review assess (base-ref main): risk HIGH, single signal shell_process in
    the test's CLI spawn (fail-closed test). RDD off → ordinary policy.
  - Verification: writer self-verification + parent structural readback
    (diff touches only the 5 intended files, nothing under src/) + parent spot
    check re-run (8/8). Independent verifier: UNAVAILABLE (sub-agent provider
    reported insufficient funds, twice) — typed unavailable, not a PASS.
  - Discovery: classifyTask keywords are English-only, so Spanish heavy tasks
    fall to light locally — the es-heavy-* fixture cases exist to measure
    exactly that gap.

## Next step
Await explicit user confirmation for T4 (manual real API run). Never run it
automatically.
