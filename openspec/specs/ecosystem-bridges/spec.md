# ecosystem-bridges Specification

## Purpose

Shared tools and capabilities enter the workspace through explicit bridges. MCP is the external interoperability boundary. Internal Kairo-to-host communication is a direct API. Gentle AI remains the sole methodology authority.

## Requirements

### Requirement: Internal Direct API, External MCP

Communication between the Kairo kernel and the Gentle Shell host MUST use a direct API. MCP MUST be reserved for external tools and clients. External MCP servers MAY appear as tools in the same workspace.

#### Scenario: Kernel to host without MCP

- GIVEN the Kairo extension is loaded in Gentle Shell
- WHEN the host needs a kernel snapshot or wants to submit a `WorkRequest`
- THEN that exchange MUST use the direct API
- AND it MUST NOT require an MCP round-trip for that internal path

#### Scenario: External MCP tool

- GIVEN an external MCP server such as Engram or CodeGraph is configured
- WHEN the operator works in the unified workspace
- THEN that server's tools MAY appear in the same workspace
- AND absence of that server MUST disable only those tools

### Requirement: Single Skill Copy

The system MUST administer skill installation, compatibility, and availability. It MUST NOT copy multiple versions of the same skill into the workspace. Skills MUST load through the host resource mechanism.

#### Scenario: Skill already provided by the host

- GIVEN a skill is already loaded through Gentle Shell/Pi resources
- WHEN Kairo starts the workspace
- THEN Kairo MUST NOT install a second copy of that skill
- AND the loaded skill MUST remain the one the host resolved

#### Scenario: Skill missing

- GIVEN a Kairo-managed skill is not installed
- WHEN the workspace starts
- THEN startup MUST succeed
- AND only that skill's capability MUST be unavailable

### Requirement: Degraded Optional Integrations

Engram, MCP, CodeGraph, Gentle AI, or Hermes being unavailable MUST disable only the affected capability. The workspace MUST still start.

#### Scenario: Workspace starts without optional pieces

- GIVEN Engram, CodeGraph, and Hermes are absent
- WHEN the operator runs `kairo`
- THEN the interactive workspace MUST start
- AND memory, graph, and Hermes execution MUST be unavailable
- AND conversation and kernel routing that do not depend on them MUST remain available

#### Scenario: Gentle AI unavailable

- GIVEN Gentle AI is not available
- WHEN the operator runs the workspace
- THEN ODD, SDD, review, and workflow transitions MUST NOT be invented by Kairo
- AND Kairo MUST NOT present itself as the methodology authority

### Requirement: Gentle AI Governance Authority

Gentle AI MUST remain the sole authority for ODD, SDD, review, and workflow transitions. Kairo MUST NOT replace those transitions with a parallel workflow engine.

#### Scenario: Workflow state is Gentle AI's

- GIVEN Gentle AI reports an active workflow or review transition
- WHEN the workspace displays methodology state
- THEN that state MUST come from Gentle AI
- AND Kairo MUST NOT override the transition

#### Scenario: No parallel methodology store

- GIVEN the operator is in the unified workspace
- WHEN work is classified as ODD or SDD
- THEN classification and gates MUST follow Gentle AI
- AND Kairo MUST NOT persist a competing workflow ledger
