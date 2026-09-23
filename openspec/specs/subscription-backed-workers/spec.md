# subscription-backed-workers Specification

## Purpose

Delegated execution uses verified native Claude, Codex, Cursor, and OpenCode subscription paths. Pi coordinates the workspace; it MUST NOT force those providers through pay-per-use APIs.

## Requirements

### Requirement: Native Subscription Adapters

Claude, Codex, Cursor, and OpenCode MUST keep native CLI adapters. The system MUST NOT silently fall back to a paid API when a subscription path is unavailable.

#### Scenario: Subscription path used

- GIVEN a role is assigned to a verified subscription-backed adapter
- WHEN the kernel delegates work for that role
- THEN the worker MUST launch through that adapter's native CLI
- AND the system MUST NOT substitute a pay-per-use API

#### Scenario: Subscription path unavailable

- GIVEN the assigned subscription path is missing, unauthenticated, or denied
- WHEN the kernel would otherwise delegate that assignment
- THEN the system MUST NOT silently switch to a paid API
- AND the decision MUST surface that the assignment cannot run automatically

### Requirement: Verified Access Only

Models without verified usable access, including unverified models and models that require unavailable extra credits, MUST NOT appear in automatic recommendations or selection surfaces. They MAY reappear only after evidence confirms usable access.

#### Scenario: Selector hides unverified and denied models

- GIVEN the catalog contains denied, unverified, and allowed models
- WHEN the operator opens a recommendation or manual selection surface
- THEN denied and unverified models MUST NOT appear as candidates
- AND allowed or not-applicable models MAY appear

#### Scenario: Extra credits required

- GIVEN a model requires extra credits that are not available
- WHEN recommendations or selectors are computed
- THEN that model MUST NOT appear as a candidate
- AND it MUST remain hidden until evidence shows credits or access are available

### Requirement: Parallel Delegation From One Workspace

The system MUST be able to delegate one task to at least two different subscription-backed providers from the same workspace. Worker cards for those native CLIs MUST render from normalized Kairo `WorkEvent`s. They MUST NOT be treated as Pi Gentle Agents.

#### Scenario: Two providers in one view

- GIVEN two roles or slices of one task are assigned to different verified subscription adapters
- WHEN the operator delegates that work from the unified workspace
- THEN both workers MAY run in parallel
- AND each worker's progress, files, tests, errors, and results MUST appear in the same terminal view

#### Scenario: Native worker is not a Pi subagent

- GIVEN a Claude, Codex, Cursor, or OpenCode CLI worker is running
- WHEN the workspace presents worker activity
- THEN the presentation MUST be driven by Kairo normalized events
- AND the system MUST NOT claim the worker is a Gentle Agent / Pi subagent

### Requirement: Optional Hermes Worker

Hermes MAY execute work when installed and enabled. Hermes MUST NOT be required for Kairo startup or ordinary operation.

#### Scenario: Hermes absent

- GIVEN Hermes is not installed
- WHEN the operator starts Kairo or delegates to a non-Hermes worker
- THEN startup MUST succeed
- AND only Hermes execution MUST be unavailable

#### Scenario: Hermes enabled

- GIVEN Hermes is installed and enabled
- WHEN the kernel routes a suitable `WorkRequest` to Hermes
- THEN Hermes MUST run under the same worker contract as other workers
- AND its events MUST use the same normalized channel
