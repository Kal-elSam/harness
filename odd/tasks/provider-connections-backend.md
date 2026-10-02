# provider-connections-backend

Branch: `feat/connections-backend` (from `feat/kairo-cursor-baseline` @ 60a0102a7).
Mirror: Engram topic `odd/provider-connections-backend/tasks`.
Ownership: connections backend, verifiers, access storage. Do NOT edit Rust or implUI.

## Objective
A common backend contract `connections.status`, `connections.preview`, `connections.connect` for Codex, Claude, Cursor and OpenCode Go, plus correct access classification and cache invalidation.

## Problem (verified in code)
- `src/global/observability/claude-model-entitlement.js:19` `DENIED_HTTP_STATUSES = {402, 403, 429}`: a 429 (temporary limit) is stored as `denied`, and `claude-entitlement-store.js:12` keeps evidence for 7 days (`DEFAULT_ENTITLEMENT_TTL_MS`).
- The Claude access cache invalidates only on `subscriptionType` change (`claude-entitlement-store.js` ~L89/L139), not on account change; an unidentifiable account keeps old evidence.
- Cursor access evidence (`cursor-entitlement-store.js`, 15 min TTL) is also not tied to an account identity.
- `src/global/connections.js` covers companion tools (gentle/hermes/engram/graphify/agent), not provider login.

## Step 1: official CLI map (local `--help` only; nothing executed, no sessions/prompts)
Versions seen: codex-cli 0.159.3, Claude Code 2.1.287, cursor-agent 2026.10.01-14929f9, opencode 1.18.33.
| Provider | Install check | Status/identity | Login (interactive) | Notes |
|---|---|---|---|---|
| Codex | `codex --version` | `codex login status` (also `codex doctor` for auth/runtime health) | `codex login` (browser/device; `--with-api-key` and `--with-access-token` read secrets from stdin: NEVER used by Kairo) | `codex logout` removes credentials |
| Claude | `claude --version` | `claude auth status [--json\|--text]` | `claude auth login [--claudeai\|--console\|--email <e>\|--sso]` | `claude auth logout` |
| Cursor | `cursor-agent --version` | `cursor-agent status` / `whoami` `[--format json]`; `cursor-agent about [--format json]`; models: `cursor-agent --list-models` | `cursor-agent login` (opens browser; `NO_OPEN_BROWSER` env disables) | `--api-key` / `CURSOR_API_KEY` exist: NEVER used by Kairo |
| OpenCode Go | `opencode --version` | `opencode auth list` (alias `opencode providers list`) | `opencode auth login -p <provider> [-m <method>]` | `opencode models [provider]` lists models; `opencode auth logout [provider]` |
Network requirement: NOT verified (commands were not executed). From help text only: login commands need network/browser; `codex login status`, `claude auth status`, `opencode auth list` are expected to read local credential state; `cursor-agent status/about` and `--list-models` are expected to call the Cursor API. Each must be confirmed by a recorded, isolated run before being treated as offline-safe; until then classify as `network: "unverified"`.

## Scope (authorized by the pasted task)
- New module(s) for the common contract. Separate four layers in every result: `installation`, `authentication`, `modelAccess`, `quota`.
- `preview` returns provider, exact argv, and the surfaces used (credential store / browser / network); it is deterministic and has an expiry. `connect` requires explicit `confirm: true` AND an unexpired preview whose fingerprint matches; executes only fixed explicit argv from an allowlist per provider (never arbitrary commands, never shell strings); supports cancellation (AbortSignal) and timeout; never passes secrets on argv/stdin.
- Fix classification: 429 -> temporary limit (`rate_limited`/`limited` with retry-after/short TTL), not `denied`, not `allowed`. Explicit denial (402/403 or documented denial text) stays `denied`.
- Cache: store an account fingerprint (one-way hash of the stable account identifier; never raw email/token/response bodies). On account change or when the account cannot be identified, invalidate prior access evidence.
- Never persist tokens, keys or sensitive responses.

## Out of scope
Rust, implUI, VS Code panel, selection policy, actually logging in during tests (all provider CLIs are simulated via injected spawn).

## Execution
- TDD strict: RED first, then GREEN. Runner `node --test <file>`; full suite needs a temporary `node_modules` symlink to the main repo (remove after).
- Route: W1 = fixes to classification/cache (step 3, existing files, RED tests). W2 = contract module (step 2) + tests. One writer at a time. Parent verifies and commits each work unit.

## Tasks
- [x] T1 Map official CLI commands from local help (no sessions/prompts) - table above.
- [x] T2 RED+GREEN: 429 is a temporary limit in Claude entitlement classification and cache (not denied for 7 days, not allowed); explicit 402/403 still denied.
- [x] T3 RED+GREEN: account fingerprint invalidates Claude and Cursor access evidence on account change or unidentifiable account; no raw identifiers stored.
- [x] T4 RED+GREEN: common contract `connections.status|preview|connect` with the four layers, per-provider allowlisted argv, preview expiry/fingerprint, confirm gate, cancel, timeout.
- [x] T5 Simulated tests for: account absent, authenticated, unknown state, account change, temporary limit, explicit denial, cancellation, timeout.
- [x] T6 Verify full suite vs base with real deps; commit work units (Conventional Commits, no AI attribution).

- [x] T7 Single contract with Cursor. RESOLUTION: Cursor's current consumer (kairo-plan1-baseline, settings-provider-connections.js, mtime 17:16) already adapts to our ORIGINAL 671c5d79c API through adaptProviderConnectionsApi, so the contract is the original API shapes + additive fields; the RPC-record shaping stays in their adapter; the first conformance attempt to their older simulated double was reverted. (Original T7 text, superseded:) entry `src/global/provider-connections.js` exporting `createProviderConnections(deps)`; row key `provider`; installation present|absent|unknown; modelAccess array of `{modelId,label,state,reusable?,retryAfterMs?}` with states allowed|denied|unverified|catalogued|rate_limited|limited; quota `{state: ok|limited|unknown}`; preview takes `{provider}` and returns `{ok,provider,argv,surfaces:{credentialStore,browser,network,terminal},fingerprint,expiresAt(ms),scope,summary}` held in memory per provider; connect takes `{provider,fingerprint,confirm,signal}` and returns `{ok,reason,provider,needsTerminal,error?}` with reasons connected|not_confirmed|stale_preview|cancelled|timeout|failed|cli_absent|auth_not_confirmed. Document in `docs/ai/provider-connections-contract.md` + conformance test.
- [x] T8 Login success is not exit 0: after exit 0 re-run provider status; ok only if authentication is `authenticated`; unauthenticated or unknown -> `auth_not_confirmed`.
- [x] T9 Real readers by default (cache-only, never probes, never extra spawns beyond the allowlisted argv): Claude entitlement cache, Cursor pool-access cache, usage cache for quota; account identity for Claude/Cursor; anything without a source stays `unknown`/`unverified`.
- [x] T10 OpenCode syntax verified locally without running login: `opencode auth login [url] -p <provider id or name> -m <method label>` (help text). Local catalog has provider id `opencode-go` (name "OpenCode Go", env OPENCODE_API_KEY) but that does NOT prove `auth login -p opencode-go` accepts it, so the login argv omits `-p`; the post-login `opencode auth list` check decides.

- [ ] T11 Native review (candidate 85decbfd0, lineage review-98842cc8acfc7c97) found 2 CRITICAL deterministic findings; one bounded correction (<=200 lines declared, target <=150) is being applied here and will be carried to the reviewed checkout as one commit:
  - R3 (readers.js:41-47): Cursor access reader needs cache.accountFingerprint but no production writer stamps it, so Cursor modelAccess is always unknown and the tests hide it by hand-building the cache. Fix: make the writer path real (identity-aware write of Cursor pool evidence in the existing probe/merge path via an injected identity resolver using ONLY the allowlisted `cursor-agent status --format json` parser, once per sweep, never per model) and make the unknown honest (explicit reason when the cache has no fingerprint). End-to-end test: probe-write then read back through the reader with no hand-built fingerprint.
  - R4 (service.js:193-209): the post-login status recheck reuses the caller's signal/timeout and reports any non-authenticated result as auth_not_confirmed. Fix: recheck gets its own fresh bounded budget; caller cancel after exit 0 => outcome cancelled; an inconclusive recheck (timeout/cancelled/spawn error) => failed with additive reason `auth_check_incomplete` (status included so only the cheap check can be retried); conclusive unauthenticated/unknown-parse => auth_not_confirmed; authenticated => connected.

## Acceptance
Simulated tests for the eight scenarios above pass; 429 never becomes a 7-day denial; no secrets persisted; no arbitrary command execution; no Rust/UI edits.

## Progress / evidence
T1 done by the orchestrator (help text only).
T2/T3 written (unchecked, pending parent verification): 429 -> UNVERIFIED + limit "temporary" + retryAfterMs (default 5m, cap 60m, Retry-After honored), persisted as short-TTL evidence; 402/403/credits_required stay denied (7d). accountFingerprint (sha256/32 hex) on Claude + Cursor caches; enforced when caller passes `accountIdentifier`. RED: new tests failed at import (missing exports/module). GREEN: 20/20 new; 753/756 related, 3 failures pre-existing on base (T27, T29, T23 wire).
T4/T5 written (unchecked, pending parent verification): `src/global/provider-connections/` (allowlist, parsers, runner, evidence, service, index). `createProviderConnections({runner, interactiveRunner, now, accessReaders, quotaReaders, evidenceStore})` -> `status|preview|connect` (+ `methods` map keyed `connections.*`). RED: both new test files failed at import (module missing). GREEN: 54/54 new; 240/240 in connections*/entitlement/conversation*/project-strategy*. previewId = sha256(provider|action|argv|expiresAt), recomputed by connect (no stored state). Not registered in kairo-ui-rpc-stdio.js (interactive stdio inherit would collide with the RPC stdout channel: design decision). Cursor identity parsed generically (email/userId/user_id/id, then name), null when absent; not wired into service.js.
T7-T10 written (unchecked, pending parent verification), revised per coordinator: the contract is the ORIGINAL 671c5d79c shapes (providerId rows, installed|missing, modelAccess/quota objects, sync pure preview({providerId,action}), stateless connect({preview,...}) with outcome/reason) plus ADDITIVE items only (shim `src/global/provider-connections.js`, `modelAccess.models[]`, `needsTerminal`, reader context `subscriptionType`/`now`). T8: exit 0 then fresh status; non-authenticated => outcome failed / reason auth_not_confirmed. T9: cache-only default readers in `readers.js`, MERGED with injected (accessReaders:{}, quotaReaders:{}, evidenceStore:null get defaults). T10: login argv `opencode auth login` + conservative Credentials-section parser. Doc: `docs/ai/provider-connections-contract.md`. RED observed: T8 (3 failing), defaults/merge/OpenCode (8 failing); GREEN 75/75 provider-connections tests. No real CLI run.

T11 correction written (unchecked, pending parent verification): R4 recheck own budget + `auth_check_incomplete`/cancelled mapping (service.js); R3 identity-aware Cursor writer via injected `resolveCursorAccountIdentifier` (default `readCursorAccountIdentifier`, allowlisted status argv only, once per sweep, only when a probe is persisted; null with an injected probe) in conversation/service.js verifyAccess + verifyAnalystAccess, honest reason `cursor_identity_not_recorded` in readers.js. RED: 4 R4 tests failed, identity test failed at import. GREEN: 353/353 related, 82/82 provider-connections under a temp HOME.

## Next step
T2.

## T2-T3 evidence (orchestrator)
- 429 without `credits_required` -> `{status:"unverified", limit:"temporary", retryAfterMs}` (Retry-After honored, clamped 5s-60m, default 5 min); 402/403/credits_required stay `denied` (7-day TTL). Gates keep failing closed.
- Claude and Cursor caches carry `accountFingerprint` (sha256 salted, 32 hex); changed, unknown or legacy-without-fingerprint accounts are not reused. Enforcement is opt-in per call (`accountIdentifier` key present).
- Verified: real `claude auth status --json` exposes `email` and `orgId` (key names only inspected), so the identifier is obtainable and evidence is not permanently invalidated.
- Tests: 20/20 new; full suite with real deps 2464 tests, 5 failures identical to the pre-existing set (T27, T29, T23 wire, fork bundle x2).
- Open for T4: Cursor identity source (service.js does not pass `accountIdentifier` for Cursor yet); a temporarily limited model still shows as pending/stale in the verification plan (cosmetic). Note: the fingerprint is a salted hash of a low-entropy identifier (email|orgId); it is one-way but guessable by dictionary, acceptable for a local cache, never stored raw.

## T4-T6 evidence (orchestrator)
- Module `src/global/provider-connections/` (allowlist, parsers, runner, evidence, service, index) + 2 test files + fake runner helper: 54/54 new tests; full suite with real deps 2518 tests, 5 failures identical to the pre-existing set (T27, T29, T23 wire, fork bundle x2).
- Reviewed by the orchestrator: runner uses no shell, strips credential env vars, kills on timeout/abort; connect never takes argv from the caller and recomputes previewId; no secret-bearing flag appears in any allowlist.
- No real provider CLI was run for T4-T5 (all simulated). Known design choice: preview is stateless, so a valid preview can be replayed within its 5-minute TTL (login is idempotent). `modelAccess` can also report `exhausted` (Cursor) beyond the required states.

## T7-T10 evidence (orchestrator)
- Contract = 671c5d79c shapes + additive (`modelAccess.models[]`, `needsTerminal`, `surfaceNote`, shim `src/global/provider-connections.js`); no second RPC dispatcher; doc `docs/ai/provider-connections-contract.md` with a Cursor adapter checklist (map `temporarily_limited` -> quota_limited; preview is sync/pure; `auth_not_confirmed` surfaces as not connected).
- T8: after exit 0 a fresh status re-check decides; unauthenticated/unknown (incl. Cursor advisory) -> outcome failed, reason auth_not_confirmed. T9: real cache-only readers merged per key with injected ones (consumer passes accessReaders:{}, evidenceStore:null); no probes, no extra spawns; unknown stays unknown. T10: OpenCode login argv has no -p/-m; Go counts as authenticated only from its own line in the Credentials section.
- Behavior change to flag: `evidenceStore: null` now means the default store, not "no invalidation".
- Verified: provider-connections tests 75/75 (also with a temp HOME), related 240/240, full suite 2539 tests with the same 5 pre-existing failures. No real provider CLI was run in T4-T10.

## T11 evidence (orchestrator)
- R4: recheck after exit 0 honors caller cancel (-> cancelled), keeps its own fresh status budget, and an inconclusive check (timeout/cancelled/spawn_error/not_installed) -> failed/auth_check_incomplete with status; conclusive unauthenticated/unparseable -> auth_not_confirmed.
- R3: Cursor identity is resolved once per verification sweep (allowlisted `cursor-agent status --format json` only; injected fake in tests) and passed to mergeCursorAccessResult in verifyAccess and verifyAnalystAccess; reader reports `cursor_identity_not_recorded` for legacy/unidentified caches; end-to-end test with no hand-built fingerprint.
- Verified: provider-connections tests 82/82 (also with a temp HOME); full suite 2546 tests, same 5 pre-existing failures. Correction size ~187 changed lines (cap 200). Pending: native targeted validation on the reviewed checkout (candidate 85decbfd0 + this commit).
