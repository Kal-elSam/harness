# Rollback Runtime

## Snapshot policy

Crear snapshot antes de:

- loop autónomo
- cambios multiarchivo
- migraciones
- cambios de auth
- cambios de infraestructura
- cambios IA productivos
- actualizaciones de dependencias

## Git policy

Antes de cambios grandes:

```bash
git status
git diff
git branch --show-current
```

Preferir worktrees/branches aisladas para agentes.
