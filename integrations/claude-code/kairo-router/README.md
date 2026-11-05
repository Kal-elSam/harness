# Kairo router

On the first prompt of each session without a routing plan, the router calls
`kairo team onboarding --json --cwd DIR`. Kairo asks whether to analyze a project
without an approved team, review a suggested team, re-analyze a stale team, or
initialize Git for a non-Git directory. The assistant asks before other work;
analysis uses the user's chosen analyst and requires separate team approval.
Declining suppresses further asks for that session. An active team adds no ask.
Failures never block prompts, and later prompts retain the standard planning
reminder. Session start resets the first-prompt flag.

The Kairo pane shows provider quota and reset times, the routing plan, running delegations, and pending verdicts. Stale quota data is marked. Use `/kairo-pane` to toggle the pane; supported fullscreen surfaces open it automatically. Unavailable sources are shown as unavailable and do not prevent prompts or delegations.

A routed Agent call shows who runs the work on its task card: `Role · model (provider) — task`. Every launch except the exact gentle-ai actors (`review-*`, `jd-*`) is routed; text such as `[no-redirect]` in a prompt or field has no effect. The spinner names who is working: the running delegation, or else the orchestrator with its session model (`Orchestrator · claude-opus-5-5 (claude) — Running Bash`), and adds `<provider> CRITICAL` while a provider's quota pacing is critical. It never shows generic stage words or random verbs.

The orchestrator delegates file writes to the owning role through the Agent tool: main-thread edit tools and recognized Bash file-write patterns are denied, while delegated writes and Bash redirection to temporary scratch paths or /dev/null remain allowed.

When a route lands on a Claude model, the Agent call receives the matching Agent-tool alias (`sonnet`, `opus`, `haiku` or `fable`) because the tool rejects full model ids. An alias cannot pin an exact version (`claude-haiku-4-5-20251001` runs as `haiku`); the ledger and pane still show the real routed id. A routed id with no alias leaves the agent's own model and shows one toast.

## Delivery ownership (0.8.0)

The main session delegates delivery to the **Deliverer** role with the Agent tool. Its Bash guard denies `git push` (including global options such as `git -C DIR push`), `gh pr create`, `edit`, `merge`, `ready`, `comment`, and `gh release create`. Shell wrappers and compound commands use the same parser as the file-write guard; heredoc bodies remain data.

`git commit`, read-only GitHub commands (`gh pr view`, `list`, `checks`, and `gh api` GET), and subagent delivery calls remain allowed. This is a command-pattern guard, not a shell sandbox or remote-operation authorization.

## Task correlation

An exact prompt line `Kairo-Task-Id: <id>` carries an existing Architect task identity into launch, outcome, and routing trace rows without changing the prompt or routing decision. Repeated identical markers are accepted; distinct markers are recorded as invalid. The core, not the hook or trace payload, validates the task using the Architect store.

New launch and outcome rows contain `taskId`, `taskIdStatus`, and `executionId`. Task status is `linked`, `absent`, `invalid`, `not_found`, or `unreadable`; only `linked` carries a non-null task id. Each hook launch reuses its trace id as the execution id, including background outcomes; a handover gets a new execution id. Identity failures never block work.

`kairo team record-launch` and `record-outcome` accept `--task-id ID` and `--execution-id ID`. External execution ids use 8–64 letters, digits, or hyphens. Missing or malformed launch execution ids get a UUID; outcomes store null instead of inventing a correlation. `kairo team exec --task-id ID` overrides the stdin task marker. Its first attempt reuses a valid stdin `Kairo-Execution-Id: ID` marker, or generates a UUID when the marker is missing, malformed, or ambiguous. Each retry gets a new UUID, even with `--no-record`, and its trace links to the first attempt through `parentExecutionId`.

Plan executions append one best-effort `architect` routing trace, using the existing run id verbatim (the internal `run_*` format), and never add launch ledger rows. Reused executions add no trace. The trace schema remains `kairo.routing-trace/v2`. Legacy rows remain readable; verdict rows, attribution keys, ranking inputs, and distribution counts ignore the new columns.

## Execution evidence

The trace observes, the Launch Ledger accounts, and the Router decides. Transport
wrappers receive `Kairo-Execution-Id: ID` directly after their `kairo-model` line;
other launches receive no execution marker. Hook, executor, and outcome traces
share that execution id. A handover gets its own id and links to the first launch
through `parentExecutionId`. These are additive fields on `kairo.routing-trace/v2`,
not new ledger columns or routing inputs.

Every started launch has a best-effort `outcome` trace when a result or host stop
is observed, including launches without a usable route or catalog role. Foreground
outcomes are `completed`, `failed`, `exhausted`, or `unknown`. Background stop events
write `stopped`, never `completed`: they prove only that the host agent stopped;
a wrapper's child process may still run. The existing ledger `completed` value on
that path is a known advisory. A dead session synthesizes no outcome.

The core computes `governance` from the project role catalog and decision, ignoring
payload governance: `denied`, `governed` for exec/architect, or, for hook,
observation, and outcome rows, `observable` outside the catalog, then `override`,
`degraded` for invalid/absent decisions, or `governed`. An unreadable catalog gives
null. `team-verifier` remains trace-only; SendMessage correlation remains out of
scope. Trace failures never alter accounting, quota, Pacing, or route selection.
