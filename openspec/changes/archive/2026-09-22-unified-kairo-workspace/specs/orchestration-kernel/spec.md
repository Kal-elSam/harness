# orchestration-kernel Specification

## Purpose

Project intelligence, availability, ranking, team composition, routing, and execution orchestration live in a headless Kairo kernel. The interactive UI consumes snapshots and events; it MUST NOT execute that logic itself.

## Requirements

### Requirement: Headless Intelligence Surface

The kernel MUST expose project analysis, subscription availability, model catalog ranking, and PROJECT TEAM composition as snapshots independent of any terminal view.

#### Scenario: UI reads a snapshot

- GIVEN the kernel has produced a current project and availability snapshot
- WHEN the workspace requests that snapshot
- THEN the UI MUST receive the snapshot without re-running analysis inside the view
- AND the snapshot MUST be sufficient to render team, catalog, and availability state

#### Scenario: Probe work stays off the prompt path

- GIVEN the interactive workspace has already presented its first prompt
- WHEN usage, availability, or project probes are still running
- THEN those probes MUST complete asynchronously
- AND a probe failure MUST NOT take down the workspace

### Requirement: Routing And Delegation Contracts

The kernel MUST accept a `WorkRequest` and MUST emit a `RouteDecision` before work is handed to a worker. Successful or failed work MUST produce normalized `WorkEvent` records and a terminal `WorkResult` or `ExecutionReceipt`.

#### Scenario: Routable automatic assignment

- GIVEN an active PROJECT TEAM with a verified automatic assignment for the requested role
- WHEN the kernel receives a `WorkRequest` for that role
- THEN it MUST emit a `RouteDecision` that names the assigned worker
- AND subsequent `WorkEvent`s MUST belong to that decision

#### Scenario: Missing or inactive strategy

- GIVEN no active PROJECT TEAM strategy exists
- WHEN the kernel receives a `WorkRequest`
- THEN it MUST NOT invent an assignment
- AND it MUST emit a decision that work cannot be delegated automatically until a strategy is approved

### Requirement: Event Normalization

Every worker execution MUST stream progress, tool activity, tests, file changes, errors, and completion through one normalized event channel. The UI MUST render from those events rather than from provider-specific logs.

#### Scenario: Live worker activity

- GIVEN a delegated task is running
- WHEN the worker emits progress, a tool call, a test result, a file change, or a failure
- THEN a normalized `WorkEvent` MUST appear on the shared channel
- AND the workspace MUST be able to present that event in the same terminal view

#### Scenario: Unknown provider payload

- GIVEN a worker emits a line that is not a known structured event
- WHEN the kernel normalizes the stream
- THEN it MUST NOT fabricate tool, test, or diff events
- AND it MAY attach the raw line as an opaque event without claiming structure
