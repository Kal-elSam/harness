# CLI reference

Moved from the npm README. Day-to-day commands: `kairo`, `status`, `sync`, `doctor`. In the terminal, `kairo help` shows those four; `kairo help --all` lists everything.

## CLI commands

| Command | Description |
|---|---|
| `kairo` | Primary — short and direct |
| `kairo-runtime` | Descriptive alias |
| `harness` | Legacy alias (prefer `kairo`) |
| `agentic-harness` | Legacy descriptive alias |

```bash
kairo --version
kairo
kairo --dry-run
kairo setup
kairo setup --dry-run
kairo setup --agents all
kairo install --agents cursor,codex --yes
kairo status
kairo status --json
kairo connections
kairo connections --json
kairo control-plane --json
kairo fleet
kairo fleet --json
kairo fleet models
kairo fleet models --profile
kairo fleet configure
kairo fleet configure --yes
kairo fleet configure --codex-model gpt-5.6-sol --yes
kairo fleet configure --from gentle --platforms claude,opencode
kairo fleet set --platform opencode --agent sdd-apply --model opencode-go/deepseek-v4-pro
kairo fleet set --platform opencode --agent sdd-apply --model opencode-go/deepseek-v4-pro --yes
kairo mcp
kairo mcp --workspace-bound --cwd <abs>
kairo mcp install
kairo mcp install --yes
kairo adapters
kairo adapters --json
kairo sync
kairo sync --dry-run
kairo sync --dry-run --json
kairo policy
kairo policy --json
kairo policy set profile safe
kairo policy reset
kairo install
kairo install --agents all
kairo install --agents cursor,codex --components orchestrator,sdd-core
kairo doctor
kairo doctor --json
kairo orchestrator --json
kairo architect --task "Design duplicate-payment protection"
kairo ui --cwd /path/to/repository
kairo conversation snapshot --cwd /path/to/repository --json
kairo plans list
kairo plans show <taskId>
kairo plans approve <taskId>
kairo plans reject <taskId>
kairo intelligence status
kairo intelligence models
kairo intelligence context --json
kairo intelligence route --task "explain architecture"
kairo intelligence ask --prompt "Summarize project risks" --json
# Cloud (OpenRouter/free) only after explicit consent + confirm:
# OPENROUTER_API_KEY=... kairo intelligence ask --prompt "..." --cloud-consent --yes
kairo update   # update the Kairo CLI from npm (--yes applies)
kairo detect
kairo components
kairo components validate
kairo components init <id> --label "<label>"
kairo components pack <id> --out <file>    # advanced
kairo components import <file>             # advanced
kairo components configure sdd-core [--overwrite-conflicts] [--dry-run|--yes]
kairo components adopt sdd-core [--agents <list>] [--dry-run|--yes]
kairo components diff sdd-core [--agents <list>] [--json]
kairo components verify sdd-core [--json]
kairo components rollback sdd-core --receipt <id> [--dry-run|--yes]
kairo backups
kairo history
kairo history --command sync --action repaired
kairo history last --json
kairo report
kairo report --json
kairo report --out ./diagnostics.txt
kairo rollback --to <snapshot> [--apply]
kairo uninstall
kairo install --scope=workspace   # opt-in / legacy
```

MCP details: [docs/mcp.md](mcp.md).

Legacy CLI aliases (backward compatible): `harness`, `agentic-harness`, `sgs-harness`, `harness-sgs`

`kairo help` lists commands and JSON support; longer examples live in this README.

To try locally from this repo:

```bash
node ./bin/kairo.js setup --dry-run
node ./bin/kairo.js status
node ./bin/kairo.js connections --json
node ./bin/kairo.js fleet --json
node ./bin/kairo.js sync --dry-run
node ./bin/kairo.js adapters --json
node ./bin/kairo.js install --dry-run
```

## Install scopes

| Scope | Default for | Behavior |
|---|---|---|
| `agent-global` | bare `kairo`, `setup`, `install`, `update`, `doctor`, `status`, `uninstall` | Primary path. Configures local agent roots, managed sections, `~/.harness` state. No project folders. |
| `workspace` | `init` only (opt-in/legacy) | Explicit `--scope=workspace`. Copies `repo-template/` into the current repo. |

### Architecture plans

`kairo architect` runs the subscription-authenticated Codex CLI in read-only,
ephemeral mode. It supplies a bounded context pack from Kairo's existing compiler,
including applicable `AGENTS.md` governance while excluding private files and broad
repository dumps. Kairo captures the final plan and writes the Git-owned handoff to
`.ai/tasks/<taskId>/`:

```text
task.md       Original task
plan.md       Codex architecture plan
status.json   Digests, base HEAD, state, and decision evidence
execution.json Reserved Claude run linkage after explicit execution
```

Plans start as `awaiting_approval`. Approval and rejection are explicit; both
refuse changed artifacts or a different Git `HEAD`.
Identical requests reuse an awaiting plan or a draft held by a live process;
an interrupted orphan draft is failed and replaced after stale-lock recovery. The
request identity includes canonical project root, Git `HEAD`, normalized task, and model.

```bash
kairo architect --task "Refactor authentication boundaries"
kairo plans approve <taskId>
```

An approved plan can be started explicitly with `kairo conversation execute <taskId>`.
Kairo revalidates the plan digests, Git `HEAD`, and the working-tree fingerprint
captured at approval, then starts a detached Claude run. Claude must report
first-party `claude.ai` subscription authentication; API-key and alternate-cloud
credentials are stripped, and the new flow uses `--permission-mode auto` with no
permission bypass flags. `kairo conversation cancel <taskId>` cancels an active run.
OpenCode execution remains unavailable until Kairo can verify `opencode-go/*` and
that server-side **Use balance** is disabled.

`kairo ui --cwd <repo>` starts the same architecture conversation workflow on an
ephemeral loopback URL. The URL carries a per-process token; API requests also require
that token and valid loopback Host/Origin headers. The timeline is derived from the
Git-owned task artifacts, so browser and Cursor refreshes preserve state. Plan approval
remains separate from execution: only the explicit **Execute with Claude** action
starts implementation. The timeline polls detached run state without claiming that
approval itself started work.

### `kairo start`

`kairo start` is the terminal-first conversation cockpit. It keeps the editor at the
bottom of a full-screen terminal view and shows the current project, provider status,
integration status, recent task transcript, plans, and detached executions. Provider
quota is deliberately displayed as `unknown` unless a provider reports a measured value;
Kairo never invents subscription percentages.

For Codex, the cockpit performs a bounded read-only `codex app-server` query
(`account/rateLimits/read`) and displays the measured five-hour and weekly windows when
the installed CLI supports them. It sends `supportsLunaReserve: false` and never reads
or enables credit/PAYG details. Errors and timeouts remain `unknown` (fail-closed).

```bash
kairo start --cwd /path/to/repository
```

Type a task and press Enter to request a Codex architecture plan. Use `Tab` to move
between the composer and plan list, `a` to approve, `x` then `y` to explicitly execute
an approved plan with Claude, `c` to cancel an active run, and `q` to exit. Composer
commands include `/help`, `/usage`, `/providers`, `/status`, `/clear`, and `/quit`.
OpenCode remains visibly blocked until its billing safety can be verified.

OpenCode Go usage is read from the authenticated, read-only Zen usage endpoint when
the local `opencode-go` credential is present. OpenCode Zen has no supported remote
balance endpoint here, so `opencode stats --days 7 --models` is shown only as
`local_recorded` history for `opencode/*` models. It is not a subscription balance or
invoice. Kairo labels Zen `PAYG`, keeps balance/auto-reload `unknown`, and enforces
`PAYG blocked`; it never enables **Use balance**, auto-reload, or model execution.

### `kairo` / `kairo setup`

Bare `kairo` opens the Ink setup UI (**Local Agent Operating System**) in a TTY. `kairo setup --simple` uses the Clack wizard instead. `kairo setup`
is equivalent. Detects agents, shows a plan, and lets you choose agents/components before
applying. Use `--dry-run` to preview without writing, or `--yes` / flags to skip prompts.
Use `kairo install` for explicit non-interactive configure in CI and scripts.
Setup writes Kairo-owned `~/.harness` state and managed adapter sections — not
Gentle methodology files ([companion boundary](gentle-companion.md)).

```bash
kairo
kairo --dry-run
kairo setup
kairo setup --dry-run
kairo setup --agents cursor,codex --components orchestrator,sdd-core --yes
kairo install --agents cursor,codex --yes
```

### `kairo status`

Control panel for the local ecosystem: detected vs managed agents, installed
components, check counts (ok/missing/stale/warning), backups, overall status, and the
recommended next action. Installed components expose public health
(`healthy` / `degraded` / `drifted` / `missing`).

```bash
kairo status
kairo status --json
```

`--json` prints a stable machine-readable envelope for CI, tooling, and debugging
(`ok`, `overall`, `agents`, `components`, `componentHealth`, `checks`, `backups`,
`nextAction`, `cliVersion`). Human text remains the default. Exit code is non-zero when
`overall` is not `ok`.

### `kairo control-plane`

Atomic IDE panel report (`kairo.control-plane/v1`): work snapshot + Gentle
workflow + team + attention. Gentle workflow is a passthrough of
`gentle-ai.review-integration/v2` — see [Gentle companion boundary](gentle-companion.md).

```bash
kairo control-plane --json
```

### `kairo sync`

Primary convergence command. Detects managed state, repairs drift with the same
safe engine as `update` (managed content only, backups before config changes,
user content preserved), then prints a status summary.

```bash
kairo sync
kairo sync --dry-run
kairo sync --dry-run --json
```

- No state → recommends `kairo setup`, writes nothing.
- Already OK → writes nothing.
- Drift/missing/stale → repairs, then shows status.
- Writes **Kairo-owned** managed sections and `~/.harness` only — not Gentle
  `.gentle-ai/` files, review inventory, or SDD change documents
  ([companion boundary](gentle-companion.md)).
- `--json` uses the same stable envelope as `status`, plus sync fields
  (`action`, `wrote`, planned/applied repairs when present).
- `kairo update` remains as a technical alias.

### `kairo history`

Read-only audit log of managed operations under `~/.harness/history.jsonl`.
Use it to investigate what Kairo Runtime applied without parsing JSONL manually.

```bash
kairo history
kairo history --command sync
kairo history --action repaired --limit 10
kairo history last
kairo history last --json
kairo history last --command sync
```

- Filters: `--command`, `--action`, `--limit` (combine before limiting).
- `history last` prints the most recent matching event; exit 0 when empty.
- Queries never write to `~/.harness`.

### `kairo report`

Read-only local diagnostics bundle for support and debugging. Combines status,
policy, adapters, diff/drift preview, and recent history without modifying
`~/.harness` or agent configs.

```bash
kairo report
kairo report --json
kairo report --out ./diagnostics.txt
kairo report --limit 10
```

- Default stdout is human-readable; `--json` is stable for CI.
- `--out <file>` writes only to the path you specify (text or JSON per flags).
- `--limit <n>` controls history events included (default 20).
- Corrupt `history.jsonl` lines appear as warnings; valid events still display.
- No telemetry and no full config contents — paths, states, and summaries only.

### `kairo policy`

Optional local operation preferences under `~/.harness/policy.json`. Use this
when your team wants consistent apply/preflight defaults without repeating CLI
flags on every `setup`, `sync`, or `upgrade`.

```bash
kairo policy
kairo policy --json
kairo policy set profile ci
kairo policy set preflight true
kairo policy set agents detected
kairo policy set components orchestrator,sdd-core
kairo policy reset
```

Profiles:

| Profile | Behavior |
|---|---|
| `safe` | Preflight on; interactive terminal prompts before apply (default). |
| `ci` | Preflight on; non-interactive apply allowed via policy (`applyMode: confirm`). |
| `fast` | Same as `ci` — preflight on, confirmation via policy instead of a prompt. |

Precedence: **CLI flags > policy file > internal defaults**. Without a policy
file, behavior matches 0.18.0. `policy reset` deletes only `policy.json`; it
does not touch `state.json`, managed adapters, or installed components.

Keys: `profile`, `applyMode` (`prompt` \| `confirm`), `preflight`, `agents`
(`detected`, `all`, or a comma-separated list), `components`.

Visibility (0.20.0+): `kairo status`, `kairo explain`, and apply preflight on
`setup`/`sync`/`upgrade` show the effective policy and consent source (`cli`,
`policy`, `interactive`, or `none`). `status --json` includes a stable `policy`
field.

### `kairo install` (agent-global)

Non-interactive configure. Same engine as `setup`.

```bash
kairo install --dry-run   # preview the plan, writes nothing
kairo install             # apply
kairo install --agents cursor,claude
```

What it does:

- Detects local agents: `cursor`, `codex`, `opencode`, `claude`. If none are
  detected, it targets all supported agents.
- Installs the orchestrator/conductor contract to `~/.harness/core/`.
- Adds a managed marker section to each agent config
  (for example `~/.cursor/AGENTS.md`):

```md
<!-- harness:managed:start -->
...managed content, refreshed by kairo sync...
<!-- harness:managed:end -->
```

- Everything outside the markers is user-owned and always preserved.
- Before modifying any existing config it snapshots the file to
  `~/.harness/backups/<timestamp>/`.
- Records everything in `~/.harness/state.json`.
- Set `HARNESS_HOME=/some/dir` to redirect the whole managed root (useful for
  testing and sandboxed environments).

### `kairo update` (agent-global)

Technical/compatibility alias for the repair engine used by `sync`. Prefer
`kairo sync` for day-to-day use. Requires an existing `~/.harness/state.json`.

### `kairo doctor` (agent-global)

Reports installed agents, managed state, backups, and missing configs.
Exits non-zero when managed state or a tracked config is missing.

```bash
kairo doctor
kairo doctor --json
```

`--json` uses the same stable control-plane envelope as `status`, including the
detailed `checks` array.

### `kairo uninstall` (agent-global)

Removes managed sections from agent configs (with a fresh backup first),
deletes `~/.harness/state.json` and `~/.harness/core/`. Backups are preserved.
