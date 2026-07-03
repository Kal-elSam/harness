# SDD Workflow Contract

> Managed by `@kal-elsam/harness` component `sdd-core`.

## Workflow

Every non-trivial change follows:

```txt
Requirement → Classify → Spec → Plan → Tests failing first → Implement → Validate → Review → Human approval
```

## Rules

- No significant feature without a spec.
- No bug fix without a regression test that fails first.
- No success claim while the pipeline fails.
- Escalate spec level when risk, ambiguity, or blast radius increases.
- Inside a repository, repo `AGENTS.md` and `docs/ai/` govern over this global contract.

## Repository override

When working inside a project with harness workspace assets, prefer:

```txt
docs/ai/spec-driven-development.md
docs/ai/spec-sizing.md
docs/specs/
```

This global contract is the fallback when no repository harness is present.
