Evidence for odd/tasks/router-provider-authority.md (spec and tasks live there). Experimental results, measurements and snapshots go here.

## Preflight result: PREFLIGHT_PASS_WITH_C7_FINDING

Run 2026-11-04, UTC stamp 20261104T180451Z, output directory `/Users/kal-el/kairo-t1/preflight-20261104T180451Z`, kept outside version control. Run by the user from an independent terminal; an earlier run failed C2 because two Claude sessions, this session and the OpenCode service were running, and OpenCode was stopped for the run.

| Check | Status | Evidence |
| --- | --- | --- |
| C1 session variables | PASS | no agent variables |
| C2 processes | PASS | no matching processes |
| C3 manifest M1 | PASS | 69761 entries |
| C4 idle 120s | PASS | M2 identical to M1, c4-changed-paths.txt empty |
| C5 isolation | PASS | isolated HARNESS_HOME reports no pending verdicts while live has pending ones; lines=1 exit=0 |
| C6 live auth | PASS | claude logged in with subscription; codex exit 0 with ChatGPT |
| C7 isolated auth | PASS as recorded, finding: CLAUDE_CONFIG_DIR no, CODEX_HOME no, isolated HOME no for both providers |
| C8 manifest M3 | PASS | identical to M2, c8-changed-paths.txt empty |
| C9 hooks | PASS | Codex UserPromptSubmit mentions kairo or pacing; no Claude settings event does, but plugin hooks are not in that file |

C7 PASS only means the table was recorded; it is not a claim that isolated authentication works, and no isolated environment currently keeps authentication. This shows stability at rest over 120 seconds for the listed roots; it does not cover provider transcripts, sessions, logs or Keychain, does not measure quota, and says nothing about hooks during a model run. No model was run.

### Isolation options from CLI help, not yet tested (2026-11-04)

- Codex: `exec --ignore-user-config` states it does not load config.toml and that auth still uses CODEX_HOME; `--disable FEATURE` disables a feature, and `codex features list` shows hooks as stable and enabled. So real subscription auth with hooks disabled looks possible without a second login. Whether hooks.json is honored under these flags is untested.
- Claude: `--bare` skips hooks and plugins but restricts auth to an API key and skips keychain reads, so it is rejected under S31. `--safe-mode` disables hooks, plugins and customizations; its effect on subscription auth is untested. `--restricted` ignores user settings and removes code-running tools unless named. `--setting-sources` selects sources; plugin behavior under it is untested.
- The repository probe adapters do not pass these flags, so using them would need a scratch runner outside the product, with no product code change.
- A separate login in an isolated config directory is an alternative; not needed unless flags fail.

## T1 findings

Status 2026-11-04: partial. T1 is not closed. Static inspection only; no probes, refresh, or exploit tests were run. Findings below are proposals; none is an approved requirement until the user accepts it.

### Inventory corrections

- `claude-hooks.js:82` row is wrong as stated: that line tells orchestrators not to follow nextWriter. Its consumers are `pacing-cli.js:131` and `hosts/pacing-context.js:32`.
- `project-router.js:357-361` moved to 357-368.
- `register.ts` row 671-689 also covers 665-666.

### New inventory rows

All paths under `src/global` unless a path says otherwise.

| Location | Fixed item | Effect | Severity | Handling |
|---|---|---|---|---|
| team/team-exec.js:128-174 | caller-chosen provider and model | admission checks executability only, no Router decision | P0 | require a Router-issued authorization |
| team/team-exec.js:104-125,186-200 | capacity retry | re-routes through the Router, same provider first, records a failed outcome; explorer called this a silent switch and the parent check did not confirm that; user visibility still unverified | P1 | align with D12 and trace |
| intelligence/role-registry.js:492-510 | frontier labor gate | source of the Builder rejection for frontier models | P0 | keep per OD1, exception at launch |
| intelligence/frontier-reference.js:6-72 | frozen Q3 cutoff 54.5 | decides which models are frontier | P0 | see Builder eligibility |
| team/routing-input-cache.js:212-214 | Builders take cheapest qualified model | price-first rule conflicts with S4 | P1 | T8 |
| hosts/claude-kit.js:191-192 | KIT_PARITY maps builder agents | fixed agent identity | P1 | verify it resolves to the Router model |
| hosts/pacing-context.js:32; team/pacing-cli.js:131 | nextWriter text | advisory consumers | P1 | advisory only or remove |
| integrations/claude-code/kairo-router/hooks/register.ts:64 | second Sonnet downgrade | duplicate of 753 | P1 | one Router decision |
| intelligence/router.js:174-226; runtime/run-profile.js:15 | preferred backend and model; default model | runtime path outside the team Router | P1 | scope decision |
| hosts/claude-code.js:15; intelligence/types.js:21-22; fleet-shared.js:14-16,43; fleet-models.js:58; fleet-configure-plan.js:19; intelligence/execution-router.js:348; repo-template/docs/ai/provider-routing.md:9-20,48-70 | pins and defaults, usage not verified in depth | unknown | P2 | verify |

Not covered by this pass: execution adapters and hosts for other providers were only searched for model literals; service.js, routing-input-cache.js, launch-ledger.js, claude-odd-bridge.js, gentle-role-map.js, team-apply.js and roles-cli.js were not read in full.

### Builder eligibility (S11)

Floor .55 (`role-demand.js:16-20`); roleFitScore is measuredQuality.successRate, else 1 on an owned evidence pass, else gapValue (`role-demand.js:242-245`). Frontier is a value at or above cutoff 54.5, using the live catalog index against the frozen reference (`frontier-reference.js:63-71`).

| Candidate | Live index | Reference index | Gate | Verdict |
|---|---|---|---|---|
| gpt-6-astra | 56.9 | 56.9 | frontier labor | excluded by rule |
| gpt-6.1-sol | 54.6 | 54.5 | frontier labor | excluded by rule |
| claude-opus-5-5 | 59.1 | 58.4 | frontier labor | excluded by rule |
| claude-sonnet-5-5 | 54.5 | 54.2 | frontier labor | calibration suspect: non-frontier in the frozen reference, frontier only because the live index drifted to the cutoff |
| gpt-6.1-terra | 51.3 | 51 | unqualified | evidence missing |
| gpt-6-luna | 27.9 | 27.8 | unqualified | evidence missing; owned evidence store holds a builder.apply-fix-v1 pass, not confirmed as production-enabling, and the route still reports unqualified |
| claude-haiku-5-5 | 36.5 | 36.2 | unqualified | evidence missing |
| claude-haiku-4-5-20251001 | none found | none | unqualified | evidence missing; owned evidence holds an error record for claude-haiku-4-5, which is not proof of low quality |

The routing input cache generated 2026-11-03 has Frontend Builder and Backend Builder but no Builder entry and no values for these candidates, so it predates the v2 role catalog. Whether that stale cache alone explains unqualified is unverified. Measurement ran partly under a Codex host, which hid Claude candidates. Non-frontier models can qualify under the rules; no floor change is supported yet. Live values come from the local model intelligence cache.

### Offline eligibility measurement (2026-11-04)

This subsection supersedes the earlier statements about a routing cache dated 2026-11-03 and missing Builder entry, which described another project key. No model, probe, refresh or network call was run. Builder requires coding, terminalExecution and agenticExecution; floor .55.

| Candidate | sciCode | terminalBenchV4 | Missing | gapValue | roleFitScore | Owned pass | Result |
|---|---:|---:|---|---:|---:|---|---|
| gpt-6.1-terra | .551 | .556 | agentic | .519 | .519 | no | below floor; route says unqualified |
| gpt-6-luna | .546 | .126 | agentic | .363 | 1 | yes | qualifies on score; route says unqualified |
| claude-haiku-5-5 | .550 | .328 | agentic | .437 | .437 | no | below floor |
| claude-haiku-4-5-20251001 | none | terminalBenchHard .273 | coding, agentic | .359 | .359 | no | below floor; retained registry values, no current AA row |
| gpt-6-astra | not reported | .591 | agentic | .593 | .593 | no | frontier labor |
| gpt-6.1-sol | .542 | .561 | agentic | .515 | .515 | no | below floor and frontier labor |
| claude-opus-5-5 | .669 | .596 | agentic | .610 | .610 | no | frontier labor |
| claude-sonnet-5-5 | .610 | .636 | agentic | .586 | .586 | no | frontier labor; above floor |

Concrete rejection causes:

- **Verified:** The missing-signal penalty is .10 times share missing (`role-demand.js:268-276`), so .033 here. Every candidate lacks agenticExecution in the cached signals, so all pay it. Calculation by parent: Terra without the penalty is about .553, above the floor by about .003; this margin is too small to conclude anything.
- **Inference, strong, from code read by the parent:** The stored approved Builder is claude/claude-sonnet-5-5, so `project-router.js:324-342` sets builderProvider to claude and bandAllowed (`305-309`) reports codex candidates as unqualified at line 387. So for Terra and Luna the route message reflects root cause A, not quality.
- **Verified code risk:** In `model-intelligence.js:2297-2300` any accepted owned pass moves qualification to the owned path, where only owned competitors compete. Luna has one operational pass of one fixture, dated 2026-10-20, scored 1, with terminalBenchV4 .126. Lifting root cause A alone could make Luna the sole qualified Builder on that single run, conflicting with S21-local. Needs a fix decision before T4 and T5.
- **Refuted:** Null composite indices alone cause the rejections; nulling them left gaps unchanged. Reported by the Technical Lead.
- **Reported by the Technical Lead, not re-verified by the parent:** On missing split-role cache data the route returns a stale approved assignment without applying frontier compatibility.

### Refresh side effects

`kairo team route --refresh` can write `manual-picks-ledger.json`, `routing-input-cache.json`, `codex-models-last-good.json`, `model-intelligence.json`, usage samples, `project-strategy.json`, `team-reform.json` and refresh locks, and calls provider usage, catalog and auth surfaces plus Artificial Analysis. No isolating flag exists. Automatic triggers: stale inputs in team pacing, team pacing `--no-wait`, the statusline, and the Claude Router hooks calling team pacing (`pacing-cli.js:82-97`; `background-refresh.js:27-46`; `statusline-cli.js:65-76`; `register.ts:269-274,558,728`). Observed 2026-11-04: this project's routing input cache was rewritten at 17:41:21Z, after the user's decision, without anyone running refresh; `project-strategy.json` and `team-reform.json` were last changed 2026-10-28, so no re-form happened today. Route flips seen in this session are consistent with this and not proven to be caused by it. Therefore S27 condition 1 cannot be guaranteed on live state while these automatic paths run; isolated evaluation must set both `HOME` and `HARNESS_HOME`, and even that does not sandbox provider processes.

### Artificial Analysis (S29)

Reader `src/global/observability/artificial-analysis-models.js`; credential `ARTIFICIAL_ANALYSIS_API_KEY` is configured; cache `model-intelligence.json` fetched 2026-11-04T16:15:07Z; no durable daily request limiter in the reader. For Terra, Luna and Haiku 5.5, cached populated fields are `intelligenceIndex`, `hle`, `sciCode` and `terminalBenchV4`; coding, math and agentic composites are null. That AA stopped publishing them is the user's report from its documentation, not established from local data. Published token prices are not subscription consumption.

### Evaluation budget

Suspended by S50; retained as history only.

Superseded in part by D14 and S34: the API-equivalent figures below are informational and authorize nothing; budget must be stated in subscription quota units, and these are not yet measured. Proposal awaiting user approval: the builder probe is one fixture in a temporary workspace (workspace separation, not an OS sandbox); evidence can go to an isolated home; usage fields are nullable; planner default 200,000 tokens per call is an estimate, not an enforced cap. Pilot: 2 distinct tasks per candidate for Terra, Luna and Haiku 5.5, no retries, 300 second timeout per call: 6 calls, about 1.2M estimated tokens, about 2.40 USD API-equivalent, 30 minutes maximum. Instrumentation value only. Coarse comparison: 20 paired tasks per candidate: 60 calls, about 12M tokens, about 24 USD API-equivalent, 5 hours maximum, about plus or minus 20 points of uncertainty; needs new fixtures. Subscription quota cannot be derived from these figures, and no hard consumption guarantee exists. Filesystem snapshots cannot restore provider quota, remote logs or keychain effects. Parent observation 2026-11-04: the Codex 5h window fell from 97 to 41 percent during this session, mostly coinciding with a 19-minute gpt-6-astra read-only analysis. Not attributed per run.

### Task limits (A2)

Two ledgers, 379 Builder events, 2026-10-27 to 2026-11-04 (125 launch, 123 outcome, 131 verdict). No task id, duration, or usage fields, so attempts and consumption per task are not measurable. No numeric limits proposed. T2 must capture task id, attempt identity and count, start and end, observed usage with unknown kept as unknown, rework, outcome.

### Governance check (S23, S24, S26)

Conclusion: governance can be bypassed today; that overrides and frontier exceptions cannot evade governance is not established. Parent confirmed items 1, 3 and the --no-record part of 5 in code; others are static reading by the reviewer.

1. Critical. `[no-redirect]` in any string argument of a launch skips routing, with no human identity, scope, expiry or single use (`register.ts:630-633,731-734`); the prompt-submit form stores a boolean not consumed after one delegation (538-541). The orchestrator can write it itself and did during this feature, following the current fallback rule.
2. Critical. `team exec` with caller-chosen provider and model escapes Router decision, budget and independence (`team-exec.js:128-174`); provider CLIs through Bash are not guarded (`register.ts:71-72,128-153,498-503`); Bash guards are skipped for subagents (499-503). Nested launch availability and non-Claude hosts unverified.
3. High. `team verdict --result pass` verifies no reviewer, provider independence, artifact, task or revision (`launch-ledger.js:217-249`); record-outcome accepts a caller result (175-181).
4. High. The escalation budget counts decision admissions, not launches (`escalation-budget.js:9-73`; `escalation.js:7-30`). Consumed on record; no refund; no idempotency key; retry after cleanup failure can double charge; missing file means empty budget; one authorization can be reused for several direct launches. A1 reuse alone does not govern frontier labor.
5. High. The launch ledger is mutable JSONL (`launch-ledger.js:47-89`); recording errors are swallowed (`register.ts:696-703`); gentle actors skip accounting (623); `team exec --no-record` trusts the caller (`team-exec.js:168-170`).
6. High. Gentle actor passthrough by name (`register.ts:8,623`), explicit model preference (42-58,737-747), admission failing open (324-331).

Limit: same-user writable files cannot give tamper resistance against that user's processes; a hook cannot govern a caller holding direct provider execution. The threat model must be chosen.


## Dry run and validator review (2026-11-04)

- DRY_RUN_PASS, as reported by the user: codex-cli 0.166.0; hooks feature false under `--disable hooks`; login exit 0 with ChatGPT; `gpt-6-luna` present by exact id; untouched fixture verdict fail; quota observed at 2026-11-04T18:21:14Z: 5h 39 percent, weekly 79 percent. No model ran. The script changed afterwards when the validator sandbox was hardened; the new self-test P6b has not run in the quiet window yet, and runs before any launch.
- Scripts live outside version control in `/Users/kal-el/kairo-t1` (`run-luna-once.sh`, `probe-helper.mjs`).
- Validator review: it imports the model-edited file in-process and runs `node --test` (`role-aptitude-validators.js:44-54,126-133`). The earlier profile would have allowed reading the home directory and running other programs. Hardened: `env -i` outside the sandbox with a fake `HOME` and `TMPDIR`; writes only to `val-tmp`, `val-home`, the workspace and `/dev/null`; reads of `/Users/kal-el` denied except the listed repository, output and node paths; `process-exec` only for the real node binary; network denied.
- Hostile test in scratch, reported by the writer: read `.codex/auth.json`, read `.claude.json`, list `.ssh`, write to the home, write to `/private/tmp`, spawn `security`, `launchctl`, `open`, `curl`, `sh`, connect `1.1.1.1:443`, connect to a live unix socket: all denied. Legitimate validation still distinguishes untouched (fail) from fixed (pass).
- Residual limits: allow default remains, so mach services and system paths outside the home stay reachable; not proof against every macOS escape. Hostile code still ran, as intended, under the policy.
- Finding: Kairo inspects providers outside the team. `kairo team providers` shows cursor and opencode-go as configured false, yet refresh runs opencode stats (`opencode-usage.js:122`) and cursor-agent models. The OpenCode service restarted at 12:22:03 local, the same second a Claude session resumed; causation is inferred, not reproduced. `CursorUIViewService` is an Apple text input service, unrelated to Cursor. User statement, verbatim: "opencode y cursor estan fuera , no se poer que se sigue nejecutando sus procedeso y servicios, no los necsito por ahora, estamo sunciametne con claude y codex"


## Model inventory and offline matrix (2026-11-04)

Source: cached files only (.codex/models_cache.json, codex-models-last-good.json, claude-entitlement.json, routing cache, kairo team verify-access without refresh, cached AA from 2026-11-04T16:15:07Z). No model ran. Access for Codex is catalog evidence, not an execution probe; Runnable is not established.

### Table A — discovered catalog

| Model | Provider | Access | In routing | Reason |
| --- | --- | --- | --- | --- |
| gpt-6.1-sol, gpt-6-astra, gpt-6.1-terra, gpt-6-luna | codex | catalog | yes | - |
| gpt-6-sol, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna | codex | catalog | no | superseded |
| gpt-6-chat-thinking, gpt-reserve, codex-auto-review | codex | no evidence | no | hidden |
| claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, claude-haiku-4-5-20251001 | claude | probe allowed | yes | - |
| claude-opus-5, claude-sonnet-5, claude-opus-4-8, claude-opus-4-7, claude-opus-4-6 | claude | probe allowed | no | superseded |
| claude-sonnet-4-6 | claude | evidence expired | no | superseded |
| claude-haiku-4-5 | claude | probe allowed | no | alias of the dated id |
| claude-fable-5-1, claude-fable-5 | claude | denied, requires usage credits | no | denied |

Totals: 24 discovered, 8 routed. The count of 16 omitted matches exactly (10 superseded, 3 hidden, 2 denied, 1 alias); superseded status was not checked model by model. Fable stays excluded under S31.

### Table B — cached capability and fit

Fit is the computed value with the current policy when no candidate in the pool has agentic evidence.

| Model | Index | Frontier status | Missing | Fit | Clears .55 |
| --- | ---: | --- | --- | ---: | --- |
| gpt-6-astra | 56.9 | frontier | agentic | .627 | yes |
| gpt-6.1-sol | 54.6 | frontier | agentic | .549 | no |
| gpt-6.1-terra | 51.3 | non_frontier | agentic | .553 | yes |
| gpt-6-sol | 44.2 | non_frontier | agentic | .527 | no |
| gpt-6-luna | 27.9 | non_frontier | agentic | .396 | no, before owned pass |
| gpt-5.6-sol | none | capability_unverified | agentic | .595 | yes |
| gpt-5.6-terra | 32.3 | non_frontier | agentic | .574 | yes |
| gpt-5.6-luna | none | capability_unverified | agentic | .510 | no |
| claude-opus-5-5 | 59.1 | frontier | agentic | .643 | yes |
| claude-sonnet-5-5 | 54.5 | frontier by tie, 54.2 in reference | agentic | .619 | yes |
| claude-haiku-5-5 | 36.5 | non_frontier | agentic | .471 | no |
| claude-opus-5 | none | capability_unverified | agentic | .609 | yes |
| claude-sonnet-5 | none | capability_unverified | agentic | .518 | no |
| claude-haiku-4-5-20251001 | none | capability_unverified | coding, agentic | .393 | no |
| claude-opus-4-8 | none | capability_unverified | agentic | .540 | no |
| claude-opus-4-7 | none | capability_unverified | coding, agentic | .798 | yes, artifact, see P19 |
| claude-opus-4-6 | none | capability_unverified | coding, agentic | .452 | no |
| claude-sonnet-4-6 | none | capability_unverified | coding, agentic | .429 | no |

### Notes

- Discrepancy: the earlier Technical Lead pass reported Terra .519, Astra .593, Sol .515, Sonnet .586 with a .033 penalty; this pass reports them without it. The code at model-intelligence.js:459-468 drops the penalty only when no model in the given pool has the signal, so the difference points to different pools. Inferred, not reproduced. Which pool live qualification uses is unverified; routing-input-cache.js:209 passes configuredModels, which suggests the team pool. If so, Terra's unqualified status comes from provider reservation alone.
- These values stayed the same between the 8-model and 18-model pools, because the gap is an absolute magnitude (capability-scoring.js:378-449). A runner reported this; the penalty rule above is the exception.
- Reading by provider, with verified non-frontier status and clearing the floor: Codex has gpt-6.1-terra and gpt-5.6-terra. Claude has none; claude-sonnet-5-5 depends on P6.
- Scratch retained at /private/tmp/builder-aa.3JDvkb.

## Model Discovery check (2026-11-04)

Read-only check of the user's proposal against code and CLI help. No model ran.

- Artificial Analysis client exists: src/global/observability/artificial-analysis-models.js, keyed by ARTIFICIAL_ANALYSIS_API_KEY. One refresh is one legacy request plus one request per documented page, no retries (lines 176-178).
- Current cadence is not weekly: in-process TTL is 6 hours (src/global/team/service.js:655). The cache read fetchedAt 2026-11-04T16:15:07Z, about 3.5 hours old at check time. What refreshed it was not traced. Weekly cadence requires changing this path.
- Rate limit conflict, unresolved: the user's text says 100 requests per 24 hours for Free v2. https://artificialanalysis.ai/api-reference says "The API is rate-limited to 1,000 requests per day." No v2-specific page could be fetched. A weekly refresh stays under either figure.
- Claude has no machine-readable catalog: src/global/observability/claude-models.js:1-16 is a hand-maintained documented catalog, and /model is interactive. A new Claude model cannot be discovered from the CLI. Artificial Analysis can signal it; it stays pending verification (S57).
- Codex: Kairo reads the catalog by spawning codex app-server (src/global/observability/codex-models.js:42). codex debug models exists; per its help, --bundled skips refresh and dumps only the catalog shipped with the binary, so it does not prove account access. Whether these start secondary processes was not tested; neither was run.
- frontierEvidence (src/global/intelligence/frontier-reference.js:67-72) compares the value it receives, today the live index. The frozen pool holds values for 12 models only, so P6 needs a defined result for new models: P18 and P20 make them not eligible until an approved snapshot.
- Once the Router reads only approved snapshots, live oscillation cannot reach it; hysteresis then acts only when a new snapshot is proposed.
- src/global/intelligence/model-capability-registry.js exists as an evidence store with no Discovered to Assigned states.
- No general scheduler found: a search for launchd, crontab, LaunchAgent and setInterval hits only src/global/cli-help.js and src/global/runtime/monitor/monitor-platform.js. The weekly trigger is open in P20.

## T2 review warnings (2026-11-04)

Native four-lens review of 00a7f7247, regenerated because acknowledgement of the earlier runs burned their artifacts; these are not proven to be the same warnings as those runs. The review classed all as informational; the classes below are the parent's, against S60 and S64.

| Finding | Location | Class | State |
|---|---|---|---|
| R4-unbounded-stale-lock-spin, R3-001 | routing-trace.js:69 | Blocker: team exec could hang at full CPU after the task ended | Fixed in c59f25a35, tested |
| R3-002 handover reported no fallback | register.ts:879 | Relevant | Fixed, tested |
| R2-evidence-definition-mismatch | cli-reference.md:1385 | Relevant | Fixed in docs: confirmed means exit code 0 |
| R3-004 hook pacing shape unproved | register.ts:821 | Relevant | Fixed, tested |
| R2-stale-ledger-advisories, R3-005 | feature document L22 | Relevant | Superseded by L23 |
| R3-003 payload parsed for other team commands | cli.js:1010 | Relevant | Fixed, differential identical |
| R2-undocumented-trace-retention | routing-trace.js:12 | Informational | Documented, 8 days |
| R2-exec-selected-means-previous | team-exec.js:184 | Informational | Documented |
| R4-killed-writer-blackout | routing-trace.js:74-84 | Relevant | Open, accepted: a killed writer can lose trace rows for up to 30 seconds; launches continue and the session toast fires only once |
| Stale-lock race inside R3-001 | routing-trace.js:69 | Informational | Open: two writers can briefly both hold the lock; worst effect is an interleaved or lost trace row |
| R2-claude-alias-duplication | routing-trace.js:44 | Informational | Open |
| R2-trace-launch-opaque-derivation | register.ts:812-819 | Informational | Open |
| R2-unexplained-initial-schema-version | routing-trace.js:49 | Informational | Open: real v1 rows exist in the user's home and expire by retention |

## Plugin installation check (2026-11-04)

Read-only comparison. The active plugin is kairo-router 0.7.5 at commit e71135588, from marketplace repo Kal-elSam/harness on GitHub. The repo declares 0.8.0. Against 0.7.5, the T2 base adds: a guard denying git push and gh delivery commands from the main session, rtk unwrapping in that guard, and an orchestrator and cell tree in the pane and prompt context. Those are new enforcement and display, not new routing decisions. T2 adds only record-trace emission; a search of the hook found no project-strategy write, refresh, rebuild or apply. A marketplace update reads GitHub, and this branch is not pushed, so it would not carry T2; installing T2 needs a local source or a push. The plugin version was not bumped by T2.

## T2 final review warnings (2026-11-04)

Native four-lens review of f99585a35: approved, zero blockers by the review and by the parent's reading against S60 and S64. All 11 findings are open; none was fixed in this round.

| Finding | Location | Class | Consequence |
|---|---|---|---|
| R3-hook-candidate-mapping-unproved | register.ts:816-818 | Relevant | No test proves populated candidates and rejections reach the hook payload |
| R4-trace-warning-latch | register.ts:626 | Relevant | After the first failure toast, later trace failures in the session give no signal; launches unaffected |
| R2-handover-selected-doc-scope | cli-reference.md:1385 | Relevant | Docs describe selected holding the previous attempt for exec only; hook handover does the same |
| R3-retention-unproved | routing-trace.js:78-80 | Relevant | The 8-day prune and rewrite has no test |
| R3-wall-clock-test-flake | routing-trace.test.js:228 | Relevant | 1400 ms and 1500 ms limits over a whole CLI run can fail under load |
| R2-rawroute-last-read-coupling | register.ts:671 | Informational | Handover row fields can mix route reads |
| R2-tracelaunch-selected-param | register.ts:808 | Informational | Parameter name invites swapping selection and execution |
| R2-trace-launch-opaque-derivation | register.ts:812-814 | Informational | Uncommented precedence rules |
| R2-claude-alias-duplication | routing-trace.js:44 | Informational | Family list repeated three times |
| R2-unexplained-trace-constants | routing-trace.js:12-16 | Informational | No rationale on values |
| R2-unexplained-initial-schema-version | routing-trace.js:49 | Informational | v2 with no v1 note in code |

## Installation manifest, kairo-router 0.7.5 to candidate (2026-11-04)

Base: active 0.7.5, commit e71135588. Candidate: 0.8.0 on feat/router-provider-authority at 256ae4855. Changed plugin files: register.ts, register.test.ts, README.md, and the version in plugin.json. hooks.json, pane.ts, types and the other tests are identical. The userConfig options do not change.

| Feature | Origin | Effect | Decides routing | Revert |
|---|---|---|---|---|
| Delivery guard: main session denied git push, gh pr create, edit, merge, ready, comment and gh release create; subagents allowed | dcb0e22f8 | New denial; delivery goes through the Deliverer role | No | Session-only: close the session |
| rtk unwrapping in the guard scan, also for sh -c | 04e23f4f5 | rtk-wrapped writes and delivery in the main session are now denied too | No | Same |
| Orchestrator and cell tree in pane and prompt context | 387bb92cc | Display and prompt text change; prompt context grows | No | Same |
| Routing trace: record-trace on each Agent launch, bounded failure toast at 1, 5, 25, 125 | T2 commits | One background process per launch, 2 second timeout, never awaited; appends routing-trace.jsonl | No | Same |

Not in the plugin: the global kairo link follows this checkout, so team exec traces are already written. If the checkout leaves this branch, record-trace is missing and the hook only shows the failure toast.

Installation path: claude --plugin-dir pointing at integrations/claude-code/kairo-router. Per https://code.claude.com/docs/en/plugins/loading.md the local plugin replaces the same-named installed plugin for that session only; both are not loaded, and claude plugin list still shows the installed row. It writes no global configuration by this path. Rollback: close the session; the next ordinary session loads 0.7.5. Verification: checksums of the three global plugin configuration files, taken before and compared after. Not verified until run: the claim that this leaves those files unchanged. A permanent install has no documented version pin or rollback per the plugin CLI reference, and is not proposed here.

Limitation: this path brings the three non-T2 features for that session. A T2-only build would need a separate backport onto 0.7.5.

## T2 session validation (2026-11-04)

Baseline taken at 16:25 local, commit 487084d80, worktree clean. Paths under the home directory.

| File | sha256 |
|---|---|
| .claude/plugins/installed_plugins.json | e2eacc829c9c445bac391de157b3b898a7223d65ca3a78a3e9e72943db62f723 |
| .claude/plugins/known_marketplaces.json | f1be526ccf9cbfc5ae33099bbf3b0ef1669aaf25f34cdd7c14212eea86b5d7f1 |
| .claude/settings.json | 73e699e5d7e6f1f7aca1f810d7f7c5bab809fcafc5631bed99f5151848b09fff |
| .harness/sessions/dfd01812152434aa/project-strategy.json | 3857d58727d32c1d4517310079db36677df9d96a4da64d603a654df3598a073a |
| .harness/sessions/dfd01812152434aa/team-reform.json | dd3f715c34cc75bf91373d3c30f788fd508ead90f9c595c49b877856930066ae |

routing-trace.jsonl had 13 rows, 0 with source hook. Active sessions on 0.7.5 cannot emit source hook rows, so any such row comes from the validation session. Growth of routing-trace.jsonl and launch-ledger.jsonl is expected.

Checklist for the validation session:
1. Plugin: the prompt context shows Master Orchestrator and Team tree exactly once.
2. Guard: git push --help from the main session is denied with the Deliverer message. Nothing reaches a remote.
3. Use only a delegation already needed. No invented task, no benchmark.
4. Duplicates: that delegation adds exactly one source hook row and one launch row in the ledger. Two rows for one launch stops the validation.
5. The source hook row: record selectedProvider, selectedModel, candidates, rejectionReasons, routingDecision, effectiveLaunch, fallbackDetected, quotaSnapshot, role. A field that does not apply is recorded as not applicable. Handover not forced; if absent it stays proven only by tests.
6. The launched agent and model match the printed route, or fallbackDetected reports the difference.
7. Close the session, start one without --plugin-dir, confirm the old format returns, and compare all five checksums. A change in project-strategy.json or team-reform.json needs an explanation before acceptance; an unrelated change by another active session is possible, so close other sessions first where practical.

## T2 session validation, partial results (2026-11-04, about 16:35 local)

Reported by the user from the validation session (PID 93079, --plugin-dir). Items 4 to 7 are still open; the rows for items 4 to 6 were not received.

| Item | Result | Evidence |
|---|---|---|
| 1 Plugin context | Pass | Master Orchestrator and Team tree appear once; hook reports kairo-router 0.8.0 loaded while 0.7.5 stays installed |
| 2 Guard | Pass | git push --help denied with the Deliverer message; the command never ran |
| 3 Real delegation only | Holds | No delegation was needed, so none was launched |
| 4-6 | Open | No source hook row yet: routing-trace.jsonl has 15 rows, 0 with source hook; launch-ledger.jsonl unchanged at 566 rows |
| 7 Close and compare | Pending | See the checksum note below |

No stop condition fired: no duplicate row, no team re-form, no routing difference. project-strategy.json and team-reform.json are unchanged since 11:42 on 2026-11-04 and their hashes equal the baseline.

Findings, classified by the parent against S60, S64 and S66:

| Finding | Class | Parent's reading |
|---|---|---|
| tsconfig.json untracked in integrations/claude-code/kairo-router, created at 16:33:52, one second after the session start | Informational | Contents: extends ./.claude-plugin/types/tsconfig.json, which exists. The installed 0.7.5 cache has no such file. Timing points to the --plugin-dir load; cause not proven. Keep it out of commits. |
| Builder route is WAIT_FOR_PROJECT_TEAM and the tree shows unknown (unknown), waiting until unknown | Baseline, not a T2 difference | The 0.7.5 session of the user shows the same row; this is the T1 Builder finding (causes A, B, C). A Builder delegation launches the pinned agent, as before T2; the trace should then show kind invalid or absent with fallbackDetected true. Declared expected, not a stop condition, by the parent; the user decides. A role that routes gives a cleaner row. |
| routing-input-cache.json changed at 16:34 and 16:35, no --refresh run | Baseline, unattributed | Routing inputs refresh from the prompt hooks and pacing when stale, with a 30 minute TTL. Which session wrote it is not provable. record-trace does not touch it (read in code and review). Not a stop condition. |
| Guard denied a read-only python3 heredoc with the write message | Baseline | The 0.7.5 guard denied the same class of command earlier in the parent session. Not caused by the candidate. A known false positive of the guard heuristic. |
| Another session active in the same checkout | Resolved | It is the parent session, PID 12871, which is also a writer. |

Checksum note: ~/.claude/settings.json changed from the baseline hash 73e699e5d7e6f1f7aca1f810d7f7c5bab809fcafc5631bed99f5151848b09fff to 2e28039d95d9dee7c80bf61c56253ed34dc24a8a7af417521ac14c58e2986618, modified 16:34:41. The cause is the user running /model in the parent session, which saved the default model; the file now contains the line "model": "sonnet". No copy of the earlier file exists, so that the model line is the only difference is not verified. For item 7, treat 2e28039d95d9dee7 as the expected settings hash, not the baseline. installed_plugins.json and known_marketplaces.json equal the baseline.

## T2 session validation, final results (2026-11-04)

| Item | Result | Evidence |
|---|---|---|
| 4 Duplicates | Pass | 1 source hook row and 1 launch row for the Explorer delegation at 2026-11-04T22:56:11Z, 6 ms apart |
| 5 Source hook row | Pass | All fields present; handover not applicable |
| 6 Agent and model match the route | FAIL | See below |
| 7 Close and compare | Pass | Plugin session closed; the old format returned in a session without the flag; all five hashes equal the baseline taken at 16:59:50 local. settings.json returned to the baseline 73e699e5 through the user's /model to Opus, which replaces the 2e28039d expected hash |

Item 6 failure (MODEL_IDENTITY_MISMATCH). Route selected claude-haiku-4-5-20251001. The Agent tool received the alias haiku (subagent meta.json has model haiku). The subagent transcript shows claude-haiku-5-5 in 27 of 27 assistant messages. Ledger launch and outcome rows record claude-haiku-4-5-20251001. The trace says fallbackDetected false because routing-trace.js line 44 treats an alias plus the same family as equivalent. effectiveLaunch.evidence is requested. register.ts line 717 records route.targetModel. Claude Code docs (code.claude.com/docs/en/sub-agents.md, verified): the Agent call model parameter accepts only sonnet, opus, haiku, fable; frontmatter accepts full ids; the per-invocation value beats frontmatter. An alias therefore never proves a version.

Ledger count 566 to 558: explained as 566 plus 2 appended minus 10 pruned by the 8 day retention (launch-ledger.js lines 16 and 67-73). The file birth time 16:57:04 shows an atomic rewrite, and the first row is 19 s after the cutoff. The 10 deleted rows have no copy, so their contents are not verified.

Explorer verdict: not registered, by the user's decision.

