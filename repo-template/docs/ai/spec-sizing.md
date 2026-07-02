# Spec Sizing

## Objective

Classify the required depth of a spec before implementation.

The goal is to avoid two failure modes:

```txt
Over-specification: wasting time with complex SDD for tiny tasks.
Under-specification: allowing risky work to proceed with vague instructions.
```

## Spec levels

```txt
basic
standard
complex
```

## Basic spec

Use for low-risk, well-understood, localized work.

Examples:

- small UI copy change
- styling adjustment
- small isolated component behavior
- simple bug with clear reproduction
- simple utility function
- small test addition
- documentation update

Allowed when:

- no architecture change
- no API contract change
- no database change
- no auth/security change
- no payment/billing change
- no AI behavior change
- no production migration
- low ambiguity
- low blast radius

Required sections:

```txt
Goal
Scope
Files likely affected
Acceptance criteria
Validation
```

## Standard spec

Use for normal product/engineering work.

Examples:

- new frontend feature
- new form or workflow
- API endpoint without critical data impact
- integration with existing service
- non-critical refactor
- medium bug spanning multiple files
- state management change
- component library change

Allowed when:

- moderate ambiguity
- moderate number of files
- test strategy needed
- contracts may be touched but not critical
- rollback is straightforward

Required sections:

```txt
Problem
Goal
Non-goals
User flow / system flow
Scope
Technical plan
Acceptance criteria
Test plan
Risks
Rollback
```

## Complex spec

Use for high-risk, ambiguous or architectural work.

Examples:

- architecture changes
- auth/authorization/session changes
- payments/billing
- database schema or migrations
- production AI behavior
- agent/tool/MCP permissions
- security-sensitive logic
- infrastructure/deployment changes
- cross-service workflows
- large refactors
- multi-agent orchestration
- data consistency changes
- irreversible or hard-to-rollback changes

Required sections:

```txt
Context
Problem
Goals
Non-goals
Stakeholders
System boundaries
Current architecture
Proposed architecture
Alternatives considered
Decision / ADR link
Data model / contracts
Failure modes
Security/privacy review
Test strategy
Eval strategy if AI-related
Migration plan
Observability
Rollback plan
Rollout plan
Risk register
Human approvals
Acceptance criteria
Implementation phases
```

## Complexity scoring

Score each dimension from 0 to 2.

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Ambiguity | clear | some unknowns | unclear/open-ended |
| Blast radius | 1 file/module | multiple modules | cross-system |
| Architecture impact | none | local pattern | system boundary/design |
| Data impact | none | non-critical data | persistent/critical data |
| Security/privacy | none | minor | auth/secrets/privacy |
| AI behavior | none | prompt-only/internal | production behavior/tools |
| Testability | simple | needs integration | needs evals/E2E/contracts |
| Rollback | trivial | moderate | hard/destructive |
| Dependency impact | none | minor package | new service/vendor/MCP |
| User impact | invisible/internal | normal UX | critical flow/revenue |

## Decision

```txt
0-3 points    -> basic spec
4-9 points    -> standard spec
10+ points    -> complex spec
Any hard trigger -> complex spec
```

## Hard triggers for complex spec

Always complex if the task touches:

- auth
- authorization
- payments
- billing
- secrets
- production database migration
- destructive data changes
- infrastructure
- CI/CD release gates
- production AI behavior
- MCP/tool permissions
- cross-service contracts
- architecture boundaries
- compliance/legal/privacy
- anything difficult to rollback

## Escalation

A spec can be upgraded at any time.

```txt
basic -> standard
standard -> complex
```

A spec can be downgraded only after review.

## Rule

```txt
Start with the smallest safe spec.
Escalate as soon as risk or ambiguity increases.
Never use a basic spec for critical work.
```
