# Proposal: Unified Kairo Workspace

## Intent

Kairo currently duplicates responsibilities already provided by Pi and Gentle Shell—interactive sessions, terminal UI, conversation state, subagent presentation, and workflow controls—while launching provider CLIs as isolated processes.

This produces slow interactions, fragmented context, duplicated state, and an experience that is less practical than opening several independent terminals.

This change will turn Kairo into a single composition root:

- Gentle Shell provides the interactive terminal workspace.
- Pi owns persistent sessions, context, compaction, extensions, and agent presentation.
- Kairo owns project analysis, subscription intelligence, model routing, team composition, and cross-provider delegation.
- Gentle AI remains the methodology and governance authority.
- Engram provides durable cross-session memory.
- MCP and skills expose shared tools and capabilities.
- Hermes becomes an optional execution worker.

The user continues to interact through one command: `kairo`.

## Scope

### In Scope

- Replace Kairo’s custom cockpit as the default interactive host with a pinned Gentle Shell/Pi runtime.
- Introduce a headless Kairo kernel for project intelligence, routing, availability, and orchestration.
- Maintain persistent Kairo sessions instead of spawning a fresh provider process for ordinary conversation.
- Normalize Claude, Codex, Cursor, OpenCode, Pi, and optional Hermes execution behind a common worker contract.
- Preserve native provider CLI adapters so existing subscriptions remain usable.
- Unify active context, Engram memory, CodeGraph evidence, skills, MCP tools, and Gentle AI workflow state in one workspace.
- Stream normalized worker activity, results, usage, tests, and file changes into Gentle Shell.
- Migrate existing Kairo sessions and retain the legacy cockpit temporarily as a rollback path.

### Out of Scope

- Merging Gentle Shell, Pi, Gentle AI, Engram, or Hermes into the Kairo repository.
- Reimplementing Gentle Shell’s TUI, Pi’s session engine, Engram memory, or Gentle AI workflows.
- Replacing subscription-backed provider CLIs with mandatory pay-per-use APIs.
- Making Hermes a required dependency or the primary coordinator.
- Integrating the OpenAI Agents API.
- Embedding `@earendil-works/pi-coding-agent` as an in-process SDK for the host (v1 launches `gentle-shell --link` plus a Kairo extension).
- Removing the legacy cockpit before the new workspace has completed a compatibility release.

## Capabilities

> Contract for the spec phase. Each new capability gets `openspec/changes/unified-kairo-workspace/specs/<name>/spec.md`.

### New Capabilities

- `unified-interactive-workspace`: Start and operate Kairo through a persistent Gentle Shell/Pi workspace with one terminal and one session model.
- `orchestration-kernel`: Provide headless project analysis, model selection, routing, delegation, and normalized execution events.
- `subscription-backed-workers`: Execute work through verified Claude, Codex, Cursor, and OpenCode subscription paths without silently falling back to paid APIs.
- `unified-context`: Assemble bounded context from the active Pi session, Engram, CodeGraph, project state, skills, and Gentle AI workflow evidence.
- `ecosystem-bridges`: Expose MCP tools, skills, memory, governance, and optional Hermes execution through one compositional runtime.

### Modified Capabilities

None. No existing OpenSpec capability specifications are present; current behavior will be captured as new capabilities.

## Approach

Implementation stays incremental even though the capabilities describe the full workspace:

1. Package compatible, pinned Gentle Shell and Pi versions and raise Kairo’s runtime requirement to Node.js >=22.19.
2. Make `kairo` launch `gentle-shell --link` with a first-party Kairo extension and project binding. Do not embed the Pi SDK in-process for the host slice.
3. Extract the current project-analysis, availability, ranking, and routing logic into a UI-independent kernel.
4. Define common runtime contracts: `ContextBundle`, `WorkRequest`, `RouteDecision`, `WorkerCapability`, `WorkEvent`, `WorkResult`, `ExecutionReceipt`.
5. Keep provider-specific authentication, quota detection, launch behavior, and limit invalidation inside native worker adapters.
6. Use direct in-process APIs between the Gentle Shell extension and the Kairo kernel; reserve MCP for external tools and clients.
7. Assign one source of truth per concern:
   - Pi: active session and context compaction.
   - Engram: durable memory.
   - Gentle AI: ODD, SDD, review, and workflow authority.
   - Kairo: project and subscription intelligence.
   - CodeGraph: repository structure.
   - Provider adapters: execution and availability.
8. Stream every worker through one normalized event channel rendered as Gentle Shell cards. Native Claude/Codex/Cursor/OpenCode workers are Kairo extension cards; they are not Gentle Agents (Pi subagents).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `bin/kairo.js` | Modified | Keep the `kairo` bin; default interactive path opens the unified host. |
| `src/cli.js` | Modified | Default interactive command launches pinned Gentle Shell with the Kairo extension; `--legacy-cockpit` keeps the previous host. |
| `src/global/cockpit/` | Deprecated | Current conversation cockpit remains as compatibility and rollback. |
| `src/global/ink/` | Deprecated | Current Ink dashboard remains as compatibility and rollback. |
| `src/global/conversation/` | Modified | Session start/resume/list map onto Pi-backed sessions; stop duplicating transcripts. |
| `src/global/runtime/` | Modified | Headless kernel, worker contracts, event normalization, and provider adapters. |
| `src/global/integrations/` | Modified | Connect Engram, Gentle AI, skills, CodeGraph, and optional Hermes through explicit ownership boundaries. |
| `package.json` | Modified | Pin host dependencies and require Node.js >=22.19. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Gentle Shell/Pi public contracts drift from the pinned versions | High | Pin exact versions (`gentle-pi@3.5.1`, Pi >=0.85.1); fail closed on version gate. |
| Existing sessions cannot be resumed | Medium | Non-destructive migration; keep original session files; write new host metadata separately. |
| Context is duplicated or grows without bounds | High | One owner per context source, token budgets, references, and compaction. |
| Native subscription workers have no Gentle Shell card surface | High | Kairo extension renders worker cards from normalized `WorkEvent`s; do not pretend Gentle Agents cover CLI workers. |
| The new host hides Kairo’s differentiated value | Medium | Keep project analysis, routing, team composition, and execution evidence as first-party Kairo capabilities. |
| Optional integrations block startup | Medium | Load them asynchronously; degrade only the missing capability. |

## Rollback Plan

- Preserve the existing cockpit behind `--legacy-cockpit` for one minor release.
- Keep existing session files unchanged during migration; write new host metadata separately.
- Allow `kairo resume` to detect and open both legacy and new sessions during the transition.
- If the new host fails its startup or compatibility checks, print the failure and offer the legacy cockpit explicitly.
- Reverting the host entrypoint and dependency changes restores the previous runtime without deleting user sessions, Engram memory, or provider configuration.

## Dependencies

- Node.js >=22.19.
- Compatible pinned versions of Gentle Shell (`gentle-pi`) and Pi (`@earendil-works/pi-coding-agent`).
- Public Gentle AI workflow and review contracts.
- Existing native Claude, Codex, Cursor, and OpenCode CLIs.
- Engram and CodeGraph as optional managed integrations.
- Hermes local API only when Hermes execution is enabled.
- Confirmation that Gentle Shell’s package license and public extension contracts permit redistribution in Kairo’s installation model.

## Success Criteria

- [ ] Running `kairo` opens the interactive workspace in under one second on a warm local start.
- [ ] Usage, availability, and project probes run asynchronously and never block the initial prompt.
- [ ] Ordinary conversation does not spawn a new Claude, Codex, Cursor, or OpenCode process for every message.
- [ ] `kairo start`, `kairo resume`, and `kairo list` operate on persistent Pi-backed sessions.
- [ ] A session can be resumed with its transcript, task state, context references, and worker history intact.
- [ ] Kairo can delegate one task to at least two different subscription-backed providers from the same workspace.
- [ ] Worker progress, tool calls, tests, file changes, results, and failures appear in the same terminal view.
- [ ] Models without verified usable access never appear in automatic recommendations or selection surfaces.
- [ ] Engram, MCP, CodeGraph, Gentle AI, or Hermes being unavailable disables only the affected capability.
- [ ] Hermes can execute work when enabled but is not required for Kairo startup or normal operation.
- [ ] Gentle AI remains the sole authority for ODD, SDD, review, and workflow transitions.
- [ ] Existing Kairo sessions migrate without modifying or deleting their original storage.
- [ ] The complete test suite covers host startup, session migration, routing, context ownership, worker events, degraded integrations, and legacy rollback.
