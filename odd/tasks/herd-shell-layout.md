# Herd Shell Layout (Camino 1)

## Objective

Build a Herdr-style layout inside the Pi/Kairo host: left sidebar with spaces/agents carrying honest states (working | blocked | idle | done | unknown), main zone = existing Pi conversation, bottom strip = compact usage + short session id. One glance answers who needs attention (blocked first).

## Problem

H1–H5 delivered an attention-ordered **overview widget** (HERD|USAGE) above the editor. That closed the IA/data gap but not the visual acceptance: spaces/agents must live in a **persistent left sidebar**, Pi conversation in the center, and usage in a **bottom strip** — composed around Pi's fullscreen viewport, not as a temporary widget.

## Why

Attention ordering (blocked first, fail-closed unknown) reuses the same snapshot + availability sources. The missing piece is real shell composition in the Kairo Pi fork (slots), then wiring the Kairo extension into those slots. Herdr remains visual reference only — never installed or integrated.

## Scope

### Closed (preserve — valid work)

- H1 — Additive snapshot `agents[]`/`spaces[]` with fail-closed states (blocked|idle|unknown; working/done never invented).
- H2 — Widget herd render (glyph agents, compact spaces, usage strip) as **regular-mode fallback**.
- H3 — Real-state wiring gap documented (no working/done run registry).
- H4 — `/kairo-team` detail + blocked-transition notify already satisfied.
- H5 — Suite green + node render evidence for the **widget** overview (not shell acceptance).

### Open — Real shell (authorized 2026-09-25 plan)

- H6 — Fork Pi: shell slots for left sidebar + bottom strip around existing fullscreen chat viewport. Do not replace transcript, editor, session, or Pi shortcuts. Tests: fullscreen composition, resize, switch to regular, editor focus, transcript scroll.
- H7 — Kairo launch: fullscreen by default; user can return to regular (widget overview fallback). Extension feeds sidebar from `agents[]`/`spaces[]` (headers **SPACES** / **AGENTS**, never "HERD"); USAGE → bottom strip; blocked-first; unknown when no evidence. Regular mode keeps current widget + `/kairo-team`.
- H8 — Responsive: ≥90 columns → fixed 28-col sidebar + chat remainder; &lt;90 → hide sidebar, compact attention/usage summary; `/kairo-team` keeps full list.
- H9 — Integrate new fork version into harness (pin). **No npm publish, push, or PR without explicit remote authorization.**
- H10 — Evidence: fork + harness suites; interactive TTY at 100 and 60 columns with capture (sidebar beside chat at 100; readable fallback at 60). Visual acceptance does **not** close on an isolated Node render. Record RDD status in this doc.

## Non-goals

- Own PTY binary/server, multi-machine detach, screen manifests
- Herdr dependency or install
- Second chat / bun pane / own PTY splits (single Pi chat only)
- Adopting Jev / changing routing
- `--legacy-cockpit` changes

## Constraints

- Additive `kairo.workspace-shell/v1` changes only; old consumers must not break.
- Fail-closed to `unknown` whenever there is no evidence; never invent state.
- `--legacy-cockpit` stays untouched.
- Fullscreen default chosen by user; regular mode keeps overview widget as fallback.
- No publish / push / PR without explicit remote authorization.

## Authorized scope

User plan "Kairo shell con sidebar real" (2026-09-25) authorizes H6–H10 on branch `feat/herd-shell-layout`. H1–H5 remain accepted as the data/widget foundation. Push/PR/merge/npm remain user decisions.

## Acceptance criteria

- [ ] Real TTY @100 cols: persistent sidebar (SPACES/AGENTS) beside Pi chat; usage strip below; blocked-first; no invented states
- [ ] Real TTY @60 cols: sidebar hidden; compact attention/usage summary readable; `/kairo-team` still has full list
- [ ] Fullscreen default on Kairo launch; switch to regular restores widget overview
- [ ] Snapshot additive; suite green (fork + harness); fork tests cover composition/resize/mode/focus/scroll
- [ ] Feature doc records RDD status and any remaining signal gaps (working/done)

## TDD

- Mode: strict (source: project Strict TDD Mode enabled).
- Runner: `node --test <file>` / fork vitest focused; `npm test` full before merge.
- RED before implementation, GREEN, then REFACTOR; never invent evidence.

## Delivery

- Strategy: `ask-on-risk` (default).
- Chain: fork bump (H6/H9) then harness wiring (H7/H8) then evidence (H10).
- RDD: assess per work-unit commit when enabled.
- Forecast: fork layout + harness likely &gt;400 authored lines combined → ask chain strategy before PR if split.

## Tasks

- [x] H0-1 Feature doc + Engram mirror `odd/herd-shell-layout/tasks`
- [x] H1-1 / H1-2 Snapshot agents/spaces (additive, fail-closed)
- [x] H2-1 / H2-2 Widget herd overview (regular-mode fallback)
- [x] H3-1 Map sources; working/done gap documented
- [x] H4-1 `/kairo-team` + blocked notify (already satisfied)
- [x] H5-1 Widget suite + node render evidence (shell acceptance reopened)
- [x] H6-1 RED: fork tests for shell slots (fullscreen composition, resize, regular switch, editor focus, transcript scroll)
- [x] H6-2 GREEN: fork layout slots + extension UI API (`setSidebar` / bottom strip) without replacing Pi core surfaces
- [x] H7-1 RED: harness tests — fullscreen default launch; sidebar data/order; no invented states; headers SPACES/AGENTS
- [x] H7-2 GREEN: launch fullscreen; extension fills sidebar + usage strip; regular keeps widget fallback
- [x] H8-1 RED/GREEN: ≥90 → 28-col sidebar; &lt;90 → hide sidebar + compact summary
- [x] H8b-1 Native review findings on `992fd097c..d5d467120` (APPROVED, but real defects found, required before fork `.4` publish):
  1. (R4/R3 WARNING) `getTuiMode` reads `KAIRO_TUI_MODE` once from env captured at extension creation — a live `/tui-mode`/settings-selector switch to regular is invisible; the extension keeps painting into slots the fork no longer draws, showing nothing. Derive the mode from the fork's live settings.json (what `SettingsManager.setTuiMode` actually persists on a live toggle) instead.
  2. (R4/R3) The sidebar-or-compact choice is made once per refresh from `process.stdout.columns`; slot components ignore the `width` passed to `render()`. Make the choice live inside each slot's own render, re-checked every repaint, so crossing the 90-column threshold reflows with no intervening refresh.
  3. (R3 WARNING) `extraLines` (e.g. team-recovery notices) are dropped in fullscreen — must appear in the sidebar at ≥90 cols or the compact summary below it.
  4. (R2 WARNING) Readability: sidebar truncation budget (24, via `cardInnerWidth`) doesn't match its documented 28 columns, and headers/route lines aren't truncated at all; `getTuiMode`'s missing-value default (fullscreen) is the inverse of the fork's own rule (regular); `setWorkspaceWidget`'s doc is stale.
  5. (R3 suggestion) Launcher tests must assert both `--tui-mode <mode>` in argv and `KAIRO_TUI_MODE` in the child env, for fullscreen and for regular.
  6. (parent PTY review) "Run /project analyze" is duplicated (ROUTES line + AGENTS empty-state) in the sidebar and compact summary — show it once. The narrow (60-col) compact USAGE line shows only the first provider even though more fits — include every provider that fits the width, ellipsis otherwise.
- [x] H8c-1 Regression found by a real PTY run of the `.4` local fork build at 60×30: the sidebar column still reserved 28 of the fork's `HStack` columns even though the extension deliberately rendered an empty sidebar below its own 90-column threshold, leaving the chat only 32 columns and truncating the status bar enough to hide the session id (100×30 was already correct). Fixed:
  1. Fork (`shell-viewport.ts`): `CollapsibleSidebarLayout` replaces the generic `HStack` sidebar/main split — it reserves the sidebar's fixed basis only when the sidebar actually renders at least one line at the current width; an empty sidebar collapses the reserved column to zero and the main column gets the full width. Re-evaluated on every `render()`, so a live resize (not just a fresh extension refresh) reflows immediately.
  2. Kairo (`extension/index.js`): the bottom-strip side of the same class of bug was already closed by H8b (the strip clears below 90 cols); confirmed still correct after the fork change (no fork-side "empty bottom strip still reserves height" bug exists — `VStack`'s own `basis: "auto"` sizing already collapses an empty strip to zero rows, verified by a dedicated fork unit test).
  3. Kairo (`extension/index.js`): unrelated perf fix bundled in the same pass — `readLiveKairoTuiMode` did a `readFileSync` + `JSON.parse` on every `getTuiMode()` call, which runs on every render (Pi repaints the fullscreen surface on every streamed token). `createLiveTuiModeReader` caches the parsed mode by the settings file's `mtimeMs` (via `statSync`), only re-reading the body when the mtime actually changes; a missing/unreadable file is never cached.
- [x] H8d-1 Regression found by the parent with a real PTY run: H8c's `CollapsibleSidebarLayout` fixed the WIDTH bug but broke the VERTICAL layout — at 100x30 the editor, dock, and status bar disappeared entirely (only the USAGE strip survived, moved to the top of the main column); at 60x30 the whole screen went blank; a live resize also left the whole screen blank. Root cause: `CollapsibleSidebarLayout` implemented only `Component.render(width)` (no height parameter). The real fullscreen renderer (`TuiAltScreen`'s render loop, via `renderLayoutFrame(root, width, height, ...)` in `packages/tui/src/layout.ts`) never calls `render(width)` on the root component directly — it walks a `[LAYOUT_NODE]` component tree top-down, distributing a real height budget at every level so nested `VStack`s with `grow`/`basis: 0` entries (transcript, editor dock, footer) can flex. A component with no `[LAYOUT_NODE]()` is opaque to that walk: the engine treats it as one leaf and calls its bare `render(width)`, which has no height to distribute at all, so every nested `VStack` inside computes sizes with `availableSize: undefined` (see `VStack.render` in `packages/tui/src/components/v-stack.ts`) — a `basis: 0, grow: 1` entry (the transcript) collapses to zero, and so does the `basis: 0` chat-column entry inside the bottom-strip wrapper, dropping editor/dock/footer/status entirely. Fixed in `740b4aa86`: `CollapsibleSidebarLayout` now implements `[LAYOUT_NODE]()`, returning a transparent `hstack` node (sidebar entry with a live-computed basis — 0 when it renders no content at its fixed width, else its basis; main entry `basis: "auto", grow: 1`), so the real renderer walks it exactly like the pre-H8c generic `HStack` did, restoring correct height distribution while keeping the H8c zero-width collapse. `render(width)` is unchanged (still used by direct/opaque callers, e.g. `TuiAltScreen`'s fallback `render(width)` compat path and existing unit tests). `renderLayoutFrame`/`LayoutFrame` were exported from pi-tui's public index (`packages/tui/src/index.ts`) so this can be exercised from coding-agent tests without reaching into pi-tui internals.
- [ ] H9-1 Integrate fork version into harness pin (after authorized publish — **blocked until remote auth**, unchanged by H8d)
- [x] H10-1a Suites both repos + interactive TTY captures @100/@60 for the H8d fix specifically (fork `test/kairo` 39/39, Kairo `npm test` 2278/2278/1 skip, real PTY evidence below). H10 as a whole (final acceptance-checklist reopen tied to the eventual published/pinned fork version) stays open pending H9.

## Progress

- H0–H5 (2026-09-25): DONE as widget/IA foundation. Commits include `7195ca3`, `3362369`. Working/done never emitted (no run registry). Widget RDD review still deferred (slice_budget_reached / untracked collect). Visual shell acceptance **reopened** under H6–H10.
- H6+ (2026-09-25): Plan accepted — real sidebar shell. Route: fork first (vendored `third_party/pi` @ `0.87.1-kairo.4`), then harness. No publish/push/PR without explicit auth.
- H6 (2026-09-25): DONE — `createShellViewport` + `ExtensionUIContext.setSidebar` / `setBottomStrip`; fullscreen rebuild in interactive-mode; regular mode safe no-op. Version `0.87.1-kairo.4`. Evidence: `npx vitest --run test/kairo` → 33 passed / 0 failed (after `npm run build:offline`).
- H7/H8 (2026-09-25): DONE (harness side) — `launchGentleShell` passes `--tui-mode fullscreen` by default (persisted, never overwrites a user-chosen `regular`); the Kairo extension feature-detects `setSidebar`/`setBottomStrip` and feeds SPACES/AGENTS + USAGE when the fork exposes them and the mode is fullscreen (≥90 cols: fixed 28-col sidebar + bottom strip, widget cleared; &lt;90 cols: BOTH the sidebar and the strip are cleared, one compact attention/usage/route summary occupies the widget slot); regular mode and the missing-API case both keep the classic HERD/USAGE overview widget. No fork source changes were needed. Commit: `59099b7c1` (initial harness code).
- H7/H8 dedup fix (2026-09-25): a coordinator PTY re-check of `59099b7c1` found real duplication that the unit tests had missed — they only exercised the per-command refresh path, never `session_start` (the real launch path), which always followed the shell render with the old "unavailable-routes" text widget landing it next to the sidebar (or replacing the compact summary entirely below 90 cols); session identity and USAGE could render in up to 3-4 places (sidebar, strip, widget, status bar); sidebar overflow was cut silently with no ellipsis. Fixed in `c45d6d82e`: `isShellActive`/`renderShellSurface` in extension/index.js are now the single decision point for BOTH the "overview" and "unavailable-routes" views once the shell is active; `renderShellSidebarLines`/`renderShellBottomStripLines`/`renderCompactShellSummaryLines` in workspace-widget.js drop the session-identity line (status bar owns it alone in fullscreen), the strip is cleared below 90 cols (not just the sidebar — usage folds into the compact summary instead), a `routeUnavailable` option folds the "no automatic route" notice into the sidebar/compact summary instead of a separate widget, and every sidebar line is truncated with `truncateToWidth(..., "…")`. Regular mode and the `.3` pin are unchanged (verified by dedicated tests and a real capture — see below).
- H8b native review fixes (2026-09-25): native review of `992fd097c..d5d467120` APPROVED with no blockers, but named 6 real defects to fix before fork `.4` publish (see the H8b-1 task item above for the full list). Fixed in `b8586ff79`:
  - **Live mode (#1)**: `getTuiMode`'s default now reads the fork's own `settings.json` fresh on every call (`readLiveKairoTuiMode` in extension/index.js, via the new exported `resolveKairoPiSettingsPath` in launch-gentle-shell.js — the exact file `SettingsManager.setTuiMode` persists to on a live `/settings` change), instead of a `KAIRO_TUI_MODE` env value captured once at extension creation. Its missing/unreadable-file fallback is now `"regular"`, unifying with the fork's own `SettingsManager.getTuiMode` default (was the inverse before — R2 finding #4).
  - **Live width (#2)**: the sidebar, bottom strip, and compact-summary widget are now installed ONCE whenever the shell is active (`renderShellSurface` no longer branches on `getColumns()` at dispatch time) — each factory (`createShellSidebarWidget`/`createShellBottomStripWidget`/`createCompactShellSummaryWidget` in workspace-widget.js) decides its OWN content live inside `render()`, reading `getColumns()` fresh every call via the shared `isWideEnoughForSidebar` helper. Crossing the 90-column threshold now reflows with no extension-triggered refresh. Documented tradeoff (in code, `isWideEnoughForSidebar`'s own doc): the fork's sidebar HStack column has a fixed 28-column basis once installed (`shell-viewport.ts`'s `SHELL_SIDEBAR_BASIS`) — there is no live API to shrink the reserved column itself from inside `render()`, only to empty its content, which is what happens below 90 cols.
  - **extraLines (#3)**: `renderShellSurface` now forwards `extraLines` to all three factories; `renderShellSidebarLines`/`renderShellBottomStripLines`/`renderCompactShellSummaryLines` append them (muted, truncated where applicable).
  - **Truncation budget + stale docs (#4)**: sidebar truncation now uses the real `SHELL_SIDEBAR_COLUMNS` (28), not `cardInnerWidth(28)` (24, meant for bordered panels the sidebar never draws) — every line (headers, route notice, spaces, agents, extraLines) is truncated. `setWorkspaceWidget`'s doc rewritten to describe the current shell-vs-classic routing.
  - **Launcher test coverage (#5)**: two new tests in host-launch.test.js assert `--tui-mode <mode>` in argv AND `KAIRO_TUI_MODE` in the child env together, for both fullscreen and regular — both passed immediately (no behavior change needed; the launcher was already correct, just untested as a pair).
  - **Dedup + multi-provider USAGE (#6)**: `noTeamHintLine`/`compactAttentionLine` now suppress the generic "Run /project analyze to build this project's team." wording when `routeUnavailable` already carries that instruction (sidebar shows "No agents yet." instead; compact summary omits the attention line entirely) — "Run /project analyze" now appears exactly once per surface. `compactUsageLine`/`fitUsageSegments` now fit as many `USAGE` provider segments as the given width allows (mirroring `fitFooterCommands`'s whole-segment-only approach), ending in `…` when one is dropped, instead of always showing only the first provider.

## Verification evidence

- H1–H5: `node --test` snapshot/widget/extension; full `npm test` 2243 pass / 0 fail / 1 skip; node-width render only (not shell TTY).
- H6: fork vitest `test/kairo` 33 pass / 0 fail after offline build; shell composition unit tests cover sidebar HStack, basis 28, clear/omit, transcript primary, bottomStrip vs footer. Real PTY TTY @100/@60 still required for acceptance (H10).
- H7/H8 (2026-09-25): RED observed pre-implementation (uncommitted from a prior session) — `node --test test/host-launch.test.js test/workspace-shell-extension.test.js test/workspace-widget.test.js` failed on the new `--tui-mode`, `renderShellSidebarLines`/`renderShellBottomStripLines`/`renderCompactShellSummaryLines`/`SHELL_SIDEBAR_MIN_COLUMNS` exports and the shell-slot extension tests (missing implementations). GREEN after implementation: `node --test test/host-launch.test.js test/workspace-shell-extension.test.js test/workspace-widget.test.js test/ecosystem-degrade.test.js` → 97 pass / 0 fail / 1 skip (the 1 skip is the pre-existing opt-in live-Pi test). Full `npm test` → 2257 pass / 0 fail / 1 skip. Fork `npx vitest --run test/kairo` (after `npm ci` + `npm run build:offline`, no fork source changes needed — H6 already exposed everything H7/H8 needed) → 33 pass / 0 fail.
  - Fullscreen-by-default flag: the fork's own `--tui-mode fullscreen|regular` CLI flag (`third_party/pi/packages/coding-agent/src/cli/args.ts:213-226`), read by `InteractiveMode` via `options.tuiMode ?? this.settingsManager.getTuiMode()` (`interactive-mode.ts:573`). `launchGentleShell` now always passes `--tui-mode <value>`, defaulting to `fullscreen` and persisting it into the fork's own `settings.json` (`prepareKairoPiHome`), but never overwriting a `regular` value the user (or the fork's own runtime `/tui-mode` toggle, which calls `SettingsManager.setTuiMode` and persists to the same file) already chose — so a user is back in regular mode on the next Kairo launch without needing `--legacy-cockpit`.
  - Extension feature-detection: `createKairoWorkspaceExtension` only feeds the fullscreen sidebar/bottom-strip slots when `typeof ctx.ui.setSidebar/setBottomStrip === "function"` (absent on the published `.3` pin) AND the current TUI mode is fullscreen. The fork's `ExtensionUIContext` exposes no getter for its own mode or terminal width, so `getTuiMode`/`getColumns` default to the one honest real signals available: the `KAIRO_TUI_MODE` env var the launcher sets from the same value passed as `--tui-mode`, and `process.stdout.columns`. Known limitation: a user who toggles TUI mode live from inside a running Pi session (its own runtime shortcut) is not reflected in the extension until the next `session_start`/command refresh, since there is no live-mode-change event exposed to extensions — acceptable given the fork's current API surface; not a regression from any prior state.
  - Dedup fix RED/GREEN: added tests targeting the real `session_start` launch path (not just the per-command refresh the original H7/H8 tests used) for fullscreen-with-slots at ≥90 and &lt;90 cols, fullscreen-without-slots (`.3` fallback), and regular mode — `node --test test/workspace-widget.test.js` RED 6/39 failing (session line still present, no ellipsis, no `routeUnavailable` option), `node --test test/workspace-shell-extension.test.js` RED 3/42 failing (old widget still rendered next to/instead of the shell surface via `session_start`'s unavailable-routes override). GREEN after the fix: `node --test test/host-launch.test.js test/workspace-shell-extension.test.js test/workspace-widget.test.js test/ecosystem-degrade.test.js` → 105 pass / 0 fail / 1 skip. Full `npm test` → 2265 pass / 0 fail / 1 skip. Fork `npx vitest --run test/kairo` → 33 pass / 0 fail (still no fork source changes). Commit: `c45d6d82e`.
  - Real PTY evidence, first pass (pre-publish check): built the fork's `dist/bundle/cli.js` fresh (`npm ci && npm run build:offline` in `third_party/pi`, unchanged fork source at `0.87.1-kairo.4`) and drove it in a real PTY (`tty_driver.py`, extended to accept `rows`/`cols` in the spec) at 100×40/60×40. This pass is superseded by the corrected re-check below — it is what surfaced the duplication the coordinator then confirmed independently.
  - **Coordinator PTY re-check (2026-09-25) found real duplication** — see the "H7/H8 dedup fix" entry above for the code fix. After the fix, three fresh captures at 100×30 / 60×30 (rows=30 per the coordinator's repro, fresh `HARNESS_HOME` per capture, `tty_driver.py`):

    **Screen A — 100×30, local `.4` fork build, `--tui-mode fullscreen`, real shell slots active** (`-e src/global/host/extension/`, the same `--no-*`/env flags as `launchGentleShell`, plus `KAIRO_TUI_MODE=fullscreen` mirroring what the real launcher sets):
    ```
    SPACES
    ◈ agentic-harness            pi v0.87.1-kairo.4
    ROUTES unavailable           escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash ·
    Run /project analyze.        ctrl+o more
    AGENTS                       Press ctrl+o to show full startup help and loaded resources.
    Run /project analyze to…
                                 Pi can explain its own features and look up its docs. Ask it how to
                                 use or extend Pi.
    [...]
                                ────────────────────────────────────────────────────────────────────────
                                ~/Desktop/agentic-harness (feat/herd-shell-layout)
                                0.0%/0 (auto)                                                    unknown
                                Kairo · agentic-harness · session: unbound
                                USAGE
                                Codex  5h   ━━━━━━━━━─ 89%
                                       W    ━━━━────── 36%
                                Claude S    ━━━━────── 43%
                                       W    ━━──────── 21%
                                Go     usage unknown
    ```
    Fact counts: `session:` → 1 (status bar only); `USAGE` → 1 (strip header only); `KAIRO ROUTES`/`KAIRO TEAM` → 0 (no separate widget); `ROUTES unavailable` → 1 (sidebar); sidebar overflow line ends in `…` (no silent cut); sidebar (SPACES/AGENTS) renders beside the chat column with no widget duplicating it.

    **Screen B — 60×30, same build/flags, narrow fullscreen (sidebar AND strip both cleared)**:
    ```
     pi v0.87.1-kairo.4
     escape interrupt · ctrl+c/ctrl+d clear/exit · / commands ·
     ! bash · ctrl+o more
     Press ctrl+o to show full startup help and loaded
     resources.
    [...]
    Run /project analyze to build this project's team.
    USAGE Codex 5h 89% / W 36%
    ROUTES unavailable
    Run /project analyze.
    ────────────────────────────────────────────────────────────
    ~/Desktop/agentic-harness (feat/herd-shell-layout)
    0.0%/0 (auto)                                        unknown
    Kairo · agentic-harness · session: unbound
    ```
    Fact counts: `session:` → 1 (status bar only); `USAGE` → 1 (inside the one compact summary); `KAIRO ROUTES`/`KAIRO TEAM` → 0; `ROUTES unavailable` → 1 (compact summary); no sidebar, no separate strip — one widget carries attention + usage + route notice.

    **Screen C — 100×30, real `node ./bin/kairo.js ui` launcher, pinned published `.3`** (no shell APIs — `pnpm list @kal-elsam/kairo-pi-coding-agent` confirms `0.87.1-kairo.3` is the resolved dependency; this is the actual production launcher path, not the direct-cli.js shortcut used for Screens A/B):
    ```
    KAIRO ROUTES · unavailable
    No verified automatic route is available for this project.
    Next: run kairo --legacy-cockpit, then /project analyze.
    USAGE · Codex 5h 88% / W 36% │ Claude S 43% / W 21% │ Go usage unknown
    KAIRO TEAM · not_analyzed
    Run /project analyze to build this project's team.
    session: unbound
    ────────────────────────────────────────────────────────────────────────────────────────────────────
    ~/Desktop/agentic-harness (feat/herd-shell-layout)
    0.0%/0 (auto)                                                                                unknown
    Kairo · agentic-harness · session: unbound
    ```
    Fact counts: `session:` → 2 (once inside the classic widget's own footer line, once in the status bar); `USAGE` → 1; `KAIRO ROUTES` → 1; `KAIRO TEAM` → 1. This 2× session count is the same pre-H7 baseline the classic widget always had (it names the session in its own last line in addition to the status bar) — unchanged by H7/H8, confirming the `.3` pin path has "no duplication beyond what regular mode already had."

- H8b RED/GREEN: widget-level RED 7/46 failing (real 28-col truncation, dedup, extraLines, multi-provider USAGE fit, live-`getColumns()` reactivity) → GREEN 46/46. Extension-level: 1/44 failing on the first (wrong) test model of the extraLines fix, corrected to use the real `availabilityExtraLines` source (`loadLiveData` → `null`) → GREEN 44/44; new tests also cover the live settings.json mode switch in both directions with no new extension instance. Launcher: 2 new tests for `--tui-mode`+`KAIRO_TUI_MODE` together passed immediately (24/24, no behavior change needed — already correct). Scoped 4-file suite: `node --test test/host-launch.test.js test/workspace-shell-extension.test.js test/workspace-widget.test.js test/ecosystem-degrade.test.js` → 116 pass / 0 fail / 1 skip. Full `npm test` (log saved) → 2276 pass / 0 fail / 1 skip. Fork `npx vitest --run test/kairo` → 33 pass / 0 fail (still no fork source changes — H8b is a harness-only fix). Commit: `b8586ff79`.

- H8b real PTY evidence — three fresh captures at 100×30/60×30 (fresh `HARNESS_HOME`+settings.json per capture) plus a live bidirectional mode-switch capture:

  **Screen A — 100×30, local `.4` fork build, live settings.json `tuiMode: "fullscreen"`, no `KAIRO_TUI_MODE` env at all (proving the live-settings read, not the old env path)**:
  ```
  SPACES
  ◈ agentic-harness
  ROUTES unavailable
  Run /project analyze.
  AGENTS
  No agents yet.
  [...]
                              ────────────────────────────────────────────────────────────────────────
                              ~/Desktop/agentic-harness (feat/herd-shell-layout)
                              0.0%/0 (auto)                                                    unknown
                              Kairo · agentic-harness · session: unbound
                              USAGE
                              Codex  5h   ━━━━━━━━━─ 86%
                                     W    ━━━━────── 35%
                              Claude S    ━───────── 11%
                                     W    ━━──────── 17%
                              Go     usage unknown
  ```
  Fact counts: `session:` → 1 (status bar); `USAGE` → 1 (strip); `ROUTES unavailable` → 1 (sidebar); "Run /project analyze" → 1 total (AGENTS shows "No agents yet." instead — dedup confirmed); no widget-slot content (chat column is Pi's own welcome text only).

  **Screen B — 60×30, same build, narrow fullscreen**:
  ```
  [Pi welcome text...]
                              USAGE Codex 5h 86% / W 35%…
                              ROUTES unavailable
                              Run /project analyze.
                              ────────────────────────────────
                              ~/Desktop/agentic-harness (fe...
                              0.0%/0 (auto)            unknown
                              Kairo · agentic-harness · ses...
  ```
  Fact counts: `session:` → 1; `USAGE` → 1 (compact summary, ends in `…` since only Codex's segment fit the actual widget width — Claude/Go correctly dropped, never truncated mid-name); `ROUTES unavailable` → 1; no attention line (suppressed — no agents and the route notice already explains why, per the #6 dedup fix); no sidebar, no separate strip.

  **Screen C — 100×30, real `node ./bin/kairo.js ui` launcher, pinned `.3`** (unaffected by H8b — same as the H7/H8 dedup-fix baseline):
  ```
  KAIRO ROUTES · unavailable
  No verified automatic route is available for this project.
  Next: run kairo --legacy-cockpit, then /project analyze.
  USAGE · Codex 5h 86% / W 35% │ Claude S 11% LOW / W 17% LOW │ Go usage unknown
  KAIRO TEAM · not_analyzed
  Run /project analyze to build this project's team.
  session: unbound
  ────────────────────────────────────────────────────────────────────────────────────────────────────
  ~/Desktop/agentic-harness (feat/herd-shell-layout)
  0.0%/0 (auto)                                                                                unknown
  Kairo · agentic-harness · session: unbound
  ```
  Fact counts: `session:` → 2 (classic widget's own line + status bar, same pre-H7 baseline); `USAGE` → 1; `KAIRO ROUTES` → 1; `KAIRO TEAM` → 1 — unchanged.

  **Live regular-mode switch (both directions), 100×30, `.4` fork build.** The fork exposes no direct keybinding for TUI mode — only the `/settings` interactive selector, whose "TUI mode" field calls `SettingsManager.setTuiMode(mode)` on change, persisting to the exact `settings.json` `readLiveKairoTuiMode` reads. Scripting that selector's exact key navigation was judged too fragile to be reliable evidence, so the switch was triggered the same way that handler ends up mutating state — editing `settings.json` directly to the value `setTuiMode` would have written — followed by Pi's own built-in `/reload` command (which fires `session_start` with reason `"reload"`, the same real code path a manual `/reload`, `/new`, or app restart uses):
  - **Before** (`tuiMode: "fullscreen"`): sidebar (SPACES/AGENTS/ROUTES unavailable) shown, no widget content in the chat column.
  - **After editing `settings.json` to `"regular"` + `/reload`**: sidebar is GONE; the chat column now shows the classic `KAIRO ROUTES · unavailable / KAIRO TEAM · not_analyzed / ... / session: unbound` widget — the exact regular-mode fallback — with NO new extension instance, proving the live read.
  - **After editing back to `"fullscreen"` + `/reload`**: sidebar (SPACES/AGENTS/ROUTES unavailable/No agents yet.) is back beside the chat column (which now also shows an unrelated "No models available" Pi startup notice, expected in this no-provider test environment and unrelated to the shell fix).

- H8c (2026-09-25): a real PTY run of the `.4` local fork build at 60×30 found the sidebar column still reserved 28 columns even though the extension rendered it empty below 90 columns — the fork's `HStack` always reserves an entry's fixed `basis` regardless of what that entry actually renders. Fixed in `45a75aaac` (fork): `CollapsibleSidebarLayout` replaces the `HStack` sidebar/main split in `shell-viewport.ts` — it collapses the reserved sidebar column to zero whenever the sidebar renders no lines at the current width, re-evaluated on every `render()` call. A separate perf-only fix landed in `c6ba46507` (Kairo): `createLiveTuiModeReader` caches `getTuiMode()`'s parsed result by the settings file's `mtimeMs`, since the uncached `readLiveKairoTuiMode` was doing a `readFileSync` + `JSON.parse` on every render.
  - RED (fork, `shell-viewport.test.ts`, source reverted to pre-fix while keeping the new tests): 5 failed / 5 passed — `CollapsibleSidebarLayout is not a constructor` / `instanceof` failures. GREEN after restoring the fix: fork `npx vitest --run test/kairo` (after `npm ci` + `npm run build:offline`) → 7 files / 36 tests passed / 0 failed (includes `packaging-files.test.ts`).
  - RED (Kairo, `workspace-shell-extension.test.js`'s new `createLiveTuiModeReader` spy tests, source reverted to the pre-H8c `HEAD` version): import failure (`createLiveTuiModeReader` does not exist yet) — 0 pass / 1 fail. GREEN after restoring the fix: `node --test test/workspace-shell-extension.test.js` → 46 pass / 0 fail (2 new tests use injected `statImpl`/`readFileImpl` spies to prove an unchanged mtime never re-reads/re-parses, a changed mtime re-reads exactly once, and a missing settings file is never falsely cached).
  - Scoped 4-file suite: `node --test test/host-launch.test.js test/workspace-shell-extension.test.js test/workspace-widget.test.js test/ecosystem-degrade.test.js` → 118 pass / 0 fail / 1 skip. Full `npm test` (log saved) → 2278 pass / 0 fail / 1 skip.
  - Real PTY evidence (LAUNCHER-EQUIVALENT setup — fresh `HARNESS_HOME` per capture, `HARNESS_HOME/.harness/pi-agent/settings.json` = `{"quietStartup": true, "tuiMode": "fullscreen"}`, `PI_CODING_AGENT_DIR`/`KAIRO_PI_EMPTY_SESSIONS=1`/`PI_SKIP_VERSION_CHECK=1`/`KAIRO_TUI_MODE=fullscreen`, `node third_party/pi/packages/coding-agent/dist/bundle/cli.js -e src/global/host/extension/ --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --tui-mode fullscreen`, cwd = repo root, `tty_driver.py`):

    **100×30, `.4` local fork build (unchanged from before H8c — sidebar reserves its 28 columns):**
    ```
    |SPACES
    |◈ agentic-harness           USAGE
    |ROUTES unavailable          Codex  5h   ━━━━━━━━━━ 100%
    |Run /project analyze.              W    ━━━━────── 35%
    |AGENTS                      Claude S    ━━━━━━──── 64%
    |No agents yet.                     W    ━───────── 9%
    |                            Go     usage unknown
    |Kairo · agentic-harness · session: unbound
    |To resume this session: pi --session 01a0dbe0-e716-7364-84e5-8b37fdf071c3
    ```

    **60×30, `.4` local fork build (the H8c fix — sidebar column fully collapsed):**
    ```
    |USAGE Codex 5h 100% / W 35% │ Claude S 64% / W 9% LOW…
    |ROUTES unavailable
    |Run /project analyze.
    |~/Desktop/agentic-harness (feat/herd-shell-layout)
    |0.0%/0 (auto)                                        unknown
    |Kairo · agentic-harness · session: unbound
    |To resume this session: pi --session 01a0dbe1-29f7-75c9-be03
    |-a10c0e4163f8
    ```
    The chat/USAGE content starts at column 0 (no reserved blank sidebar gutter) and the status bar shows the complete `Kairo · agentic-harness · session: unbound` text — the session id is no longer hidden by truncation.

    **100×30, real `node ./bin/kairo.js` launcher, pinned `.3` (unaffected by H8c — no `setSidebar`/`setBottomStrip` API, classic widget fallback):**
    ```
    |KAIRO ROUTES · unavailable
    |No verified automatic route is available for this project.
    |Next: run kairo --legacy-cockpit, then /project analyze.
    |USAGE · Codex 5h 100% / W 35% │ Claude S 64% / W 9% LOW │ Go usage unknown
    |KAIRO TEAM · not_analyzed
    |Run /project analyze to build this project's team.
    |session: 98fce01b · ask
    |~/Desktop/agentic-harness (feat/herd-shell-layout)
    |Kairo · agentic-harness · session: 98fce01b · ask
    |To resume this session: pi --session 01a0dbe1-b68f-72c8-a863-e7a63dac6736
    ```
    Confirms the `.3` pin path (no shell-slot API) is unchanged by the H8c fork fix, as expected.

- H8d (2026-09-25): a real PTY run by the parent (100x30 and 60x30, plus a live 100→60→100 resize) found the H8c fix broke the VERTICAL layout — see the H8d-1 task item above for the full root-cause analysis and fix summary. Fixed in `740b4aa86` (fork): `CollapsibleSidebarLayout` gains `[LAYOUT_NODE]()`, making it transparent to the real fullscreen renderer (`renderLayoutFrame`) the same way the pre-H8c generic `HStack` always was; `render(width)` is unchanged. `renderLayoutFrame`/`LayoutFrame` are now exported from `packages/tui/src/index.ts`'s public API. No harness (Kairo) source changes were needed — this is a fork-only fix, version stays `0.87.1-kairo.4` (still unpublished; H9 remains blocked on remote authorization).

  **RED** (`test/kairo/shell-viewport-layout.test.ts`, three new tests, run against HEAD `8a6453b81` before the fix): all 3 failed —
  ```
  100x30 with a visible sidebar: ... > AssertionError: expected -1 to be greater than or equal to 0   (editorRow not found)
  60x30 with an empty sidebar: ...    > AssertionError: expected -1 to be greater than or equal to 0   (editorRow not found)
  a live resize 100 -> 60 -> 100 ...  > AssertionError: expected -1 to be greater than or equal to 0   (editorRow not found)
  ```
  These tests call `renderLayoutFrame(viewport.root, width, height, ...)` directly (the real fullscreen path, the only one with a height budget to distribute) instead of `.render(width)`, because the bug is invisible to any test that only calls `.render(width)` — that method never receives a height in the first place, real or broken.

  **GREEN** after the fix (`npm ci && npm run build:offline`, then `npx vitest --run test/kairo` in `packages/coding-agent`): 8 files / 39 tests passed / 0 failed (36 pre-existing + 3 new). `npm run check` (biome + tsgo) is clean except 4 pre-existing `TS2554` errors in `test/kairo/shell-viewport.test.ts` (lines 170, 230, 231) confirmed via `git stash` to already exist on HEAD `8a6453b81` before this fix — unrelated to H8d, not touched.

  **Kairo checks (unaffected)**: full `npm test` at the harness root (log saved) → 2278 pass / 0 fail / 1 skip — exactly matching the pre-H8d baseline; no harness source changes were made.

  **Real PTY evidence** (launcher-equivalent setup — fresh `HARNESS_HOME` per run, `HARNESS_HOME/.harness/pi-agent/settings.json` = `{"quietStartup": true, "tuiMode": "fullscreen"}`, `PI_CODING_AGENT_DIR`/`KAIRO_PI_EMPTY_SESSIONS=1`/`PI_SKIP_VERSION_CHECK=1`/`KAIRO_TUI_MODE=fullscreen`, `node third_party/pi/packages/coding-agent/dist/bundle/cli.js -e src/global/host/extension/ --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --tui-mode fullscreen`, cwd = repo root, `tty_driver.py`, PTY 100x30/60x30):

    **Run 1 — same process, live resize 100 → 60 → 100** (spec: `["wait",15],["snap","a-100"],["resize",30,60,4],["snap","b-60"],["resize",30,100,4],["snap","c-100-again"]`):

    **a-100 (100x30, initial)**:
    ```
    01|SPACES
    02|◈ agentic-harness
    03|ROUTES unavailable
    04|Run /project analyze.
    05|AGENTS
    06|No agents yet.
    07|
    08|
    09|
    10|
    11|
    12|
    13|
    14|
    15|
    16|
    17|
    18|
    19|                            ────────────────────────────────────────────────────────────────────────
    20|
    21|                            ────────────────────────────────────────────────────────────────────────
    22|                            ~/Desktop/agentic-harness (feat/herd-shell-layout)
    23|                            0.0%/0 (auto)                                                    unknown
    24|                            Kairo · agentic-harness · session: unbound
    25|                            USAGE
    26|                            Codex  5h   ━━━━━━━━━━ 100%
    27|                                   W    ━━━━────── 35%
    28|                            Claude S    ━━━━━───── 54%
    29|                                   W    ━───────── 8%
    30|                            Go     usage unknown
    ```

    **b-60 (60x30, live resize from a-100, same process)**:
    ```
    01|
    02| Warning: No models available. Use /login to log into a
    03| provider via OAuth or API key. See:
    04|
    05| /Users/kal-el/Desktop/agentic-harness/third_party/pi/packa
    06| ges/coding-agent/docs/providers.md
    07|
    08| /Users/kal-el/Desktop/agentic-harness/third_party/pi/packa
    09| ges/coding-agent/docs/models.md
    10|
    11|
    12|
    13|
    14|
    15|
    16|
    17|
    18|
    19|
    20|
    21|
    22|USAGE Codex 5h 100% / W 35% │ Claude S 54% / W 8% LOW…
    23|ROUTES unavailable
    24|Run /project analyze.
    25|────────────────────────────────────────────────────────────
    26|
    27|────────────────────────────────────────────────────────────
    28|~/Desktop/agentic-harness (feat/herd-shell-layout)
    29|0.0%/0 (auto)                                        unknown
    30|Kairo · agentic-harness · session: unbound
    ```

    **c-100-again (100x30, live resize back, same process)**:
    ```
    01|SPACES
    02|◈ agentic-harness            Warning: No models available. Use /login to log into a provider via
    03|ROUTES unavailable           OAuth or API key. See:
    04|Run /project analyze.
    05|AGENTS                       /Users/kal-el/Desktop/agentic-harness/third_party/pi/packages/coding-a
    06|No agents yet.               gent/docs/providers.md
    07|
    08|                             /Users/kal-el/Desktop/agentic-harness/third_party/pi/packages/coding-a
    09|                             gent/docs/models.md
    10|
    11|
    12|
    13|
    14|
    15|
    16|
    17|
    18|
    19|                            ────────────────────────────────────────────────────────────────────────
    20|
    21|                            ────────────────────────────────────────────────────────────────────────
    22|                            ~/Desktop/agentic-harness (feat/herd-shell-layout)
    23|                            0.0%/0 (auto)                                                    unknown
    24|                            Kairo · agentic-harness · session: unbound
    25|                            USAGE
    26|                            Codex  5h   ━━━━━━━━━━ 100%
    27|                                   W    ━━━━────── 35%
    28|                            Claude S    ━━━━━───── 54%
    29|                                   W    ━───────── 8%
    30|                            Go     usage unknown
    ```

    **Run 2 — fresh process at 60x30** (separate `HARNESS_HOME`, spec: `["wait",15],["snap","d-fresh60"]`):
    ```
    01|
    02|
    03|
    04|
    05|
    06|
    07|
    08|
    09|
    10|
    11|
    12|
    13|
    14|
    15|
    16|
    17|
    18|
    19|
    20|
    21|
    22|USAGE Codex 5h 100% / W 35% │ Claude S 54% / W 8% LOW…
    23|ROUTES unavailable
    24|Run /project analyze.
    25|────────────────────────────────────────────────────────────
    26|
    27|────────────────────────────────────────────────────────────
    28|~/Desktop/agentic-harness (feat/herd-shell-layout)
    29|0.0%/0 (auto)                                        unknown
    30|Kairo · agentic-harness · session: unbound
    ```

  **Facts observed in all four captures**: the editor separators, the cwd line, the model line, and the full `Kairo · agentic-harness · session: unbound` status-bar text are present and un-truncated in every capture, including immediately after both live resizes — no blank screen after resize, and no missing dock/status content at either width. At 100 cols the sidebar (SPACES/AGENTS, columns 0-27) sits beside the chat column; at 60 cols the sidebar is absent and the chat column gets the full width.

  **Blank-after-resize verdict: app bug, not a driver artifact.** The task's own repro used the same `tty_driver.py`/`pyte` mechanism this evidence uses, and with the H8d fix applied, a live resize through that exact mechanism (`TIOCSWINSZ` + `SIGWINCH`, `pyte`'s `screen.resize`) now produces a fully correct redraw every time (see `b-60` and `c-100-again` above) — no blank screen, no stale content. Since the same driver, the same resize mechanism, and the same terminal library now render correctly once the layout bug is fixed, the previously observed "whole screen blank after resize" was caused by the same root cause as the static-render regression (an opaque `CollapsibleSidebarLayout` producing far fewer lines than the terminal height on every render, resize included), not by `pyte`'s `screen.resize` or the driver's `TIOCSWINSZ`/`SIGWINCH` mechanism.

## Next step

H9/H10 remain open: H9 (integrate fork version into harness pin) is blocked on explicit remote/publish authorization; H10 (full evidence record + reopening the acceptance checklist for the eventual pinned/published fork version) should follow once H9 is authorized. No push/PR/npm publish was performed. H8c (sidebar-column-reservation regression) and H8d (vertical-layout regression introduced by the H8c fix) are both closed with RED/GREEN and real PTY evidence above.

### Parent verification of H8c/H8d (2026-09-26)

- The parent's H8c PTY check (launcher-equivalent settings under
  `$HARNESS_HOME/.harness/pi-agent`, row-numbered, blank rows kept) found
  that `45a75aaac` hid the editor, separators, and status bar at 100x30
  (the USAGE strip moved to the top of the chat column), and that a live
  resize to 60 left the screen blank. The H8c writer's own captures had
  filtered out blank rows, so they did not show it. H8d (`740b4aa86`)
  fixed it with `[LAYOUT_NODE]`.
- The parent re-ran the check on `daa785045` with a live resize
  (TIOCSWINSZ + SIGWINCH), 100 → 60 → 100:
  - Every screen has the editor separators, the cwd and model lines, and
    the full `Kairo · agentic-harness · session: unbound` at rows 19–24
    (at 100) and 25–30 (at 60).
  - At 60 the chat starts at column 0 with the full width, and the
    compact summary sits above the editor.
  - The sidebar comes back after resizing to 100.
- `daa785045` fixes 4 `tsgo` TS2554 errors in
  `test/kairo/shell-viewport.test.ts`. They were introduced by our own
  `45a75aaac` (the helper `render()` took no parameter), not by
  upstream. After the fix: `npx tsgo --noEmit` has 0 errors, biome is
  clean, and `npx vitest --run test/kairo` gives 8 files and 39/39.

## Staged visible-results plan (authorized 2026-09-26)

Source: user "Autorizo todo" on plan "Kairo shell con resultados visibles por etapa".
Route: delegated direct per task (inline only for 1-3 file decide/verify). No SDD artifacts.
TDD: strict (source: sdd-init/harness strict_tdd true). Runner: `pnpm test` (`node --test`); fork `npx vitest --run test/kairo`.
Delivery: `ask-on-risk` (default). Forecast: S1+S2+S3 likely >400 authored lines combined -> ask chain strategy before PR if split.
RDD: on (decided by default; global/clone unset). Assess per work-unit commit; candidate = work-unit commit, never TODO checkbox.
Engram mirror: `odd/herd-shell-layout/tasks` SYNCED via CLI (#4007; MCP save ambiguous without session_id).

### Stage gates (must record aprobado/rechazado per stage before next)

- [ ] S1 Launcher real .4 local aislado (sin publicar): capturas 100 y 60 cols + resize ambos sentidos + modo regular; conteo sesion/agents/usage; cero duplicados/datos cacheados como vigentes
- [ ] S2 UI cierre: proyecto actual en vez de SPACES; AGENTS con modelo + causa concreta (no BLOCKED generico); click abre detalle + misma accion por teclado; RED->GREEN + captura TTY por cambio
- [ ] S3 Recuperacion en origen: perdida acceso -> motivo -> propuesta verificable -> aprobar/rechazar -> team resultante; sin activacion hasta aprobacion; sin alternativa -> salida ejecutable real
- [ ] S4 Cierre: revision riesgo alto + publicar/fijar .4 solo con autorizacion remota explicita; aceptacion final repite capturas y recuperacion con kairo instalado (no solo CLI fork)

### Tasks

- [ ] S1-1 RED/GREEN: launcher-equivalent PTY harness (100/60 + resize + regular) con conteos `session:`/`USAGE`/sidebar
  - Baseline 2026-09-26 (sin cambios fuente): scoped `node --test test/host-launch test/workspace-shell-extension test/workspace-widget test/ecosystem-degrade` -> 118 pass / 0 fail / 1 skip. Pin confirmado `.3` (`pnpm list`); `third_party/pi` dist es stub (cli.js 160B, cli-runtime.js 660B) -> falta `npm ci + build:offline` para .4 local; `tty_driver.py` no esta en el repo -> capturas PTY S1 pendientes.
  - Evidencia 2026-09-26 (build .4 local fresco): `npm run build:offline` en `third_party/pi` OK (bundle 56 files, 8.2 MiB); `npx vitest --run test/kairo` -> 8 files / 39 pass. PTY aislado (stdlib, sin pyte: conteos sobre raw-stream con redibujados, no pantalla unica): 100x30 fullscreen -> SPACES 1 / AGENTS 1 / ROUTES unavailable 1 / USAGE 2 (strip + re-draw) / session: 2 (historial con 2 status bars, pantalla muestra 1); sidebar junto al chat confirmada en tail. 60x30 -> SPACES 0 / AGENTS 0 / ROUTES unavailable 1 / session: 1 / USAGE 2 (transitorio "checking" + compacto final); sin sidebar, resume compacto OK. Pendiente: resize 100->60->100 mismo proceso + modo regular + conteo pantalla-unica (requiere emulacion tipo pyte).
- [ ] S1-2 Capturas revisadas con usuario: aprobado/rechazado registrado abajo
- [x] S2-1a RED/GREEN: header proyecto actual (`◈ <label>`, sin SPACES/sesion); filas AGENTS con causa concreta (`shellAgentLine`/`shortBlockedCause`, fallback honesto sin causa); `compactAttentionLine` causa en 1 bloqueado. Touches: `src/global/host/workspace-widget.js` + 2 test files. Route: delegated-direct intent, inline fallback (subagent funds exhausted, 2 attempts).
  - Evidence: RED 4 fail -> GREEN 50/50 widget; scoped 122/0/1; full `pnpm test` 2282/0/1. Commit `762ef53aa`.
  - RDD `762ef53aa`: assess high_risk/review_due true (base-diff c17ee0c5ce..HEAD incluye fork vendored: 1931 paths). Preflight STATUS pide `intended-untracked-selection` (3 untracked preexistentes, ninguno mio) con schema exacto `gentle-ai.review-intended-untracked-selection/v1` que no puedo fabricar; intento con `{}` -> `invalid_request` (retry_safe). Review NO lanzado, NO marcado como revisado. Blocker para S4: decision tuya (declarar untracked scope / autorizar review) + workers reviewers sin fondos.
- [x] S2-1a2 Correccion del usuario (2026-09-26): sin `stateReason`, ni sidebar ni resumen angosto imprimen BLOCKED/blocked — fallback `Access unavailable` sin inventar causa; `/kairo-team` agrega `Next step: run /project analyze to assign an eligible model.` en filas bloqueadas sin causa. Touches: `workspace-widget.js` (`shellAgentLine`, `compactAttentionLine`), `extension/index.js` (`teamDetailLines`) + tests. Route: inline (contexto ya cargado, 2 archivos no-triviales + tests; delegacion sin fondos).
  - Evidence: RED 3 fail -> GREEN 98/98 (2 files); scoped 124/0/1; full `pnpm test` 2284/0/1. Commit: ver abajo.
- [x] S2-1a3 Segunda correccion (2026-09-26, pedida por vos): `Unavailable` corto (entra en 28 cols sin romperse) en sidebar + resumen simple y multiple (`✖ 2 unavailable: …`); `herdAgentLine` del panel HERD intacto. Evidence: GREEN 98/98; scoped 124/0/1; full 2284/0/1.
- [x] S2-2 Capturas TTY del commit exacto `be8c0eee3` (2026-09-26, stdlib PTY sin pyte: conteos sobre raw-stream con redibujados):
  - s2-100/s2-60 (fixture causa conocida + ausente): `◈ agentic-harness`, SPACES 0, session 0, BLOCKED 0; `✖ Researcher · Cursor Model…` (causa larga trunca con …, completa en /kairo-team); `✖ Builder · Unavailable`; compacto `✖ 2 unavailable: Researcher, Builder` + USAGE una vez.
  - s2-live100 (shell real fullscreen): header `◈ agentic-harness` en vivo, SPACES 0, AGENTS 1, ROUTES unavailable 1, strip USAGE + session en status bar.
- Review riesgo alto (tu decision 2026-09-26): untracked excluidos (`docs/assets/…png`, `report.json`, `inspect-opencode-tier.sh` — preexistentes, no del commit). Recomendado hacerlo ahora; NO lanzado (autorizacion tuya pendiente, sin adivinar preflight JSON) y workers reviewers sin fondos registrado (2 delegaciones fallidas `Insufficient account funds`).
- [x] S2-1b Click abre detalle + equivalencia teclado (2026-09-26): fork verificado — `dispatchMouseToLayout` routea a slots con `handleMouse` propio (hitboxes del layout real, sin cambios fork). `agentRowHitboxes` (recomputo por render/resize, contempla detalle abierto), bloque detalle (modelo, causa completa envuelta, next step), toggle al re-clic; seleccion en closure `shellSelection` con repaint guardado por `isShellActive`; `/kairo-team` misma info por teclado. Touches: `workspace-widget.js`, `extension/index.js` + tests. Route: inline (delegacion sin fondos, 3er intento registrado).
  - Evidence: RED 1+3 fail -> GREEN 102/102 (2 files); scoped 128/0/1; full `pnpm test` 2288/0/1. Commit: ver abajo.
  - Commit `6fcb4a0d8`. RDD: assess high_risk/review_due true (acumulado rama). Review sigue pendiente de tu autorizacion + fondos.
- [x] S2-1b2 Defecto press+click (hallazgo tuyo 2026-09-26): Pi envia press y click por gesto; el toggle abria y cerraba el detalle con un click. Fix acotado: `handleMouse` responde solo a `click`. Evidence: RED 1 fail (gesto press->click daba ["a","a"]) -> GREEN 103/103; scoped 129/0/1; full 2289/0/1; TTY `s2-click.txt` PASS x4 (gesto unico, detalle abierto con causa completa envuelta, segundo click cierra). Commit: ver abajo.
- [ ] S2-2 Captura TTY por cambio S2 + aprobado/rechazado
- [ ] S2-2 Captura TTY por cambio S2 + aprobado/rechazado
- [ ] S2-2 Captura TTY por cambio S2 + aprobado/rechazado
- [ ] S3-1 RED/GREEN: propuesta sin activacion; ciclo perdida->motivo->propuesta->decision->team; salida ejecutable sin alternativa
- [ ] S3-2 Flujo recuperacion con kairo instalado + aprobado/rechazado
- [ ] S4-1 Review riesgo alto + autorizacion remota + pin .4 + capturas finales

### Stage approvals

- S1: aprobado (2026-09-26, parcial: build+suite+capturas iniciales OK; resize/regular/pantalla-unica pasan a deuda S1-2)
- S2: pendiente (S2-1a codigo + S2-2 capturas hechos; falta S2-1b click/teclado + veredicto visual tuyo)

## Prueba-real plan (autorizado 2026-09-26)

1. AGENTS click->detalle + `/kairo-team` misma accion por teclado; hitboxes + resize verificados.
2. Recuperacion: causa + modelo alternativo verificado, sin activar hasta aprobacion; probar aprobacion, rechazo y sin-alternativa.
3. Review riesgo alto sin los 3 untracked, sin inventar JSON; fondos-impedido = pendiente, nunca aprobado.
4. Publicar fork .4 + pin + instalacion SOLO con autorizacion explicita tuya (sesion indicada por vos). Sin auth = bloqueado.
Criterio «listo»: kairo normal (no CLI fork) a 100/60 + resize + mouse/teclado + ciclo proponer->aprobar/rechazar, con capturas y resuites antes de tu veredicto final.
Orden confirmado (2026-09-26): kairo carga Pi .3 (slots ausentes -> fallback HERD viejo con BLOCKED); sin mas capturas .3. Primero recuperacion con aprobacion, luego review, luego publicar/fijar/instalar .4; recien ahi veredicto visual.
- [x] S3-1a RED/GREEN (2026-09-26): perdida de acceso genera PROPUESTA verificable, jamas activa. `runTeamRecovery` escribe `{outcome:proposed, proposal(suggested), affected[]}` en el record (con `proposal` persistido en el store); el archivo del team activo no se toca; `proposed/approved/rejected` cierran fingerprint (`activated` sigue terminal por records viejos). `approveRecoveryProposal` re-verifica routabilidad actual o rechaza por stale; `rejectRecoveryProposal` cierra sin tocar nada; servicio expone ambos; extension notifica causa + alternativa + "Nothing was activated" sin re-sincronizar rutas. Touches: `team-recovery.js`, `availability-recovery-store.js`, `service.js`, `extension/index.js` + 4 test files. Route: inline (delegacion sin fondos).
  - Evidence: RED (imports + e2e + service) -> GREEN 169/169 (4 files); full `pnpm test` 2295/0/1. Commit: ver abajo.
- [ ] S3-1b Approval surface: `/project` (legacy cockpit) muestra propuesta pendiente con aprobar/rechazar reales; sin ella el aviso no nombra salidas muertas
- [ ] S3-2 Flujo proponer->aprobar/rechazar/sin-alternativa con kairo instalado + aprobado/rechazado
- S2: pendiente
- S3: pendiente
- S4: pendiente (bloqueado hasta autorizacion remota explicita)

