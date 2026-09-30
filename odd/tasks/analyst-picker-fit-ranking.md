# Analyst picker: fit ranking + honest absences

## Objective
Rank Bootstrap Analyst picker rows by analyst-profile fit (existing scores/tags), hide unusable models, and explain provider absences without inventing billing causes.

## Why
Capture showed only Codex; Claude missing with no honest reason. Preferred-adapter bias and auto-★ hid the real recommendation signal.

## Scope
- `src/global/host/project-team-sidecar.js` curation + picker notice
- `crates/kairo-ui` analyst picker (no auto-★) + wire preflight notice
- Soften team_attention copy that invented “no funds”
- Tests Node + Rust

## Out of scope
- Pi `get_state` timeout (separate)
- Changing `computeBootstrapAnalystCatalog` portfolio math

## Tasks
- [x] T1 Remove PREFERRED_ANALYST_ADAPTERS; rank by fit + evidence + name
- [x] T2 recommendedModel only when it survives filter (never models[0])
- [x] T3 Compact picker absence notice (e.g. Claude: no disponible…)
- [x] T4 Rust: drop auto-★; paint preflight notice on modal
- [x] T5 Honest team_attention (no invented funds)
- [x] T6 Tests + release rebuild

## Acceptance
- Eligible Claude can rank above Codex by tags/scores
- Ineligible Claude absent + compact notice, no disabled rows
- ★ only for real recommendedModel
- Confirm still revalidates availability

## Extension: usable `kairo` startup + analysis + team (approved 2026-09-30)

Branch `feat/kairo-startup-analyst-team` (worktree from c2382a261). No push, no merge, no #362 changes, no real-account use without authorization.
TDD: enabled (project strict TDD), runner `node --test <file>`; Rust `cargo test --manifest-path crates/kairo-ui/Cargo.toml`.
Route: delegated direct, one writer per unit (mapper evidence: 4+ files per unit).
Estimated delivery: ~600+ changed lines -> delivery strategy `ask-on-risk`; ask chain strategy before pushing (not authorized to push anyway).

- [x] T7 Startup: `session_start` no longer awaits usage/availability probes (index.js ~:789); probes run in background with `.catch`. Test with slow/never-resolving stubs. Do not raise the 8s timeout blindly; add late-get_state bridge test only to characterize. (commit 7ef366741)
- [x] T8 Unified analyst profile: `BOOTSTRAP_ANALYST_PROFILE` (project-strategy.js:65) = reasoning + coding + architecture + design; `buildAnalystPrompt` investigates languages/structure/deps/constraints/risks and justifies team with repo evidence. (commit 063071ba0). Finding: no `architecture`/`design` capability keys exist; mapped to reasoning+coding via focusAreas; a pool with thin coding evidence yields no recommendedModel.
- [ ] T9 OpenCode Go bootstrap analyzer adapter (read-only constraints, honest isolation level, no silent provider substitution, no auto-activation).
- [ ] T10 Exclusion causes (quota exhausted / unavailable verified -> exclude; unknown access and unscored != unavailable) plumbed into picker curation + notice.
- [x] T11 Rust modal: loading/error/exclusion states; cargo test. Modal opens in Loading on request, Error state with r retry / Esc close, per-provider exclusion cause lines (pickerNotice fallback when field absent); rpc stdio now forwards exclusionCauses. (commit: "feat(kairo-ui): show loading, error and exclusion causes in analyst modal"; hash in report)
- [ ] T12 (partial) Built host binary (dist/kairo-ui/darwin-arm64, Node 22, cargo release) and PTY smoke PASS (60x30, 100x30, 160x48). Local kairo NOT retargeted: awaits authorization, backup and rollback. Node 24 run and real-provider acceptance (T13) pending.
- [ ] T13 Human acceptance with real authorized provider (pending user; mocks never count as 100%).

Commits per task (evidence recorded below).

## Scope update (user-approved 2026-09-30): review findings + team presentation
Verified review findings: Go ask agent lacks webfetch/external_directory deny and mutates global opencode.json; ranking is tag/name based; prompt does not consume the shared profile; unscored/unverified models hidden. Corrections below reopen T9/T10 acceptance.
Assumptions (recorded): unscored-but-available models are selectable (lower evidence confidence, no star); unverified access stays excluded and shows as "verifying", never as missing quota.

- [x] T14 Go isolation: per-run inline OpenCode config via `OPENCODE_CONFIG_CONTENT` (no disk write, no global opencode.json mutation; beats project config in precedence), deny webfetch + external_directory (plus bash/edit/task/write), tests prove the generated config and an untouched global file in a temp HOME; isolation label stays `restricted`, canaryTested false (no real opencode run). (commit: in report)
- [x] T15 (commit: in report) Composite analyst fit: rank = profile fit (shared profile capabilities) + capabilities + benchmarks + evidence confidence; availability gates usability only; benchmark missing lowers confidence, not eligibility. Prompt and ranking consume ONE profile definition (derive prompt focus from BOOTSTRAP_ANALYST_PROFILE). Numeric fit exposed per candidate; no invented scores.
- [x] T16 Team presentation: incomplete or blocked team -> hide entire roles list (no partial team); complete + approved + validated -> show roles; saved assignments are never deleted. Projection `team.presentation = {state: complete|incomplete|blocked|verifying, rolesVisible, reason}` (src/global/conversation/team-presentation.js); Rust tolerant parse, absent => legacy visible; role edit refused while hidden. Store byte-identity tested. (commit: in report)
- [x] T17 Sidebar: compact incomplete-team notice + re-analyze action, reachable when Pi fails; "verification in progress" state that never claims missing quota. Re-analyze = existing `a` key and `/analyze` (bridge `project.preflight`, sidecar-driven, independent of Pi get_state); notices per state with `a = re-analyze` hint. (commit: in report)
- [ ] T18 Node 24 run, list the 6 skipped tests, re-run build + PTY.
- [ ] T9/T10 re-accepted only after T14/T15 pass.
