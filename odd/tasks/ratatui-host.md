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
| Team availability revalidation + reassignment | cockpit / Pi extension notices | partial | Blocked roles show only the cause present in `stateReason`; `/analyze` reassign path works. `snapshot.rs`/`surfaces.rs` cause classification fixed on this branch (commit `6f91b8d6c`): rate-limit ≠ quota, funds require explicit evidence, ambiguous/mixed-role causes render as unavailable, classification reads the original `stateReason` via `SidebarAgent.cause` (not the shortened detail). Availability revalidation loop + strategy recovery preview/approve/reject still open (U2c remainder) |
| Per-role model editor | `project-overlay.js` EDIT_* states | missing | Override one role's model in ratatui; persists via service |
| Strategy recovery preview/approve/reject | `ink/use-orchestrator-data.js` recovery fns; extension `kairo-team-approve/reject` | missing | Stale team → preview → approve/reject updates snapshot; cancel mutates nothing |

### Phase 3 — sessions, chat, dialogs

| Capability | Legacy | Ratatui | Acceptance |
|---|---|---|---|
| Prompt / stream / cancel / scroll | cockpit, Pi-TUI | done | Stream renders; Esc aborts |
| Tool events distinct from text | Pi-TUI | done (live) | Tool row separate from assistant text |
| Thinking distinct from text | Pi-TUI | missing | Thinking deltas render in their own style |
| Restored history fidelity | Pi-TUI reload | partial | `pi-rpc-transcript.js` keeps only `text` blocks; replay must show tool/thinking/error rows like live |
| Session selector (visible list) | Pi-TUI / cockpit | partial | Ctrl+[ / ] blind cycle only; need labeled list |
| New / switch | Pi RPC | done | Ctrl+N; Architect re-applied |
| Kairo session id ↔ Pi file binding | `session-registry.js`, `KAIRO_SESSION_ID` | missing | `kairo list` id appears in the picker bound to its Pi file; old sessions kept, never shown empty |
| Rename / fork | Pi RPC `set_session_name` / `fork` | missing | Renamed/forked session appears in list |
| Persist draft, history, active mode | cockpit | missing | Start → chat → quit → resume restores same session, draft, mode |
| extension_ui select / confirm / input / editor / notify | Pi `extension_ui_request` | missing (notify: parallel local notice only) | Correlated responses; cancel returns `cancelled` and mutates nothing |

### Phase 4 — conversational workspace

| Capability | Legacy | Ratatui | Acceptance |
|---|---|---|---|
| Sidebar agents + USAGE strip | cockpit, Pi-TUI widgets | done | Captures @60/100/160 |
| Model cycle / compact | cockpit, Pi-TUI | done | Ctrl+M / Ctrl+K |
| ASK / PLAN / AGENT modes | `cockpit/app.js` Shift+Tab, `service.setMode` | missing | Mode visible + persisted; ASK answers, PLAN/AGENT produce plans only |
| Plans (Markdown), tasks, approve/reject | cockpit | missing | Approve/reject through service APIs |
| Role selection → preview → confirm execute / cancel | cockpit `service.planExecution` | missing | No execution without explicit confirmation; stale preview rejected |
| Execution transcript, cancel, manual handoff | `cockpit/app.js:242-258` | missing | Non-launchable role shows paste-prompt handoff |
| Slash commands (`/models`, `/providers`, `/why`, `/usage`, `/clear`) | `cockpit/app.js:300-375` | missing | `/x` parsed as command, never sent as chat |
| Views Work / Project / Tasks / Sessions | cockpit views | missing (Work only) | Navigable inside current chrome |

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

Commands: `prompt`, `abort`, `compact`, `cycle_model`, `new_session`, `switch_session`, `switch_session_index`, `list_sessions`, `reload_snapshot`, `project.preflight`, `project.analyze`, `team.approve`, `stop`. Records: `ready`, `engine`, `transcript`, `sessions`, `kairoModels`, `team`, `preflight`, `snapshot`, `notice`, `error` + forwarded Pi events. Unused Pi RPC surface relevant here: `fork`, `set_session_name`, `get_messages` (full blocks), thinking-level ops, `extension_ui_request/response`.

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
- [ ] R6 Commands/dialogs via RPC extension-UI (partial: abort + compact via RPC; extension_ui dialogs pending)
- [ ] V3 Visual gate: color captures @60/100/160 with conversation, agents, USAGE, error notice — **your approval** (blocks R7)
- [ ] R7 Package binaries (darwin/linux); Windows `ui` error
- [ ] R8 Final parity evidence
- [ ] R9 Cutover default + strip Pi-TUI/cockpit as product UIs (**remote auth**)

### Plan 2026-09-28 (ratatui as the only UI) — supersedes open R4/R6/T2/R7–R9 scope above

- [x] U1 Parity matrix recorded (this doc); Bootstrap fixes reconciled as committed-but-unproven
- [ ] U2a Pi RPC start: runtime-active no-model fix in the consumed package; keep startup stderr + JSONL errors (publish needs auth)
- [ ] U2b Bootstrap: real fresh-session answer with confinement (provider auth) — `bootstrap-analyst-start.md` T4
- [~] U2c Team: cause wording fixed (commit `6f91b8d6c`); availability revalidation + strategy recovery preview/approve/reject still open
- [ ] U3a Sessions: Kairo id ↔ Pi file binding; visible selector; rename / new / resume / fork; persist draft, history, mode
- [ ] U3b extension_ui: select / confirm / input / editor / notify with correlated responses and safe cancel
- [ ] U3c Chat events: separate text / thinking / tools; results, errors, progress; restored history == live
- [ ] U4 Workspace: ASK/PLAN/AGENT, plans/tasks approve/reject, role → preview → confirm execute/cancel, transcript, manual handoff, per-role editor, slash commands, Work/Project/Tasks/Sessions views
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

## Quiet UX (keys)

- Quit: `q` when the editor is empty or focus is sidebar/transcript; **Ctrl+C** / **Ctrl+Q** always quit.
- Team (in host): **`a`** analyze · **`A`** approve (when suggested). Plan/ask modes are **not** in this slice.
- USAGE row 2 (`engine_line`) stays for **MODEL · session** status — quit hints live here in docs, not on the strip.

## Next step

**Plan 2026-09-28:** U2c (team WIP decision) → U3c → U3a → U3b → U4 → U5 → U6 → U7. U2a/U2b wait for publish / provider authorization. Route per task: delegated writer (JS sidecar + Rust, 2+ non-trivial files). The list below is the earlier plan, kept for history.

1. **V3** TrueColor @60/100/160 with real conversation + team data — your visual verdict (blocks R7 packaging claim). Now reachable end to end in one UI: `kairo` → `a` (analyze) → `A` (approve) → chat. Live provider check only with a session you authorize.
2. **T2** in-UI team depth: analyst picker + per-role editor (MVP is default analyst only).
3. **R6** extension-UI dialogs (RPC extension_ui only; no simulated tools).
4. **R4 remainder:** publish Pi fork (user-authorized) so RPC no-model cold-start is runtime-active; then bind Kairo `kairo list` / `resume` session ids to Pi `switch_session` when product wants one picker (today: Pi files on disk only).
5. **R9** cutover cleanup: strip old UIs / packaging after V3 approval (remote auth); daily default is already ratatui on this branch.