# Harness Installer CLI

## Comandos objetivo

```bash
harness init --mode minimal|standard|enterprise
harness sync
harness doctor
harness backup
harness rollback --to <snapshot>
harness parity-audit
harness eval init
harness ci init
harness trust-policy init
harness upgrade
```

## Reglas

- dry-run por default en proyectos existentes
- backup antes de modificar
- no clobber de archivos existentes
- merge idempotente
- preservar cambios del usuario
- reportar conflictos
- detectar stack, package manager, test runner y CI existente

## Estado

```txt
.harness/state.json
.harness/snapshots/
.harness/logs/
```
