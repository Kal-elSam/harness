# Plan mode model-agnostic cheap planning

## Objective
Make cheap two-pass planning live in plan mode itself, not in a specific model (Sol 6.1 today, another tomorrow). Any selected model in plan mode behaves as read-only architect with bounded context; default effort medium.

## Problem
Planner token burn comes from unbounded exploration in the same long session: general repo audit, full large files, lockfiles/builds/logs, re-reads, then review/tests/refinement in same conversation. Tying the mitigation to a model ID breaks on every model rotation.

## Scope
- `repo-template/opencode.json.sample`: keep `agent.plan` model-agnostic (deny edit/bash, steps 8); clarify it applies to any model.
- `repo-template/.opencode/agents/architect.md` + `repo-template/.cursor/agents/architect.md`: add bounded plan contract (read-only, max 10 files, max 8 steps, ignore noise, max 3 questions, output files/contract/risks/acceptance).
- `repo-template/docs/ai/model-policy.md` + `context-budget.md`: default plan effort medium, escalate to strong only for architecture-critical decisions; plan context budget rule.
- Out of scope: changing fleet-models defaults, Codex CLI config.toml, execution-router tiers, new skills.

## Constraints
- Adapter parity: OpenCode + Cursor first; Codex/Cursor Auto inherit via AGENTS.md + docs/ai, no model-ID hardcoding.
- Generated artifacts default English; conversation Spanish Rioplatense.
- No installs; no unrelated template refactors.

## Authorized scope
User authorized implementation in repo-template + global-template (2026-09-30). Route: delegated direct attempted, fallback inline after explore subagent failed (insufficient funds).

## Acceptance criteria
- Plan mode denies edit/bash regardless of selected model.
- Architect output capped: ≤10 files, ≤8 steps, lists files/contract/risks/acceptance.
- Default plan effort documented as medium; strong only on escalation triggers.
- `opencode.json.sample` still valid JSON.

## TDD
Mode: off for template docs (no behavior code). Runner: `node --test` (not invoked for docs-only change). Functional checks: JSON parse + structural readback per task.

## Delivery
Branch first when on default branch; work-unit commits on feature branch. Native review candidate is work-unit commit, never TODO checkbox. RDD per user-owned switch.

## Tasks
- [x] T1 — opencode plan contract stays model-agnostic (sample + comment)
- [x] T2 — architect agents bounded contract (opencode + cursor)
- [x] T3 — docs/ai policy + budget (model-policy, context-budget)
- [x] T4 — verify JSON + readback + commit

## Progress
- Created feature doc before first write.
- Delegated direct attempted (explore + writer); both failed insufficient funds; fallback inline with route evidence recorded.
- T1 verified: opencode.json.sample unchanged, still valid JSON, no model ID hardcoded.
- T2 done: plan-mode contract appended to both architect agents.
- T3 done: plan-mode default (medium) + plan budget rule.

## Verification evidence
- `node JSON.parse opencode.json.sample`: JSON OK.
- Structural readback of 4 edited files done; no tests applicable (template docs only).

## Next step
- Implement T1.
