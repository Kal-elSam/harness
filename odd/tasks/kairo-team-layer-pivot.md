# Kairo team-layer pivot — cleanup first

Objective: realign the repo to Kairo as a dynamic team layer installed into each CLI (gentle-ai style), retiring the standalone Ratatui UI and the Pi host before building provider registry, proportional split and `kairo team export`.
Branch: `refactor/retire-ui-pi` (from `delivery/kairo-runtime-clean` @ 0650a8f32). Delivery: ask-on-risk. Runner: `npm test` (node --test), run by the parent outside any sandbox.

## Specs

- S1. User (verbatim): "de acuerdo, pero, entonces primero demos ir depurando, reacomodando, ajustando y reinvidicando todo hacia este camino, debemos hacer limpieza neuvmaente".
- S2. User (verbatim): "ok procede" — reply to "¿Retiramos la interfaz Ratatui y Pi por completo, o la congelamos como tablero?" with the recommendation to retire completely. Interpreted as: retire completely.
- S3. Retire together (the UI depends on Pi: `src/global/host/kairo-ui-rpc-stdio.js:416`): `crates/kairo-ui`, the Ratatui sidecar and launcher, `pi-rpc-bridge`, `launch-gentle-shell`, `src/global/host/extension`, `third_party/pi`, `src/global/ink`, CLI commands `host`, `shell`, `ui`, their scripts, tests and package.json scripts/deps. Remove only code with no remaining KEEP dependents; everything stays recoverable in git history.
- S4. KEEP intact: `src/global/intelligence`, `runtime`, `provider-connections`, `mcp`, and commands `run`, `sync`, `setup`, `connections`, `status`, `doctor`, `install` (mapping 2026-10-21).
- S5. Assumption (not a user decision): bare `kairo` and the retired commands print a short message pointing to `kairo status` / `kairo setup` instead of launching a UI.
- S6. No push, PR, merge, or branch/backup deletion without explicit user approval.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T0 | S6 | inline | done | 0650a8f32 cache fix committed; branch created |
| T1 | S3-S5 | delegated team-builder-codex (Claude quota CRITICAL) | done | 2039 files / ~513k LOC removed; RED 0/4 -> GREEN 4/4 (test/cli-retired-ui.test.js); see L4 |
| T2 | S3 | parent: full suite outside sandbox; Codex scratch verifier + parent cross-vendor diff review (risk items 3, 5) | done | npm test 3307 pass / 0 fail; no package-lock.json in repo, so no lockfile to reconcile; see L4 |
| T3 | S1 | inline: archive odd/tasks docs that no longer serve the direction | done | 6 docs moved to odd/archive/ (ratatui-migration-complete, kairo-ui-real-use-polish, kairo-workspace-shell, unified-kairo-workspace-completion, kairo-pi-parity, cockpit-trust-recovery); multiple-kairo-sessions kept (start/resume/list remain) |
| T4 | S1 | explorer: classify integrations, control-plane, next, architect | pending | |
| T5 | S6 | user decision: merge delivery line into main; prune branches/backups | pending | |

## Log

- L1 (2026-10-21) Sam: "de acuerdo, pero, entonces primero demos ir depurando, reacomodando, ajustando y reinvidicando todo hacia este camino, debemos hacer limpieza neuvmaente".
- L2 (2026-10-21) Mapping (team-explorer): engine KEEP; UI crate 23.7k Rust LOC, third_party/pi ~546 MB, Pi bridge on the UI critical path; legacy cockpit source already gone; `kairo team export` absent.
- L3 (2026-10-21) Sam: "ok procede" (retire completely). T0 done.
- L4 (2026-10-21) T1/T2: removed third_party/pi (1917 files), crates/kairo-ui, dist/kairo-ui, 20 host files (incl. workspace-snapshot.js, so fix 0650a8f32 is retired with the UI), 33 scripts, 42 tests, docs/classic-look.md, dep @kal-elsam/kairo-pi-coding-agent and UI-only npm scripts (also prepare:acceptance-evidence, whose script was UI-only). Kept: host/workspace-cache.js, host/project-team-sidecar.js, src/global/ink (still used by setup/operations). Parent fixed 2 stale tests in test/cli-default-entry.test.js to S5 and restored an escaped em dash in package.json description. npm install fails with an internal npm error (edgesOut null, npm under ~/.hermes/node); not investigated, suite runs without it. Engram mirror pending.
