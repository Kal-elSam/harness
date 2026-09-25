# Herd Shell Layout (Camino 1)

## Objective

Build a Herdr-style layout inside the Pi/Kairo host: left sidebar with spaces/agents carrying honest states (working | blocked | idle | done | unknown), main zone = existing Pi conversation, bottom strip = compact usage + short session id. One glance answers who needs attention (blocked first).

## Problem

Today the overview is two side-by-side USAGE/TEAM panels in `src/global/host/workspace-widget.js`, fed by snapshot `kairo.workspace-shell/v1` via `src/global/host/extension/index.js` and `src/global/host/workspace-snapshot.js`. P01–P01.2 (see `odd/tasks/kairo-pi-parity.md`) delivered visible team + widget; the information architecture is still a dense role/model/via table, not an attention-ordered herd view.

## Why

Attention ordering (blocked first, fail-closed unknown) is the next IA layer, not a brain rewrite. It reuses the same snapshot + availability sources and keeps `/kairo-team` as the detail view.

## Scope

- H1 — Additive snapshot contract: `agents[]` ({id, label, role?, provider?, model?, state, stateReason?}) + `spaces[]` (current project + bound session: short id, mode). State in working | blocked | idle | done | unknown with documented rule:
  - blocked from `resolveAssignmentAvailability` blocked, or run awaiting input/approval only if a real signal exists
  - working from an active run for that role/assignment
  - idle = assignment available with no active run
  - done only with a real "finished and unseen" signal; otherwise never emit done
  - unknown when checking / no evidence
- H2 — Widget herd render in `workspace-widget.js`: agents section with glyph + name + short provider (Herdr style, no wide table), compact spaces (project + session), USAGE as bottom strip or thin bar (reuse P01.2 gauges/cache age). Narrow width stacks vertically (same content-sized discipline as `computeSideBySideWidths`). Keep Pi component factory (avoid MAX_WIDGET_LINES=10).
- H3 — Real-state wiring in extension/snapshot loaders: map only already-trusted sources (assignment-availability, session binding, conversation-service runs if they expose state). No screen-scraping. If no run-per-role signal exists, ship H2 with blocked | idle | unknown and document working/done as follow-up.
- H4 — Minimal interaction: existing per-agent command/detail or `/kairo-team`; notification on transition to blocked (reuse `availabilityNotices`). No mouse splits; Pi keyboard/commands only.
- H5 — Close vs parity: does not block P02–P07 of kairo-pi-parity. Own branch `feat/herd-shell-layout`; rebase if widget/extension collide. Legacy `--legacy-cockpit` unchanged.

## Non-goals

- Own PTY binary/server, multi-machine detach, screen manifests
- Herdr dependency or install
- Second tdo pane
- Adopting Jev / changing routing

## Constraints

- Additive `kairo.workspace-shell/v1` changes only; old consumers must not break.
- Fail-closed to `unknown` whenever there is no evidence; never invent state, never present blocked as available.
- `--legacy-cockpit` stays untouched.
- Small chained PRs if widget exceeds ~400 authored lines.

## Authorized scope

User plan "Herd shell layout (Camino 1)" authorizes H0–H5 on branch `feat/herd-shell-layout`. Push/PR/merge remain user decisions under ordinary repo policy. Base observed at H0: worktree on `feat/kairo-pi-p02-session-binding` with dirty `src/global/host/extension/index.js` + `test/workspace-shell-extension.test.js` — rebase/collide risk recorded, no branch switch done in H0.

## Acceptance criteria

- [ ] Real TTY: kairo shows agents with honest blocked/idle/unknown (+ working/done only with real signal) and usage strip
- [ ] Snapshot additive: old consumers do not break
- [ ] Suite green; widget tests cover blocked-first and fail-closed (no false done)
- [ ] Feature doc records which states still lack signal (working/done if applicable)

## TDD

- Mode: strict (source: `odd/tasks/kairo-pi-parity.md` → `~/.claude/CLAUDE.md` "Strict TDD Mode: enabled").
- Runner: `node --test <file>` focused, `npm test` full suite before merge.
- RED before implementation, GREEN, then REFACTOR; never invent evidence.

## Delivery

- Strategy: `ask-on-risk` (default). Slices H1 → H2 → H3 (H4 small) as chained PRs if widget exceeds ~400 authored lines.
- Chain strategy: not yet chosen; ask once if split is needed (`stacked-to-main` vs `feature-branch-chain`).
- RDD: per clone mode; assess per work-unit commit.
- Forecast: H1+H2 likely under 400 authored lines combined; H3 depends on run-state signal availability.

## Tasks

- [ ] H0-1 Feature doc + Engram mirror `odd/herd-shell-layout/tasks` (this file)
- [ ] H1-1 RED: snapshot tests pin `agents[]`/`spaces[]` shape + fail-closed (checking/unknown, no false done) in `test/workspace-shell-snapshot.test.js` (+ related)
- [ ] H1-2 GREEN: additive `agents[]`/`spaces[]` in `workspace-snapshot.js` with documented state rule; old fields unchanged
- [ ] H2-1 RED: widget tests pin blocked-first, truncation, stacked narrow, no false done in `test/workspace-widget.test.js`
- [ ] H2-2 GREEN: herd render in `workspace-widget.js` (agents glyph list, compact spaces, usage strip); keep component factory
- [ ] H3-1 Map real sources only (availability, session binding, runs if exposed); document working/done gap if signal missing
- [ ] H4-1 Per-agent detail command path + blocked transition notice via `availabilityNotices`; no mouse splits
- [ ] H5-1 Full suite green + real TTY verification + record unverified states; branch `feat/herd-shell-layout`

## Progress

- H0 (2026-09-25): base mapped (widget 382 lines, snapshot 358 lines, extension team/usage views). P01–P01.2 closed; P02 branch dirty — collide risk noted. No source writes yet.
- H1 (2026-09-25): DONE inline (subagents unfunded, user authorized inline). `7195ca3` feat(host): additive herd agents/spaces — 146 authored lines, far below 400. RED 5 fail → GREEN 30/30 snapshot + 84/84 related (widget, extension, cache, components, binding). No working/done run signal exists in snapshot inputs → never emitted, documented in code + H3 follow-up. RDD assess (`--base-ref 516d859 --committed-only`, untracked clutter excluded via canonical inventory): medium / under_budget (241 lines incl. feature doc) → review_due false, boundary stays pending until slice reaches budget.
- Route: delegated-direct attempted (explore worker failed: insufficient funds) → inline bounded reads fallback. Implementation tasks (H1+) go via single bounded writer each; per-action verification workers as needed.

## Verification evidence

- H0: file + Engram mirror readback only (no functional checks).
- H1+: `node --test test/workspace-shell-snapshot.test.js`, `node --test test/workspace-widget.test.js`, then `npm test`.
- Per work-unit commit on `feat/herd-shell-layout`: RDD assess when enabled.

## Next step

Create branch `feat/herd-shell-layout` (user confirms handling of dirty P02 worktree), then H1-1 RED.
