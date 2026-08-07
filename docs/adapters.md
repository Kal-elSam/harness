# Agents & adapters

## Supported adapters (agent-global)

Kairo Runtime does **not** install Cursor, Codex, OpenCode, Claude Code, or Pi. It detects
their home-directory roots and writes managed sections into their config files.

| Adapter | Label | Root | Config file |
|---|---|---|---|
| `cursor` | Cursor | `~/.cursor` | `~/.cursor/AGENTS.md` |
| `codex` | Codex | `~/.codex` | `~/.codex/AGENTS.md` |
| `opencode` | OpenCode | `~/.config/opencode` | `~/.config/opencode/AGENTS.md` |
| `claude` | Claude Code | `~/.claude` | `~/.claude/CLAUDE.md` |
| `pi` | Pi | `~/.pi/agent` | `~/.pi/agent/AGENTS.md` |

Inspect detection and managed state:

```bash
kairo adapters
kairo adapters --json
```

Agent selection defaults:

- If agent roots are detected → configure detected agents only.
- If none are detected → safe fallback to all five supported adapters.
- Force all five explicitly:

```bash
kairo setup --agents all
kairo install --agents all
```

### Pi runtime (auditable)

```bash
kairo run --agent pi --task "Review this repository" --permissions read-only --follow
```

Launches `pi --mode json --no-session` (optional `--model`). `read-only` maps to
`--tools read,grep,find,ls`; other permission aliases are rejected (never translated
to `--approve`). Custom `PI_CODING_AGENT_DIR` blocks config writes in 0.6.0 but does
not block runtime. Kairo does not install Pi or assert subscription/entitlement.

### Orchestrated Pi (Context Orchestration)

```bash
kairo run --agent pi --strategy orchestrated --task "..."
```

Loads the managed minion extension, injects `KAIRO_ORCH_*`, and persists a depth≤1
DAG under `~/.harness/runs/<rootRunId>/orchestration/state.json`. Normal completion
seals write-once `receipt.json`; interrupt recovery seals `recovered:true`. Limits:
concurrency 2, max attempts 2, context compact at 70% / stop at 90%, cascade cancel
on parent abort. No same-root resume. Direct `--strategy direct` (default) is unchanged.

### Bounded review (Codex / Pi)

Read-only native review against a Git snapshot. Never mutates the repo, never
auto-fixes, and never persists prompts, diffs, or transcripts. Receipts land under
`~/.harness/reviews/<reviewId>/receipt.json` (secret-free). Only Codex and Pi are
`reviewCompatible` in 0.7.0; Cursor / Claude / OpenCode report `false` until audited.

```bash
kairo review --agent codex
kairo review --agent pi --base main
kairo review --agent codex --commit <sha>
kairo review --agent codex --fail-on high --json
kairo reviews list [--limit N] [--json]
kairo reviews show <reviewId> [--json]
```

`--agent` is always required. Scope is working-tree by default; use `--base` or
`--commit` (mutually exclusive). Private paths need `--include-private` plus TTY
confirm or `--yes`/`--confirm`. Exit codes: `0` ok, `1` severity threshold,
`2` operational/stale/invalid/cancel.

Cockpit: **Runs → Reviews** lists receipts and opens a read-only detail view
(no launch from Cockpit in v1).

Primary governance flow:

```txt
scan (read-only) → evidence proposals → preview → confirm → apply → re-scan → recovery
```

Bare `kairo` opens the Control Center cockpit when the ecosystem is configured.
Runs stay secondary until setup/repairs/verification are healthy. CLI equivalents
remain `kairo status` / `kairo diff` / `kairo sync` (or `kairo setup` explicitly).
