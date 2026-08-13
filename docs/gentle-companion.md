# Gentle companion boundary

Kairo 0.8.0 is Gentle’s **observable companion**, not a second methodology engine.

Gentle is the sole authority for SDD / RDD, reviews, receipts, gates, recovery,
agent routing inside Gentle, and `next_transition`. Kairo negotiates
`gentle-ai.review-integration/v2`, projects official JSON, and may execute a
Gentle command **verbatim**. It does not invent workflow.

## Provider states

Mapped from the existing capabilities probe (`probeGentle` /
`evaluateGentleCapabilities`). Version numbers are not a floor: Gentle 2.2.4
may be `connected` when the v2 contract and `next_transition` are official.

| `workflow.provider` | Meaning | Panel |
|---|---|---|
| `connected` | v2 negotiated; `next_transition` published by Gentle, unaltered | Workflow passthrough |
| `upgrade_required` | Binary present; recognizable v1 / protocol 1.x | **Upgrade Gentle** (`gentle-ai doctor`). Work and Equipo stay |
| `unavailable` | Binary absent | Install hint only. No SDD / reviews / receipts / routing |
| `incompatible` | Unknown schema, non-object, or ambiguous JSON | Fail closed. Work and Equipo stay |

## Official reads (connected only)

```bash
gentle-ai review status --contract gentle-ai.review-integration/v2 --next-transition
gentle-ai sdd-status --json
```

Parsers use `JSON.parse` of command stdout only. No markdown fences, no `{…}`
slices, no inventory schema `gentle-ai.review-authority-status/v1`.

Projected fields:

- `nextTransition` — Gentle’s `next_transition` object as-is (not a string Kairo invents)
- `review.receipt` / `gate` — only when status v2/v3 publishes them
- `sdd` — `schemaName`, `changeName`, `nextRecommended` from a known `gentle-ai.sdd-status*` schema

Forbidden reconstructions: `authoritative`, `entries[]`, `revision` as receipt,
`lineage_id`, `entry.path`, inferred `phase` / `route` / `next`.

## Primaries (≤2)

1. `next_transition.execute.command` verbatim (label from Gentle `operation`).
2. `upgrade_required` → **Upgrade Gentle** with `gentle-ai doctor` (never `brew upgrade`).
3. `unavailable` → documented install: install `gentle-ai` separately, then Refresh.
4. Kairo-owned MCP repair only if a slot remains and it does not replace Gentle.

## `kairo control-plane --json`

Atomic panel report `kairo.control-plane/v1`: Ahora (work snapshot) + Workflow
(Gentle) + Equipo + Atención. The IDE panel fetches this once. Legacy
`kairo connections` / `kairo next` chips stay available but must not be
composed into a contradictory Workflow.

```bash
kairo control-plane --json
```

## Freeze (0.8.0)

These surfaces remain in the CLI / Cockpit. They **do not** feed the Gentle
workflow section of the control plane. Do not delete them in this version.

| Surface | Role after freeze |
|---|---|
| `kairo review` / `kairo reviews` | Bounded Codex/Pi reviews; receipts under `~/.harness/reviews/` |
| Cockpit **Runs → Reviews** | Read-only Kairo receipts; not Gentle authority |
| `kairo orchestrator` | Adapter capability diagnostics |
| `kairo intelligence` | Harness Engineering routing (Ollama / OpenCode / OpenRouter). Not Gentle SDD |
| `kairo fleet configure --from gentle` | Copies model assignments into Kairo’s fleet profile. Not workflow authority |

`kairo setup` / `kairo sync` write **Kairo-owned** artifacts only: `~/.harness`
state, managed `<!-- harness:managed -->` sections, MCP install + work-snapshot
rule. They must not rewrite Gentle managed files (`.gentle-ai/`, Gentle review
inventory, SDD change documents, Engram/Graphify databases).

## Proposed upstream: `gentle-ai observe --json`

Kairo currently composes two Gentle commands after a v2 capabilities probe.
A single typed companion payload would remove that composition:

```text
gentle-ai observe --json
```

Suggested shape (upstream; not implemented here, not a Kairo blocker):

- negotiated contract id (`gentle-ai.review-integration/v2`)
- `next_transition` object
- typed `sdd-status` projection (`schemaName`, `changeName`, `nextRecommended`)
- optional `receipt` / `gate` only when Gentle publishes them

This proposal lives in Kairo docs only. Do not treat missing `observe --json`
as a defect of 0.8.0, and do not open a Gentle GitHub issue from this change.

## Fail closed

Unknown schema, partial JSON, or inventory-shaped payloads → `incompatible`
(or a null SDD/review projection). Kairo never hashes, lineages, or mutates
Gentle state to fill gaps.
