# Offline effort evaluation

Evaluate the existing `classifyEffort` without changing runtime routing or using
network services. Labels are **PROVISIONAL human judgments**, not ground truth.

## Run dev first

From the repository root:

```sh
node scripts/effort-eval/evaluate.mjs --split dev --write-claims
node scripts/effort-eval/evaluate.mjs --check-claims
```

Default split is `dev`; default bootstrap seed is `20261014`, with `2000`
iterations. Override with `--seed UINT32 --iterations N`. JSON reports live in
`scripts/effort-eval/reports/<split>.json`. `--write-claims` replaces `claims.json`
with every numeric field from that report, its dotted field path, report path,
and current HEAD commit. `--check-claims` verifies values and commit bindings
without selecting any dataset split. Until the parent commits, HEAD identifies
the baseline used for this uncommitted evaluator run, not a containing commit.

## Locked dataset

Source: `feat/jev-shadow-comparison:scripts/jev-shadow/tasks.json`. Preserve 18
clear and 8 contrast cases, including pair IDs; five ambiguous cases have no
expected label and never contribute to scores.

Within each clear language/tier stratum, the last lexically ordered ID is test;
all others are dev. Changelog contrast pairs are dev; storage contrast pairs
are test. Both splits contain every language/tier bucket. This fixed split is
not adjusted after looking at predictions.

`cases.json` is a combined manifest with a committed `cases.json.index.json`
byte index. Dev reads only dev record spans, checks their hashes, and never
reads, parses, predicts, scores, or outputs held-out test rows. Test
evaluation requires explicit `--split test` (API: `explicitTest: true`) and
appends timestamp, HEAD commit, and intended report path to `test-reads.json`
**before** loading/scoring, including attempts whose predictor later fails.
Synthetic test fixtures do not touch the real ledger or run the real test split.

## Metrics and API

- Accuracy includes `n` overall, per language, and per expected tier. Confusion
  rows are expected tiers; columns are predictions. Empty buckets are null.
- CI is a seeded, record-level percentile bootstrap of overall accuracy, not a
  pair-level bootstrap. Small provisional samples limit inferential strength.
- Pair separation means the higher-labelled member gets a strictly higher
  prediction, not necessarily the exact expected labels.
- Hard labels yield null Brier/ECE with reason `predictor returns hard labels`.
  Probabilistic predictions use multiclass Brier (sum of squared errors across
  three classes) and top-label ECE with ten equal-width confidence bins.

Import `evaluate(cases, options)` for pure scoring or `runEvaluation(options)`
for guarded file access, ledger, and reports. Inject `predictor(text, record)`;
sync or async predictors return a tier string or
`{ probabilities: { light: 0.8, standard: 0.1, heavy: 0.1 } }`. Probabilities must
be finite, normalized, and nonnegative; the argmax determines the prediction.
Ties resolve in light/standard/heavy order. Mixed hard/probabilistic output does
not produce calibration scores. Import `makeClaims(report, reportPath)` and
`checkClaims(claims)` for traceability. CLI `--help` lists path overrides for
isolated fixtures and reports.

`writeDataset(dataset, path)` writes an authored manifest and its byte index.
Fixture overrides also require that adjacent index. A stale selected-case hash
fails closed; update manifest and index together only during dataset authoring,
never to revise the locked split based on results.

The nested `.npmignore` excludes this entire directory from the npm tarball
without changing any other shipped content. Package tests guard the exclusion;
the parent's unsandboxed packaging run is required to prove it.
