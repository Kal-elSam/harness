# Codex delegated write — CLI compatibility + OS wrapper evaluation

## Objective

Executable offline canary protocol ready for later authorization. Oracle
consumes evidence only. **`verifiedEffective` stays false.** No live run,
credential copy, promotion, or startRun wiring in this tranche.

## Acceptance

- [x] Protocol: exact SBPL profile, disposable paths, capture before/during/after
- [x] `verifiedEffective: false` / `approval: false` on protocol + oracle
- [x] Offline suites green (denial = linked tool/process error; executed required)
- [x] Cherry-pick `7571ecb46` → `8ff2f5fa8` on `feat/herd-shell-layout` (R1 PATH + SBPL fix)
- [x] RDD receipt for **integrated** branch tip (Gentle approved + acknowledged)

## Protocol entry

- Code: `prepareDelegatedWriteCanaryProtocol` → `src/global/runtime/codex-delegated-write-canary-protocol.js`
- Doc: `docs/codex-delegated-write-canary-protocol.md`

## RDD — prior worktree canary (closed; does not cover branch tip)

| Field | Value |
|---|---|
| lineage | `review-2c1545c135018126` |
| outcome | approved → acknowledged (burned) on worktree only |

## RDD — integrated branch tip (current receipt)

Tip `cd7d90b08` (tree `39190021…`), base `51c0e417…`, agent `codex`,
`--committed-only`, untracked excluded.

| Field | Value |
|---|---|
| risk | high |
| changed_paths / lines | 21 / 2568 |
| target_identity | `sha256:7966991f17cca5b58de2d09eea480e9a6c05d17e1b4487c2c4eb6e5201d645c3` |
| lineage | `review-4b66cfffd44c6167` |
| outcome | **approved → acknowledged** (authority **burned**) |
| advisory (informational only) | R2 WARNING `R2-omitted-externals-misnomer`; R2 WARNING `R2-forbidden-sibling-name-drift` |
| canary | protocol ready; **no** live run / credentials / promotion / wiring |
| `verifiedEffective` | **false** — review ≠ containment proof |

## TDD

`test/codex-delegated-write-os-wrap.test.js` green after cherry-pick (reported).

## Next step

1. Optional later cleanup of advisory R2 naming drift (does **not** reopen this receipt).
2. Live canary still needs **separate** authorization.
3. `verified_effective` only after live contained evidence (separate owner decision).
