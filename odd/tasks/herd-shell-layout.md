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
- [ ] H9-1 Integrate fork version into harness pin (after authorized publish — **blocked until remote auth**)
- [ ] H10-1 Suites both repos + interactive TTY captures @100/@60; record RDD; reopen checklist above only when TTY passes

## Progress

- H0–H5 (2026-09-25): DONE as widget/IA foundation. Commits include `7195ca3`, `3362369`. Working/done never emitted (no run registry). Widget RDD review still deferred (slice_budget_reached / untracked collect). Visual shell acceptance **reopened** under H6–H10.
- H6+ (2026-09-25): Plan accepted — real sidebar shell. Route: fork first (vendored `third_party/pi` @ `0.87.1-kairo.4`), then harness. No publish/push/PR without explicit auth.
- H6 (2026-09-25): DONE — `createShellViewport` + `ExtensionUIContext.setSidebar` / `setBottomStrip`; fullscreen rebuild in interactive-mode; regular mode safe no-op. Version `0.87.1-kairo.4`. Evidence: `npx vitest --run test/kairo` → 33 passed / 0 failed (after `npm run build:offline`).
- H7/H8 (2026-09-25): DONE (harness side) — `launchGentleShell` passes `--tui-mode fullscreen` by default (persisted, never overwrites a user-chosen `regular`); the Kairo extension feature-detects `setSidebar`/`setBottomStrip` and feeds SPACES/AGENTS + USAGE when the fork exposes them and the mode is fullscreen (≥90 cols: fixed 28-col sidebar + bottom strip, widget cleared; &lt;90 cols: BOTH the sidebar and the strip are cleared, one compact attention/usage/route summary occupies the widget slot); regular mode and the missing-API case both keep the classic HERD/USAGE overview widget. No fork source changes were needed. Commit: `59099b7c1` (initial harness code).
- H7/H8 dedup fix (2026-09-25): a coordinator PTY re-check of `59099b7c1` found real duplication that the unit tests had missed — they only exercised the per-command refresh path, never `session_start` (the real launch path), which always followed the shell render with the old "unavailable-routes" text widget landing it next to the sidebar (or replacing the compact summary entirely below 90 cols); session identity and USAGE could render in up to 3-4 places (sidebar, strip, widget, status bar); sidebar overflow was cut silently with no ellipsis. Fixed in `c45d6d82e`: `isShellActive`/`renderShellSurface` in extension/index.js are now the single decision point for BOTH the "overview" and "unavailable-routes" views once the shell is active; `renderShellSidebarLines`/`renderShellBottomStripLines`/`renderCompactShellSummaryLines` in workspace-widget.js drop the session-identity line (status bar owns it alone in fullscreen), the strip is cleared below 90 cols (not just the sidebar — usage folds into the compact summary instead), a `routeUnavailable` option folds the "no automatic route" notice into the sidebar/compact summary instead of a separate widget, and every sidebar line is truncated with `truncateToWidth(..., "…")`. Regular mode and the `.3` pin are unchanged (verified by dedicated tests and a real capture — see below).

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

## Next step

H9/H10 remain open: H9 (integrate fork version into harness pin) is blocked on explicit remote/publish authorization; H10 (full evidence record + reopening the acceptance checklist) should follow once H9 is authorized. No push/PR/npm publish was performed.
