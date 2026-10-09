# Complete Ratatui Migration and Remove Legacy Interfaces

Feature: `ratatui-migration-complete`
Base branch: `delivery/kairo-runtime-clean` (worktree `~/Desktop/agentic-harness-worktrees/kairo-runtime-clean`)
Mirror: Engram topic `odd/ratatui-migration-complete/tasks`

## Objective
Ratatui is the only interface. Remove the panel and all prior interfaces. Verify a real install.
Keep Pi RPC as the engine and keep legacy CLI commands/aliases.

## Constraints
- Do not alter pending changes on `feat/herd-shell-layout`.
- No config or personal data deletion.
- Push, remote merges, publishing, and moves to `main` need explicit user authorization.
- Out of scope: automating the P2 review circuit.
- TDD: not resolved yet (record mode/source/runner before the first behavior change).
- Delivery strategy: `ask-on-risk` (default). Forecast > 400 lines; chain strategy to be asked before the next commit that crosses it.

## Tasks
- [x] T1 Consolidate a single delivery base; reconcile existing trackers.
- [x] T2 Incorporate #428 (`ffc0b1a59`) and #429 (`9d8cbde4d`).
  - Finding: both build on #412-#427 (59 commits past the delivery tip). User chose: fast-forward delivery to `9d8cbde4d`, then cherry-pick `ffc0b1a59` (sibling, dry-run merge clean).
- [x] T3 Review settings-provider-connections.js and crates/kairo-ui (credentials, errors, concurrency, lifecycle); fix only reproduced faults.
- [ ] T4 Analyst recovery flow in Ratatui (picker -> explicit choice -> access confirm -> analysis -> proposal -> approval; never auto-pick first).
- [ ] T5 Remove packages/kairo-vscode, publishing, exclusive tests/docs, exclusive cockpit/Pi UI code; interactive legacy commands open Ratatui or a migration error.
- [ ] T6 Pi source in third_party/pi (#353 gaps); identify #362 before deciding.
- [ ] T7 Final validation: Node 22/24 suite, Rust checks, clean install, PTY with real Pi, prebuilt matrix on the final tip.

## Progress
- 2026-10-09: T1 explored. Delivery worktree clean at 789e0815b. No tracker yet for this feature.

- 2026-10-09: T2 done. Fast-forwarded to 9d8cbde4d (#412-#429 chain), cherry-picked ffc0b1a59 as aae8e1923. 319/319 tests pass (conversation, bridge, sidecar, rpc-stdio, ops-mutations, pty-kill) on Node 22.23.0. Node 24 and Rust checks pending (T7). Route: inline (git state + test runs).

- 2026-10-09: T3 review done (read-only worker, route: delegated). Fixed with RED/GREEN: secrets stripped from yielded login CLI env (c2504ef77); terminal_cancel honored, UI no longer blocked (f044f1d07). cargo test -p kairo-ui 352/352.
  - Open, unreproduced (not fixed): non-terminal connect has no cancel; preview replay/overlapping connects; stale preview accepted in provider_connect_flow.rs; api.connect error message forwarded to UI; sidecar resolved from cwd (bridge.rs); silent sidecar death; stop can hang on full pipe; interleaved writeln; SIGKILL orphans provider processes; terminal_session_result send dropped.
  - Done after user decision: exact-argv validation before spawn (1ea813f5c), parity test vs LOGIN_ARGV, zero-spawn proven by counting seam (21 rejected payloads, 0 spawns); deferred_events replay integration test (e2491a756); the 2 new clippy warnings (unused Command/Stdio import from f044f1d07, plus dead_code from our own code) removed (83916ba07). cargo test -p kairo-ui 359/359; node tests 131/131.
  - Limit: argv validation restricts operations, does NOT guarantee the PATH-resolved executable identity. Separate hardening task.
  - Open: clippy still fails on pre-existing layout.rs:62 (redundant_comparisons); warning count back to baseline (64 `^warning` lines). Prior debt not resolved.
- 2026-10-09: T4 mapped (read-only, delegated). Gaps G1-G7 (see worker report summary): G1 re-analyze replaces active team with `suggested` (service.js:875, persist=true); G2 Enter on pre-highlighted row 0 (analyst_picker.rs:614); G3 pending recovery proposal not reopenable after Esc/restart; G4 recovery auto-picks analyst; G5 no-qualifying-analyst recovery never opens picker; G6 analyst-status notices route nowhere; G7 approve is a single keypress not bound to the viewed proposal.
  - DECISION D1 (user): keep active team running; store re-analysis result as a separate pending proposal. Contract: re-analysis never modifies the active team nor blocks chat; pending proposal persists and reopens after Esc/restart; reject/fail keeps active team; approve identifies the viewed proposal and verifies the base team unchanged (else require new review); atomic apply; in-flight runs keep their assignment.
  - Open decisions (one at a time): D2 Enter on row 0 as explicit choice (G2); D3 recovery auto-pick vs always ask (G4). No implementation authorized yet.

## Next step
T4: close D2/D3 with the user, then implement. Unreproduced medium/low T3 findings stay open (listed above).
