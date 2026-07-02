# Gentle AI Adapter

This folder documents how Gentle AI should interact with the universal harness.

## Recommended commands

```bash
/sdd-init
gentle-ai skill-registry refresh
gentle-ai doctor
```

## Model routing

Economic models such as DeepSeek can handle:

- intake
- task breakdown
- scaffolding
- simple tests
- base documentation

Escalate to a strong model or human for:

- architecture
- critical specs
- security
- acceptance review
- complex debugging

## Source of truth

- `AGENTS.md`
- `docs/ai/`
- `docs/skills/`
- `docs/specs/`
- `evals/`
