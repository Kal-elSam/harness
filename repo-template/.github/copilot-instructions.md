# GitHub Copilot Instructions

Read `AGENTS.md` first.

Copilot is an adapter only. The universal core governs.

Required guidance:

- `docs/ai/governance.md`
- `docs/ai/enforcement.md`
- `docs/ai/quality-gates.md`
- `docs/ai/trust-policy.md`
- `docs/ai/eval-strategy.md`
- `docs/ai/maintainability-gates.md`

Rules:

- Do not implement non-trivial changes without a spec.
- Do not fix bugs without regression tests.
- Do not change AI behavior without evals.
- Do not approve high-impact changes.
- Do not add dependencies without justification.
- Do not ignore failing gates.

## Spec sizing

Before implementing non-trivial work, classify the task:

```txt
basic
standard
complex
```

Use `docs/ai/spec-sizing.md`.

Do not treat high-risk work as a basic spec.
