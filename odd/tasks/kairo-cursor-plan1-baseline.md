# Kairo Cursor Plan 1 — clean Ratatui+analyst baseline

Locator: `odd/tasks/kairo-cursor-plan1-baseline.md`
Worktree: `agentic-harness-worktrees/kairo-plan1-baseline`
Branch: `feat/kairo-cursor-baseline`
Engram mirror: `odd/kairo-cursor-plan1-baseline/tasks` (project `harness`)

## Objective

Establish a clean integration baseline from Ratatui and preserve analyst T28/T29 so Claude can build native setup/Ops depth on a shared hash. Cursor owns integration.

## Problem

`feat/ratatui-host` and `feat/kairo-startup-analyst-team` diverged (125/199). Herd-shell dirty WIP must not be pulled in. Cockpit/Ink must stay retired; Pi `.5` stays the RPC engine.

## Scope

### In
1. Baseline merge: Ratatui base + analyst T28/T29 (eligible assignment, revalidated approve, analysis progress, team proposal).
2. Integrated tests: analyst→analyze→propose→approve→chat; access loss→recovery→approve/reject; sessions/drafts/restore.
3. Later: integrate Claude finished commits; full suites; package validation (separate auth for real provider / push / PR).

### Out
- herd-shell session-handoff / context-fill dirty tree
- Restoring cockpit/Ink product UI
- Push, PR, merge, publish without separate authorization

## Constraints

- Rust = only interactive UI (`kairo`/`start`/`resume`/`ui`/`shell`)
- Pi fork `0.87.1-kairo.5` = RPC engine only
- Conflict resolution: prefer analyst for picker/team/UI conflicts; never reintroduce retired product UIs

## Tasks

- [x] P1-T1 — Merge analyst into Ratatui baseline; resolve conflicts; deliver base hash to Claude
- [x] P1-T2 — Integrated tests (Rust UI ↔ real sidecar; label simulations)
- [ ] P1-T3 — Integrate Claude commits; full suites; record failures honestly
- [ ] P1-T4 — Final package validation evidence (binaries, columns, Windows CLI); no remote delivery without auth

## Routing

- P1-T1: delegated-direct writer (merge touches many files; parent owns strategy)
- Route: delegated | Trigger: writer (2+ non-trivial) + preparation

## TDD

Mode: unknown for this integration branch — run focused then full applicable suites; do not invent RED for merge-only port.

## Acceptance (P1-T1)

- Entries `kairo`, `start`, `resume`, `ui`, `shell` coherent
- Analyst + team work from Rust
- Base commit hash published for Claude


## Progress / evidence

### P1-T1 — Merge baseline

- Base: `feat/ratatui-host` @ `4fd5e277e`
- Integrated: `feat/kairo-startup-analyst-team` @ `87f063eec`
- Conflict policy: took analyst (`--theirs`) for all 19 conflicted paths after verifying Rust UI function set is a superset (0 ratatui-only fns in `main.rs`) and deletions replace the old simple picker.
- Preserved: Pi `0.87.1-kairo.5`; CLI `kairo`/`ui`/`start`/`resume`/`shell` → `launchRatatuiHost`; retired cockpit/Pi opt-outs still throw.
- Dropped expired `.npmrc` Pi.5 cooldown exclude (past 2026-09-29).
- Did **not** import herd-shell dirty WIP (session-handoff / context-fill).
- Merge commit / base hash for Claude: `84d7f8573df91d2c41b587b81c8281a52fbcb99e`
- Focused Node: 212/212 pass (`team-presentation`, `project-strategy`, `project-analysis`, `project-team-sidecar`, analyst picker/access, `team-recovery`)
- `cargo test -p kairo-ui`: 295/295 pass (includes T28 analysis_progress tests)


### P1-T1 follow-up — pre-existing analyst test drift

- `conversation-service` bootstrap assertion still expected Explorer+Architect floor; T29 keeps analyst-justified roles only → assert `["Architect"]`.
- Regenerated `crates/kairo-ui/fixtures/verify-then-pick.ndjson` after aptitude explanation text drift (`UPDATE_WIRE_FIXTURE=1`); Rust `preflight_verify_wire_fixture_roundtrips_through_the_host` pass.
- These two failures already reproduced on pure `feat/kairo-startup-analyst-team` before the merge; not introduced by conflict resolution.


### P1-T2 — Integrated analyst→approve→chat and recovery approve/reject

- Did **not** edit Claude-owned impl: `settings-sidecar.js`, `ops-sidecar.js`, `kairo-ui-rpc-stdio.js`, `setup.js`, ops/settings panels.
- Real providers: not invoked (authorization not granted); every simulation labeled `SIMULATED` in tests/scripts.
- Node integrated (REAL `runKairoUiRpcStdio`): `test/plan1-analyst-chat-recovery-integrated.test.js` — 4/4
  - analyst→analyze→proposal→approve→chat
  - recovery.preview→apply
  - recovery.preview→reject
  - draft stop→restore
- Extension E2E reject path: `test/team-auto-recovery-e2e.test.js` (+reject keeps prior Go team)
- PTY Rust↔sidecar (SIMULATED providers): `scripts/kairo-ui-team-flow-pty-e2e.py` + fixture
  - approve-chat, recovery-reject, recovery-apply @ 100×30 — all PASS
- Smoke script: `package.json` → `smoke:kairo-ui-team-flow-pty`


### P1-T2 precision (post-review)

- Integrated tests use the **real sidecar** (`runKairoUiRpcStdio`) but **SIMULATE** Pi, analysis/approval bodies, recovery decisions, and chat answers.
- They prove wiring + navigation (ops, notices, set_model, prompt routing), **not** full real-provider / real-analyst behavior.
- Those real-behavior checks remain **pending** (require separate provider authorization + post-Claude package re-run).


### P1-T2 expand — multi-size / resize / real draft store / reject+cancel

Expanded without touching Claude-owned impl. Host Darwin arm64, binary `dist/kairo-ui/darwin-arm64/kairo-ui`.

| Check | Result | REAL vs SIMULATED |
|---|---|---|
| Node `plan1-analyst-chat-recovery-integrated` | 4/4 | REAL sidecar op loop; SIMULATED Pi/analysis/recovery/chat + in-memory draft store |
| Node `plan1-session-draft-real-store` | 1/1 | REAL `saveDraft`/`loadDraft` → `draft.json` under temp `HARNESS_HOME`; SIMULATED Pi only |
| Node `team-auto-recovery-e2e` (+reject) | 4/4 relevant | SIMULATED eligibility; reject keeps prior Go team |
| PTY `approve-chat` @60/100/160 | PASS | REAL Rust PTY + sidecar; SIMULATED team/chat |
| PTY `recovery-reject` @60/100/160 | PASS | reject: no `set_model`, no apply — prior team kept |
| PTY `recovery-apply` @60/100/160 | PASS | SIMULATED apply body |
| PTY `recovery-cancel` @60/100/160 | PASS | Esc: neither apply nor reject; no `set_model` |
| PTY `resize-preserve` 100→60→100 | PASS | content + editor input survive SIGWINCH |
| PTY `draft-restore` stop→restart | PASS | REAL `draft.json` under isolated HOME+`KAIRO_SESSION_ID`; never user `~/.harness` |

Evidence dir: `/tmp/kairo-pty-team-flow-p1t2/`. Smoke: `pnpm smoke:kairo-ui-team-flow-pty`.

Test gotchas (not product defects): empty-compose chrome steals leading `r`/`R` (markers must avoid hotkeys); Node harness needs a short post-ready delay before `stop`+`stdin.end` or the op can race the readline attach.

P1-T2 remains open for post-U2 re-run. P1-T4 still open. No Claude files edited; no real providers.


### Packaging prep (baseline — NOT P1-T4 close)

Observed on `feat/kairo-cursor-baseline` @ `79771262a` (+ this docs commit), host Darwin arm64. **Do not declare P1-T4 closed.** Re-run the same checks on the final package after Claude U2+ integration.

| Check | Result | Limit |
|---|---|---|
| `scripts/build-kairo-ui-binaries.sh` | 4/4 keys built: darwin-arm64 (~1.7M Mach-O), darwin-x64 (~1.8M Mach-O), linux-arm64 (~1.4M ELF), linux-x64 (~1.5M ELF) | Artifacts local/gitignored; not published |
| `scripts/verify-kairo-ui-clean-install.sh` | PASS (hand-staged + npm-pack extract; selection never invokes cargo) | Foreign runtime exec gaps honest: darwin-x64 needs Rosetta; linux-* need Linux/qemu |
| `test/kairo-ui-prebuilt.test.js` | 7/7 | — |
| `test/launch-ratatui-host.test.js` | 18/18 (after `pnpm install` in worktree) | — |
| Windows `ui` | Explicit error: use non-interactive CLI / `kairo setup`; no spawn | CLI-only retained |
| Host `--v3-capture` from prebuilt (PATH without cargo) | exit 0, **52** fixtures incl. 60×30 / 100×30 / 160×48 | Auto fixtures, **not** human visual approval |
| `kairo-ui-pty-e2e.py` @ 60/100/160 with packaged binary | PASS (mock sidecar) | Mock sidecar only — not real providers |

Claude note: U1 committed with review **declined** (not approved); U2 may continue under that decision. Cursor did not touch Claude-owned impl files during this packaging prep.
