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

- [x] T1 — Unify CODEX_HOME resolution (JS) + regressions: custom env, explicit arg, default, symlink; stdin-closed test.
- [x] T2 — Preserve stderr on timeout (JS) + regression.
- [x] T3 — Wrap multiline/long notices with scroll (Rust) + tests: multiline, long text in narrow terminal, final cause visible.
- [ ] T4 — Restart host from this worktree and reproduce; real Codex run (needs user authorization): valid answer + denied read outside snapshot.

## Routing

- T1–T3: delegated direct (writer trigger: 2+ non-trivial files, JS + Rust). Routed to one bounded writer sub-agent, worktree `agentic-harness-worktrees/ratatui-host`.
- T4: parent, after authorization.

## TDD

Mode: strict (source: global `~/.claude/CLAUDE.md` "Strict TDD Mode: enabled"). Runners: `node --test test/codex-sandbox.test.js`, `cargo test -p kairo-ui`.

## Acceptance

Analyst answers from a fresh session with confinement intact. If it still fails, the full error names the next blocker. Green mock tests alone do not close this.

## Delivery

Forecast ~250 authored lines; strategy `ask-on-risk`.

## Progress / evidence

### T1 — Unify CODEX_HOME resolution

- Added `resolveCodexHome({ codexHome, sourceEnv })` in `src/global/conversation/codex-sandbox.js`: explicit non-empty arg → non-empty `sourceEnv.CODEX_HOME` → `~/.codex`. `runCodexSandboxedBootstrap` now resolves it once and reuses the same value for `buildCodexSandboxProfile`'s SBPL profile AND `buildSandboxedCodexEnv`'s child env (previously each defaulted `~/.codex` independently and an explicit `codexHome` arg never reached the child env).
- Verified callers (`bootstrap-analyzer-adapters.js`, `service.js`) never pass `codexHome` today, so the new resolution is a pure widening (they get the same default behavior as before, now also honoring `CODEX_HOME` from the shell).
- RED: added `resolveCodexHome` import + 9 new tests to `test/codex-sandbox.test.js` before it existed → `node --test test/codex-sandbox.test.js` failed to load the module (`SyntaxError: ... does not provide an export named 'resolveCodexHome'`), all 23 tests reported as 1 failing suite.
- GREEN: implemented `resolveCodexHome`, `buildSandboxedCodexEnv(sourceEnv, resolvedCodexHome)`, and wired `runCodexSandboxedBootstrap` to resolve once → `node --test test/codex-sandbox.test.js`: 23/23 pass.
- New regression tests: custom `sourceEnv.CODEX_HOME` used for both profile and child env; explicit `codexHome` arg wins over env and reaches the child env; default `~/.codex` when neither is set; symlinked CODEX_HOME appears in the profile in both literal and realpath forms; spawn uses `stdio[0] === "pipe"` and `child.stdin.end()` is called.
- No sandbox permissions were widened (no `$HOME` subpath added) and no unsandboxed fallback was introduced.

### T2 — Keep stderr on timeout

- Timeout path now reports `sandboxed codex exec timed out after <timeoutMs>ms` plus the trimmed captured stderr (when non-empty) instead of dropping it. The message still starts with `"sandboxed codex exec timed out"`, so existing string/regex matches elsewhere (`cockpit-app.test.js`, `conversation-service.test.js`, `cursor-sandbox.js`'s own analogous message) are unaffected — verified via `rg -n "timed out"` across `test/` and `src/global/conversation/*.js` before changing the message.
- RED: covered by the same T1 RED run above (tests were added together since both touch the same file/module).
- GREEN: `node --test test/codex-sandbox.test.js`: 23/23 pass, including "timeout error includes captured stderr" (hung child, never closes, stderr emitted) and "a multiline config error on stderr with no output file surfaces the full stderr" (verifies the pre-existing close-path stderr capture still works for the full multiline text, not just the first line).

### T3 — Wrap multiline/long notices (Rust)

- `crates/kairo-ui/src/surfaces.rs`: added `wrap_text_segment` (word-wrap with character-wrap fallback for an over-long single word) and `wrap_notice` (splits on `\n`, wraps each segment to the inner width, prefixes the first output line with `⚠ ` and indents every other line by 2 spaces). Used in both the work-surface transcript notice and the analyst-picker notice.
- Picker popup height now adds `notice_rows` (the real wrapped line count for that popup's width) instead of a fixed `+4`, so a long/multiline notice grows the modal instead of being clipped.
- Fixed the work surface's scroll clamp: `start = chat.scroll_offset.min(total)` skipped every line once the offset reached or passed the total (an all-blank pane on "scroll to end"); changed to clamp against `total.saturating_sub(visible)` so a large scroll offset converges to showing the last `visible` rows — this is what makes the final wrapped notice line "reachable" rather than merely present in the `Line` vec.
- RED: added 3 new tests to the `surfaces::tests` module (`work_surface_wraps_multiline_notice_showing_every_line`, `work_surface_wraps_long_notice_in_narrow_area_and_reaches_final_token_when_scrolled`, `analyst_picker_modal_grows_to_fit_and_shows_a_long_wrapped_notice`) before `wrap_notice` existed → `cargo test` (in `crates/kairo-ui/`): 66 passed, 2 failed (multiline test passed coincidentally — it fit on one screen without wrapping; the narrow-area and picker-growth tests failed, buffer showed clipped/blank output).
- GREEN after implementing `wrap_notice`/`wrap_text_segment`, wiring both call sites, and fixing the scroll clamp: `cargo test`: 68/68 pass.
- Existing tests `notice_uses_amber_warn_not_error_red` and `work_surface_shows_notice_when_present` still pass unchanged.
- `cargo fmt` was run, but it reformatted 7 unrelated files in the crate (pre-existing drift from this repo's rustfmt/edition settings, nothing to do with this change) — those files were reverted with `git checkout --` and only `surfaces.rs` (verified `rustfmt --check --edition 2021 src/surfaces.rs` clean) was kept.
- `cargo clippy -p kairo-ui -- -D warnings`: FAILS, but only on pre-existing findings unrelated to this change — verified by `git stash`-ing this change and re-running clippy on the base commit (315cccdf3), which reproduces the identical 8 errors (3× `needless_return` in `main.rs`, an unused `Color` import and 2× `useless_conversion` in `surfaces.rs`'s pre-existing `render_usage`/sidebar code, none touched by this diff).

## Verification (commands run in the worktree)

- `node --test test/codex-sandbox.test.js test/bootstrap-analyzer-adapters.test.js`: 44/44 pass.
- `rg -l "codex-sandbox|timed out" test`: only `test/codex-sandbox.test.js` references `codex-sandbox.js` directly; other matches are unrelated providers (Cursor, OpenCode, etc.) and were not affected.
- `cargo test` (in `crates/kairo-ui/`, workspace has no root `Cargo.toml` — crate is standalone): 68/68 pass.
- `cargo fmt` (crate-wide invocation): applied; unrelated-file drift reverted, `surfaces.rs` kept and confirmed clean.
- `cargo clippy -p kairo-ui -- -D warnings`: FAILS on 8 pre-existing findings (confirmed present on base commit 315cccdf3, unrelated to this diff) → reported honestly as **partial** for this one check; every other required check passed.
- No JS lint script exists in `package.json` (`rg -n '"lint"' package.json` → no match) — nothing to run.

## Commits

- `918249227` — `fix(codex-sandbox): unify CODEX_HOME and keep stderr on timeout` (T1+T2, tests, this feature doc)
- `0613fdd4d` — `fix(kairo-ui): wrap multiline and long notices` (T3, tests)
- (this commit) — `docs(odd): record bootstrap analyst start progress`

## Next step

T4 — restart the host from this worktree and reproduce the original `thread/start` failure with a real (user-authorized) Codex run; confirm the CODEX_HOME fix and the now-visible full error together identify the next real blocker. The root cause of the original report is still NOT proven — T1–T3 fix verified inconsistencies, not a confirmed root cause.
