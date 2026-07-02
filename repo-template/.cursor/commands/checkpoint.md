# /checkpoint

Ejecuta validación completa antes de commit.

## Flujo

1. Revisar diff.
2. Detectar secrets, `.env`, `console.log`, `debugger`.
3. Ejecutar linter.
4. Ejecutar formatter.
5. Ejecutar typecheck.
6. Ejecutar tests.
7. Ejecutar evals si aplica.
8. Ejecutar build.
9. Proponer commit conventional.
10. Esperar aprobación humana.

## Output

```txt
Diff:
Lint:
Format:
Types:
Tests:
Evals:
Build:
Commit propuesto:
Riesgos:
```
