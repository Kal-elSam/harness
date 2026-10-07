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

## Tasks

- [x] T1 Freeze and preserve (backup verified)
- [x] T2 Isolated integration worktree from `aa66c7c90`
- [x] T3 Classify by content
- [ ] T4 Integrate current work from `feat/herd-shell-layout` in dependency order (route: delegated writer, one group at a time)
  - [ ] G1 review reference: d99095707 64c0ec584 d17293c57 d8c735091 b79289f3b (picked clean with -x as d906076de 87b6f2054 3f554a57c 5fb1c1a4b 61c758d08; not ticked: full suite blocked by missing node_modules, see Evidence)
  - [ ] G2 WorkResult validation: 363480a0f 6ee6f3767
  - [ ] G3 write admission: 1428ab0bb 95477e794 (+docs 5f56f7aac 514ed6e05)
  - [ ] G4 Codex flags: 197c671e6
  - [ ] G5 run-spawn bridge: 4be774e87 9d6d283b5 50097bc94
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

T4 G1.
