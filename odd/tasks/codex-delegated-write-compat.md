# Codex delegated write — CLI compatibility + OS wrapper evaluation

## Objective

Ordinary CLI flag compatibility + valid OS-sandbox canary prep with canonical
roots, oracle (contained/breach/inconclusive), exact command, and isolated auth
handling — **no live canary, no promotion, no startRun wiring**.

## Acceptance (this tranche)

- [x] Canonical roots validated before profile grants; symlink/broad/overlap/uncertain → reject
- [x] Offline coverage: symlink→`.codex`, incompatible roots, sandbox absent, no fallback
- [x] Runner + oracle reuse adapter launch; never approval
- [x] Exact command + isolated auth docs for future authorization
- [x] Admission still `source_declared`; RDD receipts remain pending (tests ≠ receipt)

## TDD

`node --test test/codex-delegated-write-os-wrap.test.js test/codex-execution-adapter.test.js test/delegated-write-admission.test.js`

## Tasks

- [x] CW-1..CW-7 prior increments
- [x] CW-8 Canonical root validation coherent with profile
- [x] CW-9 Offline rejection coverage
- [x] CW-10 Runner + oracle (never approval)
- [x] CW-11 Exact command + isolated auth handoff (no live run)

## Future authorized command (example shape)

```bash
CODEX_HOME='<isolated-provider>' TMPDIR='<isolated-temp>' \
  sandbox-exec -f '<profile.sb>' codex exec \
  --dangerously-bypass-approvals-and-sandbox --json \
  'Write canary-internal-write.txt inside the workspace only.'
```

Auth: copy credentials into isolated `CODEX_HOME` only — never `CODEX_HOME=~/.codex`,
never symlink isolated → personal.

## Next step

Explicit user authorization → live canary under that command → only then consider
`verified_effective` (separate owner/decision).
