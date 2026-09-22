# Design: Unified Kairo Workspace

## Technical Approach

Kairo stays a composition root. It does not become a fork of Pi or Gentle Shell.

Bare `kairo` today resolves to `shell` (`src/cli.js` `resolveImplicitCommand`) and opens the Ink orchestrator. `kairo start` / `resume` open the conversation cockpit (`src/global/conversation/session-cli.js` → `runCockpitCli`). Both are parallel hosts. This change replaces the default interactive path with a pinned `gentle-shell --link` process plus a first-party Kairo extension. The kernel (analysis, catalog, routing, workers) is extracted behind snapshots and events so the host never owns that logic.

Specs covered: `unified-interactive-workspace`, `orchestration-kernel`, `subscription-backed-workers`, `unified-context`, `ecosystem-bridges`.

Implementation is still sliced. The first shippable slice is host cutover and rollback. Kernel contracts, native worker cards, and ecosystem bridges follow without changing the host process model.

## Architecture Decisions

### Decision: Spawn Gentle Shell; do not embed the Pi SDK

**Choice**: `kairo` execs the Gentle Shell launcher (`gentle-shell --link`) with the Kairo extension injected (`-e`). The interactive session lives in that child process.
**Alternatives considered**: In-process `createAgentSession` from `@earendil-works/pi-coding-agent`; wrapping only `pi-tui` (current cockpit).
**Rationale**: Gentle Shell already owns workspace UI, sessions, compaction, and cards. Embedding the SDK would rebuild that surface. `pi-tui` is a widget library, not a session host. Confirmed product decision for v1.

### Decision: Link-mode home

**Choice**: Always pass `--link` so the child reuses `PI_CODING_AGENT_DIR` or `~/.pi/agent`.
**Alternatives considered**: Isolated `~/.gentle-shell/agent` (default launcher home).
**Rationale**: Operators already have Pi logins, models, and chats. Isolated home would force a second `/login` and split session inventory.

### Decision: Implicit `kairo` becomes the unified host

**Choice**: Change `resolveImplicitCommand` so a bare `kairo` launches the Gentle Shell host, not `shell`. `kairo start` / `resume` / `list` keep their session semantics but open the new host instead of `runCockpitCli`.
**Alternatives considered**: Keep implicit `shell` and only switch `kairo start`.
**Rationale**: Success criterion is “running `kairo` opens the interactive workspace”. Today that command is the Ink dashboard, which is the slow parallel cockpit the change exists to remove.

### Decision: Direct API between extension and kernel; MCP stays external

**Choice**: The Kairo extension talks to a local kernel module (same Node process as the extension, or a localhost RPC owned by Kairo). MCP is not used for that path.
**Alternatives considered**: Expose the kernel only as an MCP server.
**Rationale**: Spec forbids an MCP round-trip for internal snapshot/`WorkRequest` traffic. Existing `kairo mcp` remains a client-facing bridge.

### Decision: Native CLIs remain workers; Pi is not the subscription runtime

**Choice**: Claude, Codex, Cursor, and OpenCode keep `src/global/runtime/execution-adapters/*`. Ordinary chat does not spawn them. Delegation emits `WorkRequest` → adapter spawn → normalized `WorkEvent`s rendered by the Kairo extension.
**Alternatives considered**: Drive those models through Pi providers (OAuth/API keys).
**Rationale**: Pi provider auth is pay-per-use or Pi-managed OAuth. The product requirement is to keep real subscriptions and never silently fall back to paid APIs.

### Decision: Legacy hosts behind explicit flags, not silent fallback

**Choice**: `--legacy-cockpit` starts the current conversation cockpit. `kairo shell` keeps the Ink orchestrator for one minor release. Host version/runtime failure prints the error and offers those flags; it does not auto-switch.
**Alternatives considered**: Automatic fallback to the cockpit on any Gentle Shell error.
**Rationale**: Silent fallback hides the new host and makes startup probes look “fixed”. Spec requires an explicit offer.

## Data Flow

```
operator
  │  kairo | kairo start | kairo resume
  ▼
src/cli.js
  │  version gate (Node >=22.19, pinned pi/gentle-shell)
  ▼
host launcher ──spawn──► gentle-shell --link -e <kairo-extension> -- cwd
                              │
                              ▼
                         Pi session (transcript, compaction, start/resume/list)
                              │
                    Kairo extension (direct API)
                              │
                              ▼
                    orchestration kernel
                              │
              ┌──────── snapshots/events ────────┐
              ▼                                   ▼
     ContextBundle (owners)              WorkRequest
              │                                   │
              ▼                                   ▼
     Pi | Engram | CodeGraph |          RouteDecision
     Gentle AI | Kairo intel                    │
                                                ▼
                                    execution adapter (native CLI)
                                                │
                                                ▼
                                         WorkEvent stream
                                                │
                                                ▼
                                    extension worker cards
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/global/host/launch-gentle-shell.js` | Create | Resolve pinned `gentle-shell` / `GENTLE_SHELL_PI`, version gate, argv (`--link`, `-e`, cwd). Spawn without `shell: true`. |
| `src/global/host/extension/` | Create | First-party Pi extension: kernel snapshots, `WorkRequest` submission, worker cards from `WorkEvent`s. |
| `src/global/kernel/contracts.js` | Create | `ContextBundle`, `WorkRequest`, `RouteDecision`, `WorkEvent`, `WorkResult`, `ExecutionReceipt` shapes. |
| `src/global/kernel/service.js` | Create | Headless facade over existing `project-strategy`, `project-router`, catalogs, entitlement. No Ink/cockpit imports. |
| `src/cli.js` | Modify | Implicit command → unified host; parse `--legacy-cockpit`; fail closed on version gate. |
| `src/global/conversation/session-cli.js` | Modify | `start`/`resume` launch the host with a session binding instead of `runCockpitCli`. |
| `src/global/cockpit/cli.js` | Modify | Reachable only via `--legacy-cockpit`. |
| `package.json` | Modify | `engines.node` `>=22.19.0`; pin `gentle-pi` and `@earendil-works/pi-coding-agent` (or document PATH + version gate). |
| `test/host-launch.test.js` | Create | Version gate, argv composition, no `shell: true`, legacy flag. |
| `test/kernel-contracts.test.js` | Create | Routing/snapshot/event normalization without UI. |
| `test/session-cli.test.js` | Modify | Host launch wiring; cockpit only on legacy flag. |

Cockpit and Ink modules are not deleted in this change.

## Interfaces / Contracts

Shapes are plain objects, matching existing ESM modules (no TypeScript).

```javascript
/** @typedef {{ sources: Array<{ owner: "pi"|"engram"|"codegraph"|"gentle-ai"|"kairo", refs: unknown[] }>, budgetTokens: number }} ContextBundle */

/** @typedef {{ role: string, task: string, projectRoot: string, sessionId: string }} WorkRequest */

/** @typedef {{ decision: "ROUTED"|"MANUAL_HANDOFF"|"WAIT_FOR_PROJECT_TEAM", role: string, provider: string|null, why: string }} RouteDecision */

/** @typedef {{ type: string, workerId: string, payload: unknown, at: string }} WorkEvent */
```

Host launch argv (observable):

```text
gentle-shell --link -e <kairo-extension-dir> -- --cwd <projectRoot>
```

`--` forwards Pi args. Session resume passes the Pi session identity the host already understands; Kairo does not copy `transcript.json` into Pi.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Implicit command, version gate, argv (`--link`, `-e`, no shell), `WorkRequest` routing, entitlement hiding, ContextBundle owners, degraded optional sources | `node --test` with injected deps (existing `deps = {}` pattern) |
| Integration | `start`/`resume`/`list` bind sessions without writing a second transcript; legacy flag reaches `runCockpitCli`; missing Hermes/Engram does not fail launch | Existing session-registry fixtures; fake spawn |
| E2E | Warm-start timing is measured in a dedicated test only when a real host binary is present; otherwise skip | Guard with `gentle-shell` availability; never fake a 1s pass |

RED tests for applicable threat-matrix rows are listed below and must be written before production spawn/routing changes.

## Threat Matrix

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | `requirements.txt`, `CMakeLists.txt`, executable Markdown/MDX, `README.sh` | N/A: this change does not classify files as executable | — | — |
| Git repository selection | `git -C`, relative paths, absolute paths | Applicable: host and workers inherit `projectRoot` from `options.cwd` / `resolveProjectRoot` | Refuse to spawn when `cwd` is missing or not a directory; never pass operator strings into `shell: true`; session ids keep the existing UUID allowlist in `session-registry.js` | Given a missing cwd, launch fails closed; given `cwd` with metacharacters, spawn still uses argv array; given `../../` session id, path build still throws |
| Commit state | staged, `commit -a`, empty index | N/A: no commit automation in this change | — | — |
| Push state | tracking branch, first push, explicit refspec | N/A: no push automation in this change | — | — |
| PR commands | explicit `--head`, environment prefix, composed commands | N/A: delivery strategy is recorded in SDD preflight only; this change does not invoke `gh` | — | — |

Subprocess rule (not a matrix row, still required): every `gentle-shell` and provider CLI launch uses `spawn(command, args, { shell: false })`. `GENTLE_SHELL_PI` and the extension path MUST be absolute. Unresolvable binaries fail closed with an explicit legacy-host offer.

## Migration / Rollout

1. Ship host cutover with `--legacy-cockpit` and unchanged `kairo shell`.
2. Copy-on-read legacy sessions into a Pi-backed session metadata file; never move or delete `~/.harness/sessions/**`.
3. Kernel extraction can land behind the same release once snapshots render in the extension; worker cards can lag one slice.
4. Remove Ink/cockpit default only after the compatibility minor release.

No Engram schema migration. No deletion of provider auth files.

## Open Questions

- [ ] Confirm Gentle Shell license and extension contracts allow shipping/pinning `gentle-pi` inside Kairo’s npm package versus requiring a PATH install plus version gate.
- [ ] Whether `kairo conversation` / `kairo ui` stay as non-default surfaces or also route to the new host during the compatibility window.
