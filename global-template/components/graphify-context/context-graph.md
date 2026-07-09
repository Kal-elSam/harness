# Graphify Context Contract

> Managed by `@kal-elsam/kairo-runtime` component `graphify-context`.

## Role

Graphify is an optional context graph for architecture navigation. It maps
modules, dependencies, features, and risks. It does not replace reading code or
repo documentation.

## Authority order

```txt
1. Current user instruction
2. Repository AGENTS.md (when working inside a repo)
3. Repository docs/ai/ and docs/specs/
4. Engram (persistent memory)
5. Graphify (context graph)
```

If the graph contradicts code or repo docs, investigate the code first. Regenerate
the graph with `graphify update .` — never edit graph artifacts by hand.

## When to consult Graphify

Before answering architecture or cross-module questions:

1. Read `graphify-out/GRAPH_REPORT.md` for god nodes and community structure.
2. If `graphify-out/wiki/index.md` exists, navigate it instead of scanning raw files.
3. For "how does X relate to Y", prefer `graphify query`, `graphify path`, or
   `graphify explain` over broad grep when the graph is fresh.

Before modifying code in an unfamiliar area:

- Check module boundaries and dependency fan-in in the graph.
- Note circular dependencies, god modules, and untested high-centrality nodes.

## When to update the graph

Run `graphify update .` after modifying code files in a session (AST-only, no API
cost). Compare `GRAPH_REPORT.md` commit hash with `git rev-parse HEAD` to detect
staleness.

## CLI prerequisite

Graphify is not bundled with Kairo Runtime. Install the `graphify` CLI separately
when you want local graph generation. Kairo only ships the contract and health
checks.

## Graph signals to watch

| Signal | Risk | Action |
|---|---|---|
| Circular dependencies | Hidden coupling | Report and propose cycle break |
| High fan-in ("god module") | Risky change surface | Evaluate split or narrower API |
| Orphan module | Dead code or stale docs | Confirm before deleting |
| High centrality, no tests | Silent regression | Prioritize coverage before edits |
| Spec without code | Pending or abandoned work | Verify with human |
