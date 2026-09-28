# Kairo Ratatui Host (single visual UI)

## Objective

Replace Kairo's interactive UI with one Rust/ratatui host. Pi keeps the agent, conversation, and sessions. Kairo keeps agents, routing, and USAGE. Pi-TUI shell and legacy cockpit stay temporary bridges only — not product alternatives. **On this branch, daily `kairo` / `kairo ui` defaults to ratatui** (opt out with `--pi`); V3 visual acceptance still gates packaging / claiming product-done — avoid repeating the Pi-TUI failure mode (functional but unsatisfying to look at).

## Problem

Pi-TUI layout works functionally but never met the product visual bar. Continuing dual UIs wastes time. We need one host that owns chrome and paint — and we must prove the paint before cutover.

## Why

Pi RPC separates agent from UI; RPC does not transport chrome. Ratatui owns surfaces. Herdr is visual reference only (hierarchy/density), not multipanel/PTY or pixel clone. App-gallery crates are references, not a drop-in Kairo design.

## Scope

### In

- `kairo ui` launches the ratatui host by default on this branch (`feat/ratatui-host`). Opt out to Pi with `--pi` / `KAIRO_UI_HOST=pi`. `--legacy-cockpit` stays temporary code until the R9 strip — it is **not** a user path, and never the way to set up a project team.
- Team setup lives **inside** the ratatui host: `a` analyzes this project's team with the default analyst, `A` approves it, and the host re-applies Architect so chat unblocks in place. No cockpit, no Pi slash command, no restart.
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
- Plan "Ratatui como única interfaz de Kairo" (2026-09-28) — migrate every product capability of the cockpit, the Ink shell/ops/setup, and the Pi-TUI host into ratatui, then remove their entries, renderers, and exclusive deps. Pi stays the internal RPC engine only. ASK/PLAN/AGENT kept (ASK answers; PLAN/AGENT produce plans; execution needs explicit confirmation). Prebuilt binaries for darwin/linux × arm64/x64 without requiring Cargo. Reuse the kernel and shared service; no new router or task store. Publish, push, and provider-invoking tests need separate authorization. Windows keeps the non-interactive CLI only.

## Parity matrix (2026-09-28)

Legend: done / partial / missing. Source: read-only mapping of `feat/ratatui-host` @ `de42ea7cd` (codegraph + rg). Sidecar = `src/global/host/kairo-ui-rpc-stdio.js`. Each row is closed only by its acceptance test, not by this table.

### Phase 2 — engine, analyst, team

| Capability | Legacy | Ratatui | Acceptance |
|---|---|---|---|
| Pi RPC no-model cold start | vendored fork `third_party/pi/.../main.ts` (unpublished) | partial | Real RPC start without `session.model` → host stays open, `no_model` shown; startup stderr + JSONL errors surfaced verbatim |
| Bootstrap Analyst (sandboxed Codex) | cockpit ProjectOverlay | partial | `918249227`/`0613fdd4d` unify CODEX_HOME + full diagnostics (mocked). Closes only on a real fresh-session answer with confinement intact (provider auth required) — see `odd/tasks/bootstrap-analyst-start.md` |
| Analyze / analyst picker / approve | `cockpit/project-overlay.js` | done | `a` → picker → `project.analyze`; `A` → `team.approve` re-applies Architect |
| Team availability revalidation + reassignment | cockpit / Pi extension notices | done | Blocked roles show only the cause present in `stateReason`; `/analyze` reassign path works. `snapshot.rs`/`surfaces.rs` cause classification fixed on this branch (commit `6f91b8d6c`). On-demand `r` revalidate + `R` recovery preview/apply/reject wired in ratatui (this slice), reusing `workspace-snapshot.js`'s existing `recoverKairoProjectTeam`/`approveKairoRecovery`/`rejectKairoRecovery` (already used by the Pi extension's `kairo-team-approve`/`-reject`) — no new neutral module needed, it already existed |
| Per-role model editor | `project-overlay.js` EDIT_* states | done (U4d) | Override one role's model in ratatui; persists via `getProjectTeamEditCatalog`/`setProjectTeamAssignment`; SUGGESTED only (ACTIVE/STALE refused) |
| Strategy recovery preview/approve/reject | extension `kairo-team-approve/reject` (`conversation/team-recovery.js`) | done | Stale team → `R` preview → Enter/`y` apply or `x` reject updates snapshot; Esc cancels locally, mutates nothing. Note: `ink/use-orchestrator-data.js`'s `previewRecovery`/`confirmApplyRecovery`/`rescanRecovery` are governance-rollback snapshot recovery (`governance-actions.js`), unrelated to team strategy recovery — the real logic lives in `conversation/team-recovery.js`, already exposed non-React via `workspace-snapshot.js` |

### Phase 3 — sessions, chat, dialogs

| Capability | Legacy | Ratatui | Acceptance |
|---|---|---|---|
| Prompt / stream / cancel / scroll | cockpit, Pi-TUI | done | Stream renders; Esc aborts |
| Tool events distinct from text | Pi-TUI | done (live) | Tool row separate from assistant text |
| Thinking distinct from text | Pi-TUI | done | `MessageRole::Thinking` renders its own italic MUTED row; `thinking_delta` never appends onto the streaming `Assistant` text row (U3c) |
| Restored history fidelity | Pi-TUI reload | done | `pi-rpc-transcript.js` reconstructs text/thinking/tool-call/tool-result/error rows in live order; `replace_from_sidecar_transcript` replays them through the same `apply_sidecar_event` reducer the live stream uses (U3c) |
| Session selector (visible list) | Pi-TUI / cockpit | done | Ctrl+L opens `session_picker.rs`; j/k · Enter switch via `switch_session_index`; Esc cancels locally, mutates nothing. Ctrl+[ / ] still cycle unchanged |
| New / switch | Pi RPC | done | Ctrl+N; Architect re-applied |
| Kairo session id ↔ Pi file binding | `session-registry.js`, `KAIRO_SESSION_ID` | done | Lookup/annotate + resume auto-switch; `activeKairoSessionId` owns drafts across switch/new/fork/stop; fork mints+binds a new Kairo id (`createSession` + `recordPiBinding`); cancel keeps prior identity; binding failure after clone is fail-closed (`active = null`, error emitted, never saves under the previous id) |
| Rename / fork | Pi RPC `set_session_name` / `clone` | done | Rename done. Fork: RPC `clone` then mint+bind new Kairo id; source bindings/drafts untouched; fork draft empty; appears via `listSessions` / annotateSessions |
| Persist draft, history, active mode | cockpit | done (draft + active id) | Outgoing draft saved under **active** id before switch/new/fork; after success emit `{type:"draft",text,kairoSessionId}` (load dest / empty for New / empty for Fork); `stop` saves under active (not boot env alone). History/mode still via Pi transcript + Architect re-apply |
| Tool progress / result / error fidelity | Pi-TUI | done | Correlate by `toolCallId`; `tool_execution_update` rewrites the matching in-progress row; `tool_execution_end` preserves result/error text; shared `apply_sidecar_event` for live + restore; restore emits final start/end only (no invented progress) (U3c) |
| extension_ui select / confirm / input / editor / notify | Pi `extension_ui_request` | done | Correlated one-way `extension_ui_response` preserving request id (not ordinary request/response); cancel/timeout/engine death/quit release dialog without resolving another request or blocking the host. One modal at a time + FIFO queue by id (U3b) |

### Phase 4 — conversational workspace

| Capability | Legacy | Ratatui | Acceptance |
|---|---|---|---|
| Sidebar agents + USAGE strip | cockpit, Pi-TUI widgets | done | Captures @60/100/160 |
| Model cycle / compact | cockpit, Pi-TUI | done | Ctrl+M / Ctrl+K |
| ASK / PLAN / AGENT modes | `cockpit/app.js` Shift+Tab, `service.setMode` | done (U4a) | Mode visible + persisted per active Kairo session; ASK answers, PLAN/AGENT produce plans only (never execute; never Pi `prompt`) |
| Plans (Markdown), tasks, approve/reject | cockpit | done (U4b) | List + Markdown detail + approve/reject via `plans.list`/`show`/`decide` → conversation service; ASK read-only; keys `y`/`n` (not `a`) under list-focus |
| Role selection → preview → confirm execute / cancel | cockpit `service.planExecution` | done (U4c) | No execution without explicit confirmation; stale preview rejected |
| Execution transcript, cancel, manual handoff | `cockpit/app.js:242-258` | done (U4c) | Non-launchable role shows paste-prompt handoff |
| Slash commands (`/models`, `/providers`, `/why`, `/usage`, `/clear`) | `cockpit/app.js:300-375` | done (U4d) | Full slash set parsed as host commands; unknown `/…` never sent as chat |
| Views Work / Project / Tasks / Sessions | cockpit views | done (U4d) | Chrome `1`–`4`; Esc→Work; `p`/Ctrl+L enter Tasks/Sessions |

### Phase 5 — operations & setup

| Capability | Legacy | Ratatui | Acceptance |
|---|---|---|---|
| Health / readiness / diagnostics | `ink/orchestrator-app.js` DIAGNOSTICS | missing | Same fields as `kairo orchestrator --json` |
| Providers | PROVIDERS view, `fleet-probe.js` | missing | Matches `kairo fleet` |
| Usage drill-down | USAGE view | partial (strip only) | Full detail view |
| Sync / drift preview → confirm → receipt | `use-orchestrator-data.js` changes fns, `runGlobalSync` | missing | Receipt matches `kairo sync` |
| Rollback preview → confirm → receipt | CHANGES view, `runGlobalRollback` | missing | Same pattern |
| Runs (active/recent/detail/cancel) | RUNS views, `run-cli.js` | missing | List, detail, cancel |
| Alerts | ALERTS view, `alert-cli.js` | missing | Visible + transition |
| Review receipts | REVIEWS views, `review-cli.js` | missing | Matches `kairo reviews` |
| Profiles / settings | PROFILE, SETTINGS | missing | Edit persists |
| Integrations / connections | `connections.js` | missing | Same list |
| Interactive setup | `ink/setup-app.js`, `setup-routing.js` (+ Clack) | missing | First run opens ratatui setup |

Neutral adapters needed before porting: `ink/use-orchestrator-data.js` (hook-bound ops), mode/handoff logic in `cockpit/app.js`, setup step/state in `ink/setup-*.js`. Extract plain modules only; no React in Rust.

### Phase 6 — packaging

| Capability | Now | Acceptance |
|---|---|---|
| Binary | built on demand with `cargo build --release` (`launch-ratatui-host.js`) | Clean install without Cargo launches |
| darwin/linux × arm64/x64 selection | none | Correct prebuilt binary auto-selected; source build dev-only |
| Windows | explicit error (done) | Non-interactive CLI only |

### Phase 7 — retirement

| Entry / asset | Now | Target |
|---|---|---|
| `kairo`, `start`, `resume` | ratatui default via `resolveUiHost`; **9 failing tests** in `session-cli.test.js` + `cli-default-entry.test.js` still assert Pi host (re-run 2026-09-28: 10 pass / 9 fail) | Ratatui only; tests updated |
| `kairo ui` | ratatui; `--legacy-cockpit` → `runUiCli` | Ratatui only |
| `kairo shell` | Ink `runOrchestratorShell` | Ratatui Operations view |
| `--pi` / `--pi-host` / `KAIRO_UI_HOST=pi`, `--legacy-cockpit` | active opt-outs | Removed with migration message, no hidden fallback |
| Exclusive code | `src/global/cockpit/*` (8 files), `src/global/ink/*` (28), Pi-TUI widget code in `host/extension/index.js` | Deleted after parity; APIs, non-interactive CLI, adapters, bindings, RPC engine kept |
| Exclusive deps | `ink`, `react`, `@clack/prompts`, `@earendil-works/pi-tui` | Removed from `package.json` |

### Sidecar protocol today

Commands: `prompt` (U4a: `submitTask`, never Pi prompt), `set_mode`, `plans.list` / `plans.show` / `plans.decide` (U4b; never executePlan), `plans.preview` / `plans.execute` / `plans.cancel` / `plans.transcript` (U4c), `abort`, `compact`, `cycle_model`, `new_session`, `switch_session`, `switch_session_index`, `list_sessions`, `rename_session`, `fork_session`, `reload_snapshot`, `project.preflight`, `project.analyze`, `team.approve`, `team.revalidate`, `team.recovery.*`, `extension_ui_response`, `stop`. Records: `ready`, `mode`, `task_result`, `plans`, `plan_detail`, `plan_decision`, `plan_preview`, `plan_execute`, `plan_cancel`, `run_transcript`, `engine`, `transcript`, `sessions`, `draft`, `kairoModels`, `team`, `preflight`, `snapshot`, `notice`, `error` + forwarded Pi events (including `extension_ui_request`).

## Acceptance criteria

- [ ] Color TTY @60/100/160: distinguishable sidebar, work surface, USAGE (your approval) — **before R7**
- [ ] Chat with model: prompt/stream/tools/cancel/scroll on those surfaces
- [ ] Bridge: fail-open host; post-connect crash reflected; real no-model cold-start classified honestly (R4)
- [ ] Install from package selects correct binary (after visual gate)
- [ ] Default `kairo ui` → ratatui is live on this branch; R9 still covers stripping old UIs / packaging; V3 remains the visual gate before claiming product-done

## TDD

- Mode: strict. Runner: `node --test` + `cargo test`. Add render/responsiveness tests for surfaces. RED before implementation.

## Delivery

- Strategy: `ask-on-risk`. No publish/push without remote auth. Default cutover is a separate gate after visual approval.
- (2026-09-28) Chain strategy for the U-plan: `feature-branch-chain`. Cuts follow coherent work units accumulated on `feat/ratatui-host` (this worktree); only the tracker branch merges to `main`. **U7 (retirement) does not merge to `main` before U6 (packaging/parity) is verified.** This choice authorizes no push, PR, or merge — those remain separate user decisions.
- (2026-09-28) RDD correction: the user's "keep and fix" instruction for U2c's uncommitted WIP was a code decision, separate from native-review consent. RDD stays **on by default** (verified: `gentle-ai review mode status` → on, decided by default). Three already-committed candidates (Bootstrap CODEX_HOME `918249227`+`0613fdd4d`; block-cause fix `6f91b8d6c`; revalidation/recovery `5a3535566`+`307e9349e`) were genuinely declined via the presented consent envelope (`declined_this_candidate` each); user chose to leave them as-is rather than re-review. From here on, grant consent (don't skip) on the next medium/high-risk candidate.

## Tasks

- [x] R0 Feature doc + supersede Pi-TUI visual path
- [x] R1 Scaffold three-region layout (28/90)
- [x] R2 Node ↔ Pi RPC JSONL + snapshot (fail-open host)
- [x] R3a Bridge: consumable events + post-connect engine drop
- [x] V0 Compatibility spike: ratatui 0.30 + ratatui-textarea 0.9 (single ratatui tree; **no ratcn**)
- [x] V1 Native surfaces: sidebar / work / USAGE with contrast, borders, spacing, selection, notices (+ render tests)
- [x] V1-fix USAGE strip ≥2 rows (border+label visible) + full-row selection padding; content-visibility tests (not bg-only)
- [x] V2 Wire `ratatui-textarea` editor into work surface (after V0)
- [x] R3b Chat over surfaces: prompt, stream, tools, cancel, scroll (model available)
- [ ] R4 Sessions / model switch / **real** Pi cold-start no-model (partial: Pi file list + new/switch + model cycle; Architect reapply on session ops done; RPC no-model cold-start in third_party pending publish; Kairo session registry not wired)
- [x] R5 Agents sidebar data + USAGE + notices (honest states)
- [x] T1 In-UI project team: headless analyze with the default analyst (`a`) + approve (`A`) + Architect reapply, driven from ratatui — cockpit is never required or recommended
- [~] T2 In-UI team depth: analyst picker in ratatui done (this slice); per-role editor still out
- [x] R6 Commands/dialogs via RPC extension-UI (abort + compact + extension_ui dialogs U3b)
- [ ] V3 Visual gate: color captures @60/100/160 with conversation, agents, USAGE, error notice — **captures produced, pending human review** (blocks R7; **not approved**)
- [ ] R7 Package binaries (darwin/linux); Windows `ui` error
- [ ] R8 Final parity evidence
- [ ] R9 Cutover default + strip Pi-TUI/cockpit as product UIs (**remote auth**)

### Plan 2026-09-28 (ratatui as the only UI) — supersedes open R4/R6/T2/R7–R9 scope above

- [x] U1 Parity matrix recorded (this doc); Bootstrap fixes reconciled as committed-but-unproven
- [ ] U2a Pi RPC start: runtime-active no-model fix in the consumed package; keep startup stderr + JSONL errors (publish needs auth)
- [ ] U2b Bootstrap: real fresh-session answer with confinement (provider auth) — `bootstrap-analyst-start.md` T4
- [x] U2c Team: cause wording fixed (commit `6f91b8d6c`); availability revalidation + strategy recovery preview/apply/reject wired in ratatui (commits `5a3535566`, `307e9349e`)
- [x] U3a Sessions (**reopened to close Phase 3**): keep prior commits; finish active-session draft ownership across switch/new/fork/resume; fork mints new Kairo+Pi ids + `kairo list`/resume; cancel keeps prior identity; binding failure never falls back to previous id. Evidence: A→B→quit→resume B keeps both drafts; cancelled new/fork/switch keep bindings/history correct
- [x] U3b extension_ui: select / confirm / input / editor / notify with correlated one-way responses and safe cancel (cancel/timeout/engine death/quit)
- [x] U3c Chat events (**reopened to close Phase 3**): keep thinking/text/shared-reducer work; finish `toolCallId`-correlated progress + result/error **content**; restore final tool results without inventing intermediate progress
- [x] U4 Workspace: **U4a+U4b+U4c+U4d done** (modes + plans + execute/cancel/handoff + slash + Work/Project/Tasks/Sessions + per-role SUGGESTED editor)
- [ ] U5 Operations + Settings views (health, providers, usage, diagnostics, sync/rollback receipts, runs, alerts, reviews, profiles, integrations, setup) via extracted neutral adapters
- [ ] U6 Packaging: 4 prebuilt binaries, auto-select, clean install without Cargo; PTY 60×30 / 100×30 / 160×48 + terminal restore
- [ ] U7 Retirement: entries → ratatui only; remove `--pi` / `--legacy-cockpit` with migration message; delete cockpit/Ink/Pi-TUI renderers + exclusive deps; fix the 9 stale entry tests

## Progress

- (2026-09-26) R0–R3a closed on `feat/ratatui-host` (see commits in prior progress). R2 `no_model` simulated-only; real cold-start pending R4.
- (2026-09-26) Plan update: **visual before R7**. V0 spike: `ratatui@0.30.2` + `ratatui-textarea@0.9.2` → single tree; `tui-textarea@0.7` rejected (pulls 0.29). `ratcn` not adopted.
- (2026-09-26) **V0+V1** — upgraded `crates/kairo-ui` to ratatui 0.30 + ratatui-textarea 0.9; `surfaces.rs` paints bordered sidebar (selection/blocked), focused work panel, USAGE strip with distinct backgrounds; notice line for errors. Keys: `q` quit, `n` demo notice, `c` clear, `j/k` select agent.
  - Evidence: `cargo test` → **6/6** (3 layout + 3 surface bg/notice/narrow). Work-unit commit: `652d9bcc7`.
- (2026-09-26) **V1-fix** — PTY review (100×30 TrueColor): USAGE 1-row + top border hid label; selection colored text-width only. Fixes: `USAGE_STRIP_ROWS=2`; `padded_span` fills sidebar/USAGE inner width; tests assert buffer contains `USAGE`/`Codex` and `SELECT_BG` at far-x of selected row (bg-only tests are insufficient).
  - Evidence: `cargo test` → **9/9**. Work-unit commit: `3757a6c21`. Learning: a background-color assert does not prove strip content is visible.
- (2026-09-26) **V1-fix approved** (user, 100×30 TrueColor): USAGE text visible; `j` moves full-row highlight. **Not** product visual gate — center still placeholders; final verdict needs real chat + captures @60/100/160.
- (2026-09-26) **V2 + R3b** — work column split transcript + 5-row `ratatui-textarea` editor; Tab focus cycle; local mock reply without bridge; `kairo-ui-rpc-stdio.js` JSONL sidecar over `openPiRpcBridge`; Rust `bridge.rs` client with `--bridge` / `KAIRO_UI_BRIDGE=1`.
  - Evidence: `cd crates/kairo-ui && unset CARGO_TARGET_DIR && cargo test` → **16/16**. `node --test test/kairo-ui-rpc-stdio.test.js` → **3/3**. `node --test test/pi-rpc-bridge.test.js` → **8/8** (unchanged bridge).
  - Keybindings: Tab (focus), Enter submit, Esc abort/blur sidebar, PgUp/Dn transcript scroll, q quit (empty editor or sidebar/transcript), Ctrl+C/Q always quit.
- (2026-09-26) **R5** — `apply_workspace_snapshot` maps `kairo.workspace-shell/v1` agents (idle/blocked/unknown only; `working`/`done` → unknown), project label, and USAGE via extension `subscriptionsLine` (`ready` → segments with ` │ `; else honest state). Applied on `ready`/`snapshot`; sidecar `reload_snapshot`. Follow-up `eb5f13c66` fixed segment gate/join. No change to default `kairo ui`.
  - Evidence: `cargo test` → **22/22**; `kairo-ui-rpc-stdio` → **3/3**; `pi-rpc-bridge` → **8/8**. Commits: `35ba2fa30`, `eb5f13c66`.

- (2026-09-26) **Theme** — sober hacker palette: work `#090F0E`, sidebar `#111A18`, USAGE `#13211C`; accent `#5EE6A8` only for brand/focus/selection; text `#E8F5EF` / muted `#9AB2A5`; ERROR red, WARN/TOOL amber, USER blue; assistant label not accent green. Contrast + semantic paint tests. Layout/data unchanged; no matrix rain. Visual verdict still blocks R7.
  - Evidence: commits `a3dba57ce`, `a1768bc21`. `cargo test` → **28/28**. Only on worktree `feat/ratatui-host` (main checkout has no `crates/kairo-ui`). Rebuild before PTY: `unset CARGO_TARGET_DIR && cargo run --release`.
- (2026-09-26) **Unblock real chat** — `pnpm install --offline --frozen-lockfile` with **Node ≥22.19 + pnpm 10.34.5**. `EngineGate` keeps draft / no ghost assistant when engine cannot take prompts. **Correction (same day):** blaming `/login` / copying API keys into Pi was wrong for normal Kairo use. The real gap was `openPiRpcBridge` spawning RPC **without** `-e` Kairo extension and without selecting the **Architect** assignment from active `projectTeam` (strategy `orchestrator` is descriptive only). An approved team route uses already-authenticated CLIs via the Kairo provider — never silently pick another provider.
  - Evidence (pre-wiring): install + EngineGate tests; live smoke without extension hit “No API key” / no models.
- (2026-09-26) **RPC engine wiring** — `openPiRpcBridge` spawns Pi with `buildKairoPiResourceArgs` (`-e` extension, `--no-extensions` …) + `--mode rpc --no-session` (parity with interactive host minus TUI). After `get_state`, loads `projectTeam` routes via `loadKairoProviderModels`, picks **Architect** (`selectArchitectKairoModel`), `set_model` `{ provider: "kairo", modelId }`, refresh `get_state`. Missing/non-launchable Architect → `hostOpen: true`, `engine.status: no_model`, reason names projectTeam/Architect (no fallback provider). Shared helper `buildKairoPiResourceArgs` exported from `launch-gentle-shell.js`. Sidecar `ready.engine.reason` surfaces missing route.
  - Evidence: `node --test test/pi-rpc-bridge.test.js test/kairo-ui-rpc-stdio.test.js` (see commit). Route: `direct inline` (bridge + tests + doc).

- (2026-09-26) **R4 partial + commands** — Sidecar ops: `cycle_model` (Kairo `projectTeam` routes only via `set_model`), `new_session`, `switch_session` / `switch_session_index`, `compact`, `list_sessions`. Pi RPC has **no** `list_sessions`; host lists `.jsonl` under `PI_CODING_AGENT_DIR/sessions/<cwd-hash>/` honestly. `ready`/`engine`/`transcript` records; USAGE strip row 2 = `MODEL · … · session …`. Mock assistant only without `--bridge`; demo `n` notice gated off when bridge on. Keybindings (bridge): Ctrl+M model, Ctrl+N new session, Ctrl+[ / Ctrl+] prev/next on-disk session, Ctrl+K compact, Esc/abort unchanged.
  - Evidence: `cargo test` (kairo-ui), `node --test test/pi-rpc-bridge.test.js test/kairo-ui-rpc-stdio.test.js test/pi-rpc-sessions.test.js test/pi-rpc-kairo-models.test.js test/pi-rpc-transcript.test.js`. Work-unit commit on `feat/ratatui-host`.

- (2026-09-26) **R4 remainder (Architect reapply + RPC no-model)** — After `new_session` / `switch_session` / `switch_session_index`, sidecar re-applies Architect via `resolveArchitectRouteForRpc` (not only `classifyPiEngineFromState`). **Does not** re-apply after `cycle_model` (would undo the cycle). Vendored Pi fork: `--mode rpc` may start without `session.model` (`main.ts`); documented in `third_party/pi/packages/coding-agent/NOTICE.md`. **No version bump / no npm publish** — third_party change is **not** runtime-active until next publish of `@kal-elsam/kairo-pi-coding-agent`; published pin still exits on no-model cold-start.
  - Evidence: `node --test test/kairo-ui-rpc-stdio.test.js test/pi-rpc-bridge.test.js`. Work-unit commit on `feat/ratatui-host`.

- (2026-09-26) **Daily opt-in launch** — `kairo ui --ratatui` (also `KAIRO_UI_HOST=ratatui`) launches `crates/kairo-ui` via `launchRatatuiHost` (`--bridge`, spawn cwd = project). Same opt-in on bare `kairo` / `start` / `resume` / `conversation`. Default without flag/env stays Pi via `launchGentleShell` until V3/R9. `--legacy-cockpit` still wins. Windows + non-TTY fail closed. Intent: ratatui becomes the sole UI after visual gate + cutover — not a permanent second product face.
  - Evidence: `node --test test/launch-ratatui-host.test.js test/cli-implicit-host.test.js`.

- (2026-09-26) **Daily default = ratatui** — `resolveUiHost` now defaults to `ratatui` (no `--ratatui` required). Opt out: `--pi` / `--pi-host` / `KAIRO_UI_HOST=pi`. Precedence: `--legacy-cockpit` > pi flag/env > ratatui flag/env > default ratatui. R9 still owns stripping old UIs / packaging; V3 remains the visual gate before claiming product-done.
  - Evidence: `node --test test/launch-ratatui-host.test.js test/cli-implicit-host.test.js test/cli-help.test.js`.

- (2026-09-26) **no-model UX honesty** — Real sidecar `ready` with `engine.status=no_model` + empty team + `subscriptions.state=cached` looked empty/confused because defaults invented Orchestrator/Builder and USAGE hid cached segments. Fix (UI only, no invented team): empty default agents + muted `No team yet`; `work_empty_hint` from `open_notice` (`Chat blocked: no_model — …`); `USAGE · cached · seg1 │ seg2` when cached/checking has segments; `ready` prefers engine notice over sessionsNote. ~~Next step pointed at `kairo --legacy-cockpit` + `/project analyze`~~ — **superseded the same day by T1**: the next step is now the in-UI `a` / `A` keys, and no ratatui/host copy recommends the cockpit for team setup.
  - Evidence: `cargo test -q --manifest-path crates/kairo-ui/Cargo.toml` → **41/41**.

- (2026-09-26) **T1 in-UI team setup (no cockpit)** — `project-team-sidecar.js` wraps `createConversationService({ enableProviderProbes: true })`: `analyzeProjectTeam` runs `preflightProject`, picks the default analyst (`pickDefaultAnalyst`: the catalog's own `recommendedModel` when available, else the first **available** entry — an unavailable-only or empty catalog throws instead of downgrading providers), runs `runBootstrapAnalysis`, and summarizes state / team rows / analyst. `approveProjectTeam` = `approveProjectStrategy` + summary. No role or model is synthesized here.
  - Sidecar ops: `project.analyze` → progress notice, structured `{type:"team", ok, state, teamRows, roles, analyst}`, then snapshot reload (a failed analysis emits `team ok:false` + `error` and **no** snapshot). `team.approve` → approve, reload `kairoModels`, re-apply Architect via `resolveArchitectRouteForRpc` (same path as session ops), emit `engine` + `kairoModels` + `snapshot`. A failed approval never touches `set_model`.
  - Ratatui: `a` analyze / `A` approve via `BridgeClient`; `team_keys_available` keeps every character in a compose box that can send (Editor focus needs an empty draft **and** a blocked engine; Sidebar/Transcript focus is never typing). `team.state` is read from the snapshot (`not_analyzed` / `suggested` / `active` / `stale`), never inferred. `work_empty_hint` = `Chat blocked: <status> — <reason>` + `Next: press a to analyze project team, then A to approve.` (becomes `press A to approve` once suggested). Empty sidebar: `No team yet` + `a = analyze` / `A = approve`.
  - Evidence: `cargo test` → **46/46** (new: team hint keys, suggested-state hint, key-availability, snapshot team state, sidebar approve copy); `node --test test/project-team-sidecar.test.js test/kairo-ui-rpc-stdio.test.js …` → **56/56**. `rg 'legacy-cockpit|/project analyze' crates/kairo-ui` matches only the negative assertions that forbid that copy.
  - Pi-shell copy followed: `TEAM_SETUP_NEXT_STEP` ("Next: run kairo → press a to analyze, A to approve.") replaces `run kairo --legacy-cockpit, then /project analyze` in the unavailable-routes widget, both team-recovery notifications, and the non-window availability notice. Tests now assert the cockpit string is **absent**. Evidence: `node --test test/workspace-shell-extension.test.js test/workspace-widget.test.js test/host-launch.test.js test/orchestrator-shell.test.js` → **162/162**.
  - Known gaps: no analyst picker / role editor in the UI yet (T2). The `--legacy-cockpit` CLI flag and the launch-failure fallbacks that name it stay until R9 (flag, not team setup). The Pi widget's own `Run /project analyze to build this project's team.` empty-team hints (`workspace-widget.js`, `extension/index.js`) are untouched: they never mention the cockpit, but the Pi extension registers no such command — fold them into the R9 strip or a Pi-parity follow-up.
  - Pre-existing on this branch, unrelated to T1: 9 failures in `test/session-cli.test.js` + `test/cli-default-entry.test.js` still assert the Pi host for bare `kairo` / `start` / `resume` after the ratatui default cutover (verified by stashing T1 and re-running).

- (2026-09-26) **Stale release binary** — `launchRatatuiHost` no longer skips `cargo build --release` when `target/release/kairo-ui` exists but `crates/kairo-ui/src/**`, `Cargo.toml`, or `Cargo.lock` is newer (fixes USAGE segments / team keys missing after source edits without rebuild).
  - Evidence: `node --test test/launch-ratatui-host.test.js`.

- (2026-09-26) **T2 slice: analyst picker (no cockpit, no role editor yet)** — `a` no longer analyzes immediately: it sends `project.preflight`, opens an in-UI modal listing the real `analystCatalog` (recommended first, unavailable rows shown but refused on confirm), and only `Enter` on an available row sends `project.analyze` with that human's own pick. This is the same product intent as cockpit's ProjectOverlay SELECT_ANALYST, entirely inside ratatui.
  - **Codex sandbox ENOENT fix**: `codex-sandbox.js`'s `runCodexSandboxedBootstrap` now captures `child.stderr` (like `quick-ask.js`'s `askCodex`) and surfaces it — or `sandboxed codex exec exited ${code} without writing its output file` — instead of the raw ENOENT from the missing `answer.txt` a failed sandboxed run left behind. Root cause of the reported bug: MVP auto-picked Codex, the sandboxed run failed for an unknown reason, and the missing-output-file path swallowed that reason.
  - **Sidecar**: `project-team-sidecar.js` gets `preflightProjectTeam({cwd})` (read-only catalog snapshot, JSON-safe `profile`/`candidates`) and `analyzeProjectTeam({cwd, analyst?})` — an omitted `analyst` keeps the existing `pickDefaultAnalyst` fallback; a provided one (the picker's own clean modelRef shape, matching cockpit's ProjectOverlay onSelect) is re-validated against a FRESH preflight catalog, never trusted verbatim — an unmatched or no-longer-available pick fails closed with a named reason, never a silent default swap. `kairo-ui-rpc-stdio.js` adds the `project.preflight` op and forwards `cmd.analyst` into `project.analyze`.
  - **Ratatui**: new `analyst_picker.rs` (`AnalystPickerState`/`AnalystOption`) is a small state machine: builds from `analystCatalog` (recommended sorted first), j/k or arrows move across every row including unavailable ones ("list all, only confirm available" — the cockpit's own behavior), Enter on an unavailable row refuses with an inline notice and keeps the selection, Enter on an available row returns the clean payload. `surfaces.rs` paints it as a centered modal (`render_analyst_picker`) over the work surface using the existing sober-hacker palette. `main.rs` wires `a` → `request_analyst_preflight` (was: analyze immediately) → picker opens on the sidecar's `preflight` record → `Enter` → `send_analyze_with_analyst`; the picker owns all key input while open. `A` (approve) is unchanged. `engine.rs`'s default blocked-chat hint now reads "press a to choose an analyst and analyze, then A to approve."
  - Evidence: `cargo test` (kairo-ui) → **59/59** (13 new: 8 `analyst_picker` unit tests, 4 `surfaces` modal-paint tests, plus the reused suite). `node --test test/codex-sandbox.test.js test/project-team-sidecar.test.js test/kairo-ui-rpc-stdio.test.js` → **48/48**. Full `npm test` → **2386/2396 pass**; the 9 failures are the same pre-existing `session-cli.test.js`/`cli-default-entry.test.js` bare-`kairo` Pi-host assertions noted under T1, unrelated to this slice (verified unchanged).
  - Known gap: per-role editor is still out of this slice — `a` only ever picks the ONE Bootstrap Analyst that runs the analysis; it does not let a human edit individual role→model assignments after a team is suggested. That is the rest of T2.

- (2026-09-28) **U2c cause wording fix (delegated writer, writer trigger: 2 Rust files)** — Reviewed the uncommitted team-attention WIP in `snapshot.rs`/`surfaces.rs` (kept its structure: `BlockCause` classification, provider label, actionable `/analyze` in sidebar detail and chat CTA) and fixed the inference, which exceeded the evidence: it mapped rate-limited/"monthly window" text to `RateLimited` rendered as "quota spent"/"a subscription ran out of quota" (a rate limit is not an exhausted quota), mapped "billing" to `NoFunds`, classified `team_block_cause` from the already-shortened `agent.detail` instead of the original `stateReason`, and had inverted the no-invented-cause test to accept the defect.
  - Fix: `BlockCause` gained a `QuotaExhausted` variant distinct from `RateLimited` (only an explicit "quota exhausted"/"out of quota" statement earns quota wording; "monthly window is rate-limited" stays rate-limited); funds now require explicit evidence (out of funds/insufficient funds/insufficient credit(s)/out of credits/no funds) — "billing"/entitlement alone falls through to `Unavailable`. `SidebarAgent` gained a `cause: BlockCause` field set in `map_agent`/`apply_workspace_snapshot` from the ORIGINAL `stateReason`; `team_block_cause` now aggregates that field across blocked roles instead of re-parsing shortened `detail` text, and roles that disagree on cause render `Unavailable` (previously the joined-detail-string reclassification could silently pick whichever keyword `classify_block_cause` checked first).
  - **RED**: baseline `cargo test` on the untouched WIP was **69/69 green** — the WIP's own tests were inverted to *accept* the defect (asserted "quota spent" for rate-limit evidence). Production fix and the restored/new tests were authored together; to get an honest RED reading after the fact, spliced the new/fixed test module onto the pre-fix (`HEAD~1`) production code in a scratch copy of the crate and ran `cargo test`: **32 compile errors** (`E0433`/`E0560`/`E0609` — `BlockCause` not found, `SidebarAgent` has no field `cause`), confirming the new tests genuinely depend on the fix and cannot pass (or even compile) against the old WIP.
  - **GREEN**: `cargo test` on the real fix → **76/76** (7 new: rate-limited-not-quota, explicit-quota-exhausted, insufficient-credits, billing-alone-unavailable, no-entitlement-unavailable, mixed-causes-across-roles, classification-uses-original-reason).
  - Verification: `rustfmt --check --edition 2021 src/snapshot.rs src/surfaces.rs` → clean. `cargo clippy -- -D warnings` → same pre-existing 8 findings as base (line-shifted only; none new in the two changed files). `node --test test/kairo-ui-rpc-stdio.test.js` → **16/16**.
  - Commit: `6f91b8d6c` (`crates/kairo-ui/src/snapshot.rs`, `crates/kairo-ui/src/surfaces.rs` only).
  - Known gap: availability revalidation loop and strategy recovery preview/approve/reject (the rest of U2c) are still open — this slice only fixed cause classification/wording.

- (2026-09-28) **U2c remainder: availability revalidation + strategy recovery (delegated writer, writer trigger: JS sidecar + Rust, 2+ non-trivial files)** — Mapping check first: the doc's pointer to `ink/use-orchestrator-data.js`'s `previewRecovery`/`confirmApplyRecovery`/`rescanRecovery` was wrong — those wrap `governance-actions.js` (global sync/rollback snapshot recovery), unrelated to team strategy. The real logic is `conversation/team-recovery.js` (`decideTeamRecovery`, `runTeamRecovery`, `approveRecoveryProposal`, `rejectRecoveryProposal`), and a neutral (non-React) adapter over it **already existed**: `workspace-snapshot.js`'s `recoverKairoProjectTeam` / `approveKairoRecovery` / `rejectKairoRecovery` / `readPendingKairoRecovery`, already used by the Pi extension's `kairo-team-approve` / `kairo-team-reject` commands. No extraction needed — only sidecar + ratatui wiring.
  - **Availability revalidation**: `workspace-snapshot.js` gains `revalidateKairoTeamAvailability({cwd})` — re-runs the same real `loadKairoLiveData` probe the second render phase uses, then rebuilds the snapshot from that live evidence (`ok`/`reason` honestly reported; a failed probe still rebuilds from last-known cache, never invents "available"). Sidecar op `team.revalidate` emits `{type:"availability", ok, reason}` then a fresh `snapshot`. Ratatui key `r` (empty-compose or non-editor focus, same gate as team keys) sends it.
  - **Strategy recovery preview/apply/reject**: sidecar ops `team.recovery.preview` (→ `recoverProjectTeam`, builds/persists a SUGGESTED proposal, never activates), `team.recovery.apply` (→ `approveRecoveryProposal`, re-verifies against CURRENT eligibility, refuses a stale proposal as `outcome:"error"` and touches nothing), `team.recovery.reject` (→ `rejectRecoveryProposal`, only closes the fingerprint). Each emits a `{type:"recovery", op, ...outcome}` record; apply re-applies Architect and republishes routes on `outcome:"approved"`, same as `team.approve`.
  - **Ratatui**: new `recovery_picker.rs` (`RecoveryPreviewState`) builds cause rows + proposed-replacement rows verbatim from the sidecar's own `recovery` record (`outcome:"proposed"` only — any other outcome never opens a modal, just a plain notice via `recovery_preview_notice`). `surfaces.rs` paints it as a centered modal (`render_recovery_preview`, sober-hacker palette, same pattern as `render_analyst_picker`). Keys: `R` opens the preview (empty-compose/non-editor gate); while open, Enter/`y` applies, `x` explicitly rejects, **Esc cancels locally with no server call at all** (cancel mutates nothing by construction, not just by contract). `q`/Ctrl+C/Ctrl+Q still quit.
  - **RED→GREEN evidence**:
    - JS: `revalidateKairoTeamAvailability` — RED via stub (`{ok:true, reason:null, snapshot:null}`) → 2 assertion failures in `test/workspace-shell-snapshot.test.js`; real impl → GREEN, `node --test test/workspace-shell-snapshot.test.js` **32/32**.
    - JS: 6 new `kairo-ui-rpc-stdio.js` ops tests — RED (unknown-op path) → 6 failing; real handlers wired → GREEN, `node --test test/kairo-ui-rpc-stdio.test.js` **22/22** (includes: stale-apply refused and never calls `set_model`; reject/cancel mutate nothing beyond closing the fingerprint; revalidate reports real evidence, never quota/funds wording).
    - Rust: `recovery_picker.rs` — RED via temporarily forcing `from_recovery_record` to always return `Some(default())` → 4/5 tests failed with real assertion diffs; restored real parsing → GREEN, 5/5.
    - Rust: `surfaces.rs` recovery-preview render tests — RED via temporarily stubbing `cause_lines` to empty inside `render_recovery_preview` → 1/3 failed (`"rate-limited"` not found); restored → GREEN, 3/3.
  - Verification: `node --test test/kairo-ui-rpc-stdio.test.js test/project-team-sidecar.test.js` → **48/48**; also ran `test/workspace-shell-snapshot.test.js test/workspace-shell-extension.test.js test/launch-ratatui-host.test.js test/team-auto-recovery-e2e.test.js` → all green (157/157 combined with the stdio/sidecar files). `cd crates/kairo-ui && cargo test` → **84/84**. `rustfmt --check --edition 2021` on every changed `.rs` file → clean (pre-existing drift only in untouched lines of `bridge.rs`/`main.rs`, confirmed via `git stash` diff before/after). `cargo clippy -- -D warnings` → same **8** pre-existing findings as base, zero new. Full `npm test` → **2411/2420** (9 known pre-existing `session-cli.test.js`/`cli-default-entry.test.js` failures, unchanged).
  - Commits: `5a3535566` (JS: `src/global/host/kairo-ui-rpc-stdio.js`, `src/global/host/workspace-snapshot.js`, `test/kairo-ui-rpc-stdio.test.js`, `test/workspace-shell-snapshot.test.js`), `307e9349e` (Rust: `crates/kairo-ui/src/{bridge,main,surfaces}.rs`, new `crates/kairo-ui/src/recovery_picker.rs`). Authored changed lines: ~1210 (exceeds the ~400 advisory heuristic — both commits are already the smallest coherent behavior with tests; not split further to avoid an artificial JS/Rust half-feature).
  - Decision gap (not guessed): no product spec named the exact revalidate/recovery-preview keybindings. Chose `r` (revalidate) / `R` (recovery preview) / Enter·`y` (apply) / `x` (reject) / Esc (local cancel) by analogy with the existing `a`/`A` team-setup keys and the "Enter/y apply, Esc cancel, explicit reject" wording in the task brief; flag for product review before it's called final UX.

## Quiet UX (keys)

- Quit: `q` when the editor is empty or focus is sidebar/transcript; **Ctrl+C** / **Ctrl+Q** always quit.
- WorkMode (U4a): **Shift+Tab** cycles ASK → PLAN → AGENT → ASK (persisted via `service.setMode` under active Kairo session). Plain **Tab** stays focus cycling. Compose chrome shows `Message Kairo · ASK|PLAN|AGENT`. Enter routes through `submitTask` (ASK answers; PLAN/AGENT plan only — never execute, never Pi `prompt`).
- Plans / tasks (U4b, bridge only): empty-compose **`p`** opens the session plan list (also auto-opens after a PLAN/AGENT plan). List-focus owns keys so team `a`/`A` never clash: **↑/↓** select · **Enter** Markdown detail · **Esc** closes detail then list locally · **`y` approve / `n` reject** only when `awaiting_approval` and WorkMode ≠ ask.
- Execute / cancel / handoff (U4c, bridge only, under plan-list): **`x`** request execute when AGENT + approved + not_started → nested **role select** (↑/↓ · Enter preview · Esc local cancel) → nested **confirm** owns **`y`/`n`** so list approve/reject never fires · **`c`** cancel when `execActive` (never mode-gated). WAIT_FOR_PROJECT_TEAM + suggested-alternative auto-executes (no y/n). MANUAL_HANDOFF pastes `taskPrompt` into the transcript (no launch). Esc on role/confirm is local-only. Team **`a`/`A` swallowed** while plan list OR exec modals are open.
- Team (in host): **`a`** analyze · **`A`** approve (when suggested).
- Availability + recovery (in host): **`r`** revalidate provider availability on demand · **`R`** preview a strategy recovery when the team is stale/blocked. In the recovery preview modal: **Enter**/**`y`** apply (re-verified against current eligibility; a stale proposal refuses and mutates nothing) · **`x`** explicitly reject (closes the proposal only) · **Esc** cancel locally (no server call at all).
- Sessions (U3a, bridge only): **Ctrl+L** opens the visible session picker (real rows, labeled by the bound Kairo session id when one exists) — j/k or arrows move, **Enter** switches, **Esc** cancels locally (no server call). **Ctrl+[** / **Ctrl+]** still cycle sessions on disk unchanged. **Ctrl+R** renames the current session to whatever is in the compose box (then clears it). **Ctrl+F** forks the current session (RPC `clone`) into a new one, source untouched. These keybindings were not specified by a product spec — chosen by analogy with the existing Ctrl+M/N/K bridge shortcuts; flag for product review before calling final UX.
- USAGE row 2 (`engine_line`) stays for **MODEL · session** status — quit hints live here in docs, not on the strip.

- (2026-09-28) **U3c chat event fidelity (delegated writer, writer trigger: JS sidecar + Rust, 2+ non-trivial files)** — Two known gaps closed: thinking not separated from text, and restored history dropping non-text blocks. Investigated a third (errors/progress distinctness) and found a real gap there too, folded into the same slice per the brief's instruction.
  - **Wire format (verified via codegraph, not guessed)**: Pi RPC's `AssistantMessageEvent` union (`third_party/pi/packages/ai/src/types.ts:652`) already has `thinking_start`/`thinking_delta`/`thinking_end`, shaped identically to `text_start`/`text_delta`/`text_end` (`{ type, contentIndex, delta, partial }`) — same `delta` field, only `type` differs. No ambiguity/decision gap here; the wire shape is fully published in the vendored fork.
  - **Root cause of gap 1**: `chat.rs`'s `apply_sidecar_event` read `/assistantMessageEvent/delta` for ANY `message_update`, regardless of `assistantMessageEvent.type` — so a `thinking_delta` silently appended onto the same streaming `Assistant` row as `text_delta`. Same blind read also meant `{ type: "error", error: {...} }` (no `delta` field) was silently dropped — a real assistant-stream failure never appeared in the transcript, only sometimes surfaced as a top-level notice.
  - **Fix (`crates/kairo-ui/src/chat.rs`)**: `MessageRole` gains `Thinking` (own row, `append_streaming` helper keyed by `(role, streaming)` so concurrent thinking/text streams never cross-append) and `Error` (assistant-stream-level failure, distinct from a failed *tool* result). `ChatMessage` gains `is_error: bool`, set from `tool_execution_end`'s `isError` so a failed tool row renders in ERROR tone instead of sharing TOOL amber with a success. `apply_sidecar_event`'s `message_update` branch now switches on `assistantMessageEvent.type` (`thinking_delta` / `text_delta` / `error`) instead of blindly reading `delta`.
  - **Fix (`crates/kairo-ui/src/surfaces.rs`)**: `message_to_lines` reuses existing tone constants only (no new colors, per the brief) — `Thinking` = MUTED + italic (distinct from both plain System and non-italic Assistant), `Tool` error = ERROR instead of TOOL, `Error` = ERROR. `transcript_has_conversation` updated for the two new roles (exhaustive match).
  - **Restored history (`src/global/host/pi-rpc-transcript.js`)**: `mapPiMessagesToTranscriptRows` no longer filters to `type === "text"` blocks. It now walks each assistant message's content blocks (text/thinking/toolCall) and pairs `toolCall` blocks with their `toolResult` message by `toolCallId`, emitting rows shaped like the SAME live sidecar/bridge events `apply_sidecar_event` already reduces (`message_update` with `text_delta`/`thinking_delta`/`error`, `tool_execution_start`/`tool_execution_end`, `agent_settled`), plus two replay-only markers (`user_message`, `system_message`) for turns a live stream never emits as bridge events. `chat.rs`'s `replace_from_sidecar_transcript` now runs every non-replay-only row through `apply_sidecar_event` itself instead of its own parallel `{role, content}` mapping — live and replayed rendering share one implementation by construction, so they cannot diverge. This is a deliberate breaking change to the sidecar↔host wire contract (both ends are in this repo/slice); the one other importer test asserting the old `{role, content}` shape (`test/kairo-ui-rpc-stdio.test.js`) was updated to match.
  - **Gap 3 (errors/progress) verdict**: tool errors were already glyph-distinct (`✖`/`✓`) but NOT color-distinct (both TOOL amber) — fixed via `is_error` above. Assistant-stream errors were silently dropped (see root cause above) — fixed via `MessageRole::Error` above. "Progress" markers: no separate `tool_execution_update`/progress sidecar event is currently forwarded into `apply_sidecar_event` at all (only `start`/`end`); out of scope for this slice (no regression — nothing regressed, there was never a progress row to preserve) and not required by the brief's acceptance list, so left alone.
  - **RED→GREEN evidence**:
    - JS: `test/pi-rpc-transcript.test.js` — RED (6/6 assertion failures, old `{role,content}`-only shape) → real impl → GREEN 6/6. `test/kairo-ui-rpc-stdio.test.js` transcript-shape assertion updated → GREEN.
    - Rust `chat.rs`: RED via compile error (missing `MessageRole::Thinking`/`Error`, missing `is_error` field — a genuine missing-symbol case) → added the enum variants/field as a wrong-behavior stub (old buggy `apply_sidecar_event`/`replace_from_sidecar_transcript` logic kept) → recompiled clean with the 4 new/updated tests failing on real assertions (not compile errors) → real reducer implementation → GREEN 12/12 in `chat::`.
    - Rust `surfaces.rs`: 3 new render tests (`thinking_row_renders_distinct_from_assistant_row`, `tool_error_row_is_visually_distinct_from_tool_success_row`, `assistant_stream_error_row_uses_error_tone`) were authored alongside the real `message_to_lines` fix; confirmed genuine RED after the fact by reverting `message_to_lines` to the old-tone/no-italic behavior in a scratch copy and rerunning — 3/3 failed with real assertion diffs (e.g. `left: Rgb(224,180,92) / right: Rgb(220,90,90)`) — then restored the real implementation → GREEN.
  - **Required-case coverage**: thinking-delta-distinct-row (chat.rs + surfaces.rs) ✓; live mixed-turn (text+thinking+tool-call+tool-result+error) replayed via the sidecar-transcript path produces an identical ordered row sequence to live (`chat.rs::replayed_history_matches_live_event_sequence_for_mixed_turn`) ✓; tool error visually distinct from tool success (`chat.rs::tool_execution_end_marks_error_flag_distinctly` + `surfaces.rs::tool_error_row_is_visually_distinct_from_tool_success_row`) ✓.
  - Verification: `node --test test/pi-rpc-transcript.test.js test/kairo-ui-rpc-stdio.test.js` → **28/28**. `cd crates/kairo-ui && cargo test` → **91/91**. `rustfmt --check --edition 2021 src/chat.rs src/surfaces.rs` → clean (ran `rustfmt` once to normalize formatting introduced by the new code, verified via `git diff` that only the touched regions changed). `cargo clippy -- -D warnings` → same **8** pre-existing findings as base `668bcbb96` (confirmed by symbol/pattern match, not just count: `surfaces.rs` lines 407/413 are the base's 374/380 `Line::from(padded_span(...))` findings, shifted by this slice's earlier insertions — zero new findings in `chat.rs` or `surfaces.rs`). Full `npm test` → **2414/2423** (one run showed a 10th failure that did not reproduce on rerun — flaky real-process spawn timing in `session-cli.test.js`; rerun confirmed the same 9 pre-existing failures, all in `test/session-cli.test.js`/`test/cli-default-entry.test.js`, unchanged from baseline).
  - Commits: `8cc81a8` (Rust: `crates/kairo-ui/src/{chat,surfaces}.rs`), `ca73eac` (JS: `src/global/host/pi-rpc-transcript.js`, `test/pi-rpc-transcript.test.js`, `test/kairo-ui-rpc-stdio.test.js`). Authored changed lines: ~667 (exceeds the ~400 advisory heuristic; both commits are already the smallest coherent behavior with tests — thinking/error rendering and replay fidelity share the same reducer contract and splitting them further would leave one half untestable on its own — not split further per the heuristic's own advisory-only status).
  - No decision gap: the wire format was verifiable (not guessed), and the third checked item (errors/progress) had a real, fixable gap rather than an ambiguous one.

- (2026-09-28) **U3a sessions: id binding, visible picker, rename/fork, draft persistence (delegated writer, writer trigger: JS sidecar + Rust, 2+ non-trivial files)** — Mapping check first: `KAIRO_SESSION_ID` was already being set and passed all the way down to the spawned Pi child (via `launch-ratatui-host.js` → Rust `Command` inherits env → sidecar `process.env` → `buildRpcChildEnv` spreads it into the RPC child), and the Pi extension's own `bindSession()` already recorded it into `pi-bindings.json` via `recordPiBinding` — but nothing on the ratatui/sidecar side ever READ that binding back. The doc's gap was accurate: the join was one-directional (write-only from the extension), never consumed.
  - **JS (`kairo-ui-rpc-stdio.js`)**: `runKairoUiRpcStdio` now resolves `homeDir`/`projectRoot` (DI'd, degrades to unbound on failure — never crashes) and annotates every `sessions` entry (`ready`, `list_sessions`, `new_session`, `switch_session_index`, `fork_session`) with `kairoSessionId` via `lookupPiBinding`. On startup, if `KAIRO_SESSION_ID` matches a binding for one of the on-disk Pi files, the sidecar sends `switch_session` to that exact file before emitting `ready` — `kairo resume <id>` now reopens the transcript actually bound to that id. New ops `rename_session` (RPC `set_session_name`) and `fork_session` (RPC `clone`, NOT the entry-based `fork` — verified via `third_party/pi/.../rpc-mode.ts`: `fork` requires an `entryId` and edits/regenerates history from a past message, returning `{text, cancelled}`, not a new session; `clone` is the dedicated "duplicate the whole session at its current leaf" command, source file untouched). `stop` accepts an optional `draft` string and persists it via new `session-registry.js` `saveDraft`/`loadDraft` (a `draft.json` sibling of `session.json`, schema `kairo.session-draft/v1`); `ready.draft` surfaces any previously saved draft.
  - **Rust**: new `session_picker.rs` (`SessionPickerState`/`SessionOption`, same state-machine shape as `analyst_picker.rs`) labels each row by its bound Kairo id (short-formed) when present, else the Pi label — never invents an id. `surfaces.rs` gets `render_session_picker` (same centered-modal pattern). `main.rs`: `Ctrl+L` opens the picker from the host's own cached `pi_sessions` (populated in `ingest_sessions_record`); Enter sends `switch_session_index`; Esc cancels with no bridge call. `Ctrl+R` renames the current session using the compose box's own text (then clears it); `Ctrl+F` forks via the new `BridgeClient::fork_session`. `ready.draft` is applied to the editor exactly once (`draft_restored` flag, never clobbers text already typed); on quit, `main()` now calls the new `BridgeClient::stop_with_draft` with the compose box's current text instead of plain `stop()`.
  - **RED→GREEN evidence**:
    - JS: `test/session-registry.test.js` — 5 new draft tests, RED via missing export (`SyntaxError: ... does not provide an export named 'loadDraft'`) → real impl → GREEN, `node --test test/session-registry.test.js` **26/26**.
    - JS: `test/kairo-ui-rpc-stdio.test.js` — 9 new U3a tests (binding annotation, unresolvable-project-root fallback, auto-switch-on-resume, rename success/refusal, fork-sends-clone-never-fork, stop-persists-draft, ready-surfaces-draft) — all newly written against the not-yet-existing DI options/ops, first run failed with real assertion diffs (undefined `kairoSessionId`, empty `switchCalls`, thrown "must never send the entry-based fork" from the mock) → real impl → GREEN, `node --test test/kairo-ui-rpc-stdio.test.js` **30/30**.
    - Rust `session_picker.rs`: RED via wrong-behavior stub (`row_label` ignoring `kairo_session_id`, `confirm` always `None`) → 2/9 failed on real assertion diffs → restored real impl → GREEN, 9/9.
    - Rust `surfaces.rs` render tests: RED via temporarily replacing the modal title and empty-state copy with placeholders → 2/3 new tests failed on real content diffs → restored → GREEN, 3/3 (plus the reused suite).
  - **Verification**: `node --test test/session-registry.test.js test/kairo-ui-rpc-stdio.test.js` → **56/56**. `cd crates/kairo-ui && cargo test` → **103/103** (was 91). `rustfmt --check --edition 2021` on every changed file → clean for all newly-authored lines (confirmed by diffing against baseline: remaining flagged lines in `main.rs`/`bridge.rs` are pre-existing drift, unchanged, just shifted line numbers — ran `rustfmt` directly only on `session_picker.rs` (new file) and `surfaces.rs` (all its remaining drift was inside my own new function/tests, confirmed zero unrelated lines touched via `git diff --stat` showing insertions-only)). `cargo clippy -- -D warnings` → same **8** pre-existing findings as base `0080174` (matched by exact file:line:symbol, not just count — `surfaces.rs:5` unused `Color`, `layout.rs:62` `&&`, `snapshot.rs:279` doc-lazy-continuation, `surfaces.rs:408/414` useless conversion, `main.rs` three `unneeded return` inside the pre-existing `Focus::Editor/Sidebar/Transcript` arms); zero new findings in any file touched. Full `npm test` → **2427/2438** pass, **10** failing: 9 are the documented pre-existing baseline (8 in `session-cli.test.js` + 1 in `cli-default-entry.test.js`, count verified unchanged via `git stash` before/after — this task's binding work does not touch `resolveUiHost`/bare-`kairo` default resolution, so it could not and did not reduce that count) plus 1 flaky (`sidecar stays alive and emits engine_unavailable after Pi exit`, passes in isolation — timing-sensitive under full-suite parallel load, matching the same flake class the U3c progress entry already noted).
  - Commits: `944056067` (JS: `src/global/conversation/session-registry.js`, `src/global/host/kairo-ui-rpc-stdio.js`, `test/session-registry.test.js`, `test/kairo-ui-rpc-stdio.test.js`), `aa19a18bf` (Rust: `crates/kairo-ui/src/{bridge,main,surfaces}.rs`, new `crates/kairo-ui/src/session_picker.rs`). Authored changed lines: ~1200 (exceeds the ~400 advisory heuristic; both commits are already the smallest coherent behavior with tests spanning JS+Rust for one feature — not split further per the heuristic's advisory-only status).
  - Decision gaps (not guessed): (1) `fork_session` uses RPC `clone`, not `fork` — `fork` takes an `entryId` and is really "edit/regenerate from an earlier message," a different feature; implemented what's verifiable, left entry-based history editing out of scope. (2) A fork is not yet bound to a new Kairo session id, so it won't appear in `kairo list` under its own id — no product spec named whether it should; flagged for product review. (3) New session-picker/rename/fork keybindings (Ctrl+L/R/F) were chosen by analogy with existing Ctrl+M/N/K bridge shortcuts, not specified anywhere — flagged in "Quiet UX" for product review before being called final.

- (2026-09-28) **U3a close: active-session drafts + fork Kairo binding (delegated writer, STRICT TDD)** — Prior U3a commits preserved (`944056067`, `aa19a18bf`). Gaps closed:
  - **JS (`kairo-ui-rpc-stdio.js`)**: track `activeKairoSessionId` (starts from env `KAIRO_SESSION_ID` after resume auto-switch). On switch/new/fork accept optional `draft`, save under **current active** BEFORE transition; after success emit `{type:"draft", text, kairoSessionId}` (destination load / empty New / empty Fork). `fork_session`: after successful `clone`, `createSession` (inherits prior mode via `getSession`) + `recordPiBinding`; source bindings/drafts untouched. Cancelled clone/switch: keep prior active; no destination draft emit; no rebind. **Fail-closed binding failure** after clone: emit `error`, set `activeKairoSessionId = null` (never keep prior id — that would make `stop` contaminate the source draft ownership for the fork's editor; never bind the fork under the previous id as fallback). `stop` saves under **active** id, not boot env alone. DI: `createSession`, `recordPiBinding`, `getSession`.
  - **Rust**: `BridgeClient::{new_session,switch_session_index,fork_session}_with_draft`; host passes compose-box text on Ctrl+N / picker Enter / Ctrl+[ ] / Ctrl+F; `poll_bridge` applies `{type:"draft"}` (empty clears editor; non-empty restores destination).
  - **RED→GREEN**: 5 new JS tests written first → **30 pass / 5 fail** (missing active ownership, destination draft emit, fork mint+bind, cancel, binding fail-closed) → impl → GREEN.
  - **Verification (observed)**: `node --test test/kairo-ui-rpc-stdio.test.js test/session-registry.test.js` → **61/61** (35 rpc-stdio + 26 session-registry). `cd crates/kairo-ui && cargo test` → **103/103**.
  - Commit: `feat(kairo-ui): active-session drafts and fork Kairo binding (U3a)`.

- (2026-09-28) **U3c tool fidelity close (delegated writer, STRICT TDD)** — Prior thinking/text/shared-reducer work preserved. Closed the remaining tool gaps:
  - **Wire (vendored Pi)**: `tool_execution_start|update|end` carry `toolCallId` + `toolName`; update has `partialResult`; end has `isError` + `result` (`{ content: [{type:"text", text}] }`).
  - **Rust (`chat.rs`)**: `ChatMessage.tool_call_id`; start/update/end correlate by id (in-place row rewrite so concurrent tools never clobber); `tool_payload_text` extracts result/error text into the row body (`✓/✖ name\ncontent`); shared `apply_sidecar_event` still owns live + `replace_from_sidecar_transcript`.
  - **JS (`pi-rpc-transcript.js`)**: restored rows include `toolCallId` + `result.content` from `toolResult` messages; **never** invents `tool_execution_update` on replay.
  - **RED→GREEN (observed)**: JS 5 pass / 2 fail (missing toolCallId + result) → impl → 7/7. Rust compile-fail on missing `tool_call_id` → field + wrong-behavior until assertions → GREEN chat 16/16.
  - **Verification (observed)**: `node --test test/pi-rpc-transcript.test.js test/kairo-ui-rpc-stdio.test.js` → **42/42**. `cd crates/kairo-ui && cargo test` → **107/107**.
  - Commit: `feat(kairo-ui): toolCallId progress and result content (U3c)`.

- (2026-09-28) **U3b extension_ui dialogs (delegated writer, STRICT TDD)** — Pi `extension_ui_request` / one-way `extension_ui_response` with correlated ids:
  - **JS**: `pi-rpc-bridge.js` gains `sendRaw`/`writeLine` (stdin write, **no** pending map). Sidecar op `extension_ui_response` forwards `{type,id,value|confirmed|cancelled}` via `sendRaw`. `extension_ui_request` already forwarded via `onEvent`.
  - **Rust**: new `extension_ui.rs` — one modal at a time + FIFO queue by id; select/confirm/input/editor; notify → notice (no response). Esc → cancelled same id; engine_unavailable clears locally; host quit sends cancelled then stop. Modal owns keys (own draft buffer — never chat compose).
  - **Policy**: concurrent dialogs never mix ids; cancel of active only cancels that id; queued promote after close.
  - **Verification**: `node --test test/pi-rpc-bridge.test.js test/kairo-ui-rpc-stdio.test.js test/pi-rpc-transcript.test.js` → **59/59**. `cd crates/kairo-ui && cargo test` → **115/115**.
  - Commit: `feat(kairo-ui): extension_ui dialogs with correlated responses (U3b)`.

- (2026-09-28) **Phase 3 close evidence (full suite, not focused-only)** — After U3a+U3c+U3b on `feat/ratatui-host`:
  - Focused: stdio+transcript+bridge+registry → **85/85**; `cargo test` → **115/115**.
  - Full `npm test` → **2439 pass / 10 fail / 1 skip** (2450). Baseline only: **9** entry-host (`session-cli`×8 + `cli-default-entry`×1) + **1** flake (`engine_unavailable after Pi exit`). **Not green.**
  - RDD assess (`--base-ref 499a99bdc --committed-only`): Cursor is **unassessable**; with `--agent=codex` the same range is `high` / `review_due` and status preflight returns `action: start` + consent relay (see Progress entry below). Functional proof ≠ native review.
  - Commits: `26fe516e1` (doc reopen), `2b712dfe1` (U3a), `ca641694d` (U3c), `1b22de709` (U3b).

- (2026-09-28) **Phase 3 PTY end-to-end (integrated acceptance)** — `python3 scripts/kairo-ui-pty-e2e.py` under real `script(1)` PTY + mock sidecar `scripts/fixtures/kairo-ui-pty-mock-sidecar.mjs` (no Pi/providers):
  - Observed **PASS**: alt-screen enter `?1049h` + leave `?1049l` (terminal restore); mock log `out ready` + auto `extension_ui_request` + `tool_execution_{start,update,end}`; host replied `extension_ui_response id=pty-dialog-1 cancelled=false value=Allow`; Ctrl+L session-picker chord then Esc (local cancel); `q` quit exit 0.
  - Separate evidence from unit suites and from native RDD. Not a substitute for U6 visual captures @60/100/160.

- (2026-09-28) **U4 native RDD** — Assess high / review_due on `defcc77b9..27f3ec2fb` (12 files, 5265 lines, lineage `review-4ead496a802fde90`). User answered **Skip this time** (`declined_this_candidate`); no review record; RDD stays enabled. Functional U4 proof (JS 63/63, cargo 148/148) ≠ native review.

- (2026-09-28) **Phase 3 native RDD** — Consent granted on candidate including PTY (`lineage review-50be35ef8f70df28`, `--agent=codex`). Four lenses + bounded correction for CRITICAL `R3-dialog-q` (commit `f469ac753`: plain `q` no longer quits input/editor dialogs). Targeted validation approved; `acknowledge-approved` burned authority. Advisory WARNINGs remain informational only (draft-save loss, PTY assertion strength, dialog viewport). Functional close ≠ PTY e2e ≠ native review — all three now recorded.

- (2026-09-28) **U4a ASK/PLAN/AGENT work modes (STRICT TDD)** — Persisted WorkMode in the ratatui host matching cockpit contract.
  - **Contract**: values `ask`|`plan`|`agent`, default `ask` (fail-closed); Shift+Tab cycles ask→plan→agent→ask; plain Tab stays focus; scope = active `activeKairoSessionId` via `service.setMode`/`getSession`; restore on ready/switch/new/fork; emit `{type:"mode", mode}`; Enter → `submitTask({cwd,task,mode,sessionId})` — ASK answer, PLAN/AGENT plan only (never execute; never Pi `prompt`); compose chrome `Message Kairo · ASK`; optimistic UI + cockpit-style notice on persist failure.
  - **JS (`kairo-ui-rpc-stdio.js`)**: DI `setMode`/`submitTask` (defaults wrap `createConversationService`); op `set_mode`; prompt routes through `submitTask` + `{type:"task_result"}` + notice; `mode` emitted on ready/switch/new/fork/set_mode. No new store.
  - **Rust**: `next_work_mode`/`normalize_work_mode`/`compose_chrome_title`; `BridgeClient::set_mode`; Shift+Tab / BackTab; `ShellViewModel.work_mode`; compose title live; `task_result` → System chat row; Enter no longer starts Pi assistant stream.
  - **Verification (observed)**: `node --test test/kairo-ui-rpc-stdio.test.js` → **44/44**. `cd crates/kairo-ui && unset CARGO_TARGET_DIR && cargo test` → **121/121**.
  - Out of scope (still open): U4b plans approve/reject/tasks UI; U4c role preview/confirm/exec; U4d slash/views; V3 visual.

- (2026-09-28) **U4b plans list + Markdown detail + approve/reject (STRICT TDD)** — Session-scoped timeline via conversation service; no execute/cancel/handoff (U4c).
  - **Contract**: `plans.list` → `service.snapshot` timeline; `plans.show` → `showPlan` (`taskMarkdown`+`planMarkdown`); `plans.decide` → `decidePlan(approved|rejected)` with `sessionId` ownership. Refresh list after decide and after plan `task_result`. ASK mode: no approve/reject. Stay out of `planExecution`/`executePlan`.
  - **Keybindings (list-focus only)**: empty-compose **`p`** opens plans (also auto-opens after plan `task_result`). While open: **↑/↓** (and j/k) select · **Enter** Markdown detail · **Esc** closes detail then list locally · **`y` approve / `n` reject** only when `awaiting_approval` and WorkMode ≠ ask. Team **`a`/`A` ignored** while list-focused (no clash). Copy never says "press a to approve".
  - **JS**: DI `snapshot`/`showPlan`/`decidePlan`; emit `plans` / `plan_detail` / `plan_decision`; `PLAN_REQUESTED_NOTICE` advertises `p` + `y`/`n`.
  - **Rust**: `plan_list.rs` (`PlanListState`), `render_plan_list`, bridge `plans_*`, `main.rs` list-focus key owner.
  - **Verification (observed)**: `node --test test/kairo-ui-rpc-stdio.test.js` → **49/49**. `cd crates/kairo-ui && unset CARGO_TARGET_DIR && cargo test` → **132/132**.
  - Out of scope (still open): U4c execute/cancel/handoff; U4d slash/views; V3 visual.

- (2026-09-28) **U4c role → preview → confirm execute / cancel / MANUAL_HANDOFF (STRICT TDD)** — Cockpit parity for plan execution inside ratatui; U4a/U4b untouched (`y`/`n` approve/reject stay list-focus).
  - **Contract**: `plans.preview` → `planExecution({role})`; WAIT_FOR + `suggested-alternative` auto-`executePlan` (no y/n); ROUTED/other confirmable targets open a nested confirm modal; MANUAL_HANDOFF emits `taskPrompt` into the chat transcript (no launch); `plans.execute` requires the exact `confirmationTarget` (stale rejected by service); `plans.cancel` → `cancelExecution`; `plans.transcript` → `readRunTranscript`. `plans.list` also emits `projectTeamRoles` from an active strategy.
  - **Key design**: Confirm is a nested modal that owns keys so list `y`/`n` never decidePlan during confirm. Under plan-list: **`x`** execute (agent+approved+not_started) · **`c`** cancel when execActive. Esc on role/confirm = local cancel (no server). Team `a`/`A` swallowed while plan list OR exec modals open.
  - **JS**: DI `planExecution`/`executePlan`/`cancelExecution`/`readRunTranscript`; ops `plans.preview|execute|cancel|transcript`.
  - **Rust**: `execution_flow.rs` (RoleSelect + ConfirmExecute); plan_list gates `can_execute`/`can_cancel`; bridge ops; main nested handlers; surfaces role/confirm modals; run transcript rows into chat.
  - **Verification (observed)**: `node --test test/kairo-ui-rpc-stdio.test.js` → **57/57**. `cd crates/kairo-ui && unset CARGO_TARGET_DIR && cargo test` → **142/142**.
  - Out of scope (still open): U4d slash/views; per-role editor; V3 visual.

- (2026-09-28) **U4d slash + Work/Project/Tasks/Sessions + per-role editor (STRICT TDD)** — Close remaining U4 workspace chrome.
  - **Slash**: `/help` `/usage` `/providers` `/status` `/models[--evidence|--verify-access[--refresh]]` `/why` `/clear` `/quit`|/`exit` `/plan <task>`; keep `/analyze`|/`approve` (+ `/project analyze|approve|status|refresh`); **bare `/project` → Project view** (not analyze); unknown `/…` never goes to chat.
  - **Views**: `WorkspaceView` Work|Project|Tasks|Sessions; empty-compose **`1`–`4`**; Esc→Work; **`p`** / **Ctrl+L** enter Tasks/Sessions; plan-list execute keys stay Tasks-owned.
  - **Role editor**: Project Enter → EDIT_LOADING→EDIT_MODEL_SEARCH→EDIT_CONFIRM→EDIT_SAVING→RESULT via `team.edit.catalog`/`team.edit.assign`; SUGGESTED only; ACTIVE/STALE refused.
  - **JS**: `slash.info`/`slash.clear`/`slash.project_status`/`project.refresh`/`team.edit.*`; CockpitView formatters reused for diagnostics lines.
  - **Rust**: `workspace_nav.rs`, `role_editor.rs`; expanded `parse_slash_command`; Project surface + editor modal.
  - **Verification (observed)**: `node --test test/kairo-ui-rpc-stdio.test.js` → **63/63**. `cd crates/kairo-ui && unset CARGO_TARGET_DIR && cargo test` → **148/148**.
  - Out of scope (still open): V3 visual; U5 ops views.

- (2026-09-28) **V3 visual captures produced (NOT approved)** — Deterministic Buffer dumps at 60×30 / 100×30 / 160×48 for conversation, tools, plans, dialog, error. FIXTURE mock — not live provider. Sidebar collapsed note at 60 cols; agents+USAGE when ≥90.
  - Artifacts: `docs/assets/v3-visual-fixtures/<size>-<scenario>.{ansi,txt,html}` + README.
  - Harness: `crates/kairo-ui/src/v3_capture.rs` via `kairo-ui --v3-capture`; regenerate with `scripts/kairo-ui-v3-capture`. Optional sidecar `scripts/fixtures/kairo-ui-v3-visual-mock-sidecar.mjs` (never contacts Pi).
  - Checkbox **[ ] V3** stays unchecked — awaiting human review. Do not reopen U4.
  - Verification (observed): `cargo test v3_capture` → pass; capture exits 0 and writes 46 files; spot-check `.txt` cues for conversation/tool/plan/dialog/error.

## Next step

**Plan 2026-09-28 (amended):** Phase 3 + **U4 closed**. **V3 captures ready for human review** (not approved). Next: human V3 verdict and/or U5 operations views. U2a/U2b wait for publish/auth. U7 blocked until U6. Full suite still not green (9 entry-host failures).

1. **Human review of V3** fixtures @60/100/160 (or **U5** ops views in parallel).
2. **U2a/U2b** when publish / provider auth available; **U5→U6→U7** under `feature-branch-chain`.
