# Codex delegated write — CLI compatibility + OS wrapper evaluation

## Objective

Fix ordinary Codex execution flags for the **installed** CLI (compatibility),
keep that fix separate from any isolation / `verified_effective` claim, and
prepare a **valid** OS-sandbox canary path: isolated provider/temp roots, OS
availability gate, explicit allow/deny paths — without running a live canary
until specifically authorized.

## Problem

Installed Codex CLI rejects `--sandbox` + `--approve-for-me`. Separately, a
valid containment test must not write personal `~/.codex`, must fail closed
without `sandbox-exec`, and must not invent a canary pass.

## Scope

- Track A: ordinary CLI flag compatibility (`--approve-for-me` only)
- Track B: adapted OS wrap + valid-test prep (isolated roots, availability gate, canary plan)

## Non-goals

- Promoting `verified_effective` without an authorized live canary
- Running a real canary without `authorizeRealCanary: true`
- Wiring Track B into ordinary `startRun` this increment
- Kernel edits / native RDD start

## Acceptance criteria

- [x] Ordinary launch: `--approve-for-me` only
- [x] Allowlist: workspace + isolated providerHome + isolated tempRoot; personal `~/.codex` write rejected
- [x] OS sandbox unavailable → wrap/launch refused
- [x] Canary plan exposes explicit allowed/forbidden paths; real run needs authorization
- [x] Admission still `source_declared` / `verifiedEffective: false`

## TDD

- Runner: `node --test test/codex-execution-adapter.test.js test/delegated-execution-containment.test.js test/codex-delegated-write-os-wrap.test.js test/delegated-write-admission.test.js`

## Tasks

- [x] CW-1..CW-4 Track A + initial Track B helpers
- [x] CW-5 Isolated provider/temp allowlist; forbid personal config writes
- [x] CW-6 OS availability gate before launch (fail closed)
- [x] CW-7 Canary plan with explicit paths; real run authorization required (no live run)

## Progress

- 2026-10-05: Track A + initial Track B landed (`197c671e6`).
- 2026-10-05: Valid-test prep — isolated roots, availability gate, canary plan (no live canary).

## Next step

Only after explicit authorization: implement + run real canary under the prepared
plan, then consider `verified_effective` promotion.
