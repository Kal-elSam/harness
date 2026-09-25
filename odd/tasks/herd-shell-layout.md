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
- [ ] H6-1 RED: fork tests for shell slots (fullscreen composition, resize, regular switch, editor focus, transcript scroll)
- [ ] H6-2 GREEN: fork layout slots + extension UI API (`setSidebar` / bottom strip) without replacing Pi core surfaces
- [ ] H7-1 RED: harness tests — fullscreen default launch; sidebar data/order; no invented states; headers SPACES/AGENTS
- [ ] H7-2 GREEN: launch fullscreen; extension fills sidebar + usage strip; regular keeps widget fallback
- [ ] H8-1 RED/GREEN: ≥90 → 28-col sidebar; &lt;90 → hide sidebar + compact summary
- [ ] H9-1 Integrate fork version into harness pin (after authorized publish — **blocked until remote auth**)
- [ ] H10-1 Suites both repos + interactive TTY captures @100/@60; record RDD; reopen checklist above only when TTY passes

## Progress

- H0–H5 (2026-09-25): DONE as widget/IA foundation. Commits include `7195ca3`, `3362369`. Working/done never emitted (no run registry). Widget RDD review still deferred (slice_budget_reached / untracked collect). Visual shell acceptance **reopened** under H6–H10.
- H6+ (2026-09-25): Plan accepted — real sidebar shell. Route: fork first (kairo-pi `kairo/0.87.1` @ `0.87.1-kairo.3`), then harness. No publish/push/PR without explicit auth. Engram mirror may need resync (multi-session).

## Verification evidence

- H1–H5: `node --test` snapshot/widget/extension; full `npm test` 2243 pass / 0 fail / 1 skip; node-width render only (not shell TTY).
- H6+: fork vitest + harness `node --test`; real PTY TTY @100/@60 required for acceptance.

## Next step

H6 — add shell slots in `/Users/kal-el/Desktop/kairo-pi` (delegated writer, strict TDD). Then H7/H8 in harness. Hold H9 publish until remote authorization.
