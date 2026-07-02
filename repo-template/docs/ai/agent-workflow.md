# Agent Workflow

## Roles

| Agente | Cuándo se activa | Responsabilidad |
|---|---|---|
| Harness Orchestrator | tareas complejas | Coordina estados |
| Architect | arquitectura, capas, ADRs | Decide estructura |
| Debugger | bugs, errores | Diagnóstico con evidencia |
| Test Engineer | tests, cobertura | Diseña pruebas |
| Eval Engineer | IA/agentes/prompts | Diseña evals |
| Context Engineer | memoria/grafo | Administra contexto |
| Reviewer | antes de merge/commit | Revisión técnica |

## Feature

```txt
Harness Orchestrator
→ Architect
→ Test Engineer
→ Eval Engineer si IA
→ Implementation Agent
→ Reviewer
→ Human
```

## Bug

```txt
Debugger
→ Test Engineer
→ Implementation Agent
→ Reviewer
→ Human
```

## Handoff

Cada agente entrega:

- contexto leído
- archivos analizados
- decisión tomada
- riesgos
- siguiente acción sugerida
