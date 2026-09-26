# Kairo Ratatui Host (single visual UI)

## Objective

Replace Kairo's interactive UI with one Rust/ratatui host. Pi keeps the agent, conversation, and sessions. Kairo keeps agents, routing, and USAGE. Pi-TUI shell and legacy cockpit stay temporary bridges only — not product alternatives. First deliverable: a usable replacement, not a visual demo.

## Problem

Pi-TUI layout (sidebar / chat / USAGE) works functionally but cannot meet the product visual bar after bounded polish. Continuing dual/triple UIs wastes time. We need one host that owns chrome and paint.

## Why

Pi already exposes `--mode rpc` (JSONL) so agent and UI can separate; RPC does not transport chrome. Ratatui owns layout surfaces. Herdr is visual reference only — not multi-pane/PTY multiplexer scope.

## Scope

### In

- `kairo ui` eventually launches one terminal-owning process: ratatui.
- Local Node bridge feeds existing `kairo.workspace-shell/v1` snapshot and supervises Pi via RPC JSONL.
- Host draws: sidebar, chat, editor, notices, USAGE.
- Same arrangement: 28-col sidebar when wide (≥90 cols), compact under 90 cols, single chat center.
- Essential interaction before cutover: streaming, tools/errors, edit/send, cancel, scroll, agent select, Kairo commands/dialogs, model switch, session resume/create/fork. No model → UI still opens with honest block + retry.
- Ship macOS + Linux binaries from the npm package (platform/arch select). Windows: explicit error for `kairo ui`; non-visual commands keep working.
- Default switch only after functional parity + visual approval; then remove product routes/docs that present Pi-TUI or cockpit as alternative UIs.

### Out / non-goals

- PTY panes, multiplexer, multi-chat splits
- Pixel-perfect Herdr clone
- Designing further Pi-TUI chrome or cockpit visuals
- npm publish / push / PR without explicit remote authorization

## Constraints

- Worktree: `~/Desktop/agentic-harness-worktrees/ratatui-host` on branch `feat/ratatui-host`.
- During build, old shell may remain for daily use; after cutover it is not a second face.
- Additive snapshot schema only until cutover consumers migrate.
- Fail-closed agent states (no invented working/done).
- `--legacy-cockpit` receives no new features; bridge-only until cutover docs cleanup.

## Authorized scope

User-accepted plan "Kairo: un solo host visual con ratatui" (2026-09-26). Supersedes herd-shell visual polish as the product UI destination; herd-shell data/layout contracts (snapshot, 28/90) remain reusable inputs.

## Acceptance criteria

- [ ] Host paints distinguishable sidebar, work surface, USAGE bar (color TTY captures; your approval required)
- [ ] Bridge: RPC events, engine crash/restart, no-model block, honest states, resize, focus, input, streaming, session identity
- [ ] Real TTY macOS+Linux at 60×30, 100×30, 160×48 with live agents/USAGE/conversation
- [ ] Install from built package selects correct binary
- [ ] Default `kairo ui` → ratatui only after parity + visual approval; Pi-TUI/cockpit no longer documented as product UIs

## TDD

- Mode: strict (project Strict TDD Mode).
- Runner: `node --test` (bridge/harness) + `cargo test` (host).
- RED before implementation; never invent evidence.

## Delivery

- Strategy: `ask-on-risk` (default). Forecast ≫400 lines → ask chain strategy before PR.
- No publish/push without remote auth.
- Cutover of default is a separate gate after visual approval.

## Tasks

- [x] R0 Feature doc + mark herd-shell visual path superseded (bridge-only)
- [x] R1 Rust toolchain + `crates/kairo-ui` scaffold: three-region layout (28 / grow / strip), 90-col collapse, no RPC yet
- [ ] R2 Node bridge: spawn Pi `--mode rpc`, JSONL framing, feed `kairo.workspace-shell/v1`
- [ ] R3 Chat parity: prompt, stream, tools/errors, cancel, scroll, editor send
- [ ] R4 Session continuity: resume / create / fork; model switch; no-model honest block + retry
- [ ] R5 Kairo chrome data: agents sidebar (blocked-first), agent select, USAGE strip, notices
- [ ] R6 Commands/dialogs via RPC extension-UI forward
- [ ] R7 Package binaries (darwin/linux × arch) into npm; Windows explicit error for `ui`
- [ ] R8 Evidence: unit + real TTY captures; visual approval gate
- [ ] R9 Cutover: default → ratatui; strip product docs/routes for Pi-TUI & cockpit (**remote auth**)

## Progress

- (2026-09-26) Plan accepted. Worktree `~/Desktop/agentic-harness-worktrees/ratatui-host` on `feat/ratatui-host`. Solo-agent guard disabled globally (`~/.cursor/hooks.json` no longer references it; script/rule/README removed).
- (2026-09-26) **R0 closed** — feature doc `odd/tasks/ratatui-host.md`; `odd/tasks/herd-shell-layout.md` marked superseded as product UI destination (bridge-only). Work-unit commit: `31ff4e2c0`.
- (2026-09-26) **R1 closed** — `crates/kairo-ui` (ratatui 0.29, crossterm 0.28): `split_shell` with 28-col sidebar at ≥90 cols, collapse below, 1-row USAGE strip; painted sidebar / work surface / USAGE. Quit: `q`/`Esc`.
  - Evidence: `cd crates/kairo-ui && cargo test --offline` → **3/3 pass** (agent + user re-check 2026-09-26). `.gitignore` ignores `crates/kairo-ui/target/`; `Cargo.lock` tracked.
  - Work-unit commit: `77595cfef`.
  - Note: Cursor sandbox may redirect `CARGO_TARGET_DIR`; local runs should `unset CARGO_TARGET_DIR` before `cargo run --release`.

## Next step

R2 only: Node bridge → Pi `--mode rpc` JSONL + feed `kairo.workspace-shell/v1`. Ratatui owns all UI. Pi startup failure (including no model) must not prevent Kairo from opening. No visual polish in R2.
