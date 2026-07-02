# AI Evals

## Objetivo

Validar comportamiento de IA, agentes, prompts, tool calling, RAG y flujos conversacionales.

## Cuándo crear evals

- Prompt de producción.
- Agente conversacional.
- Tool calling.
- Clasificación.
- Generación de contenido.
- RAG.
- Workflow multi-step.
- Cambio de modelo o proveedor.
- Cambio de memoria/contexto.

## Tipos de eval

| Tipo | Objetivo |
|---|---|
| Golden dataset | Casos esperados conocidos |
| Prompt regression | Evitar degradación de prompts |
| Tool-call correctness | Verificar herramienta correcta y argumentos |
| Schema adherence | Respuesta cumple contrato |
| Safety checks | Evitar acciones inseguras |
| Conversation flows | Validar flujos multi-turn |
| Cost/latency | Controlar costo y tiempo |
| Hallucination checks | Evitar invenciones |

## Estructura

```txt
evals/
├── golden-datasets/
├── prompt-regression/
├── tool-calling/
└── conversation-flows/
```

## Regla

Si un cambio puede alterar comportamiento IA, debe tener eval o justificación explícita de por qué no aplica.
