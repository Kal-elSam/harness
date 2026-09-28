# Bootstrap Analyst start recovery

Locator: `odd/tasks/bootstrap-analyst-start.md` (worktree `agentic-harness-worktrees/ratatui-host`, branch `feat/ratatui-host`)
Engram mirror: `odd/bootstrap-analyst-start/tasks` (project `harness`)

## Objective

Fix verified inconsistencies in the sandboxed Codex Bootstrap Analyst start and surface the full error.
The root cause of the reported `thread/start` failure is NOT yet proven.

## Problem (verified at 315cccdf3)

- `codex-sandbox.js`: `buildCodexSandboxProfile` / `runCodexSandboxedBootstrap` default `codexHome` to `~/.codex` independently of `sourceEnv.CODEX_HOME`; an explicit `codexHome` never reaches the child env. Codex and the sandbox can disagree on CODEX_HOME.
- `codex-sandbox.js`: the timeout path resolves `"sandboxed codex exec timed out"` and drops captured stderr.
- `crates/kairo-ui/src/surfaces.rs`: work-surface and picker notices render as one unwrapped `Line`; long or multiline errors are clipped at the pane width (transport keeps the full text).

## Scope / constraints

- One CODEX_HOME resolution: explicit arg → `sourceEnv.CODEX_HOME` → `~/.codex`; used for both child env and SBPL profile.
- Keep stdin closed (pipe + end). No widening of sandbox permissions to `$HOME`, no unsandboxed fallback.
- Real Codex run requires explicit user authorization for provider + session.

## Tasks

- [ ] T1 — Unify CODEX_HOME resolution (JS) + regressions: custom env, explicit arg, default, symlink; stdin-closed test.
- [ ] T2 — Preserve stderr on timeout (JS) + regression.
- [ ] T3 — Wrap multiline/long notices with scroll (Rust) + tests: multiline, long text in narrow terminal, final cause visible.
- [ ] T4 — Restart host from this worktree and reproduce; real Codex run (needs user authorization): valid answer + denied read outside snapshot.

## Routing

- T1–T3: delegated direct (writer trigger: 2+ non-trivial files, JS + Rust).
- T4: parent, after authorization.

## TDD

Mode: strict (source: global `~/.claude/CLAUDE.md` "Strict TDD Mode: enabled"). Runners: `node --test test/codex-sandbox.test.js`, `cargo test -p kairo-ui`.

## Acceptance

Analyst answers from a fresh session with confinement intact. If it still fails, the full error names the next blocker. Green mock tests alone do not close this.

## Delivery

Forecast ~250 authored lines; strategy `ask-on-risk`.

## Progress / evidence

(pending)

## Next step

T1–T3 via one writer.
