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
- [x] T2 — Fixed 2026-09-23 (was reopened: client implemented an INVENTED
  contract — /v1/choice with {question, choices, input}; user verified the
  published contract is POST /v1/systemone with {state, model, questions} and
  the choice inside answers.<id>.choice; orchestrator re-verified against
  docs.typesafe.ai/api). Client now sends {state, model: "jev-latest",
  questions: {effort: {type: "choice", instructions, criteria}}} and parses
  answers.effort.{choice, confidence} + usage. Commit 7baaacd.
- [x] T6 — Contract-shaped test asserts the exact URL
  https://api.typesafe.ai/v1/systemone, the documented payload, and parsing
  from the documented {model, answers, usage} response. Commit 7baaacd.
- [x] T7 — Client redacts the key from EVERY error path (status, tier echo,
  fetch rejection, non-JSON); evaluate.mjs truncates stored transport errors
  to 200 chars. Canary tests cover all paths including a hostile tier echo
  and a key-echoing fetch rejection. Commit 7baaacd.
- [x] T8 — localAccuracy and jevAccuracy now computed over the SAME scored
  set (labeled AND jev-answered); failures reported as
  jevFailures/jevFailureIds. Commit 7baaacd.
- [x] T9 — Labels marked PROVISIONAL in fixture description and report root
  (`labels: "provisional"`) until human review in T5. Commit 7baaacd.
- [x] T3 — Mock tests `test/jev-shadow-eval.test.js`: canned transport, no
  network, key canary never appears in output/errors. 8/8 green; regression
  test/execution-router.test.js 37/37 green. Commit f1f2e6b.
- [x] T4 — FIRST ATTEMPT 2026-09-23 (user-run, key in their shell): all 23
  cases failed with HTTP 401 (invalid/missing API key per TypeSafe docs).
  Fail-closed design held: 0 fabricated tiers, scored 0, accuracies null, all
  failures reported as transport (report.json, no secrets in it). A 401
  points at AUTH, not payload (a bad payload would be 422). Likely causes:
  key is not a direct TypeSafe key (the plan's Vercel-Gateway assumption),
  expired/revoked, or whitespace/quoting when exporting. Next: user verifies
  the key in console.typesafe.ai/settings/keys and can probe auth with the
  documented GET /v1/models, then re-runs. T4 stays OPEN until a run
  produces real classifications.
  ROOT CAUSE CONFIRMED 2026-09-23: the key is a Vercel AI Gateway key, not a
  direct TypeSafe key. Vercel serves the same systemone contract at
  https://ai-gateway.vercel.sh/typesafe/v1/systemone with model
  "typesafe-ai/jev" (vercel.com/docs/ai-gateway/sdks-and-apis/typesafe).
  Fix: the client takes baseUrl + model; the CLI prefers AI_GATEWAY_API_KEY
  (gateway route) over TYPESAFE_API_KEY (direct route), and `--limit N` runs
  the first N clear cases for a one-case smoke run before the full 23. The
  zero-dep fetch client is kept; no SDK. Tests 14/14, full suite 2150 pass /
  0 fail / 1 skipped.
  SMOKE 2026-09-23 (`--limit 1`, gateway key): 401 -> 403. The key and the
  route are now accepted; the Gateway refuses the request. The client dropped
  the error body, so the 403 cause was unknowable. Fix: HTTP errors now carry
  the upstream code and message (Gateway `{error,type}`, TypeSafe
  `{message,error_type}`, nested `{error:{type,message}}`), redacted and capped
  at 120 chars. Also fixed a latent leak: upstream text was truncated BEFORE
  redaction (error body and unrecognized-tier echo), so a key straddling the
  cut could survive as a partial secret. Regression tests cover both paths
  (the tier-path test fails on the old code). Tests 15/15, full suite
  2151 pass / 0 fail / 1 skipped.
  403 cause: customer_verification_required (Vercel needs a card on file).
  User added it. SMOKE PASSED 2026-09-23 (`--limit 1`): en-light-1 -> jev
  "light", confidence 0.78, 852 ms, 398 tokens, agrees with local and label.
  The route works end to end.
  FULL RUN 2026-09-23T20:28Z (23 cases, gateway): 0 failures, 18/18 scored.
  Local 15/18 (0.83), Jev 14/18 (0.78), agreement 12/18. By language: EN
  local 10/10, Jev 8/10; ES local 5/8, Jev 6/8. Local misses all 3 ES heavy
  cases (English-only keywords). Jev misses: both changelog cases (EN+ES ->
  light), en-heavy-5 payment credential (standard, conf 0.06), es-heavy-1
  (standard, 0.45). Mean Jev confidence: correct 0.67 vs wrong 0.35. Median
  latency ~445 ms, max 6563 ms; 7325 tokens (~$0.0003). A one-case gap on
  n=18 with provisional labels is noise, not a verdict. Local's EN 10/10 may
  be circular (EN cases may match its keywords). Report: report.json (untracked).
  USER DECISION 2026-09-23: zero-dependency fetch client stays; NO SDK, NO
  automatic retries (23-case manual pilot doesn't justify a dependency).
  Runbook: a 429/529 leaves the case as a TRANSPORT failure (jevError,
  excluded from both accuracy denominators — pinned by test) never as a Jev
  misclassification; do NOT relaunch the batch immediately — TypeSafe
  requires exponential backoff when retrying. If rate limits appear
  frequently, add a bounded backoff before ever considering the SDK.
- [x] T10 — Contrast set (2026-09-23): 8 cases in 4 pairs (changelog
  supplied-vs-Git, storage display-name-vs-recovery-code; EN + ES), labeled
  BEFORE any Jev run. Control: each pair stays on one side of the local
  100-char threshold with zero keyword hits, so local answers standard for
  all 8 by design (pinned by a fixture test). Report adds a `contrast`
  section scored by pair separation (both cases get their expected tier);
  pairs with a Jev failure are unscored for both classifiers. A constant
  classifier separates 0/4 pairs (verified with a stub transport). Tests
  17/17, full suite 2153 pass / 0 fail / 1 skipped.
- [x] T11 — Contrast run 2026-09-23T20:58Z (31 cases, 0 failures). Jev
  separates 2/4 pairs, local 0/4 by design. Changelog pairs separated in EN
  and ES (light 0.99/0.97, standard ~0.47). Storage pairs FAILED in both
  languages: recovery code -> standard with HIGH confidence (0.76 EN, 0.87
  ES), a confident blind spot on data-sensitivity risk. Clear cases re-run
  with identical input: Jev 14/18 -> 12/18. All 4 flips had confidence
  < 0.35 (en-standard-2, en-heavy-3, en-heavy-5, es-heavy-3), so low
  confidence means unstable, while high confidence is stable but not always
  correct. Latency median 369 ms, p90 7.6 s, max 9.4 s (heavy tail).
- [x] T12 — Offline hybrid simulator `scripts/jev-shadow/simulate-hybrid.mjs`
  (no network, no routing change). Policy: local RISK keyword -> heavy;
  else Jev at/above threshold; else standard. Reports clear hits, contrast
  hits, pairs separated, and downgraded heavy ids for local, jev, and each
  threshold side by side; selects NO threshold (overfitting guard, pinned by
  test). Tests 4/4, full suite 2157 pass / 0 fail / 1 skipped.
  On the 20:58Z report: no hybrid threshold beats local on clear (best
  15/18 = tie; results are non-monotonic across thresholds, i.e. noise).
  Hybrid contrast 6/8 (2/4 pairs) comes entirely from Jev. es-heavy-1,
  es-heavy-3, and both recovery-code cases are downgraded under EVERY
  policy: the RISK_KEYWORDS floor is English-only ("autenticación" does not
  contain "auth"; "facturación" is not "billing"). At >= 0.5 the standard
  fallback also downgrades en-heavy-4, which Jev had right at 0.42.
  Only the latest report exists; the first full run was overwritten.
- [x] T13 — Preserved the 20:58Z report byte-for-byte as
  `scripts/jev-shadow/reports/2026-09-23T20-58-30Z.json` (no added
  metadata; its provenance is only what the file itself records). Local
  tiers in it come from the pre-fix router (main b3e2725): clear 15/18,
  contrast pairs 0/4. The first full run (19:45Z-era retry) was overwritten
  and is not recoverable.
- [x] T15 — Node 20 compatibility: CI tests Node 20/22/24, and Map.groupBy
  (Node 21+) broke every Jev test on Node 20.14 ("Map.groupBy is not a
  function", reproduced locally). Replaced it with an exported
  `groupByPair` helper. Jev tests 21/21 on Node 20.14 and 22.23; full suite
  2157 pass / 0 fail / 1 skipped on 22. On local Node 20 the only failures are
  two stray test files under `.git/opencode-intelligence-preserve/`
  (local-only, absent from CI checkouts).
- [x] T14 — Provenance (after #341 merged as 5fc1c29; branch rebased on it).
  CLI reports carry `provenance`: routerSha256 (execution-router.js),
  fixtureSha256, jevQuestion + model actually sent, route. A custom
  --transport records jevQuestion/model as null (unknown, never assumed).
  `simulate-hybrid` refuses a report whose routerSha256 is missing or differs
  from the current router; `--allow-router-mismatch` proceeds but marks
  routerVerified: false with the reason. The archived 20:58Z report has no
  provenance, so it is refused by default (no metadata invented for it).
  Contrast control test split: the length invariant stays; the local profile
  is now pinned to the CURRENT router (only es-contrast-heavy-2 is a hit,
  "codigo de recuperacion" -> heavy), documenting that "8/8 standard" held
  for the pre-fix router b3e2725. The mock fixture's c3 moved to "¿Por qué
  se cae el servicio…?" because the fix made the old text a local hit.
  Tests: Jev 25/25; full suite 2167 pass / 0 fail / 1 skipped; Jev + router
  68/68 on Node 20.14.
- [x] T16 — First provenance-verified run 2026-09-23T22:34Z
  (`reports/2026-09-23-router-9819b7d.json`, router 9819b7d64a06 = post-#341,
  fixture 24cccd1f16c1, gateway, typesafe-ai/jev). Local 18/18 clear
  (IN-SAMPLE: the fix came from these cases). Jev 13/18. Versus 20:58Z, Jev
  is stable: 25/26 same tier, confidences within ~±0.05; the only clear flip
  is es-heavy-3 at confidence 0.29. The recovery-code blind spot reproduces
  (en-contrast-heavy-2 standard 0.77). One 429 (rate_limit_exceeded) on
  es-contrast-heavy-2 left storage-es unscored, which hides local's only
  separable pair (evaluator: local 0/3 pairs). Latency median 363 ms, p90 487
  ms, max 747 ms (no multi-second tail this run).
  INCONSISTENCY FOUND: on the same report the simulator says local 1/4 pairs.
  It counts a failed Jev row as wrong for `jev` and falls back for `hybrid`,
  while the evaluator excludes failed rows for both classifiers.
- [x] T17 — Simulator aligned with the evaluator: a failed Jev row is missing
  evidence, excluded for EVERY policy; a pair with any failure is unscored for
  all; both are listed under `excluded`. Regression test failed first (5
  scored rows instead of 4), then passed. Jev + router tests 69/69 (hybrid
  6/6 on Node 20.14); full suite 2168 pass / 0 fail / 1 skipped.
  Corrected T16 simulation (saved report untouched): excluded es-contrast-
  heavy-2, unscored storage-es; every policy has 3 scored pairs. Local 18/18
  clear, 3/6 contrast, 0/3 pairs. Jev 13/18, 5/6, 2/3. Hybrid 15-17/18 clear,
  5/6, 2/3 at every threshold. The earlier "hybrid 7/8, 3/4" was an artifact
  of scoring the 429 as a standard decision. Next: re-run into a new file to
  recover storage-es (local 18/18 stays in-sample).
- [x] T18 — Rebased on main 1b27571 (#342: English "recovery code" risk
  keyword). The contrast test now pins BOTH recovery-code cases as local hits
  (local separates both storage pairs). The simulator unit fixture's "silent
  heavy" example moved to "backup phrase", which is still keyword-free, so it
  keeps testing the same thing. Router hash is now a5f91be1b0b9: the
  simulator correctly REFUSES the 22:34Z report (router 9819b7d64a06); a new
  run is needed for any current-router comparison. Tests: Jev 26/26; Jev +
  router 71/71 on Node 20.14; full suite 2170 pass / 0 fail / 1 skipped.
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
- 2026-09-23 (second batch): T2 reopened by user review and fixed, T6–T9 done.
  - Commit: 7baaacd. Checks: 10/10 new tests, 37/37 regression.
  - Contract verified by orchestrator against docs.typesafe.ai/api before
    implementing: POST /v1/systemone, {state, model, questions},
    answers.<id>.{choice, confidence}, usage.{input_tokens, output_tokens}.
  - T4 note: documented contract asks for exponential backoff on 429/529;
    the client deliberately does not retry — re-run manually if rate-limited,
    or switch to the official @typesafe-ai/sdk (retries built in). User
    decision before T4.

## Next step
User re-runs the smoke case to read the 403 code/message, fixes the Vercel
team setting it names (allowlist, deny rule, or billing), then re-runs:
`AI_GATEWAY_API_KEY=... node scripts/jev-shadow/evaluate.mjs --limit 1`.
If it returns a real tier, run the full fixture with `--out report.json`.
Never run it automatically. T4 approach decided by the user: zero-dep fetch client, no
auto-retry, 429/529 = transport failure + backoff before any relaunch.
