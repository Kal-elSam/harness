# Tasks: Unified Kairo Workspace

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1400 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 host cutover → PR 2 sessions → PR 3 kernel → PR 4 workers → PR 5 context/bridges (each merges to main in order) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pin runtime, spawn `gentle-shell --link`, switch implicit `kairo`, `--legacy-cockpit` | PR 1 (base = main) | `node --test test/host-launch.test.js test/cli-implicit-host.test.js` | `kairo --help` / dry launch with fake spawn; N/A for real Gentle Shell if binary absent | `src/cli.js`, `src/global/host/`, `package.json` engines |
| 2 | `start`/`resume`/`list` bind Pi-backed sessions without copying transcripts | PR 2 (base = main after PR 1) | `node --test test/session-cli.test.js test/session-registry.test.js` | Fake host spawn + existing session fixtures | `src/global/conversation/session-cli.js` |
| 3 | Headless kernel snapshots and routing contracts | PR 3 (base = main after PR 2) | `node --test test/kernel-contracts.test.js test/project-router.test.js` | N/A — unit/integration against existing strategy fixtures | `src/global/kernel/` |
| 4 | Native workers emit `WorkEvent`s; extension cards; no per-message CLI spawn | PR 4 (base = main after PR 3) | `node --test test/worker-events.test.js test/execution-adapters.test.js` | N/A unless a provider CLI is present | `src/global/host/extension/`, kernel event path |
| 5 | `ContextBundle` owners + degraded Engram/MCP/CodeGraph/Hermes/Gentle AI | PR 5 (base = main after PR 4) | `node --test test/context-bundle.test.js test/ecosystem-degrade.test.js` | N/A — missing binaries simulated | `src/global/kernel/` context + integrations wiring |

## Phase 1: Foundation

- [x] 1.1 Write failing tests in `test/host-launch.test.js`: missing `cwd` fails closed; `cwd` containing shell metacharacters still results in `spawn(file, argv, { shell: false })`; unresolvable `gentle-shell` fails closed and names `--legacy-cockpit`.
- [x] 1.2 Write failing tests in `test/cli-implicit-host.test.js`: bare `kairo` (no args) resolves to the unified host, not `shell`; `--legacy-cockpit` still reaches `runCockpitCli`.
- [x] 1.3 Create `src/global/kernel/contracts.js` with `ContextBundle`, `WorkRequest`, `RouteDecision`, `WorkEvent`, `WorkResult`, and `ExecutionReceipt` object factories/validators (no UI imports).
- [x] 1.4 Set `package.json` `engines.node` to `>=22.19.0` and record the pinned Gentle Shell/Pi minimums used by the version gate (PATH install + gate if the license question is unresolved; do not vendor `gentle-pi` until license is confirmed).

## Phase 2: Host Cutover (PR 1)

- [x] 2.1 Implement `src/global/host/launch-gentle-shell.js` to resolve an absolute `gentle-shell` binary, require Pi >=0.85.1, compose `['--link', '-e', <absolute-extension-dir>, '--', ...]` and spawn with `shell: false`.
- [x] 2.2 Change `resolveImplicitCommand` in `src/cli.js` so a bare interactive `kairo` launches the unified host; keep `kairo shell` as the Ink orchestrator for the compatibility window.
- [x] 2.3 Parse `--legacy-cockpit` in `src/cli.js` and route that flag to `runCockpitCli` in `src/global/cockpit/cli.js`.
- [x] 2.4 Make 1.1 and 1.2 pass without starting a real Gentle Shell (inject spawn/version deps).

## Phase 3: Sessions (PR 2)

- [x] 3.1 Write failing tests that `runKairoStart` / `runKairoResume` in `src/global/conversation/session-cli.js` call the host launcher with a session binding and do not write a second transcript authority.
- [x] 3.2 Write a failing test that an invalid session id still throws in `sessionDirFor` (`src/global/conversation/session-registry.js`) and is never passed to spawn.
- [x] 3.3 Point `runKairoStart` and `runKairoResume` at `launch-gentle-shell.js` instead of `runCockpitCli`, keeping `kairo list` on `listSessions`.
- [x] 3.4 Add copy-on-read migration that leaves `~/.harness/sessions/**` original files unchanged and writes new host metadata separately; cover with `test/session-registry.test.js`.

## Phase 4: Kernel (PR 3)

- [x] 4.1 Write failing tests in `test/kernel-contracts.test.js` for snapshot-without-UI, `WAIT_FOR_PROJECT_TEAM` when no active strategy, and opaque (non-fabricated) events for unknown worker lines.
- [x] 4.2 Create `src/global/kernel/service.js` that reads existing `project-strategy` / `project-router` / catalogs and returns snapshots; MUST NOT import `src/global/ink/` or `src/global/cockpit/`.
- [x] 4.3 Wire the Kairo extension stub in `src/global/host/extension/` to request snapshots over the direct API (in-process function call), not MCP.

## Phase 5: Workers (PR 4)

- [x] 5.1 Write failing tests: ordinary conversation does not spawn Claude/Codex/Cursor/OpenCode; two routed `WorkRequest`s may run in parallel; denied/unverified models stay absent from selectors (reuse `BLOCKED_ENTITLEMENTS` behavior).
- [x] 5.2 Map execution-adapter output to `WorkEvent` in the kernel; render cards only from those events in `src/global/host/extension/` (native CLIs are not Gentle Agents).
- [x] 5.3 Keep Hermes behind capability detection: missing Hermes does not fail host launch (`test/ecosystem-degrade.test.js` can start here).

## Phase 6: Context and Bridges (PR 5)

- [x] 6.1 Write failing tests in `test/context-bundle.test.js`: each bundle item names owner `pi`/`engram`/`codegraph`/`gentle-ai`/`kairo`; missing Engram omits memory rather than inventing it.
- [x] 6.2 Implement `ContextBundle` assembly in `src/global/kernel/` with explicit budgets; do not copy Pi transcripts or Gentle AI workflow ledgers.
- [x] 6.3 Write failing tests in `test/ecosystem-degrade.test.js`: absent Engram, CodeGraph, MCP, Gentle AI, or Hermes disables only that capability; Kairo MUST NOT invent ODD/SDD/review transitions.

## Phase 7: Verification

- [x] 7.1 Run `npm test` and fix failures caused by the host/session/kernel slices in scope.
- [x] 7.2 Add a skipped-if-missing harness that, when `gentle-shell` is on PATH, asserts version-gate success and that launch argv includes `--link` and `-e`.

## Verification recovery

- [x] Reopened after premature archive because no verification report existed.
- [x] Final full suite outside the restricted sandbox: 2049 pass, 0 fail, 1 skip.
- [x] Installed `gentle-pi@3.5.1` and Pi `0.85.1` only under `/tmp`; the live host harness passed 5/5 with no skip.
- [x] Unified bare `conversation` and `ui` with the host while preserving explicit scripted conversation actions and `--legacy-cockpit`.
- [x] Added `verify-report.md`; `sdd-verify` remains unavailable and is not claimed as executed.
