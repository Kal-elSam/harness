# Integrations

## Gentle AI integration

Kairo 0.8.0 is Gentle’s observable companion: it negotiates
`gentle-ai.review-integration/v2` and projects official `next_transition` /
`sdd-status --json`. It does not invent methodology. See
[Gentle companion boundary](gentle-companion.md).

After installing the harness in a repo, run:

```bash
/sdd-init
gentle-ai skill-registry refresh
gentle-ai doctor
```

`/sdd-init` detects stack and testing.  
`skill-registry refresh` updates the skill registry.  
`doctor` checks ecosystem health.

## Engram/Graphify integration

Engram and Graphify are **external** integrations. Kairo verifies configuration,
version, and freshness evidence when present; it does not install them, read the
Engram database, or traverse the Graphify graph at runtime, and never claims they
are actively running.

Integration points (repo docs / optional components):

```txt
docs/ai/context-graph.md
docs/ai/memory.md
docs/skills/context-graph.md
global-template/components/engram-memory/
global-template/components/graphify-context/
```

The rule:

- The repo keeps the source of truth in Markdown (`AGENTS.md`, `docs/ai/`, code).
- Engram may index decisions, specs, memory, and conventions when configured separately.
- Graphify may build an architecture graph when you run `graphify` yourself.
- Control-plane proposals for Engram/Graphify appear only with verifiable
  config/version/freshness checks — never from optional intelligence absence alone.
- No external memory replaces `AGENTS.md`, `docs/ai/`, or the code.
