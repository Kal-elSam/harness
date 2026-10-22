# CLI reference

Moved from the npm README. Day-to-day commands: `kairo status`, `kairo setup`, `kairo sync`, `kairo doctor`. `kairo help` shows common commands; `kairo help --all` lists everything.

## Cached project routing

```bash
kairo team route --refresh --cwd /path/to/project --json
kairo team route --role Builder --cwd /path/to/project --json
```

`team route --role ROLE_ID` returns the approved project's current distribution
choice: `decision`, `provider`, `model`, `agentName`, and `why`, plus the router's
explanation fields. Role IDs are case-sensitive. `--cwd PATH` defaults to the
current directory; `--json` emits machine-readable output. No model is launched.

The role lookup reads only local approved strategy, routing inputs, run
history, and the project launch ledger. It never recovers runs, probes providers, calls the network, or writes
files. Normal model-intelligence refreshes maintain one routing-input cache per
project in `~/.harness/sessions/<project-key>/routing-input-cache.json` (under
`HARNESS_HOME` when set). The cache includes every qualified role candidate,
provider capacity, eligibility, entitlement gates, and capability evidence.

Missing inputs, inputs older than 30 minutes, or a changed approval return
`decision: "STALE"`, the approved model, and a reminder to run
`kairo team route --refresh`; exit status is 0 so launch hooks can fall back.
An unknown role or missing approved team exits non-zero (JSON error with
`--json`).

`--refresh` explicitly rebuilds the inputs through the existing snapshot path,
including its provider probes and run recovery, and publishes them atomically.
It does not require `--role`. Refresh is not a read-only operation.

MCP tool `kairo_team_route` takes `role` and optional `cwd`, returning the same
JSON as the CLI. It is read-only; refresh is deliberately CLI-only.

### Route by agent name

```bash
kairo team route --agent team-builder --cwd /path/to/project --json
```

`--agent NAME` resolves a case-sensitive agent name through the project role
catalog, then returns the normal route plus `targetAgent` and `targetModel`.
`targetAgent` is the first agent registered for that role with an `adapterId`
matching the routed provider, or `null` when no variant exists. `targetModel` is
the routed model ID. Plain agent names remain lookup aliases, without implying
any provider. Unknown agents exit non-zero with `code: "unknown_agent"`.
If supplied together, `--role` must match the agent's role. This lookup is
read-only and preserves the existing STALE behavior.

### Record a subagent launch

```bash
kairo team record-launch --agent team-builder --adapter claude --model sonnet --cwd /path/to/project
```

Records one completed unit of work at launch time. All three identity flags are
required; `--cwd` defaults to the current directory. The agent resolves through
the same project role catalog as `team route --agent`. Success exits 0; unknown
agents exit non-zero with a clear message and write nothing.

Records contain `at` (ISO time), `role`, `agent`, `adapterId`, `modelId`, and
`source: "launch"`. The per-project JSONL file lives beside routing inputs at
`~/.harness/sessions/<project-key>/launch-ledger.jsonl` (under `HARNESS_HOME`
when set). Appends use one append-mode write per JSON line. Recording prunes
entries older than eight days under an exclusive writer lock. A busy lock
times out rather than overwriting another writer; a
`launch-ledger.jsonl.lock` directory older than 30 seconds can only belong to a
crashed writer, so it is removed and the append retried.

Both cached routing and service routing combine these launches with run-store
work for the selected role, without deduplication. Routing applies its existing
distribution window and never prunes or writes the launch ledger.

## Claude Code launch router plugin

From this repository, install explicitly:

```bash
claude plugin install ./integrations/claude-code/kairo-router
```

Make `kairo` available on the host's PATH, approve a project team, register its
provider-specific agent variants in `.kairo/roles.json`, and refresh routing
inputs with `kairo team route --refresh`. The plugin does not create wrapper
agents: non-Claude variants must already delegate to their provider. Only the
Claude Code host is covered here; the routing core remains host-agnostic.

At each Agent launch, `kairo-router` reads the route in the session's working
directory with a two-second process timeout. A ROUTED result selects the
registered provider-specific `subagent_type`; only Claude routes set the Claude
subagent's `model`. Non-Claude model IDs are never placed in that field.
A bracketed marker containing `no-redirect` (for example `[no-redirect]`) skips
routing entirely. STALE inputs, unknown agents, timeouts, and errors leave the
launch unchanged, with at most one warning toast per session. No launch is denied.
After a successful rewrite or confirmed original agent, the plugin starts
`team record-launch` with the final agent, provider, and model in the background.
It never waits for recording, denies a launch on accounting failure, or shows
an extra toast. Routes with no launchable provider variant are not recorded.

This replaces the team-pacing mod's launch rewriting; do not enable both launch
routers together. Installation and disabling an existing mod remain explicit
user operations; Kairo does not modify installed plugins here.

## Host role files

```bash
kairo team roles sync [--host ID|all] [--cwd PATH] [--json]        # preview
kairo team roles sync --host claude-code --yes
kairo team roles retire [--host ID|all] --yes
```

Writes one Kairo-marked static role file per catalog role into the project, for
hosts whose agents carry a model field: `claude-code` (`.claude/agents/<id>.md`),
`codex` (`.codex/agents/<id>.toml`), `opencode` (`.opencode/agents/<id>.md`,
model as `provider/model`), `cursor` (`.cursor/agents/<id>.md`) and `gemini`
(`.gemini/agents/<id>.md`). `kimi` (no model field) and `pi` (owned by gentle-pi)
report `unsupported`. Without `--host`, only detected hosts are used; `all`
covers every host. Nothing is written without `--yes`.

Picks come from the read-only `team route` logic per role (roles outside the
approved team follow their base role); a STALE route falls back to the approved
assignment, and each file reports its `source` (`route` or `approved-fallback`).
A pick whose provider is not native to the host reports `needs-wrapper` and
writes nothing. Existing files without the Kairo marker, and symlinks, are never
touched (`skip-foreign`); updating a marked file first keeps a
`<path>.kairo-backup.<stamp>` copy. `retire` removes only marked files.

## Project roles

Each project has one role catalog: Kairo's 14 built-in roles, gentle-ai's workflow
roles (`odd-*`, `review-*`, `jd-*`; each inherits capabilities and quality tier from
the Kairo role named in its `sourceRole`), and your own roles from
`<project>/.kairo/roles.json`. There is no limit on role count.

```json
{
  "roles": [
    {
      "id": "Data Wrangler",
      "description": "Cleans and reshapes datasets",
      "capabilities": ["coding", "terminalExecution"],
      "qualityFloor": "standard",
      "agents": ["team-data"]
    },
    { "id": "Reviewer", "qualityFloor": 0.8, "agents": ["team-reviewer"] }
  ]
}
```

Fields: `id`, `description` and `capabilities` (new roles; one of `reasoning`, `coding`,
`terminalExecution`, `softwareExecution`, `instructionFollowing`, `agenticExecution`,
`responseTime`); `qualityFloor` (a tier `light`/`standard`/`demanding` or a number 0-1);
`agents` (plain names or `{ "name": "team-builder-codex", "adapterId": "codex" }` objects, for launch hooks); `extends` (copy tier,
volume and flags from an existing role). Reusing an existing id (second entry) overrides
that role's capabilities, floor or agents. An invalid file is ignored as a whole: built-in
and gentle-ai roles stay and the problems are reported with their field path. Duplicate
agent names keep the first role.

### Provider-specific agents

Plain names keep their existing role lookup behavior. Use objects to declare
which already-existing agent runs that role on each provider:

```json
{
  "roles": [{
    "id": "Builder",
    "agents": [
      "legacy-builder",
      { "name": "team-builder", "adapterId": "claude" },
      { "name": "team-builder-codex", "adapterId": "codex" }
    ]
  }]
}
```

Both `name` and `adapterId` must be non-empty strings. If multiple variants claim
the same provider, the first wins and the catalog reports a warning. A duplicate
name claimed by another role cannot become this role's launch target.

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
kairo plans list
kairo plans show <taskId>
kairo plans approve <taskId>
kairo plans reject <taskId>
kairo plans execute <taskId> --role <role> [--confirm]
kairo plans cancel <taskId>
kairo plans result <taskId>
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
| `agent-global` | `setup`, `install`, `doctor`, `status`, `uninstall` | Kairo adapter integration and managed-state operations. Configuration writes use managed sections and `~/.harness` state. No project folders. |
| `workspace` | `init` only (opt-in/legacy) | Explicit `--scope=workspace`. Copies `repo-template/` into the current repo. |

Bare `kairo` only prints the terminal UI retirement notice. `kairo update` previews
updating the CLI from npm; `--yes` applies it. Agent configuration methodology,
workflow, review, skills, and memory remain gentle-ai's responsibility.

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

```bash
kairo plans execute <taskId> --role <role>            # read-only preview
kairo plans execute <taskId> --role <role> --confirm  # execute the previewed target
kairo plans cancel <taskId>
kairo plans result <taskId>
```

`--role` is required (PROJECT TEAM is the sole authority). The preview picks the
most under-served model among every qualified, executable model of every available
provider, proportional to quota headroom and respecting the role's quality floor
(`distribution` in the preview explains targets, actuals and the choice). Without `--confirm`,
`execute` only prints the preview; with `--confirm` it fails with
`Cannot execute "<taskId>": <reason>` when the preview has no confirmation target.
On execution Kairo revalidates the plan digests, Git `HEAD`, and the working-tree fingerprint
captured at approval, then starts a detached Claude run. Claude must report
first-party `claude.ai` subscription authentication; API-key and alternate-cloud
credentials are stripped, and the new flow uses `--permission-mode auto` with no
permission bypass flags.
OpenCode execution remains unavailable until Kairo can verify `opencode-go/*` and
that server-side **Use balance** is disabled.

### Retired terminal UI

The standalone Ratatui UI and Pi host were retired. Bare `kairo` prints:

```text
The terminal UI was retired. Use `kairo status` or `kairo setup`.
```

Bare `kairo` exits 0. `kairo host`, `kairo shell`, `kairo ui`, `kairo start`,
`kairo resume`, `kairo list`, and `kairo conversation` print the same line and
exit 1. They never launch a UI.

### `kairo` / `kairo setup`

Bare `kairo` prints the retirement notice above. `kairo setup` runs the Clack wizard in a
terminal (`--simple` selects it explicitly). It detects agents, shows a plan, and lets you choose agents/components before
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
