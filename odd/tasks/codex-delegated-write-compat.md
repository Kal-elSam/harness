# Codex delegated write — CLI compatibility + OS wrapper evaluation

## Objective

Valid offline canary prep: pinned workspace command, disposable internal/external
attempts, hardened oracle (deltas + denial evidence). **No live run, credential
copy, promotion, or startRun wiring.**

## Acceptance (this tranche)

- [x] Exported command pins workspace (`cd` + `--cd`)
- [x] Attempts target disposable paths only (not personal `~/.codex`)
- [x] Oracle: `contained` = internal delta + external denials; external delta = `breach` even after process error; preexisting/omitted → inconclusive
- [x] Offline tests cover omitted attempts, preexisting files, breach+error, other-cwd pinning
- [x] stdout/events/per-attempt result preserved on oracle output
- [x] RDD receipts remain pending (tests ≠ receipt)

## Corrected test for later authorization

```bash
cd '/tmp/kairo-wt-delegated-1/tree' && \
CODEX_HOME='/tmp/kairo-wt-delegated-1/provider-home' \
TMPDIR='/tmp/kairo-wt-delegated-1/tmp' \
'sandbox-exec' '-f' '/tmp/kairo-wt-delegated-1/profile.sb' 'codex' 'exec' \
'--dangerously-bypass-approvals-and-sandbox' '--cd' '/tmp/kairo-wt-delegated-1/tree' '--json' \
'<plan.task: internal write + disposable external probe; never ~/.codex>'
```

Auth (operator-owned later): place credentials only under isolated `CODEX_HOME`.
This prep does **not** copy credentials.

Oracle inputs after a real run: per-attempt `{initialState, finalState, outcome, stdout, events, result}`.

## TDD

`node --test test/codex-delegated-write-os-wrap.test.js`

## Next step

Explicit authorization → live canary under that command → only then consider
`verified_effective`.
