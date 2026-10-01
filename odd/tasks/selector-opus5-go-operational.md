# Selector: Opus/Sonnet 5 missing + Go-limited operational team

## Objective

Reproduce the analyst picker Kairo shows without new probes, restore allowed Claude Opus 5 / Sonnet 5 in that selector, and ensure a suggested project team does not assign principal roles to rate-limited OpenCode Go when a usable Codex fallback exists.

## Problem

1. **Picker**: Allowed `claude-opus-5` / `claude-sonnet-5` disappeared from the curated analyst selector even though entitlement is `allowed` and 4.x supersession alone does not explain the gap.
2. **Suggested team**: Architect / Builder / Orchestrator persisted as `opencode-go/kimi-k3` while Go was `limited:monthly`, with Codex only as `fallback`.

## Why

1. `applyLifecycle` took `max(generation)` per `lineageKey` across **all** adapters. Cursor exposing `claude-*-5-5*` (generation 5.5) marked Claude’s still-current generation 5 as `superseded` → `buildRecommendationPool` dropped them → picker never listed them.
2. Comparative `buildEfficientTeam` correctly kept the ineligible Go leader as `primary` (`available: false`) with Codex as `fallback`. Pre-T28 `buildProjectStrategy` wrote that blocked primary into `projectTeam.model`. T28 operational assignment already promotes the usable fallback; regression locks the Go monthly case.

## Scope

- Fix lifecycle supersession to be **per adapterId + lineageKey** (no cross-adapter retirement).
- Regressions only; do not enable models indiscriminately; do not change benchmarks.
- 429 / probe risk deferred.

## Constraints

- No new provider probes or consumption while diagnosing.
- Within the same adapter, newer generations still supersede older ones (Claude 4.x → 5; Cursor 5 → 5.5).

## Tasks

- [x] T1 — Trace Opus 5 / Sonnet 5 catalog → lifecycle → entitlement → pool → curated picker; confirm drop at cross-adapter lifecycle
- [x] T2 — Confirm Go-limited suggested team cause (blocked comparative primary persisted / operational promotion)
- [x] T3 — RED regression: Cursor 5.5 must not supersede Claude’s allowed Opus/Sonnet 5; GREEN with per-adapter lifecycle
- [x] T4 — RED/lock regression: Go monthly rate-limit → Architect/Builder/Orchestrator operational on Codex

## Acceptance

- Offline reproduction with cached AA + documented Claude + Cursor 5.5 ids shows Claude Opus/Sonnet 5 `current` and in the recommendation pool.
- `buildProjectStrategy` with Go rate-limited and Codex ok assigns operational Architect/Builder/Orchestrator to Codex.
- Targeted tests pass; no benchmark or entitlement map widening.

## Applicable checks

- `node --test test/model-candidate-catalog.test.js test/project-strategy.test.js`
