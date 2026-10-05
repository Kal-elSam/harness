# Delegated execution containment (authorized writes)

## Objective

Document containment for productive delegated runs with authorized writes, and keep that evidence explicitly separate from Bootstrap Analysis isolation.

## Scope

- `docs/delegated-execution-containment.md`
- Cross-links from Bootstrap / adapters / docs index
- `test/delegated-execution-containment.test.js`
- No Bootstrap sandbox changes; no RDD start

## Acceptance

- [x] Doc states path+authority model (worktree cwd, permission authority, adapter workspace-write)
- [x] Explicit non-equivalence to Bootstrap `verified` / sandbox-exec canaries
- [x] Tests pin Codex workspace-write default, consent-gated yolo, worktree path containment, orchestrator cwd binding
- [x] Bootstrap doc points here and forbids reusing its canaries

## Evidence

- `node --test test/delegated-execution-containment.test.js`
- Existing suites cited in the doc remain the broader proof (worktree, permission authority, Codex adapter)
