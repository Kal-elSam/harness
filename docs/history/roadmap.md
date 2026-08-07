# Historical roadmap notes

## v2 — Universal-first, adapter-based

This version adds:

- `docs/ai/model-policy.md`
- `docs/ai/provider-routing.md`
- `docs/ai/tool-adapters.md`
- `docs/ai/context-budget.md`
- `docs/skills/model-selection.md`
- `docs/skills/tool-adapter-sync.md`
- Adapters for Codex, Claude, Gemini, GitHub Copilot, Cursor, and Gentle AI
- Codex skills: SDD, TDD, evals, checkpoint
- Claude agents/skills pointers
- Gemini pointer
- SDD subagents per phase
- Explicit policy for cost-efficient models such as DeepSeek

v2 principle:

```txt
Universal core first.
Tool adapters second.
Model providers third.
```

Cursor remains the primary editor, but not the source of truth.

## v3 — Loop Engineering + OpenCode-first execution adapter

This version adds Loop Engineering as a formal harness layer and positions OpenCode + Gentle AI + DeepSeek as the primary execution adapter for this flow.

```txt
OpenCode executes.
Gentle AI structures SDD/TDD.
DeepSeek iterates cheaply.
Harness governs.
Loops repair with boundaries.
Evals validate.
Graphify observes dependencies.
Engram preserves learning.
Human approves impact.
```

New modules:

```txt
docs/ai/loops.md
docs/ai/loop-policy.md
docs/ai/loop-observability.md
docs/ai/loop-log.md
docs/skills/loop-design.md
docs/skills/loop-debugging.md
docs/skills/loop-review.md
docs/skills/loop-retrospective.md
.opencode/
.gentle-ai/loops/
evals/loop-regression/
```

## v4 — Universal Adapter Parity

This version corrects the interpretation that the harness is OpenCode-based.

v4 rule:

```txt
AGENTS.md governs.
docs/ai defines.
docs/skills operationalize.
docs/specs specify.
evals validate.
Adapters translate.
Models execute.
Humans approve impact.
```

OpenCode may be the user's preferred runtime because Gentle AI + DeepSeek live there, but it has no higher authority than Cursor, Codex, Claude, Gemini, or Pi.

Key new document:

```txt
docs/ai/adapter-parity.md
```

New rule:

```txt
No adapter is primary by authority.
An adapter can be primary only by workflow preference.
The core universal remains the governance layer.
```

## v5 — Enforcement-first Harness

This version moves the harness closer to a real control plane — beyond methodology and documentation.

```txt
Docs guide.
Policies constrain.
CI gates enforce.
Evals measure.
Hooks block unsafe actions.
Trust policy protects skills/tools.
Installer manages lifecycle.
```

New modules:

```txt
docs/ai/enforcement.md
docs/ai/quality-gates.md
docs/ai/eval-strategy.md
docs/ai/trust-policy.md
docs/ai/installer-cli.md
docs/ai/observability-runtime.md
docs/ai/rollback-runtime.md
docs/ai/maintainability-gates.md
.github/workflows/harness-quality-gate.yml
.github/workflows/harness-security-gate.yml
.github/dependabot.yml
scripts/harness/
evals/golden/
evals/tool-calls/
evals/schema/
evals/regression/
```

## v6 — Spec Sizing and Complexity Classification

This version adds explicit feature/task spec sizing.

The harness already had installation modes:

```txt
minimal
standard
enterprise
```

But those describe harness installation size, not the complexity of a feature spec.

v6 adds:

```txt
basic spec
standard spec
complex spec
```

Rule:

```txt
Do not force complex SDD on simple tasks.
Do not allow basic specs for high-impact work.
Spec complexity must match risk, ambiguity, architecture impact, testability and blast radius.
```

New core files:

```txt
docs/ai/spec-sizing.md
docs/ai/spec-intake.md
docs/ai/spec-escalation.md
docs/specs/templates/basic-spec.md
docs/specs/templates/standard-spec.md
docs/specs/templates/complex-spec.md
docs/skills/spec-complexity-classifier.md
docs/skills/spec-intake.md
docs/skills/spec-escalation-review.md
```
