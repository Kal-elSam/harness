# Freeze, plan, and analyze effort outcomes

U11 builds the runner without spending quota. Real Phase A/B execution belongs
to the parent. Only `classifyEffort` predicts; Jev is not used. Node 20+.

## Safe offline path

```sh
node scripts/effort-eval/outcome-tasks/freeze-predictions.mjs
node scripts/effort-eval/outcome-tasks/run.mjs --phase A --dry-run
```

Freeze validates all fixtures and external checks, records SHA-256 hashes per
prediction, and fixes Phase A to six tasks (3 EN/3 ES, all categories, two
risk-sensitive). Existing predictions cannot be overwritten without `--force`.
Changing predictions after results exist invalidates their hash lineage.
**The parent must commit predictions before any real execution.**

Dry-run uses the project's synchronous documented Claude catalog. It does not
verify current entitlement. It prints 18 task/tier/model entries and explicitly
bypasses the real quota probe and provider. Missing tier models fail closed;
there is no fallback to a different tier. Phase B selects the other 18 tasks.

## Real execution (parent only)

`run.mjs --phase A`, `--phase B`, or `--tasks id,id` runs all three tiers.
These commands spend subscription quota and call the existing Claude CLI quota
reader before each run. Do not invoke them in an offline build session.
An unknown quota probe or remaining quota below 20% stops cleanly before the
next run. Exact 20% is allowed; the worst measured window is used.

Programmatic `runOutcomes` accepts injected `runTask` and `quotaProbe` functions.
Tests always inject both; they never start a provider or invoke Claude CLI.
The real task bridge uses normal permission mode (no unsafe-consent bypass) and
awaits the supervisor completion promise before reading terminal state/checking.
The existing `runKairoBenchTask` owns fresh temporary-copy cleanup. Only fixture
bytes enter that copy; the trusted external check runs from the corpus directory
against it. Scope is checked before and after the check, including file modes,
directory changes, and symlinks. This is copy isolation, not an OS security
sandbox against hostile code. No check is supplied to the agent prompt/copy.

JSONL defaults to `results.jsonl`. Each row records task/tier/model, checked
outcome/reason, tokens, API-equivalent `total_cost_usd` (not subscription billing),
wall time, optional turns, timestamp, and the frozen-file SHA-256. `diffSize` is
the sum of old/new byte lengths for changed entries, not a Git line count.
Unknown telemetry stays null. Transport/auth/quota failures and crashes before
verification are missing evidence. Completed pass/fail pairs are skipped on
resume; missing evidence is retried. Model/hash mismatch or malformed JSONL
refuses resume rather than mixing experiments. Use one writer per results file;
concurrent invocations are not supported.

## Analysis

```sh
node scripts/effort-eval/outcome-tasks/analyze.mjs
```

Writes `reports/analysis.json` and `reports/analysis.md`. Use `--predictions`,
`--results`, and `--output` for alternate paths; each CLI exposes `--help`.
The cheapest passing tier defines minimal truth. All-fail tasks are unsolvable;
a failure above a passing tier flags non-monotonicity. Incomplete/missing-evidence
tasks are excluded from every metric. Successful retries replace missing
evidence. Unsolvable tasks are excluded from tier accuracy and under/over rates,
but retained in routed success/cost. Risk-sensitive tasks are reported separately.
Unknown cost makes total routed cost null; known subtotal and missing count
remain visible. No threshold, policy, or winner is selected from these synthetic,
single-run-per-tier outcomes. No claim about live routing savings is made.
