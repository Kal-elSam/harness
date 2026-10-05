# Session Handoff + Context Fill

## Objective

Close the opt-in `session-handoff` component and the `context-fill` observability (`kairo context --json`, hook, checkpoint) as one unit, across the five agent templates (claude, codex, cursor, opencode, pi).

## Problem

The work exists only as uncommitted/untracked files on `feat/herd-shell-layout`, mixed with shell, Pi-pin and documentation changes, and with no feature tracker. Nothing is committed, so nothing is recoverable or reviewable as a unit.

## Why

Handoff and context-fill share contracts (`context` JSON, checkpoint format). Closing them separately would let the contracts drift. Missing data must stay `unknown`; a percentage is never invented.

## Scope (pending files at reconciliation, 2026-10-05)

- Component: `src/global/components/session-handoff.js`, `src/global/component-builders.js`, `global-template/components/session-handoff/`, `global-template/components/catalog.json`, `docs/components.md`.
- Observability: `src/global/observability/context-fill{,-checkpoint,-cursor,-handoff,-hook}.js`, `scripts/context-fill-hook.js`.
- CLI: `src/cli.js`, `src/global/cli-help.js`.
- Templates: `repo-template/.{claude,codex,cursor,pi}/skills/session-handoff/`, `repo-template/.cursor/commands/`, `repo-template/.opencode/commands/`, `repo-template/.pi/prompts/`, `repo-template/docs/ai/session-handoff.md`, `repo-template/AGENTS.md`, `repo-template/docs/ai/adapter-parity.md`.
- Tests: `test/context-fill.test.js`, `test/context-fill-hook.test.js`, `test/component-{catalog-compat,registry,resolve}.test.js`, `test/components-cli.test.js`, `test/workspace-components.test.js`.

## Non-goals

- Shell/theme/Pi-pin changes (tracked in `odd/tasks/herd-shell-layout.md`).
- Diagnostic files (`report.json`, `scripts/inspect-opencode-tier.sh`): never in functional commits.
- Push, publish, merge, remote or provider calls.

## Constraints

- Component is opt-in: installed only by explicit command.
- Absent data => `unknown`; no invented percentages.
- Artifacts in English; Spanish only in chat.
- Existing documented `context` and handoff contracts are preserved.

## Acceptance criteria

- [ ] Explicit install works; default install does not add the component.
- [ ] `kairo context --json` emits valid JSON; absent data reported as unknown.
- [ ] Checkpoint is written and recoverable in a fresh session.
- [ ] All five agent templates carry the handoff entry points.
- [ ] Focused tests + `npm run test:cool` green with fresh evidence.

## TDD

- Mode: strict (source: project Strict TDD Mode enabled).
- Runner: `node --test <file>`; full `npm run test:cool`.
- Code already exists untested-by-history: each task first confirms coverage by observing RED against a deliberately broken contract or adds the missing test; never claim RED that was not observed.

## Delivery

- Strategy: `ask-on-risk`. Forecast well over 400 changed lines => ask chain strategy before any PR.
- RDD: on (default). Assess per work-unit commit.
- Route: delegated writer for multi-file units (Writer trigger).

## Tasks

- [x] SH-0 Feature doc + Engram mirror `odd/session-handoff-context-fill/tasks`
- [ ] SH-1 Audit existing files against acceptance criteria; list gaps (mapper)
- [ ] SH-2 Context-fill core + `context --json` + CLI help (tests first)
- [ ] SH-3 Hook + checkpoint recovery (tests first)
- [ ] SH-4 Component, catalog, builders, opt-in install (tests first)
- [ ] SH-5 Templates for the five agents + docs/parity
- [ ] SH-6 Focused tests, `npm run test:cool`, commit per work unit, RDD assess

## Progress

- 2026-10-05: tracker created from the reconciliation plan. No source written yet.

## Verification evidence

None yet for this feature.

## Next step

SH-1 audit.
