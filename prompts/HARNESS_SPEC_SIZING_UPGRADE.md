# Harness Spec Sizing Upgrade

Use this prompt to add spec complexity classification to an existing harness.

## Add or update

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

## Update adapters

Add spec sizing support to:

```txt
.cursor/commands/spec-size.md
.cursor/commands/spec-intake.md
.cursor/commands/spec-escalate.md
.opencode/commands/spec-size.md
.opencode/commands/spec-intake.md
.opencode/commands/spec-escalate.md
.codex/skills/spec-complexity-classifier/SKILL.md
.claude/skills/spec-complexity-classifier/SKILL.md
.pi/prompts/spec-size.md
```

## Rule

```txt
Start with the smallest safe spec.
Escalate when risk or ambiguity increases.
Never use a basic spec for critical work.
```
