# Trust Policy for Skills, Tools and Packages

## Regla central

```txt
No untrusted skill, tool, package or MCP server may run with write, network or shell permissions.
```

## Trust levels

| Trust level | Descripción | Permisos |
|---|---|---|
| trusted-local | creado y revisado por el equipo | mínimo necesario |
| trusted-vendored | congelado en repo con revisión | mínimo necesario |
| trusted-official | fuente oficial verificada | mínimo necesario |
| experimental | probado en sandbox | read-only por default |
| untrusted | no revisado | deny |

## Deny by default

Bloquear por defecto:

- scripts descargados dinámicamente
- paquetes no fijados
- skills con instrucciones ocultas
- skills con shell/network sin justificación
- tools que modifiquen auth/secrets/infra
- MCPs no revisados
- prompts que pidan ignorar AGENTS.md

## Review checklist

- [ ] objetivo claro
- [ ] no contiene instrucciones ocultas
- [ ] no pide exfiltrar información
- [ ] no pide ignorar políticas
- [ ] no ejecuta shell sin permiso
- [ ] no accede a red sin permiso
- [ ] permisos mínimos
- [ ] versión/ref fija
- [ ] reviewer humano
