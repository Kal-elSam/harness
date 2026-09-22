# unified-interactive-workspace Specification

## Purpose

Kairo presents one interactive terminal workspace. Gentle Shell and Pi own the session surface; `kairo` remains the only command the operator needs to invoke.

## Requirements

### Requirement: Default Host Launch

The system MUST open the pinned Gentle Shell workspace when the operator runs `kairo` with no host override. The launch MUST bind the current project and MUST load the first-party Kairo extension. The host MUST be the Gentle Shell launcher with link-mode reuse of the operator's Pi agent home. The system MUST NOT embed the Pi coding-agent SDK in-process as the interactive host.

#### Scenario: Warm default start

- GIVEN a compatible Node.js runtime and pinned Gentle Shell/Pi install
- AND the operator is in a project directory
- WHEN the operator runs `kairo` with no host override
- THEN the interactive workspace prompt is presented in under one second on a warm local start
- AND usage, availability, and project probes MUST NOT block that first prompt

#### Scenario: Host version or runtime mismatch

- GIVEN Gentle Shell, Pi, or Node.js is below the pinned minimum
- WHEN the operator runs `kairo` with no host override
- THEN the system MUST fail closed before presenting the new workspace
- AND the system MUST print the failure
- AND the system MUST offer the legacy cockpit explicitly

### Requirement: Persistent Session Commands

The system MUST provide `kairo start`, `kairo resume`, and `kairo list` against persistent Pi-backed sessions. Ordinary conversation MUST NOT create a new Claude, Codex, Cursor, or OpenCode process for each message.

#### Scenario: Resume preserves workspace state

- GIVEN an existing Pi-backed Kairo session with transcript, task state, context references, and worker history
- WHEN the operator runs `kairo resume` for that session
- THEN the workspace MUST restore transcript, task state, context references, and worker history
- AND the system MUST NOT spawn a provider CLI solely to restore conversation

#### Scenario: List and start isolation

- GIVEN one or more Pi-backed sessions for the current project
- WHEN the operator runs `kairo list`
- THEN every real session for that project MUST be listed
- AND WHEN the operator runs `kairo start`
- THEN a new isolated session MUST be created without resuming an existing one

### Requirement: Non-Destructive Session Migration

The system MUST migrate existing Kairo session storage without modifying or deleting the original files. New host metadata MUST be written separately. During the compatibility window, `kairo resume` MUST detect both legacy and new sessions.

#### Scenario: Legacy session remains intact

- GIVEN a pre-change Kairo session on disk
- WHEN the operator first opens the unified workspace for that project
- THEN the original session files MUST remain unchanged
- AND the session MUST remain resumable through `kairo resume`

#### Scenario: Mixed inventory during transition

- GIVEN both a legacy session and a new Pi-backed session for the same project
- WHEN the operator runs `kairo list`
- THEN both sessions MUST appear
- AND `kairo resume` MUST open the requested session without guessing among ambiguous prefixes

### Requirement: Legacy Cockpit Rollback

The system MUST keep the previous cockpit available behind an explicit `--legacy-cockpit` flag for one minor release. Default interactive invocation MUST NOT use that cockpit after the host cutover ships.

#### Scenario: Explicit legacy host

- GIVEN the compatibility release is still supported
- WHEN the operator runs `kairo --legacy-cockpit`
- THEN the previous cockpit MUST start
- AND existing session, Engram, and provider configuration MUST remain untouched

#### Scenario: New host failure offers rollback

- GIVEN the new host fails its startup or compatibility checks
- WHEN the operator runs default `kairo`
- THEN the system MUST NOT silently continue in the new host
- AND the system MUST offer the legacy cockpit explicitly
