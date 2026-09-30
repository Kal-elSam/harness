# Analyst picker: fit ranking + honest absences

## Objective
Rank Bootstrap Analyst picker rows by analyst-profile fit (existing scores/tags), hide unusable models, and explain provider absences without inventing billing causes.

## Why
Capture showed only Codex; Claude missing with no honest reason. Preferred-adapter bias and auto-★ hid the real recommendation signal.

## Scope
- `src/global/host/project-team-sidecar.js` curation + picker notice
- `crates/kairo-ui` analyst picker (no auto-★) + wire preflight notice
- Soften team_attention copy that invented “no funds”
- Tests Node + Rust

## Out of scope
- Pi `get_state` timeout (separate)
- Changing `computeBootstrapAnalystCatalog` portfolio math

## Tasks
- [x] T1 Remove PREFERRED_ANALYST_ADAPTERS; rank by fit + evidence + name
- [x] T2 recommendedModel only when it survives filter (never models[0])
- [x] T3 Compact picker absence notice (e.g. Claude: no disponible…)
- [x] T4 Rust: drop auto-★; paint preflight notice on modal
- [x] T5 Honest team_attention (no invented funds)
- [x] T6 Tests + release rebuild

## Acceptance
- Eligible Claude can rank above Codex by tags/scores
- Ineligible Claude absent + compact notice, no disabled rows
- ★ only for real recommendedModel
- Confirm still revalidates availability

## Extension: usable `kairo` startup + analysis + team (approved 2026-09-30)

Branch `feat/kairo-startup-analyst-team` (worktree from c2382a261). No push, no merge, no #362 changes, no real-account use without authorization.
TDD: enabled (project strict TDD), runner `node --test <file>`; Rust `cargo test --manifest-path crates/kairo-ui/Cargo.toml`.
Route: delegated direct, one writer per unit (mapper evidence: 4+ files per unit).
Estimated delivery: ~600+ changed lines -> delivery strategy `ask-on-risk`; ask chain strategy before pushing (not authorized to push anyway).

- [x] T7 Startup: `session_start` no longer awaits usage/availability probes (index.js ~:789); probes run in background with `.catch`. Test with slow/never-resolving stubs. Do not raise the 8s timeout blindly; add late-get_state bridge test only to characterize. (commit 7ef366741)
- [x] T8 Unified analyst profile: `BOOTSTRAP_ANALYST_PROFILE` (project-strategy.js:65) = reasoning + coding + architecture + design; `buildAnalystPrompt` investigates languages/structure/deps/constraints/risks and justifies team with repo evidence. (commit 063071ba0). Finding: no `architecture`/`design` capability keys exist; mapped to reasoning+coding via focusAreas; a pool with thin coding evidence yields no recommendedModel.
- [ ] T9 OpenCode Go bootstrap analyzer adapter (read-only constraints, honest isolation level, no silent provider substitution, no auto-activation).
- [ ] T10 Exclusion causes (quota exhausted / unavailable verified -> exclude; unknown access and unscored != unavailable) plumbed into picker curation + notice. (Its "BLOCKED_ENTITLEMENTS unchanged" constraint is superseded for UNVERIFIED only by T20.)
- [x] T11 Rust modal: loading/error/exclusion states; cargo test. Modal opens in Loading on request, Error state with r retry / Esc close, per-provider exclusion cause lines (pickerNotice fallback when field absent); rpc stdio now forwards exclusionCauses. (commit: "feat(kairo-ui): show loading, error and exclusion causes in analyst modal"; hash in report)
- [ ] T12 (partial) Built host binary (dist/kairo-ui/darwin-arm64, Node 22, cargo release) and PTY smoke PASS (60x30, 100x30, 160x48). Local kairo NOT retargeted: awaits authorization, backup and rollback. Node 24 run and real-provider acceptance (T13) pending.
- [ ] T13 Human acceptance with real authorized provider (pending user; mocks never count as 100%).

Commits per task (evidence recorded below).

## Scope update (user-approved 2026-09-30): review findings + team presentation
Verified review findings: Go ask agent lacks webfetch/external_directory deny and mutates global opencode.json; ranking is tag/name based; prompt does not consume the shared profile; unscored/unverified models hidden. Corrections below reopen T9/T10 acceptance.
Assumptions (recorded): unscored-but-available models are selectable (lower evidence confidence, no star); unverified access stays excluded and shows as "verifying", never as missing quota.

- [x] T14 Go isolation: per-run inline OpenCode config via `OPENCODE_CONFIG_CONTENT` (no disk write, no global opencode.json mutation; beats project config in precedence), deny webfetch + external_directory (plus bash/edit/task/write), tests prove the generated config and an untouched global file in a temp HOME; isolation label stays `restricted`, canaryTested false (no real opencode run). (commit: in report)
- [x] T15 (commit: in report) Composite analyst fit: rank = profile fit (shared profile capabilities) + capabilities + benchmarks + evidence confidence; availability gates usability only; benchmark missing lowers confidence, not eligibility. Prompt and ranking consume ONE profile definition (derive prompt focus from BOOTSTRAP_ANALYST_PROFILE). Numeric fit exposed per candidate; no invented scores.
- [x] T16 Team presentation: incomplete or blocked team -> hide entire roles list (no partial team); complete + approved + validated -> show roles; saved assignments are never deleted. Projection `team.presentation = {state: complete|incomplete|blocked|verifying, rolesVisible, reason}` (src/global/conversation/team-presentation.js); Rust tolerant parse, absent => legacy visible; role edit refused while hidden. Store byte-identity tested. (commit: in report)
- [x] T17 Sidebar: compact incomplete-team notice + re-analyze action, reachable when Pi fails; "verification in progress" state that never claims missing quota. Re-analyze = existing `a` key and `/analyze` (bridge `project.preflight`, sidecar-driven, independent of Pi get_state); notices per state with `a = re-analyze` hint. (commit: in report)
- [x] T19 Remove the blind analyst fallback: `pickDefaultAnalyst` returns only the catalog recommendation when available and above MIN_RECOMMENDATION_CONFIDENCE (shared rule with the picker star), else null; `analyzeProjectTeam` returns `{status: "analyst_selection_required", message}` with no provider call or strategy mutation; sidecar emits `team{ok:false,status,reason}` and the Rust host shows the message. (commit: in report)
- [x] T20 (commit: in report) **Primary path superseded by T23 (verify first); the per-selection guard below stays only as a safety net.** Unverified-access analysts are selectable with revalidation (user decision 2026-09-30, option 2). **Supersedes T10's "BLOCKED_ENTITLEMENTS unchanged" for UNVERIFIED only**; DENIED stays excluded (`exclusions`, `unavailable_verified`) and `BLOCKED_ENTITLEMENTS` itself is unchanged for every other surface (team edit catalog, unscored list, router). Catalog entries gain additive `accessVerified` and `selectable`; an unverified row is `available:false, selectable:true, accessVerified:false, cause:"access_unknown"` (`available` stays "safe to run now"). Rails: never `recommendedModel`/tagged, never `pickDefaultAnalyst`, never `pickRecoveryAnalyst`, ranked after all verified rows (fit order inside its group), Spanish marker "acceso sin verificar". On confirm, `analyzeProjectTeam` calls `service.verifyAnalystAccess` (Claude: one `claude -p` entitlement probe of that model; Cursor: one `cursor-agent -p` probe of the model's pool, bypassing the snapshot cooldown) BEFORE `runBootstrapAnalysis`; failure/denial/no check -> `{status:"analyst_access_unverified", accessStatus, analyst, reason, message}` with no provider analysis, no strategy write, no substitution. Rust modal renders the marker and surfaces the new result as a notice. Known gap: unverified UNSCORED models stay hidden upstream (service.js unscoredModels filter).
- [x] T21a (commit 51b4cad83) Unattended recovery no longer blind-picks: `pickRecoveryAnalyst` drops `usable[0]`, applies the shared `recommendationQualifies` rule (moved to neutral `src/global/conversation/analyst-qualification.js`, re-exported by the sidecar) plus the `accessVerified !== false` guard; only quality/efficient-tagged qualifying models are picked. Nothing qualifies -> no analyzer call, previous team kept, record outcome `analyst_selection_required` (was `no-analyst`; non-terminal, bounded retries, so the sidebar notice and manual re-analyze (T16/T17) remain the path). RED observed (3 tests failed) before the fix, GREEN after; the T20 test that relied on an untagged pick was rewritten to tag it.
- [x] T21b.1 (commit 34f02ac63) `test/analyst-store-untouched.test.js`: real temp-dir strategy store, stubbed service. project-strategy.json is byte-identical after `analyst_selection_required` and after `analyst_access_unverified` (unverified, denied, throwing revalidation); analyzer, approve and substitution spies stay at zero. Mutation check observed: disabling the revalidation guard made the test fail.
- [x] T21b.2 (commit d35715bae) Wire-record proof, NOT a full end-to-end. Node side (`test/analyst-preflight-analyze-wire.test.js`) runs the real `runKairoUiRpcStdio` op loop with the real `preflightProjectTeam`/`analyzeProjectTeam` over PassThrough streams; the conversation service (catalog, revalidation probe, analysis spy) and the Pi child are fakes. The NDJSON is frozen in `crates/kairo-ui/fixtures/preflight-analyze-unverified.ndjson` (drift fails the Node test). Rust side (`preflight_then_analyze_wire_fixture_roundtrips_through_the_host`) drives the real host code: `request_analyst_preflight` and the picker Enter path write through `BridgeClient::send_op` into a recorder process (asserted equal to the fixture requests) and the fixture records go through `ingest_record`. Mutation check observed on the fixture. Unexercised: the real Rust-spawned Node process (stdio between them), a PTY/terminal render, and any real provider.
- [x] T22 (user-approved 2026-09-30) Selector fit/coherence pass. Commits: b81ee69cc, 788c9f627, 39c39d654, a967c20ed, f658eded6. Observed limits are listed under "T22 acceptance" below.
- [x] T23 (user-approved 2026-09-30, 'verify first') Discovery vs verification, consent, one ranking, top-three picker. Units: e5e1142db (discovery/verification split), d58fa1b64 (unified ranking/star), 74956c5ed (curation, plan, RPC op), 3477d7002 (Rust modal). Details and observed limits under "T23 acceptance".
- [ ] T24 (user-approved 2026-09-30) Correct the analyst recommendation: up to THREE DISTINCT models compared across every available subscription by aptitude for analyzing architecture and code; quality over cost/speed. Sub-items:
  - [x] T24.1 Explain the current ranking first (trace module + script + tests; finding in "T24 ranking trace").
  - [ ] T24.2 Shared evaluator replaces the analyst's own fit (required capabilities, comparable evidence, optional tie-break only; no quality x confidence).
  - [ ] T24.3 Project context from the existing local profile scan, used only to contextualize the explanation text.
  - [ ] T24.4 One classification: star, default and top-three distinct models derived from the catalog order without recalculation; equivalent routes to manual.
  - [ ] T24.5 Experience: why/what-differs explanations, probe progress in the Rust modal, per-subscription error summary, close-does-not-cancel.
  - [ ] T24.6 Behavioural tests (shuffle, optional data, duplicates, before/after verification, wire fixtures).
  - [ ] T24.7 PTY smoke that opens the analyst picker.
  - [ ] T24.8 Delivery: backup prev3, rebuild, identity check, suites Node 22/24 and cargo.
- [ ] T18 Node 24 run, list the 6 skipped tests, re-run build + PTY.
- [ ] T9/T10 re-accepted only after T14/T15 pass.

## Acceptance status (recorded 2026-09-30; T9/T10 NOT closed)
- T9 partial: per-run inline config (OPENCODE_CONFIG_CONTENT) with bash/edit/task/write/webfetch/external_directory denied is implemented and unit-tested. Real Go confinement is unverified (no real opencode run); isolation stays `restricted`, canaryTested false.
- T10 partial: verifiable exclusion causes are implemented. Unverified-access models are now selectable with revalidation (T20), but unverified-access models that are also unscored remain hidden (`unscoredModels` filter in conversation/service.js still uses BLOCKED_ENTITLEMENTS; changing it alters `/models --evidence`).
- Recovery gap: closed by T21a (recovery no longer blind-picks; unit-tested with stubs only, never run against a real provider).
- Unproven paths: byte-identical strategy file on analyst_selection_required / analyst_access_unverified is now asserted (T21b.1, stubbed service, real store). The Rust host <-> sidecar path is proven only as wire records (T21b.2): the Node sidecar and Rust host are each exercised for real but not connected to each other, and there is no PTY run or real-provider run. Still unproven: a live Rust-spawned sidecar process end to end.
- Provider calls: the T20 revalidation probe DOES call the provider (Claude: one real probe, about one cent when allowed; Cursor: one pool-access probe) and can consume account. "Does not start the analysis" does not mean "makes no calls". Only ever runs after the user confirms an unverified-access analyst.
- Still open: T12 deploy acceptance, T13 real-provider human acceptance, T18 remaining items.
- Local test link: `kairo` currently points at this worktree (backup and rollback in ~/.harness/relink-backup); this is a reversible trial, not accepted daily-driver install.

## T22 reuse audit (before coding; item -> already existed / gap)
| Item | Already existed | Gap implemented |
|---|---|---|
| Real evidence to selector | `computeAnalystFits` (project-strategy.js) already computed per-capability `computeCapabilityGapValue`, coverage, confidence, `fit`; `BOOTSTRAP_ANALYST_PROFILE`; sidecar carried `fit`/`confidence` | Values were dropped and absence became `fit: 0`. Now `fit: null` when no capability evidence, new additive `evidence {reasoning, coding, coverage}` (null = absent, measured 0 stays 0); unscored `fit: null`. Rust never read `fit`: now parses tolerantly (null/absent = unknown) and sorts unknown after known |
| Main view filter | `MIN_RECOMMENDATION_CONFIDENCE` + `recommendationQualifies` in `analyst-qualification.js`; `curateAnalystCatalogForPicker`; `accessVerified`/`selectable`/`available` flags | `qualifiesForMainView` (same neutral module): available AND `accessVerified !== false` AND numeric reasoning AND coding evidence AND valid confidence >= 0.5. No fit threshold. Short per-row `explanation` (sidecar) rendered by Rust |
| Manual alternatives | unscored models (`cause: "unscored"`) and T20 unverified-access rows already selectable; `service.verifyAnalystAccess` probe; byte-identical store test | Separate `alternatives` list + `m` toggle in the modal; unverified+unscored ("both") now reaches the catalog via new `modelIntelligence.analystUnscoredModels` (service.js; `unscoredModels`, `/models --evidence`, team edit catalog unchanged); never starred/tagged; explicit second confirmation (Rust warning state + sidecar `accessCheckConfirmed`; without it `analyst_access_confirmation_required`, no probe) |
| Identity / no loss | `candidateKey` already on every entry | Removed dedupe-by-displayName and the 16 cap from the picker only; Rust list scrolls (`visible_range`), footer stays visible |
| Sidebar/chat coherence | `deriveTeamPresentation` + Rust `team_presentation`/`roles_visible` (sidebar), `blocked_team_attention` (chat, per-role) | Chat banner now derived from the SAME presentation state (single line, no roles/models unless legacy/no presentation); verifying never says blocked/quota; editing gate relaxed for the Project view |
| Delivery | `build:kairo-ui`, `smoke:kairo-ui-pty`, relink-backup dir | Binary backup + `rollback-binary.sh`; rebuilt; identity check |

## T22 acceptance (observed 2026-09-30)
- RED/GREEN observed per unit (JS: 5 failing (evidence), module-load failure then 1 failing (views/confirmation), 2 failing (unverified+unscored), 1 failing (service list), 1 failing (rpc relay) before each fix; Rust render/banner/editor tests failed before implementation). The Rust picker STATE logic (views, warning, scroll) was written before its tests; it is covered by a mutation check instead (disabling the second-confirmation branch failed 7 tests, restored).
- New shapes: catalog entry `fit: number|null`, `evidence: {reasoning: number|null, coding: number|null, coverage: number|null}`; curated `analystCatalog: {recommendedModel, models /*main*/, alternatives /*manual*/}` with row additions `listing: "main"|"manual"`, `explanation: string`; analyze payload `analyst.accessCheckConfirmed: true` (only after the second Enter); new non-result `{status: "analyst_access_confirmation_required", analyst, message}` relayed as a `team{ok:false}` record.
- Chat banner states: verifying -> `Verifying team access…`; incomplete -> `Team incomplete — a to re-analyze[ · 2 to edit]`; blocked -> `Team blocked — a to re-analyze[ · 2 to edit]` (blocked keeps the sidebar's word instead of the brief's "incomplete" so both surfaces say the same thing); complete -> none; absent presentation -> legacy per-role CTA.
- Team editor: T16 deviation narrowed, not removed. The Project view (key `2`) already lists roles in its own pane; `begin_role_edit_for_selected` now allows editing there for a hidden SUGGESTED team (ACTIVE/STALE still read-only). Sidebar never lists roles while hidden; it shows `2 = edit team` for a suggested team. Remaining gap: reaching the editor needs the `2` key (not a clickable action) and the role list inside the Project view is unfiltered by presentation.
- Delivery: backup `~/.harness/relink-backup/kairo-ui.darwin-arm64.prev` (sha256 60b0c1ba...), restore with `~/.harness/relink-backup/rollback-binary.sh`. Rebuilt host binary sha256 472d33c7...; the path the global `kairo` resolves (`~/.local/bin/kairo` -> worktree `bin/kairo.js`, `resolvePrebuiltBinary`) is the freshly built `dist/kairo-ui/darwin-arm64/kairo-ui` (same sha256 and mtime).
- Suites: Node 22.23.0 2291 tests, 2286 pass, 0 fail, 5 skipped; Node 24.18.0 same counts; cargo 260 passed. The 5 skips: live Pi host test (needs `KAIRO_LIVE_PI_TEST=1`), and 4 clean-install/pack tests that need all four prebuilts (only darwin-arm64 exists). PTY smoke PASS at 60x30, 100x30, 160x48 but it drives a mock Pi with dialogs/tools only; it does NOT open the analyst picker.
- NOT observed: any real provider/probe/account; the picker rendered in a real PTY; the real Rust-spawned sidecar end to end. T10 can be re-evaluated only after a human uses the picker; T9/T10/T12/T13/T18 stay OPEN (T12 still lacks real-provider acceptance; T18 Node 24 suite now ran green but the human items remain).

## T23 reuse audit (before coding; item -> already existed / gap)
| Item | Already existed | Gap implemented |
|---|---|---|
| Probes | `probeClaudeModelEntitlements`, `probeCursorPoolAccess`, `mergeEntitlementResults`/`mergeCursorAccessResult` stores, `resolveClaudeEntitlements`/`resolveCursorPoolAccess` (TTL), `verifyAnalystAccess`, `verifyClaudeEntitlements` (`/models --verify-access`) | `snapshot()` used `resolveOrProbeCursorAccess` (spawned Cursor probes, plus a 30s in-memory cooldown). Replaced by `resolveCursorAccessFromCache` (persisted evidence only; expired = unverified, reason `stale`). Probe calls now live only in the new `verifyAccess` |
| Catalog/scoring | `computeAnalystFits`, `computeBootstrapAnalystCatalog`, `qualifiesForMainView`, `recommendationQualifies`, `accessVerified`/`selectable`, `candidateKey`, exclusion causes | Unchanged except the star: `recommendedModel` is now the first qualified row of the shared ranking (`compareAnalystRows`, moved to `analyst-qualification.js`), not the Explorer/Pareto pick; `quality` tag follows it |
| Picker | main/manual views, presentation state, `exclusionCauses` | main = top three (no padding), manual = remaining VERIFIED, unverified/denied/exhausted in neither list and reported by subscription (`access_unknown` worded as partial comparison); rows carry `subscription`/`label`; explanations are words (no decimals) |
| Wire | `project.preflight`, `project.analyze`, `preflight` record | additive `verificationPlan`, `unverifiedSubscriptions` on the preflight record; new op `project.verify_access`, new record `verification` |

## T23 acceptance (observed 2026-09-30)
- RED/GREEN observed per unit. JS: `access-verification.test.js` 12 of 13 failed before `planAccessVerification`/`verifyAccess`/cache-only discovery existed (the 13th, fresh-evidence reuse, already held), 13/13 after; `project-strategy.test.js` and `analyst-picker-verified.test.js` failed at module load (missing exports `compareAnalystRows`, `verifyProjectTeamAccess`) and passed after; the wire tests for `project.verify_access` failed (2) then passed. Rust: the new picker/plan/confirmation/verifying tests were written together with the code (compile-level RED only: the old warning/second-confirmation tests stopped compiling when their code was removed); behaviour is covered by the new tests and the replayed wire fixture, not by a per-test observed-failing assertion.
- New shapes. Preflight record (additive): `verificationPlan: {pendingCount, reusableCount, mayConsumeQuota, costStatement, subscriptions: [{adapterId, provider, granularity: "model"|"pool", pendingCount, reusableCount, checks: [{id, kind, modelId, pool?, models?, label, state: "pending"|"reusable", reason: "stale"|"never_verified"|null, cachedStatus: "allowed"|"denied"|null, age}]}]}`, `unverifiedSubscriptions: [{adapterId, provider, models, reason}]`. Op `{op: "project.verify_access", confirmed: true}` (anything but boolean `true` is refused without a probe). Record `{type: "verification", ok, status: "verified"|"confirmation_required"|"failed"|"unavailable", persisted, outcomes: [{adapterId, provider, granularity, results: [{id, label, status: "allowed"|"denied"|"unverified", reason, modelId, pool?}], counts: {allowed, denied, unverified}}], message}`, followed by a rebuilt `preflight` record when it ran. Service: `planAccessVerification({cwd})`, `verifyAccess({cwd, confirmed})`, `preflightProject(...).verificationPlan`.
- Probes still reachable: only `verifyAccess` (Claude per model, Cursor per pool, each at most once, persisted only when allowed/denied), the legacy `/models --verify-access`, and the T20 `verifyAnalystAccess` safety net (a crafted `project.analyze` for a still-unverified analyst; the Rust picker can no longer produce it). Snapshot, preflight and catalog mode spawn nothing (spy-tested for Claude and Cursor).
- Behaviour change to know: Cursor evidence older than 15 minutes (or never verified) is now `unverified`/`stale` everywhere a snapshot is read, including routing and the team sidebar, until a verification runs; nothing re-probes it in the background any more. Claude already behaved this way.
- Superseded tests rewritten on purpose: conversation-service (Cursor pool probes now run concurrently inside `verifyAccess`; snapshot polls never probe), analyst-picker-views (manual view, identity/no cap, sort, preflight expectations), project-team-sidecar (copy `no verificado — comparación parcial`, star derived from ranking, four T20 curate/causes tests), analyst-preflight-analyze-wire (T21b test kept as the safety-net check without a fixture; new verify fixture), and in Rust the warning/second-confirmation/unverified-marker tests plus the `preflight-analyze-unverified.ndjson` fixture (deleted, replaced by `verify-then-pick.ndjson`).
- NOT observed: any real provider/probe/account; the picker rendered in a real terminal or PTY (the PTY smoke does not open it); the real Rust-spawned sidecar talking to the real service. Wire proof is a replayed fixture plus unit tests.

## T24 ranking trace (observed 2026-09-30, BEFORE any ranking change)
Reproduce: `node scripts/trace-analyst-ranking.mjs` (real pipeline: `scoreAvailableModels` -> candidate catalog/pools -> `computeBootstrapAnalystCatalog` -> `curateAnalystCatalogForPicker`; no provider call, no probe). Benchmarks are the local Artificial Analysis snapshot fetched 2026-09-27..30 (`~/.harness/model-intelligence.json`, read-only); the controlled catalog (`CONTROLLED_TRACE_CATALOG`) mirrors real shapes: Codex, Claude Opus/Sonnet/Fable, Cursor effort re-exposures, the same model via Codex and Cursor, OpenCode Go. Access is stated (Fable denied, the rest allowed), never probed. Tests: `test/analyst-ranking-trace.test.js` with a verbatim excerpt of that snapshot (`test/fixtures/analyst-aa-excerpt.json`). Limit: the trace scores with the AA rows only (the product's registry may hold extra sources such as the Hugging Face leaderboard for some identities).

```
stage      pos star candidateKey                         slug                      fit    conf  reasoning coding  evidence(gpqa/hle/sci/int/cod)  note
main       1   *    codex::gpt-5-6-sol                   gpt-5-6-sol               0.606  0.917 0.718     0.571   0.941/0.495/0.571/47/77.4       
main       2        cursor::gpt-5-6-sol                  gpt-5-6-sol               0.606  0.917 0.718     0.571   0.941/0.495/0.571/47/77.4       
main       3        codex::gpt-5-5                       gpt-5-5                   0.599  0.917 0.697     0.558   0.935/0.458/0.558/38.4/74.9     
manual     1        cursor::gpt-5-6-sol-high             gpt-5-6-sol-high          0.593  0.917 0.694     0.578   0.928/0.46/0.578/42.3/77.2      
manual     2        codex::gpt-5-6-terra                 gpt-5-6-terra             0.58   0.917 0.677     0.55    0.925/0.429/0.55/42.1/76.7      
manual     3        claude::claude-opus-5                claude-opus-5             0.425  0.815 0.741     0.564   0.932/0.549/0.564/50.8/78       
manual     4        opencode-go::kimi-k3                 kimi-k3                   0.423  0.815 0.702     0.595   0.935/0.469/0.595/43.6/76.2     
manual     5        opencode-go::glm-5-3                 glm-5-3                   0.411  0.815 0.67      0.59    0.917/0.423/0.59/44.8/74.8      
manual     6        claude::claude-sonnet-5              claude-sonnet-5           0.393  0.815 0.662     0.543   0.911/0.413/0.543/38.2/71.5     
manual     7        opencode-go::deepseek-v4-pro         deepseek-v4-pro           0.384  0.815 0.669     0.51    0.928/0.41/0.51/36/68.8         
manual     8        cursor::claude-opus-5-thinking-high  -                         -      0.25  -         -       -/-/-/-/-                       unscored (no AA match)
manual     9        cursor::claude-sonnet-5-thinking-high -                         -      0.25  -         -       -/-/-/-/-                       unscored (no AA match)
excluded   -        claude::claude-fable-5-1             claude-fable-5-1          -      -     -         -       0.937/0.591/0.631/53.4/81.6     access denied (verified)
excluded   -        claude::claude-opus-4-8              claude-opus-4-8           -      -     -         -       0.92/0.487/0.544/41.8/74.3      superseded by a newer generation in the same lineage
```

Findings (each verified by the trace or a counterfactual test, not assumed):
1. **Opus 5 / Sonnet 5 are not low on capability.** Claude Opus 5 has the highest measured reasoning magnitude in the controlled set (0.741 vs 0.718 for Codex Sol) and coding 0.564 vs 0.571; yet it ends 6th overall (manual #3), Sonnet 5 9th. The only input that separates them is `fit = profileFit x confidence`: confidence is 0.917 for the Codex rows and 0.815 for Claude/OpenCode rows.
2. **Cause = data trigger + code amplification.** Data: AA publishes `ifBench` (the optional `instructionFollowing` capability in `BOOTSTRAP_ANALYST_PROFILE`) for the Codex models only (Sol 0.727, 5.5 0.759, Terra 0.712); it is null for Opus 5, Sonnet 5, Kimi K3, GLM 5.3 and DeepSeek V4 Pro. Code (`computeAnalystFits`, project-strategy.js): a missing OPTIONAL capability (a) lowers `coverage` and therefore `confidence`, (b) stays in the `totalWeight` denominator so it also lowers `profileFit`, and (c) `fit = profileFit x confidence` multiplies both, plus it averages absolute magnitudes of different benchmarks. So an absent optional datum is punished like incapacity twice. Counterfactual test (`BASELINE cause`): nulling `ifBench` on every row moves Opus 5 into the main view.
3. **Duplicated evidence takes two slots.** `codex::gpt-5-6-sol` and `cursor::gpt-5-6-sol` carry the identical AA row (same slug, same numbers) and occupy main positions 1 and 2, so the "top three" contains two models. Code: `curateAnalystCatalogForPicker` dedupes by `candidateKey`, which differs by adapter; nothing collapses the same model across subscriptions, and the percentile/fit pool counts the duplicated evidence twice.
4. **Data gap, not code: Cursor's `claude-opus-5-thinking-high` / `claude-sonnet-5-thinking-high` are UNSCORED** (no AA slug match for those ids), so they can only be manual. The repo does not define them as equivalent to AA's `claude-opus-5-high`; no equivalence was invented.
5. Correct exclusions (code is right): `claude-fable-5-1` denied (verified), `claude-opus-4-8` superseded by generation 5 of the same lineage.
6. Not a cause: availability, access verification, Codex-over-Claude preference (none exists), input order.

Conclusion: the main cause is CODE (optional data penalized, magnitudes mixed and multiplied by confidence, no cross-subscription identity), triggered by an asymmetric DATA gap; the Cursor effort ids are a pure data gap. T24.2-T24.4 address the code causes only.
