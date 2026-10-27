# Quota-aware model selection without taking over Gentle launches

Status: local proposal, 2026-10-27. Not an implemented or upstream-approved API.
Scope: Gentle Shell host integration for Kairo. No publication, external repository changes, or configuration writes are authorized by this document.

## Recommendation

Add a host-owned selection hook before dispatch. Gentle Shell resolves the effective user assignment; Kairo recommends a model using quota and existing selection policy; the host validates and admits the choice. Gentle AI remains responsible for review contracts, consent, immutable evidence, and all provider-issued transitions.

This needs upstream support. Injecting an undocumented `model` field into `subagent_run`, changing capture tokens, or temporarily rewriting configuration is not an integration.

## Verified baseline

Evidence is from the locally installed `gentle-pi` package, not a claim about upstream HEAD. Paths below are relative to that package root.

| Surface | Current behavior | Evidence |
| --- | --- | --- |
| Ordinary named agents | `subagent_run` exposes no model/provider argument. Model resolution happens in the host. | `extensions/gentle-agents.ts:1689-1777,2163-2177` |
| RDD reviewer selection | Selection is user-owned; missing configuration fails closed. No fallback to another provider or ambient model. | `docs/review-integration.md:24-34` |
| RDD routing precedence | Session profile binding, then repository pin, then global model configuration. | `extensions/gentle-ai.ts:2469-2471` |
| Kairo actor protection | Review lenses, refuter, JD judges and JD fix return `NOT_ROUTED`. `review-validator` is absent from that list, not proven integrated. | Repository: `src/global/intelligence/role-catalog.js:27-32`, `src/global/team/routing-input-cache.js:104-127` |
| Installed native capability surface | Gentle AI 4.2.0, protocol 2.6 does not advertise an external model-selection hook. | Read-only `gentle-ai review capabilities --contract gentle-ai.review-integration/v2` inspection |

## Selection rules

1. Resolve the effective assignment in the host, including its provenance and revision. Do not infer it from sparse `models.json` or reproduce host precedence in Kairo.
2. Keep an explicitly assigned model while its provider has sufficient quota and the model remains executable. A manual choice need not be re-ranked against automatic bands or diversity caps.
3. For `inherit` or a persisted Pi default without an explicit agent assignment, Kairo ranks eligible models using existing role bands, cap, fairness and quota policy. Do not introduce a second ranking algorithm here.
4. On confirmed quota exhaustion, advance through the eligible alternatives and notify the user before each admitted change. Do not replace an explicit model merely because another scores better.
5. If every eligible provider is confirmed exhausted, wait until the earliest verified relevant reset, display its time and timezone, then recheck availability. Waiting must be cancellable and must not hold a launch reservation.
6. Unknown quota is not exhaustion, and unknown reset time must not become a fabricated countdown. Report unavailable evidence and pause the dependent selection. Authentication, configuration and malformed-result failures are not quota failures.
7. Keep every substitution invocation-scoped. Kairo never writes `models.json`, profile pins, session bindings or agent definitions. Future invocations resolve the original user assignment again.

## Proposed host contract

The following fields describe semantics, not an existing schema, command or registered capability. Upstream owns final naming, versioning and transport.

| Exchange | Minimum information |
| --- | --- |
| Host selection request | Opaque request identity; exact agent identity; resolved Kairo role; effective assignment, source and explicit/inherited status; model and thinking configuration; eligible authenticated model references; host-owned policy constraints; routing revision. No credentials. |
| Kairo recommendation | Keep, select, wait or unavailable; selected model reference if any; bounded reason; quota observation freshness; verified reset if known; ordered eligible alternatives when applicable. |
| Host admission | Accepted selection bound to request and routing revision, or a typed refusal. Reject stale requests, unknown actors/models, unavailable providers and policy violations before dispatch. |
| User visibility | Effective model, assignment source, why it changed, and verified wait/reset time. Preserve original assignment in the explanation. |

The host must retain provenance distinguishing an explicit assignment from a value materialized from a default. If that distinction is unavailable, return an unresolved selection instead of silently overriding the user.

Thinking/effort must be validated against the selected model. Preserve compatible user settings; do not silently translate unsupported settings. The host owns any documented translation or refusal.

## Two dispatch paths

### Ordinary and Judgment Day agents

Invoke the hook after effective assignment resolution and before launch admission. Consume an accepted choice internally; do not require the parent agent to invent extra `subagent_run` fields.

Proposed role mapping:

| Gentle agent | Kairo role |
| --- | --- |
| `gentle-ai-explore` | Explorer |
| `gentle-ai-worker` | Builder |
| `gentle-ai-verify` | Verifier |
| `jd-fix-agent` | Builder, with existing Judgment Day correction constraints |
| `jd-judge-a`, `jd-judge-b` | Reviewer, with host-supplied independence constraints |

Only model selection changes. Agent identity, task, working directory, Judgment Day activation, frozen findings and correction boundaries stay unchanged. Kairo must not rename an actor to evade ownership protection.

### RDD lenses, refuter and validator

RDD requires a separately advertised, provider-admitted extension of its current no-fallback contract. A generic Pi hook is insufficient.

The native provider must define the selection point and bind the admitted choice to the exact target, actor and review attempt before completion. Candidate/group configuration must be read as a consistent snapshot; shared quota admission must prevent concurrent slots from assuming the same remaining capacity is free. These are proposed safeguards, not assertions about current model-freeze timing.

Use Security Reviewer for `review-risk`; Reviewer for the other lenses and refuter. The exact Kairo role for `review-validator` remains to be agreed upstream; until then, do not assign a generic reviewer silently. All roles retain their native prompts and admission rules.

Provider-issued operation names, argument order, opaque tokens and submission descriptors remain unchanged. If new selection metadata is required, the provider must issue it through a negotiated contract rather than adapters appending flags.

Before a role starts, confirmed exhaustion may request another admitted selection under that future contract. After a completion starts, failure must return to the native provider. Only an explicit provider-owned continuation can authorize retry or reselection; Kairo cannot replay a completion, reuse evidence from another attempt, create a new lineage, bypass a typed refusal, or synthesize a verdict.

## Compatibility and tradeoff

Without the negotiated capability, retain current host behavior and Kairo's ownership exclusions. Do not promise automatic fallback for unsupported actors.

A static configuration reader is simpler and useful for visibility, but cannot implement per-launch selection or safe quota fallback. The recommended hook costs upstream API and runtime work but preserves user intent and native review authority.

## Acceptance scenarios for a future implementation

These are proposed tests, not checks executed for this draft.

- An explicit, executable model with quota is retained, even when automatic ranking prefers another model.
- Inherited/default assignment uses existing Kairo policy; a session binding or repository pin is not accidentally treated as inherit.
- Confirmed exhaustion selects the next admitted eligible model, emits a notice, and leaves all routing configuration byte-identical.
- Exhausting multiple alternatives advances through them; exhausting all eligible providers produces a cancellable wait with a verified reset time. Unknown quota/reset produces no invented time or unbounded polling.
- Missing credentials, invalid model configuration and malformed reviewer output never masquerade as quota exhaustion.
- A stale routing revision, unsupported thinking setting or unknown actor is rejected before launch without changing configuration or review state.
- Concurrent dispatches cannot oversubscribe one quota reservation; cancellation releases reservations. A wait does not consume a launch slot.
- JD dispatch preserves its exact guarded payload. RDD selection preserves target/actor/attempt binding, consent, immutable evidence and exact native continuations; mid-completion failure cannot trigger an adapter-owned retry.
- With capability absent or Kairo disabled, existing command output, routing and review behavior remain unchanged.

## Next step

Review this draft locally. Separately authorize any upstream discussion, publication or implementation. Before coding, settle the host hook/version, explicit-assignment provenance, RDD admission/reselection semantics and validator role; then add contract tests against that admitted API.
