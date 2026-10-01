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
- [ ] T4 RED+GREEN: common contract `connections.status|preview|connect` with the four layers, per-provider allowlisted argv, preview expiry/fingerprint, confirm gate, cancel, timeout.
- [ ] T5 Simulated tests for: account absent, authenticated, unknown state, account change, temporary limit, explicit denial, cancellation, timeout.
- [ ] T6 Verify full suite vs base with real deps; commit work units (Conventional Commits, no AI attribution).

## Acceptance
Simulated tests for the eight scenarios above pass; 429 never becomes a 7-day denial; no secrets persisted; no arbitrary command execution; no Rust/UI edits.

## Progress / evidence
T1 done by the orchestrator (help text only).
T2/T3 written (unchecked, pending parent verification): 429 -> UNVERIFIED + limit "temporary" + retryAfterMs (default 5m, cap 60m, Retry-After honored), persisted as short-TTL evidence; 402/403/credits_required stay denied (7d). accountFingerprint (sha256/32 hex) on Claude + Cursor caches; enforced when caller passes `accountIdentifier`. RED: new tests failed at import (missing exports/module). GREEN: 20/20 new; 753/756 related, 3 failures pre-existing on base (T27, T29, T23 wire).

## Next step
T2.

## T2-T3 evidence (orchestrator)
- 429 without `credits_required` -> `{status:"unverified", limit:"temporary", retryAfterMs}` (Retry-After honored, clamped 5s-60m, default 5 min); 402/403/credits_required stay `denied` (7-day TTL). Gates keep failing closed.
- Claude and Cursor caches carry `accountFingerprint` (sha256 salted, 32 hex); changed, unknown or legacy-without-fingerprint accounts are not reused. Enforcement is opt-in per call (`accountIdentifier` key present).
- Verified: real `claude auth status --json` exposes `email` and `orgId` (key names only inspected), so the identifier is obtainable and evidence is not permanently invalidated.
- Tests: 20/20 new; full suite with real deps 2464 tests, 5 failures identical to the pre-existing set (T27, T29, T23 wire, fork bundle x2).
- Open for T4: Cursor identity source (service.js does not pass `accountIdentifier` for Cursor yet); a temporarily limited model still shows as pending/stale in the verification plan (cosmetic). Note: the fingerprint is a salted hash of a low-entropy identifier (email|orgId); it is one-way but guessable by dictionary, acceptable for a local cache, never stored raw.
