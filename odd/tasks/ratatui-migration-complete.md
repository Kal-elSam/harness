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
- Delivery strategy: `ask-on-risk`; chain strategy chosen by user: `feature-branch-chain` (tracker/integration branch `delivery/kairo-runtime-clean`; chained slices; only the full integration targets `main` at the end). Local commits only: no push, remote PRs, or merge to main until explicitly authorized.
- Budget deviation (recorded, no history rewrite): the ~400-line threshold was crossed during T3 before the strategy was asked. Net diff aae8e1923..tip (code, excl. odd/): +520/-35 = 555; accumulated by commits: +543/-58 = 601. Budget is measured by commits, not only net diff.
- Slices: S1 = T3 code commits (c2504ef77, f044f1d07, 1ea813f5c, e2491a756, 83916ba07) on top of the #412-#429 base + cherry-pick aae8e1923; S2 = T4 (coherent units with their tests, not split artificially).

## Tasks
- [x] T1 Consolidate a single delivery base; reconcile existing trackers.
- [x] T2 Incorporate #428 (`ffc0b1a59`) and #429 (`9d8cbde4d`).
  - Finding: both build on #412-#427 (59 commits past the delivery tip). User chose: fast-forward delivery to `9d8cbde4d`, then cherry-pick `ffc0b1a59` (sibling, dry-run merge clean).
- [x] T3 Review settings-provider-connections.js and crates/kairo-ui (credentials, errors, concurrency, lifecycle); fix only reproduced faults.
- [x] T4 Analyst recovery flow in Ratatui (picker -> explicit choice -> access confirm -> analysis -> proposal -> approval; never auto-pick first).
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
  - DECISION D2 (user): highlighted first row + a fresh deliberate Enter is an explicit choice; no forced move. "No auto-select" means no execution without a user action, not no initial focus. Rules: opening the picker or highlighting a row runs nothing; the opening event and key repeats never confirm; a changed catalog or vanished option is never silently substituted; Esc cancels; choosing an analyst does not approve the resulting team. Key tests: open -> zero executions; deliberate Enter -> exactly one analyze on the displayed candidate.
  - DECISION D3 (user): recovery may highlight a suggested analyst but always needs a fresh Enter before analyzing (D2 protections apply; no forced move). Eligible suggestion -> shown highlighted, user may pick another. None qualifies -> open picker with the cause; no automatic fallback, access requirements not relaxed. Open, cancel, empty catalog, access denied never consume a retry. Attempt is recorded right before the analysis starts, under lock, after revalidating candidate/access; a started analysis that fails or is interrupted counts. Choosing an analyst neither approves the proposal nor replaces the active team. Verified current defect: `started` is written before preflight/selection (team-recovery.js:178).
  - All T4 decisions closed (D1-D3). Implementation NOT yet authorized: the planner's recommendation to authorize T4 does not replace the user's own authorization.
- 2026-10-09: T4 implemented (user-authorized; delegated writer, strict TDD; runners: node --test, cargo test -p kairo-ui). Commits (local, no push): dd27bb13e D1 pending proposal store + approve/reject bound to proposal id and base hash, atomic apply; 66ac4c05e D2 fresh deliberate Enter gate (300 ms chain/repeat), no silent substitution; c957dda1d D3 recovery suggests analyst, waits for human pick, `started` recorded only after revalidation. Slice S2 = +1808/-89 net (+1810/-91 by commits), excl. odd/.
  - Verified by parent at tip c957dda1d: cargo test -p kairo-ui 377/377; JS subset (team-recovery, auto-recovery-e2e, store-untouched, sidecar, rpc-stdio) 209/209; clippy `^warning` count 64 = baseline (layout.rs:62 deny error pre-existing). Worker reported: full JS suite 2979 pass/0 fail/5 skipped, 411/411 on the T4 set (not re-run by parent).
  - Pending / open after T4: (a) product question: should a manual human pick bypass the 10/20-min backoff and 3-attempt bound after a failed attempt (currently "retry-later")? (b) in-flight runs keep assignment only spy-tested, no executePlan fixture; (c) recovery modal Enter not freshness-gated (only the picker); (d) readSetup().recovery.pending ignores manual proposals; a base-changed proposal still shows as proposed and only refuses on approve; (e) Pi extension auto-refresh no longer analyzes (D3) and shows nothing on analyst_selection_required; (f) G6 (analyst access status routing) not covered; (g) end-to-end in real PTY with real Pi pending in T7. Worker note: it reset one of its own local commits after a rustfmt mangle and redid it.

  - DECISION D4 (user, T4 follow-up; NOT yet authorized to implement): a fresh manual analyst choice bypasses ONLY the internal `retry-later` and `retries-exhausted` gates (team-recovery.js:70/72; gate applied at :198 before analystChoice at :209, and again under lock at :245). One Enter -> at most one analysis, no automatic retries. Do NOT bypass provider cooldown/Retry-After, quota, access, budget, or lock. Keep attempt history, record manual origin, never silently reset counters. Revalidate candidate and base team; active team stays intact until approval. Min tests: manual choice during backoff and after the 3rd failure; blocked provider still blocks; double submit does not duplicate analysis.

  - D4 implemented (user-authorized; delegated writer, strict TDD): fe5a36ce0 `feat(recovery): let a manual analyst choice bypass the retry throttle` (+155/-9, 4 files, JS only). `decideTeamRecovery({manual})` skips only retry-later/retries-exhausted, both gates (initial + under lock); terminal outcomes still `already-handled`; origin recorded as `origin: "manual"` on started/failure/proposed records; attempts continue previous+1; double submit -> second call `analysis-in-progress`, analyze runs once. Provider cooldown/Retry-After/quota have no seam in this module: they reach it only as catalog exclusion/eligibility; blocked analysts stay `analyst-unavailable`. Parent verified at tip: 220/220 on team-recovery, auto-recovery-e2e, availability-fingerprint, sidecar, rpc-stdio; read the bypass code (team-recovery.js:68-76). Worker reported full JS suite 2987 pass/0 fail/5 skipped (not re-run by parent). Two existing regression tests were rewritten to use `analystChoice: null` for the automatic path.
  - NEW GAP from D4 (found by worker): during backoff/exhaustion an automatic refresh returns `skipped` before the picker can open, so the manual-bypass is unreachable from the Ratatui UI until the picker flow requests the selection step without the throttle. Rust side untouched; UI path for the manual bypass is untested. Needs a decision/authorization.

  - DECISION D5 (user; implementation NOT yet authorized): close the D4 reachability gap inside T4 before T5. Three separate actions: (1) automatic refresh updates state only: no modal, no analysis; (2) explicit recovery request (`R`) may open the picker during backoff or exhaustion, without analyzing and without consuming an attempt; (3) deliberate Enter starts at most one analysis, applying D4 and keeping access, eligibility, budget and lock. If a pending proposal exists, reopen it; never generate another silently. Required proof: real Ratatui action -> sidecar -> backend -> picker -> Enter, both during backoff and after the 3rd failure (a direct `analystChoice` call does not cover it). Verified: gate returns `skipped` before selection is prepared (team-recovery.js:198-209).

## Next step
Implement D5 (picker reachable during backoff/exhaustion, end-to-end proof) after user authorization, then T5 (remove packages/kairo-vscode and legacy UI).
