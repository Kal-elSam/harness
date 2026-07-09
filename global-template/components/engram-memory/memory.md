# Engram Memory Contract

> Managed by `@kal-elsam/kairo-runtime` component `engram-memory`.

## Role

Engram is an optional external memory layer. It indexes decisions, bugs, and
conventions across sessions. It does not replace the repository as source of
truth.

## Authority order

```txt
1. Current user instruction
2. Repository AGENTS.md (when working inside a repo)
3. Repository docs/ai/ and docs/specs/
4. Engram (persistent memory)
5. Graphify (context graph)
```

If Engram contradicts AGENTS.md or repo docs, the repo wins. Update or discard
stale memory instead of following it blindly.

## When to search memory

Search Engram before:

- Starting a non-trivial task or a standard/complex spec.
- Diagnosing a bug that feels familiar or recurring.
- Proposing a new architecture or convention.
- Resuming work after context compaction or a new session.
- Repeating a loop task (see loop-retrospective guidance when present).

Skip memory search for trivial changes (typos, formatting, comments) or tasks
fully specified in an active spec.

## When to save memory

Save proactively after:

- Architecture or policy decisions (with reasoning, not just the outcome).
- Bug root causes that may recur.
- Undocumented conventions discovered in code review.
- Loop retrospectives and discarded approaches (with why they were rejected).

Do not save secrets, credentials, PII, ephemeral debug output, or content
already documented in AGENTS.md or docs/ai/.

## MCP tools

Engram is not bundled with Kairo Runtime. Configure Engram MCP tools
(`mem_search`, `mem_save`, etc.) in your agent when you want persistent memory.
Kairo only ships the contract and health checks — not the MCP server itself.

## Decision traceability

Important decisions belong in `docs/ai/decision-log.md` or an ADR. Engram
indexes; the repo certifies.
