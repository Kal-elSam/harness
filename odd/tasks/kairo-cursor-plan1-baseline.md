# Kairo Cursor Plan 1 — clean Ratatui+analyst baseline

Locator: `odd/tasks/kairo-cursor-plan1-baseline.md`
Worktree: `agentic-harness-worktrees/kairo-plan1-baseline`
Branch: `feat/kairo-cursor-baseline`
Engram mirror: `odd/kairo-cursor-plan1-baseline/tasks` (project `harness`)

## Objective

Establish a clean integration baseline from Ratatui and preserve analyst T28/T29 so Claude can build native setup/Ops depth on a shared hash. Cursor owns integration.

## Problem

`feat/ratatui-host` and `feat/kairo-startup-analyst-team` diverged (125/199). Herd-shell dirty WIP must not be pulled in. Cockpit/Ink must stay retired; Pi `.5` stays the RPC engine.

## Scope

### In
1. Baseline merge: Ratatui base + analyst T28/T29 (eligible assignment, revalidated approve, analysis progress, team proposal).
2. Integrated tests: analyst→analyze→propose→approve→chat; access loss→recovery→approve/reject; sessions/drafts/restore.
3. Later: integrate Claude finished commits; full suites; package validation (separate auth for real provider / push / PR).

### Out
- herd-shell session-handoff / context-fill dirty tree
- Restoring cockpit/Ink product UI
- Push, PR, merge, publish without separate authorization

## Constraints

- Rust = only interactive UI (`kairo`/`start`/`resume`/`ui`/`shell`)
- Pi fork `0.87.1-kairo.5` = RPC engine only
- Conflict resolution: prefer analyst for picker/team/UI conflicts; never reintroduce retired product UIs

## Tasks

- [x] P1-T1 — Merge analyst into Ratatui baseline; resolve conflicts; deliver base hash to Claude
- [x] P1-T2 — Integrated tests (Rust UI ↔ real sidecar; label simulations) — re-validated after Claude U1–U3 + placeholder fix
- [x] P1-T3 — Integrate Claude commits; full suites; record failures honestly — **reopened** for `50f9b4984`, then closed
- [x] P1-T4 — Final package validation evidence (binaries, columns, Windows CLI) — **re-run required** after placeholder fix; done on post-fix HEAD

## Routing

- P1-T1: delegated-direct writer (merge touches many files; parent owns strategy)
- Route: delegated | Trigger: writer (2+ non-trivial) + preparation

## TDD

Mode: unknown for this integration branch — run focused then full applicable suites; do not invent RED for merge-only port.

## Acceptance (P1-T1)

- Entries `kairo`, `start`, `resume`, `ui`, `shell` coherent
- Analyst + team work from Rust
- Base commit hash published for Claude


## Progress / evidence

### P1-T1 — Merge baseline

- Base: `feat/ratatui-host` @ `4fd5e277e`
- Integrated: `feat/kairo-startup-analyst-team` @ `87f063eec`
- Conflict policy: took analyst (`--theirs`) for all 19 conflicted paths after verifying Rust UI function set is a superset (0 ratatui-only fns in `main.rs`) and deletions replace the old simple picker.
- Preserved: Pi `0.87.1-kairo.5`; CLI `kairo`/`ui`/`start`/`resume`/`shell` → `launchRatatuiHost`; retired cockpit/Pi opt-outs still throw.
- Dropped expired `.npmrc` Pi.5 cooldown exclude (past 2026-09-29).
- Did **not** import herd-shell dirty WIP (session-handoff / context-fill).
- Merge commit / base hash for Claude: `84d7f8573df91d2c41b587b81c8281a52fbcb99e`
- Focused Node: 212/212 pass (`team-presentation`, `project-strategy`, `project-analysis`, `project-team-sidecar`, analyst picker/access, `team-recovery`)
- `cargo test -p kairo-ui`: 295/295 pass (includes T28 analysis_progress tests)


### P1-T1 follow-up — pre-existing analyst test drift

- `conversation-service` bootstrap assertion still expected Explorer+Architect floor; T29 keeps analyst-justified roles only → assert `["Architect"]`.
- Regenerated `crates/kairo-ui/fixtures/verify-then-pick.ndjson` after aptitude explanation text drift (`UPDATE_WIRE_FIXTURE=1`); Rust `preflight_verify_wire_fixture_roundtrips_through_the_host` pass.
- These two failures already reproduced on pure `feat/kairo-startup-analyst-team` before the merge; not introduced by conflict resolution.


### P1-T2 — Integrated analyst→approve→chat and recovery approve/reject

- Did **not** edit Claude-owned impl: `settings-sidecar.js`, `ops-sidecar.js`, `kairo-ui-rpc-stdio.js`, `setup.js`, ops/settings panels.
- Real providers: not invoked (authorization not granted); every simulation labeled `SIMULATED` in tests/scripts.
- Node integrated (REAL `runKairoUiRpcStdio`): `test/plan1-analyst-chat-recovery-integrated.test.js` — 4/4
  - analyst→analyze→proposal→approve→chat
  - recovery.preview→apply
  - recovery.preview→reject
  - draft stop→restore
- Extension E2E reject path: `test/team-auto-recovery-e2e.test.js` (+reject keeps prior Go team)
- PTY Rust↔sidecar (SIMULATED providers): `scripts/kairo-ui-team-flow-pty-e2e.py` + fixture
  - approve-chat, recovery-reject, recovery-apply @ 100×30 — all PASS
- Smoke script: `package.json` → `smoke:kairo-ui-team-flow-pty`


### P1-T2 precision (post-review)

- Integrated tests use the **real sidecar** (`runKairoUiRpcStdio`) but **SIMULATE** Pi, analysis/approval bodies, recovery decisions, and chat answers.
- They prove wiring + navigation (ops, notices, set_model, prompt routing), **not** full real-provider / real-analyst behavior.
- Published Pi RPC cold start (no model) was later **VERIFIED by Claude** and fixed (`50f9b4984` / `287d34342`) — see P1-T3 reopen. Real **provider** runs remain pending specific authorization. Packaged-host no-model path is a separate open check.


### P1-T2 expand — multi-size / resize / real draft store / reject+cancel

Expanded without touching Claude-owned impl. Host Darwin arm64, binary `dist/kairo-ui/darwin-arm64/kairo-ui`.

| Check | Result | REAL vs SIMULATED |
|---|---|---|
| Node `plan1-analyst-chat-recovery-integrated` | 4/4 | REAL sidecar op loop; SIMULATED Pi/analysis/recovery/chat + in-memory draft store |
| Node `plan1-session-draft-real-store` | 1/1 | REAL `saveDraft`/`loadDraft` → `draft.json` under temp `HARNESS_HOME`; SIMULATED Pi only |
| Node `team-auto-recovery-e2e` (+reject) | 4/4 relevant | SIMULATED eligibility; reject keeps prior Go team |
| PTY `approve-chat` @60/100/160 | PASS | REAL Rust PTY + sidecar; SIMULATED team/chat |
| PTY `recovery-reject` @60/100/160 | PASS | reject: no `set_model`, no apply — prior team kept |
| PTY `recovery-apply` @60/100/160 | PASS | SIMULATED apply body |
| PTY `recovery-cancel` @60/100/160 | PASS | Esc: neither apply nor reject; no `set_model` |
| PTY `resize-preserve` 100→60→100 | PASS | content + editor input survive SIGWINCH |
| PTY `draft-restore` stop→restart | PASS | REAL `draft.json` under isolated HOME+`KAIRO_SESSION_ID`; never user `~/.harness` |

Evidence dir: `/tmp/kairo-pty-team-flow-p1t2/`. Smoke: `pnpm smoke:kairo-ui-team-flow-pty`.

Test gotchas (not product defects): empty-compose chrome steals leading `r`/`R` (markers must avoid hotkeys); Node harness needs a short post-ready delay before `stop`+`stdin.end` or the op can race the readline attach.

P1-T2 re-validated after Claude U1–U3 (see P1-T3). No Claude files edited during expand; no real providers.


### P1-T3 — Integrate Claude U1–U3 (preserve Cursor corrections)

Cherry-picked onto `feat/kairo-cursor-baseline` (after `62c10da4d` P1-T2 expand), preserving Cursor commits `567f53406` (T29 conversation-service + wire fixture) and Plan1 integrated/PTY tests:

| Claude commit | Content | Local hash |
|---|---|---|
| `f30f4c2c0` | ops.runs.show / ops.reviews.show + Rust detail | `8c92505ac` |
| `10dd3bd02` | settings.setup load/preview/apply | `54841de81` |
| `a066e4fd3` | native Setup flow in Settings | `3becaba09` |
| `3d5945702` | Pi startup stderr in engine reason | `2cc8a16ed` |

Conflicts: only `odd/tasks/kairo-parity.md` (modify/delete + content) — took Claude; synced closing notes from `7b1d064c2`. **Zero** overlap with Cursor post-base source files.

Post-integrate suites (this tree, not Claude's old base):

| Suite | Result |
|---|---|
| `cargo test -p kairo-ui` | **331/331** |
| Focused Claude+Plan1 Node (ops/settings/pi/plan1/recovery/conversation) | **257/257** |
| `pnpm test` full Node | **2422 pass / 4 fail / 1 skip** (2427 tests) |
| P1-T2 expanded PTY (rebuilt binary) | **PASS** — evidence `/tmp/kairo-pty-team-flow-post-u2/` |

#### Investigation of the failures that remain after integrate

Claude's closing note claimed **6** Node failures identical on base `56c530cf2`. On **this integrated HEAD**, the same four-file probe yields **4 fail / 122 pass** (not 6):

| # | Test | File | Symptom on integrated HEAD | Root cause |
|---|---|---|---|---|
| — | (conversation-service bootstrap roles) | `test/conversation-service.test.js` | **PASS** | Fixed earlier by Cursor `567f53406` (T29 Architect-only) — no longer a failure |
| — | (analyst-preflight-analyze-wire T23/T24) | `test/analyst-preflight-analyze-wire.test.js` | **PASS** | Not failing on integrated HEAD |
| 1 | ONE classification: catalog/picker/default/main agree | `analyst-catalog-evaluation.test.js:135` | `TypeError: null.candidateKey` | **Stale vs T27**: `curateAnalystCatalogForPicker` always returns `recommendedModel: null` (no star); test still reads `curated.recommendedModel.candidateKey` |
| 2 | trace reports… controlled catalog | `analyst-ranking-trace.test.js:11` | `starred.length` 0≠1 | Trace stars via `curated.recommendedModel` → always null after T27 |
| 3 | after T24: Sol ONE main slot / Opus in main three | `analyst-ranking-trace.test.js:30` | `main.length` 12≠3 | T27 flat list: all usable routes are `stage:"main"` (no top-3); Cursor effort ids + both Sol routes appear in main |
| 4 | after T24: Cursor effort ids manual-only | `analyst-ranking-trace.test.js:51` | stage `'main'≠'manual'` | Same T27 flat-list: unscored-but-available effort ids are listed in main with `qualification:"no_evidence"`, not parked in manual |

**Verdict:** product behavior matches **T27** (`project-team-sidecar.js` flat list, no star). The four failures were **stale assertions** for the pre-T27 top-3/star contract, not regressions from Claude U1–U3. Later rewritten in `7377b45c9` (order/identity/evidence kept).


### P1-T3 reopen — placeholder `no_model` fix + T27 test rewrite

`4344e8427` lacked Claude's follow-up `50f9b4984` (Pi placeholder model `unknown/unknown/unknown` must classify as `no_model`). Prior package evidence did **not** certify that fix.

| Step | Result |
|---|---|
| Cherry-pick `50f9b4984` | local `287d34342` — `classifyPiEngineFromState` + pi-rpc-bridge test |
| Rewrite 4 stale tests to T27 | `7377b45c9` — keep order/identity/evidence; no star / flat list / effort ids in main tail |
| Sync Claude cold-start docs | `ec444354c` ← `75f54aecc` (parity tracker + `docs/ai/kairo-parity-provider-plan.md`) |
| `cargo test -p kairo-ui` | **331/331** |
| `pnpm test` | **2427 pass / 0 fail / 1 skip** (live Pi) |
| P1-T2 expanded PTY | **PASS** — `/tmp/kairo-pty-after-placeholder/` |
| Packaging re-run | 4/4 prebuilts; clean-install PASS; Windows fail-closed; v3-capture 52; mock PTY 60/100/160 PASS |

#### Published Pi cold start — VERIFIED (Claude; not pending auth)

Claude already ran the **published** `@kal-elsam/kairo-pi-coding-agent@0.87.1-kairo.5` cold start (user-authorized 2026-10-01, local only): `--mode rpc --no-session --offline`, isolated temp HOME/`PI_CODING_AGENT_DIR`, scrubbed env (no keys, no network). Observed: `get_state` → placeholder `{id,provider,api:"unknown"}` (not null); `prompt` → `success:false` "No API key found…". Gap: classifier treated placeholder as `connected`. Fix `50f9b4984` / integrated `287d34342`. Item (a) = **VERIFIED/FIXED**. Do **not** keep marking this as pending authorization.

That evidence is **not** the same as: launching the **integrated, packaged Kairo host** (prebuilt `kairo-ui` + sidecar) with no model selected and observing end-to-end `no_model` UI. That packaged-host check remains a separate, still-open item below.

#### Still open (close evidence / delivery — no new features)

| Item | Status |
|---|---|
| Real provider basic `OK` (Codex/Claude/OpenCode Go) | **PASS** (Claude evidence in `docs/ai/kairo-parity-provider-plan.md`; do not re-run) | Cursor provider still pending; error/tool/thinking paths pending; ≠ packaged product with approved team |
| Packaged integrated host, no model (prebuilt binary path) | **PASS SIMULATED Pi** + **PASS REAL published Pi offline** (auth 2026-10-01) | Reason observed: **No active strategy…** (blocks chat without active team — not approved-team+usable-provider). Evidence `/tmp/kairo-acceptance-prep/packaged-no-model(-real-pi)/`; missing Pi → exit 2; temp proj `git init` for extension |
| Human visual acceptance of the **product** (not fixtures) | Open | Fixture HTML reviewable separately; product accept still pending |
| Foreign-platform package exec (darwin-x64 / linux-*) | Selection PASS; runtime exec still needs Rosetta / Linux-or-qemu hosts |
| Native review consent | U1/U2 **declined** (stand); **U3 approved + acknowledged** | Not pending consent |
| Stderr redaction (`23ec9c4d9`) | **Integrated** on this branch | Surfaces/redacts Pi startup stderr; revalidate package after |

#### Acceptance pack (isolated; no credentials / no network)

Command: `pnpm prepare:acceptance-evidence` (or `bash scripts/prepare-kairo-acceptance-evidence.sh`).

Latest local pack: `/tmp/kairo-acceptance-prep/`

| Artifact | Purpose |
|---|---|
| `ACCEPTANCE.md` | How to review |
| `packaged-no-model/*/screen.after-ready.txt` | SIMULATED-Pi pack: host shows `Chat blocked: no_model` |
| `packaged-no-model/*/sidecar.log` | REAL classifier + stdio; mode `SIMULATED_PI_PLACEHOLDER_CHILD` |
| `v3-visual/*.html` (52 files) | Fixture review only — not product visual acceptance |

**Packaged check labeling:** default run = integración con Pi **simulado**. Does **not** certify published Pi. Real variant: `KAIRO_PACKAGED_NO_MODEL_REAL_PI=1` → published CLI + `--offline` + temp HOME; if CLI missing → **fail** (exit 2), never silent fallback to simulation. Authorization for that real run is requested separately (not auto-executed).

Simulated/PTY/Node green ≠ complete validation. A PASS certifies the observed scenario only — not every state sharing the `no_model` label. Remaining: real providers, human product visual, foreign-platform exec.


### P1-T4 — Final package validation (post-placeholder fix)

Re-run on HEAD that includes `50f9b4984` + T27 test rewrite. Host Darwin arm64. **No publish / push / PR.** Prior packaging on `4344e8427` is **invalidated** for the placeholder fix.

| Check | Result | Limit |
|---|---|---|
| `scripts/build-kairo-ui-binaries.sh` | 4/4: darwin-arm64 ~1.7M, darwin-x64 ~1.8M, linux-arm64 ~1.4M, linux-x64 ~1.6M | gitignored; not published |
| `scripts/verify-kairo-ui-clean-install.sh` | PASS (hand-staged + npm-pack) | Foreign exec gaps: darwin-x64 Rosetta; linux-* Linux/qemu |
| `test/kairo-ui-prebuilt` + `launch-ratatui-host` | PASS (incl. Windows fail-closed) | — |
| Host `--v3-capture` | exit 0, **52** fixtures (60/100/160) | auto; not human visual approval |
| Mock PTY @60/100/160 | PASS | mock sidecar |
| P1-T2 team-flow PTY | PASS | SIMULATED providers |
| Published Pi RPC cold start (no session.model) | **VERIFIED by Claude** → fix `287d34342` | Not pending auth; see P1-T3 reopen |
| Packaged integrated host, no model (prebuilt path) | **PASS SIMULATED** + **PASS REAL published Pi offline** | Reason: **No active strategy…** (not approved-team+provider); evidence `packaged-no-model-real-pi/`; git init in temp proj |
| Real providers (adapter happy path) | Codex/Claude/OpenCode Go **PASS**; Cursor pending | Do not re-run Claudes OK evidence; packaged approved-team path still open |
| Human visual (v3 fixtures) | Fixture verdict available | Product visual acceptance still separate |
| U3 native review | **approved + acknowledged** | U1/U2 remain declined |
| Stderr redaction | **`23ec9c4d9` / `d41e0c6a9` integrated** | Revalidated below |

#### Post-stderr package revalidation (`1efd3b7e8` + `d41e0c6a9`, Darwin arm64)

| Check | Result |
|---|---|
| `node --test` pi-rpc-bridge + kairo-ui-rpc-stdio + run-redact | **126/126 PASS** |
| `node --test` kairo-ui-prebuilt + packaged-verify | **15/15 PASS** |
| `cargo test` kairo-ui | **331/331 PASS** |
| `pnpm verify:kairo-ui-clean-install` | **PASS** (foreign exec gaps unchanged) |
| `smoke:kairo-packaged-no-model` (SIMULATED Pi) | **PASS** |
| REAL published Pi offline (prior auth) | **PASS** — reason **No active strategy…** only |

Binaries unchanged by the JS stderr fix; clean-install re-proved selection + host `--v3-capture`. Remaining open: real providers, human product visual, foreign-platform exec, approved-team+usable-provider path.

### P1-T4 — historical note (pre-placeholder; superseded)

Observed on `feat/kairo-cursor-baseline` @ `79771262a` (+ this docs commit), host Darwin arm64. **Do not declare P1-T4 closed.** Re-run the same checks on the final package after Claude U2+ integration.

| Check | Result | Limit |
|---|---|---|
| `scripts/build-kairo-ui-binaries.sh` | 4/4 keys built: darwin-arm64 (~1.7M Mach-O), darwin-x64 (~1.8M Mach-O), linux-arm64 (~1.4M ELF), linux-x64 (~1.5M ELF) | Artifacts local/gitignored; not published |
| `scripts/verify-kairo-ui-clean-install.sh` | PASS (hand-staged + npm-pack extract; selection never invokes cargo) | Foreign runtime exec gaps honest: darwin-x64 needs Rosetta; linux-* need Linux/qemu |
| `test/kairo-ui-prebuilt.test.js` | 7/7 | — |
| `test/launch-ratatui-host.test.js` | 18/18 (after `pnpm install` in worktree) | — |
| Windows `ui` | Explicit error: use non-interactive CLI / `kairo setup`; no spawn | CLI-only retained |
| Host `--v3-capture` from prebuilt (PATH without cargo) | exit 0, **52** fixtures incl. 60×30 / 100×30 / 160×48 | Auto fixtures, **not** human visual approval |
| `kairo-ui-pty-e2e.py` @ 60/100/160 with packaged binary | PASS (mock sidecar) | Mock sidecar only — not real providers |

Claude note: U1 committed with review **declined** (not approved); U2 may continue under that decision. Cursor did not touch Claude-owned impl files during this packaging prep.
