# Kairo Ratatui Host (single visual UI)

## Objective

Replace Kairo's interactive UI with one Rust/ratatui host. Pi keeps the agent, conversation, and sessions. Kairo keeps agents, routing, and USAGE. Pi-TUI shell and legacy cockpit stay temporary bridges only — not product alternatives. **Visual acceptance on a real TTY happens before packaging or changing the `kairo ui` default** — avoid repeating the Pi-TUI failure mode (functional but unsatisfying to look at).

## Problem

Pi-TUI layout works functionally but never met the product visual bar. Continuing dual UIs wastes time. We need one host that owns chrome and paint — and we must prove the paint before cutover.

## Why

Pi RPC separates agent from UI; RPC does not transport chrome. Ratatui owns surfaces. Herdr is visual reference only (hierarchy/density), not multipanel/PTY or pixel clone. App-gallery crates are references, not a drop-in Kairo design.

## Scope

### In

- `kairo ui` eventually launches one terminal-owning process: ratatui (default **unchanged** until chat works **and** visual approval).
- Node bridge: `kairo.workspace-shell/v1` + Pi `--mode rpc` JSONL.
- Host draws full surfaces: sidebar, work area, USAGE — contrast, borders, spacing, selection, notices.
- Layout: 28-col sidebar ≥90 cols; compact below; single chat center.
- Editor: `ratatui-textarea` after compatibility proof (ratatui 0.30). **Do not** adopt `ratcn` as base (preliminary).
- R3–R6 on those surfaces: prompt/stream/tools/cancel/scroll; sessions; model switch; real no-model; agents; commands. Host stays open when Pi fails; never invent states.
- Visual verdict **before** R7 packaging: color TTY captures @ 60×30, 100×30, 160×48 with conversation, agents, USAGE, and an error notice. If the center still reads as empty black, fix design before binaries/default cutover.
- Then: binaries (macOS/Linux), final parity, cutover. Windows: explicit error for `ui`.

### Out / non-goals

- PTY panes / multiplexer / multi-chat splits
- Pixel-perfect Herdr clone
- Further Pi-TUI chrome design
- npm publish / push / PR / default cutover without remote auth + visual approval

## Constraints

- Worktree: `~/Desktop/agentic-harness-worktrees/ratatui-host` on `feat/ratatui-host`.
- Old shell may remain for daily use until cutover; not a second product face after cutover.
- Fail-closed agent states (no invented working/done).
- Compatibility: do not mix ratatui 0.29 and 0.30 blindly — upgrade crate in one step when adopting 0.30 widgets.

## Authorized scope

- Plan "Kairo: un solo host visual con ratatui" (2026-09-26).
- Plan "validar el producto visual antes del corte" (2026-09-26) — reorder: surfaces + visual gate before R7.

## Acceptance criteria

- [ ] Color TTY @60/100/160: distinguishable sidebar, work surface, USAGE (your approval) — **before R7**
- [ ] Chat with model: prompt/stream/tools/cancel/scroll on those surfaces
- [ ] Bridge: fail-open host; post-connect crash reflected; real no-model cold-start classified honestly (R4)
- [ ] Install from package selects correct binary (after visual gate)
- [ ] Default `kairo ui` → ratatui only after parity **and** visual approval

## TDD

- Mode: strict. Runner: `node --test` + `cargo test`. Add render/responsiveness tests for surfaces. RED before implementation.

## Delivery

- Strategy: `ask-on-risk`. No publish/push without remote auth. Default cutover is a separate gate after visual approval.

## Tasks

- [x] R0 Feature doc + supersede Pi-TUI visual path
- [x] R1 Scaffold three-region layout (28/90)
- [x] R2 Node ↔ Pi RPC JSONL + snapshot (fail-open host)
- [x] R3a Bridge: consumable events + post-connect engine drop
- [x] V0 Compatibility spike: ratatui 0.30 + ratatui-textarea 0.9 (single ratatui tree; **no ratcn**)
- [x] V1 Native surfaces: sidebar / work / USAGE with contrast, borders, spacing, selection, notices (+ render tests)
- [ ] V2 Wire `ratatui-textarea` editor into work surface (after V0)
- [ ] R3b Chat over surfaces: prompt, stream, tools, cancel, scroll (model available)
- [ ] R4 Sessions / model switch / **real** Pi cold-start no-model
- [ ] R5 Agents sidebar data + USAGE + notices (honest states)
- [ ] R6 Commands/dialogs via RPC extension-UI
- [ ] V3 Visual gate: color captures @60/100/160 with conversation, agents, USAGE, error notice — **your approval** (blocks R7)
- [ ] R7 Package binaries (darwin/linux); Windows `ui` error
- [ ] R8 Final parity evidence
- [ ] R9 Cutover default + strip Pi-TUI/cockpit as product UIs (**remote auth**)

## Progress

- (2026-09-26) R0–R3a closed on `feat/ratatui-host` (see commits in prior progress). R2 `no_model` simulated-only; real cold-start pending R4.
- (2026-09-26) Plan update: **visual before R7**. V0 spike: `ratatui@0.30.2` + `ratatui-textarea@0.9.2` → single tree; `tui-textarea@0.7` rejected (pulls 0.29). `ratcn` not adopted.
- (2026-09-26) **V0+V1** — upgraded `crates/kairo-ui` to ratatui 0.30 + ratatui-textarea 0.9; `surfaces.rs` paints bordered sidebar (selection/blocked), focused work panel, USAGE strip with distinct backgrounds; notice line for errors. Keys: `q` quit, `n` demo notice, `c` clear, `j/k` select agent.
  - Evidence: `cargo test` → **6/6** (3 layout + 3 surface bg/notice/narrow). Work-unit commit: _(filled after commit)_.
  - **Still needed for visual gate:** your color TTY look at `cargo run --release` (center must not read as empty black). V2 textarea + R3b chat next.

## Next step

You: run `cd crates/kairo-ui && unset CARGO_TARGET_DIR && cargo run --release` and say if the three surfaces read as product UI. Then V2 (textarea) + R3b chat on those surfaces.
