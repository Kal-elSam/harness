# Kairo consolidation

Branch: `feat/kairo-consolidation` (worktree `~/Desktop/agentic-harness-worktrees/kairo-consolidation`), base `aa66c7c90`.

## Objective

One product line: Ratatui + P1/P2. No unique work lost, no retired interface reintroduced (Pi UI, Cockpit, review automation, full Decision Assistant/Fleet). Pi headless RPC stays while it has consumers.

## Constraints

- No push, fetch, remote deletion, real providers, or mutating Gentle commands.
- Goal proposals, recovery and new access verification are out of scope for this unit.
- `feat/kairo-startup-analyst-team` is preserved as a branch, not integrated and not deleted (user decision 2026-10-07). Aptitude, QUALITY/EFFICIENT and 429 handling need a separate evaluation.
- Canary/cfprefs diagnostic group (~32 commits) is preserved, not integrated.
- Control-plane review reference stays as read-only observation (`review-association.js` is a hard dependency of `service.js`).

## Verification policy

- TDD: unknown. Source: base tracker records TDD unknown and asks not to invent RED for integration ports. Decision: ordinary functional checks (user, 2026-10-07).
- Runner: Node `--test`; package manager `pnpm@10.34.5` (declared in `package.json`).
- Per group: focused `node --test <files>`, then full `pnpm test`. If Rust changes: `cargo test --manifest-path crates/kairo-ui/Cargo.toml`.
- A bug that requires a behavior change gets a regression test first, with the real failure observed.

## Evidence

- Backup of dirty state: `~/Desktop/agentic-harness-worktrees/_backup-20261007/` (patches verified with `git apply --check -R`).
- Classification: `_backup-20261007/classification.md`.
- G1 checks: `node --test test/kairo-control-plane-review-association.test.js` 14/14 pass. `pnpm test` 2302 pass / 109 fail / 6 skipped; base aa66c7c90 gives 2288 pass / 109 fail with the identical failing set (diffed by name). Failures are ERR_MODULE_NOT_FOUND because `node_modules` is absent; `pnpm install` needs network, so the full suite is unverified until deps are available.
- G1 re-run after offline install: `pnpm test` 2605 pass / 4 fail / 6 skipped; base aa66c7c90 (same install) 2596 pass / 4 fail. Same 4 failing tests on both sides, so pre-existing, not caused by G1: T27 catalog rank order, T29 thin-evidence confidence, T23 project.verify_access wire, snapshot real provider/integration status. Tracked for T7.
- G2 checks: `node --test test/kernel-contracts.test.js test/kernel-delegate.test.js test/worker-events.test.js` 24/24 pass. `pnpm test` 2619 pass / 4 fail / 6 skipped (2629 tests); the 4 failures are exactly the G1 baseline set (T27, T29, T23, snapshot real provider status). No new failures.
- G3 order note: the docs commits had to precede the code commits (514ed6e05 creates `docs/delegated-execution-containment.md` and its tracker, which 1428ab0bb modifies), matching source history. Conflict on 5f56f7aac: `odd/tasks/context-fill-concurrent-persistence.md` is absent on base (modify/delete); resolved by keeping it deleted, dropping only its 2-line addendum about this docs commit.
- G3 checks: `node --test test/bootstrap-isolation-boundary.test.js test/claude-supervised-run.test.js test/delegated-write-admission.test.js test/pi-runtime.test.js test/run-manager.test.js test/delegated-execution-containment.test.js` all pass (43/43 for the first five, containment test run separately). `pnpm test` 2639 pass / 4 fail / 6 skipped (2649 tests); the 4 failures are the same baseline set. No new failures.
- G4 checks: `node --test test/codex-delegated-write-os-wrap.test.js test/codex-execution-adapter.test.js test/delegated-execution-containment.test.js test/delegated-write-admission.test.js` 19/19 pass; `test/codex-sandbox.test.js test/codex-models.test.js test/codex-usage.test.js` 34/34 pass. `test/codex-delegated-sandbox-startup-reads.test.js` does not exist on this base (it belongs to later canary-group commits, not integrated). The commit is self-contained (only node builtins, no canary/cfprefs files). `pnpm test` 2644 pass / 4 fail / 6 skipped (2654 tests); the 4 failures are exactly the baseline set. No new failures.
- G5 picks (source order, all clean, -x): ae8afdf71 de5e1d3f9; 4be774e87 dc01bd770; 9d6d283b5 b8617b2e8; 3392f9e59 007aec72b; 1862eb001 3052b2c4e; 50097bc94 9dcab2bd6; 0311e2090 e95f45f63; eae5e94f6 362b4ea7e; 70e5f32fb 86c993c3f; cd7d90b08 65022cc6b. Excluded: e336bdeef (only adds a reference to the cfprefs SHM diagnostic design, which is the canary group not integrated). Note: ae8afdf71 carries a canary evidence section inside the bridge tracker as plain text; no canary code was pulled in. Checks: `node --test test/run-result-normalizer.test.js test/run-spawn-adapter.test.js test/kernel-contracts.test.js test/kernel-delegate.test.js test/worker-events.test.js` 63/63 pass. `pnpm test` 2683 pass / 4 fail / 6 skipped (2693 tests); the 4 failures are exactly the baseline set. No new failures.

## Tasks

- [x] T1 Freeze and preserve (backup verified)
- [x] T2 Isolated integration worktree from `aa66c7c90`
- [x] T3 Classify by content
- [ ] T4 Integrate current work from `feat/herd-shell-layout` in dependency order (route: delegated writer, one group at a time)
  - [x] G1 review reference: d99095707 64c0ec584 d17293c57 d8c735091 b79289f3b (picked clean with -x as d906076de 87b6f2054 3f554a57c 5fb1c1a4b 61c758d08; ticked after offline `pnpm install --offline --frozen-lockfile`, see Evidence)
  - [x] G2 WorkResult validation: 363480a0f 6ee6f3767 (picked clean with -x as ff4275501 163ba7485; see Evidence)
  - [x] G3 write admission: 1428ab0bb 95477e794 (+docs 5f56f7aac 514ed6e05) (picked with -x in source order 5f56f7aac 514ed6e05 1428ab0bb 95477e794 as b7a5f8476 83d703035 82bec6ac9 76a218b09; see Evidence)
  - [x] G4 Codex flags: 197c671e6 (picked clean with -x as 571e2ec61; see Evidence)
  - [x] G5 run-spawn bridge: 4be774e87 9d6d283b5 50097bc94 (+docs ae8afdf71 3392f9e59 1862eb001 0311e2090 eae5e94f6 70e5f32fb cd7d90b08; picked clean with -x in source order; see Evidence)
  - [ ] G6 conversation service and Global Connect
  - [ ] G7 one-window offline (review Pi-surface 0eeae04bb e5cdc7631 017c724e2 against Pi RPC consumers)
  - [ ] G8 P1 read-only containment
  - [ ] G9 P2 review-circuit observation
- [ ] T5 Visual WIP vs Ratatui (`window_surface.rs`, themes/kairo-classic; `main.rs`/`surfaces.rs` need manual rebase)
- [ ] T6 Retire verified dead code
- [ ] T7 Validate consolidated line (Node suite, Rust tests, packaging, offline smoke)
- [ ] T8 Clean branches and worktrees (including the prunable canary registration, last)

## Known risk

`src/global/conversation/service.js` changed on both sides; the base still has 37 cockpit/ink files and `service.js` imports `../ink/cockpit-usage.js`.

## Next step

T4 G6 (conversation service and Global Connect).
