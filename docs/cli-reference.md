# CLI reference

Moved from the npm README. Day-to-day commands: `kairo status`, `kairo setup`, `kairo sync`, `kairo doctor`. `kairo help` shows common commands; `kairo help --all` lists everything.

## Team setup

Run these commands from your Git project (or add `--cwd /path/to/project`):

```bash
kairo team analysts
kairo team analyze --analyst MODEL [--goal "TEXT"] --yes
kairo team approve --yes
kairo team roles init --yes
```

First list every currently executable analyst with `kairo team analysts`. Each row
shows its number, model ID, provider, access (subscription or API key), estimated
cost of one analysis, and provider quota tier. Missing cost or quota evidence is
`unknown`; per-token benchmark prices are not an estimate of an entire analysis.
Only routes supported by both the existing bootstrap analyzer adapters and
current project-team policy appear; adding an API key does not make an
unsupported provider executable. Current project-team policy permits Claude
and Codex; Cursor and OpenCode Go drafts cannot currently be read back.

Choose a model ID (or its row number from the current list):
`kairo team analyze --analyst MODEL --yes`. If an ID appears on multiple providers,
use the row number or `PROVIDER::MODEL`. Rows are ordered by provider/model identity,
not quality or price; row numbers refer to the current inventory and may change.
Without `--analyst`, a preview prints the list; `--yes` refuses and runs nothing.
An unknown or unavailable analyst gives a one-line error naming `kairo team analysts`.
Use `--goal "TEXT"` to give the analyst the project purpose. Without it, Kairo reads
`.kairo/goal.md` when present; otherwise it keeps today's analysis behavior unchanged.

Omit `--yes` to preview analysis or approval without running the analyst or
changing the team. With `--yes`, analysis runs only your chosen analyst once
against a sanitized project snapshot, spends provider usage, and saves a draft.
No retries or model fallbacks. Discovery reads provider metadata; it does not
verify model access, run analysis, or persist changes.

Use `kairo team show` to review the host-session orchestrator above the role, model, provider, and draft/approved status
in a read-only table before approval. Approval reuses the server-side integrity
and availability checks; a rejected approval leaves the draft unchanged.

Use `kairo team rebuild` to recompute the team from the analysis already stored,
with today's model selection, capacity and catalog. It never calls a model or
the analyst and spends no usage. The preview table shows each role's old model,
new model and status (including `degraded`); nothing is written. With `--yes`
it saves the result as a draft you still approve with `kairo team approve --yes`.
Over an approved team, `--yes` files a pending proposal and the approved team
stays until you approve. Without a stored analysis it refuses: run
`kairo team analysts` and `kairo team analyze` first.
`kairo plans approve` approves a task plan, not a project team.

### Team pacing

```bash
kairo team pacing
kairo team pacing --json
```

Reads cached account usage, observed usage samples and the project's launch
ledger. Missing or older-than-30-minute quota triggers the same routing-input
refresh as `kairo team route --refresh` (may probe providers and update caches).
If refresh fails, missing quota remains unknown, never a fabricated refill.
Add `--cwd PATH` to select the project. Text uses local reset times, hours and
minutes, and one short line per measured provider. Providers without quota
share one trailing `No quota data:` line. JSON includes `providers`, each window's
`remainingPercent`, ISO `resetsAt`, `projectedRemaining` (fraction, possibly
negative), `tier`, `exhaustionInMs` and `expectedDeadTimeMs`, plus `writerCounts`,
`preferredProvider` and `nextWriter`. Projected values are estimates, not guarantees.

Next writer favors the smaller expected dead time (the maximum pause before
reset across the provider's windows), then less severe tier, later exhaustion,
larger projected remainder, and fewer Builder launches in the last seven days.
An exact tie selects Claude; no quota evidence yields no recommendation.

The Claude Code `kairo-router` plugin injects one short pacing context line per
prompt and refreshes pacing before subsequent work launches. Builder and
researcher pairs follow provider availability when the qualified concrete route
selects a model on that provider. `kairo team route --agent NAME --provider P`
constrains selection to that role’s qualified pool, retaining admission,
entitlement and exhaustion gates without changing the approved team. If no
qualified route is available, the plugin falls back to the ordinary route.
Redirects retain launch/outcome accounting and one exhaustion handover; the
handover is not pinned to the exhausted provider. Tied writer availability retains
the reference's over-60% launch-share rebalance rule. `[no-redirect]` in the user
or Agent prompt skips all launch rewrites. Claude Opus subagents drop to Sonnet
at CONSERVE or CRITICAL; the orchestrator model never changes. Under those tiers,
when Codex is HEALTHY or WATCH, inline writes over 20 new lines get an advisory
hint (never denial or replay). Gentle-ai review and judge actors are excluded.
Missing commands, malformed output and timeouts fail open.

Plugin `userConfig` fields `showBand`, `showStatus`, and `showContext` default to
`true`. Set them through Claude Code's plugin configuration (`/config`), or in
`settings.json` under `pluginConfigs["kairo-router"].options`. The above-prompt
band shows only the action and constrained provider's return time/dead time;
the single status entry reports routing activity, without repeating quota
numbers. The model context owns quota, expected unused time, local reset and
next-writer line. Hiding a display surface does not disable routing. Pending
verdict reminders remain separate because they describe unverified results,
not quota. The hand-built team-pacing mod is a reference, not a second surface
to enable alongside Kairo; this command does not modify or retire it.

### Quota phases

```bash
kairo team plan
kairo team plan --all
kairo team plan --json
```

`plan` recomputes the forecast from stored analysis with today's quota using the
same path as the rebuild preview. No model calls, usage spending or writes.
Without stored analysis it exits with code 1 and tells you to run
`kairo team analysts` and `kairo team analyze` first. Add `--cwd PATH` to select
another project.

The first line identifies the current phase. By default, the table covers the
next 24 hours; `--all` shows the full forecast. Consecutive phases with identical
role changes share one row, with local date/time ranges. Each row lists only
roles differing from the ideal team, plus waiting roles and their reset time.

Each phase caps roles per model at `ceil(assignable roles / qualified models
with budget)`. Only a sole qualified option or all qualified models being full
permits explained overflow; provider-share preferences cannot hide models with room.
Transfers must not increase the receiving provider's expected dead time: the
maximum, across its quota windows, of time until reset minus projected time
until exhaustion (never below zero), including the transferred workload's burn.
Otherwise, roles wait for their ideal provider's reset and show its time.

When every role waits, one line summarizes the wait until the next known reset.
Missing reset evidence is labeled `no reset data`. A wait's reset time may fall
beyond the displayed 24-hour range.
`--json` always prints the full, unmerged `phasePlan` itself, with or without
`--all`; rebuild JSON also includes `phasePlan`.
`kairo team show` adds one current-phase/next-change line only when a stored plan
exists. `kairo team route` prefers a changed current-phase assignment from its
qualified pool, subject to live eligibility, entitlement and task admission;
otherwise existing routing remains unchanged. Show and route use the stored
forecast; `plan` previews a fresh forecast without changing the approved team.

New analyses and rebuilt strategies include `phasePlan`: `idealTeam` preserves
`projectTeam`, while `phases` carry ISO `startsAt`/`endsAt`, exhaustion/reset
`events`, per-provider `budgets`, and the qualified `team` for that interval.
The pure forecast uses blended observed burn through the latest known reset;
both 5h and weekly windows constrain availability. Refill projections assume
that burn continues, not guaranteed throughput. Unknown burn stays unknown;
measured weekly conversion supplies burst units only when enough samples exist.
Phases preserve role quality floors, owned evidence and the strict role cap.
A role without a qualified budgeted assignment has `model: null`,
`assignmentState: "waiting"` and `waitUntil` (ISO reset time, or `null` when
unknown).


Analysis and rebuild apply a strict per-model cap of
`ceil(assignable roles / qualified models)`; the host-session orchestrator is
excluded. A qualified model passes eligibility and the quality floor for at
least one assignable role. For example, 12 roles and 7 qualified models means
at most 2 roles per model. If the best model is full, Kairo selects the next
qualified model with room and explains the cap-driven move in the role reason.
A model may exceed the cap only when it is the role's single qualified model,
or when every qualified model for that role is already full; then the best
qualified model with the fewest roles takes it. The role reason explains both
cases, so no role stays empty and no cap is exceeded silently.

All team setup commands accept `--json`. Preview responses have `ok`, `action`,
`applied: false`, `strategyStatus`, and either `analyst`/`spend` or `team`/`warnings`.
`analysts` returns `analysts` rows (`number`, `modelId`, `provider`, `candidateKey`,
`access`, `estimatedCost`, `quotaTier`). An analysis preview without a selection
returns those rows and `message` instead of `analyst`/`spend`.
Applied responses have `applied: true` and the shared setup result. `show` returns
`ok`, `action`, `strategyStatus`, and `team` rows (`role`, `model`, `provider`,
`status`). Errors exit non-zero with `ok: false`, `action`, `code`, and a one-line
`error` naming the next command. Confirmation targets stay inside the process;
there are no tokens to copy.

MCP alternative: `kairo_setup_plan`, `kairo_setup_run_analysis`, and
`kairo_setup_approve_team` use the same setup operations.

## Generate the project role catalog

After that approval:

```bash
kairo team roles init --cwd /path/to/project --json        # preview, no writes
kairo team roles init --cwd /path/to/project --yes         # write .kairo/roles.json
```

`init` reads the same active approved strategy as `team route`. Without it,
init exits non-zero and writes nothing. It never analyzes the project, launches
a model, probes a provider, or changes installed agents.

Discovery reads Markdown agents in Claude Code, OpenCode, Cursor and Gemini
role directories and TOML agents in Codex role directories, at both project and
user scope. OpenCode also reads `$XDG_CONFIG_HOME/opencode/agents` (default
`~/.config/opencode/agents`). Kairo role and bridge files are ignored.
Name, description and model metadata are read; execution wrappers identify
`codex exec`, `opencode run`, `cursor-agent` or `gemini`. Otherwise Claude
aliases/IDs map to `claude`, GPT/OpenAI IDs to `codex`, Gemini IDs to `gemini`,
and `provider/model` keeps that provider prefix. Unknown providers are reported,
never inferred from the host.

Exact role IDs and existing agent aliases win. Otherwise provider suffixes are
stripped and role-name tokens match catalog IDs. `researcher` is unmapped unless
a `Researcher` catalog role exists; capabilities are never invented. Roles must
belong to the approved team (workflow roles may use their approved source role).
Ambiguous or unmatched agents appear under `unmapped` with a reason.

The preview includes `roles`, `unmapped`, `conflicts` and `warnings`. New agents
use `{ "name": "team-builder-codex", "adapterId": "codex" }`. Existing entries,
fields, aliases and first provider-specific launch targets are preserved;
conflicts are reported. `--yes` atomically adds missing agents, with an exclusive
collision-safe `.kairo-backup.<timestamp>[-n]` backup when replacing an existing
file. An unchanged second run writes nothing and creates no backup. Invalid
existing catalogs and symlink targets are refused rather than overwritten.

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
history, local account usage samples, and the project launch ledger. It never recovers runs, probes providers, calls the network, or writes
files. Normal model-intelligence refreshes maintain one routing-input cache per
project in `~/.harness/sessions/<project-key>/routing-input-cache.json` (under
`HARNESS_HOME` when set). The cache includes every qualified role candidate,
provider capacity, eligibility, entitlement gates, and capability evidence.

With local usage samples and a ledger, routing checks task affordability before
balancing distribution. `admission.candidates` reports each model's estimated
five-hour cost, admission/rejection reason, and earliest `waitUntil` (epoch
milliseconds). `admission.decision` is `admitted` or `wait`; `why` includes the
same explanation in plain output. A wait returns `WAIT_FOR_PROJECT_TEAM`, no
provider/model/agent, and launches nothing. Route again after the reset; a future
reset is not a capacity reservation.

Costs are per-provider medians from at least three isolated, same-role runs or
launches bracketed by samples without a quota reset or overlapping recorded work.
Otherwise `withoutHistory: true` marks conservative defaults: light roles 10%,
standard 30%, demanding or unknown 40% of a five-hour window. Weekly cost uses
the measured weekly-per-five-hour conversion; when unknown, it conservatively
uses equal percentage points. Both current windows must cover the cost; missing
or expired windows require refreshed inputs, never a guessed refill.

When a higher-utility model cannot fit, routing compares its relative utility
loss against waiting as a fraction of five hours. It waits if quality loss is
greater; ties favor immediate work. Distribution only uses admitted alternatives
within that quality bound. If none fit, the earliest known feasible reset is
reported. With no samples or no supplied ledger, routing remains unchanged.
Account-level observations are estimates, not isolated task metering; unrecorded
usage can still affect them. Recorded exhaustion overrides capacity until its
reset, including when no usage history is available.

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

### Verify a delegated task

After checking a delegated task, record the orchestrator's verdict:

```bash
kairo team verdict --pending
kairo team verdict --agent team-builder-codex --result pass
kairo team verdict --agent team-builder-codex --result fail --retry
kairo team verdict --pending --json --cwd /path/to/project
```

`--agent NAME --result pass|fail` closes the latest recorded outcome for that
agent that has no result in this project. `--retry` marks a repeated attempt.
A second verdict closes the next older unresolved outcome; it never replaces
an existing verdict. Unknown agents, invalid results, and agents without a
pending outcome exit non-zero without changing the ledger. `--json` returns
the appended verdict, or an error object with `decision: "ERROR"` and `message`.

`--pending` is read-only and lists unresolved outcomes with agent, model, and
finished time (`at`). With `--json`, it returns an array of outcome records,
including `agent`, `modelId`, and `at`; an empty list is `[]`. Do not combine
`--pending` with `--agent`, `--result`, or `--retry`. Both forms accept `--cwd PATH`.

Verdicts append references to existing outcomes without rewriting their lines.
Telemetry applies each verdict once to its original outcome, not as a second
task. Existing `record-outcome` calls, including inline `--result`, still work.
The Claude Code kairo-router checks pending verdicts on each submitted prompt
and adds one short reminder only when results await verification. Missing Kairo,
timeouts, or failed lookups add no context and never block the prompt.

### Record a subagent outcome

```bash
kairo team record-outcome --agent team-builder-codex --adapter codex --model gpt-6.1-sol --status exhausted --reason "Usage limit reached" --cwd /path/to/project
```

`--agent`, `--adapter`, `--model`, and `--status` are required. Status is
`completed`, `failed`, or `exhausted`; `--reason TEXT`, `--cwd PATH`,
`--result pass|fail`, and `--retry` are optional. The agent must exist in the project role catalog. Invalid input exits
non-zero without appending an outcome.

Use `--result pass` only when task checks are green and its review is accepted;
otherwise record `--result fail`. Completion alone is not a quality verdict.
Add `--retry` when this launch repeats an earlier failed attempt of the same task.
Record the earlier failure separately against the model that failed; the retry
flag never creates an extra failure for either model. Existing calls without
these flags retain their behavior.

Role-attributed outcomes with explicit results measure quality independently of
cost or token usage. After at least five results for a model and role, passes
divided by results replaces its public role fit score (including a binary owned
aptitude pass). Rates below the role quality floor exclude that model from the
role; selection reasons identify the measured rate and sample size. Unattributed
outcomes are ignored for quality.

Outcomes append to the same launch ledger without counting another launch.
An `exhausted` outcome marks the entire provider unavailable until its next
known five-hour reset, using local usage samples or cached capacity. If no reset
is known, the marker lasts 30 minutes. Routing and admission ignore expired
markers without deleting them; a route lookup remains read-only. A normal
outcome does not clear an active exhaustion marker.

Host integrations can call the read-only detector without importing repository
source: `kairo team detect-exhaustion --text TEXT [--adapter ID] [--exit-code N]`.
It prints JSON `{ "provider": "...", "reason": "..." }` for recognized quota
failures, or `null` otherwise. It never records an outcome itself.

## Run a task on a routed model

```bash
printf '%s\n' 'Implement the task described here.' | kairo team exec --provider codex --model MODEL --role odd-worker
```

`kairo team exec --provider P --model M [--cwd PATH] [--role R]` reads the
whole task from stdin. Kairo calls the provider execution adapter's `buildLaunch`
with that model, then starts a child with an argv array, never a shell. Backticks,
dollar signs and angle brackets in the task are passed unchanged. Stdout and
stderr stream unchanged; Kairo exits with the child's exit code. No retry or
model substitution occurs. A signal exit uses `128 + signal number`.

Supported execution providers are Claude, Codex, Cursor (`cursor-agent`),
OpenCode (including `opencode-go`/`opencode-zen` IDs), Pi and Gemini. Gemini's
team-exec adapter does not add it to the automatic routing pool. Provider IDs
are lowercase. Unknown providers or models not executable for that provider
exit non-zero with a one-line error. Executability uses the fresh project
routing-input cache, automatic access and cached entitlement; it does not probe
credentials or model access. Refresh inputs separately with
`kairo team route --refresh`. The installed CLI must still be available at launch.

Each invocation records a launch and its completed, failed or exhausted outcome
in the existing project launch ledger. `--role` supplies the role ID; without it,
the ledger uses `task`. Recognized provider-limit output records exhaustion even
when the child exits zero. This command does not perform a handover itself.

## Claude Code launch router plugin

From this repository, install explicitly:

```bash
claude plugin install ./integrations/claude-code/kairo-router
```

Make `kairo` available on the host's PATH, approve a project team, generate its
provider-specific agent catalog with `kairo team roles init --yes`, refresh routing
inputs with `kairo team route --refresh`, then preview and install wrappers with
`kairo team roles sync --host claude-code` and the same command with `--yes`.
Only the Claude Code host is covered here; the routing core remains host-agnostic.

At each Agent launch, `kairo-router` reads the route in the session's working
directory with a two-second process timeout. A ROUTED result selects the
user-mapped provider-specific `subagent_type`, or `kairo-PROVIDER` when no mapping
exists. Built-in wrappers receive `kairo-model: ROUTED_MODEL` as the first prompt
line. Only Claude routes set the Claude subagent's `model`; non-Claude model IDs
are never placed in that field. Built-in wrapper launches and outcomes are
accounted against the original catalog agent, preserving role distribution and
the existing one-time quota handover.
A bracketed marker containing `no-redirect` (for example `[no-redirect]`) skips
routing entirely. STALE inputs, unknown agents, timeouts, and errors leave the
launch unchanged, with at most one warning toast per session. No launch is denied.
After a successful rewrite or confirmed original agent, the plugin starts
`team record-launch` with the catalog agent, provider, and model in the background.
It never waits for recording, denies a launch on accounting failure, or shows
an extra toast. Routes with no launchable provider variant are not recorded.

After the Agent returns, the plugin detects Claude/Codex quota or rate-limit
messages and wrapper `fallback:` lines. Normal results record a `completed`
outcome in the background. Exhaustion records an `exhausted` outcome and shows
one toast naming the provider and announcing handover. Once that recording
succeeds, the plugin routes the original task again and relaunches at most once,
only on a different provider. The prompt tells the replacement to continue from
the current working tree and not redo finished work. The replacement's outcome
is recorded too, but never triggers another retry.

If recording or rerouting fails, inputs are STALE, or no different provider is
available, the plugin returns the original result unchanged. Accounting and
handover never deny a launch.

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

The gentle-ai actors `review-risk`, `review-resilience`, `review-readability`,
`review-reliability`, `review-refuter`, `jd-judge-a`, `jd-judge-b` and
`jd-fix-agent` are excluded from init and sync. Sync reports `skipped` with
`owned by gentle-ai`; `team route --agent NAME` returns `NOT_ROUTED` with that
reason so launch hooks leave the original actor unchanged.

Work aliases include `team-builder` and `team-builder-codex` (Builder),
`team-test-runner` (Tester), and `team-explorer` (Explorer). `odd-worker` follows
Builder when it has no separate approved assignment. Backend and Frontend
Builder follow Builder when needed; a generic Builder launch uses the first
approved split Builder when no generic Builder assignment exists.
Every generated agent and wrapper includes short context guidance: use
CodeGraph, Engram, Graphify and RTK-filtered output before broad reads, and
read only the needed line ranges. Wrappers still forward task bytes unchanged.

Picks come from the read-only `team route` logic per role (roles outside the
approved team follow their base role); a STALE route falls back to the approved
assignment, and each file reports its `source` (`route` or `approved-fallback`).
On Claude Code, sync also generates `kairo-codex`, `kairo-opencode`,
`kairo-cursor` and `kairo-gemini` agents when their respective CLIs exist.
OpenCode also gets `kairo-opencode-go` and `kairo-opencode-zen` bridges for
its distinct routing identities; Cursor requires `cursor-agent`, not an unrelated
`agent` executable.
These marked agents use Haiku only as the Bash launcher: the actual task runs
through `kairo team exec` on the concrete model selected for that launch.
They read and remove the `kairo-model:` line, pipe the remaining task unchanged
to exec, and return its output unchanged. Without the line, they obtain the
model from a matching-provider route; they never invent a fixed model.
A non-native role pick reports `needs-wrapper` with its wrapper target when
available. Other hosts retain their existing native files and wrapper limits.

Existing files without the Kairo marker, and symlinks, are never
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


### Running delegated work

Use `kairo team running` to see each active role, model, provider, agent name,
and elapsed time. Add `--watch` for two-second updates (Ctrl+C stops), or
`--json` for machine-readable snapshots; both flags can be combined.
Launches without outcomes after two hours appear as **possibly abandoned**,
not running, and are reported once per watch session.

Add `--summary` (with optional `--json`) to see launches per model and provider
for today and the last 7 days from the launch ledger, for example
`gpt-6.1-sol (codex) 11, gpt-6-astra (codex) 1, claude-sonnet-5-5 (claude) 1`.
This shows whether work is really spread across models, not just providers.

`kairo team exec` (used by the Kairo provider wrappers) returns the provider's
final assistant message. On a usage or rate limit it prints `status: blocked`,
the reason and `fallback: team-builder` so the orchestrator can re-delegate.

Claude Code's Kairo status entry shows up to three active delegated agents and
counts any others. It shows the final routed model and clears when work ends.
When `showStatus` is disabled, the enabled `showBand` surface shows the work;
disabling both hides it. Quota values from `kairo team pacing` expire after two
minutes; other routing inputs retain their thirty-minute freshness limit.
