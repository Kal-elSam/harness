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
- [x] T20 (commit: in report) Unverified-access analysts are selectable with revalidation (user decision 2026-09-30, option 2). **Supersedes T10's "BLOCKED_ENTITLEMENTS unchanged" for UNVERIFIED only**; DENIED stays excluded (`exclusions`, `unavailable_verified`) and `BLOCKED_ENTITLEMENTS` itself is unchanged for every other surface (team edit catalog, unscored list, router). Catalog entries gain additive `accessVerified` and `selectable`; an unverified row is `available:false, selectable:true, accessVerified:false, cause:"access_unknown"` (`available` stays "safe to run now"). Rails: never `recommendedModel`/tagged, never `pickDefaultAnalyst`, never `pickRecoveryAnalyst`, ranked after all verified rows (fit order inside its group), Spanish marker "acceso sin verificar". On confirm, `analyzeProjectTeam` calls `service.verifyAnalystAccess` (Claude: one `claude -p` entitlement probe of that model; Cursor: one `cursor-agent -p` probe of the model's pool, bypassing the snapshot cooldown) BEFORE `runBootstrapAnalysis`; failure/denial/no check -> `{status:"analyst_access_unverified", accessStatus, analyst, reason, message}` with no provider analysis, no strategy write, no substitution. Rust modal renders the marker and surfaces the new result as a notice. Known gap: unverified UNSCORED models stay hidden upstream (service.js unscoredModels filter).
- [x] T21a (commit 51b4cad83) Unattended recovery no longer blind-picks: `pickRecoveryAnalyst` drops `usable[0]`, applies the shared `recommendationQualifies` rule (moved to neutral `src/global/conversation/analyst-qualification.js`, re-exported by the sidecar) plus the `accessVerified !== false` guard; only quality/efficient-tagged qualifying models are picked. Nothing qualifies -> no analyzer call, previous team kept, record outcome `analyst_selection_required` (was `no-analyst`; non-terminal, bounded retries, so the sidebar notice and manual re-analyze (T16/T17) remain the path). RED observed (3 tests failed) before the fix, GREEN after; the T20 test that relied on an untagged pick was rewritten to tag it.
- [x] T21b.1 (commit 34f02ac63) `test/analyst-store-untouched.test.js`: real temp-dir strategy store, stubbed service. project-strategy.json is byte-identical after `analyst_selection_required` and after `analyst_access_unverified` (unverified, denied, throwing revalidation); analyzer, approve and substitution spies stay at zero. Mutation check observed: disabling the revalidation guard made the test fail.
- [x] T21b.2 (commit d35715bae) Wire-record proof, NOT a full end-to-end. Node side (`test/analyst-preflight-analyze-wire.test.js`) runs the real `runKairoUiRpcStdio` op loop with the real `preflightProjectTeam`/`analyzeProjectTeam` over PassThrough streams; the conversation service (catalog, revalidation probe, analysis spy) and the Pi child are fakes. The NDJSON is frozen in `crates/kairo-ui/fixtures/preflight-analyze-unverified.ndjson` (drift fails the Node test). Rust side (`preflight_then_analyze_wire_fixture_roundtrips_through_the_host`) drives the real host code: `request_analyst_preflight` and the picker Enter path write through `BridgeClient::send_op` into a recorder process (asserted equal to the fixture requests) and the fixture records go through `ingest_record`. Mutation check observed on the fixture. Unexercised: the real Rust-spawned Node process (stdio between them), a PTY/terminal render, and any real provider.
- [x] T22 (user-approved 2026-09-30) Selector fit/coherence pass. Commits: b81ee69cc, 788c9f627, 39c39d654, a967c20ed, f658eded6. Observed limits are listed under "T22 acceptance" below.
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
