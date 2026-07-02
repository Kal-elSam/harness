# Git workflow

## Pipeline pre-commit

1. Diff review.
2. Secrets check.
3. Linter: `[LINT_COMMAND]`
4. Formatter: `[FORMAT_COMMAND]`
5. Type check: `[TYPE_CHECK_COMMAND]`
6. Tests: `[TEST_COMMAND]`
7. Build: `[BUILD_COMMAND]`
8. Commit conventional.

## Conventional Commits

```txt
tipo(scope): descripción en imperativo
```

Tipos:

```txt
feat | fix | test | refactor | docs | chore | perf | ci
```

## Prohibido commitear

- `.env`
- secrets
- tokens
- `console.log`
- `debugger`
- código comentado innecesario
- archivos no relacionados
- cambios de formato mezclados con lógica sin razón
