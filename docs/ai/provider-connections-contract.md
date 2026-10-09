# Provider connections contract

Entry: `src/global/provider-connections.js` (re-exports `src/global/provider-connections/index.js`; both paths resolve).
`createProviderConnections(deps)` returns `{status, preview, connect, methods}`; `methods` is keyed `connections.status|preview|connect`.
The shapes are the ORIGINAL ones (commit 671c5d79c) plus additive fields only. Record shaping for the RPC (provider/fingerprint/needsTerminal
on the wire) belongs to the consumer's adapter, not here. No RPC dispatcher lives in this module.

Providers: `codex`, `claude`, `cursor`, `opencode-go`. Rows are keyed `providerId`.

## status({providerIds?})  (async)

Returns `{providers:[row]}`. An unknown id throws `ConnectionsError` (`unknown_provider`) before anything runs.

```json
{"providerId":"claude",
 "installation":{"state":"installed","version":"2.1.287","network":"unverified"},
 "authentication":{"state":"authenticated","network":"unverified","accountFingerprint":"b860d050fb6a2e30ee963683c76ccccf"},
 "modelAccess":{"state":"mixed","source":"entitlement-cache","models":[{"modelId":"claude-opus-5-5","label":"Claude Opus 5.5","state":"allowed","reusable":true},{"modelId":"claude-haiku-4-5","label":"Claude Haiku 4.5","state":"rate_limited","retryAfterMs":300000}],"network":"unverified"},
 "quota":{"state":"available","remainingPercent":42,"network":"unverified"},
 "checkedAt":"2023-11-14T22:13:20.000Z"}
```

| Layer | Vocabulary |
|---|---|
| installation.state | `installed` `missing` `unknown` |
| authentication.state | `authenticated` `unauthenticated` `unknown` (Cursor also carries `advisory:true`) |
| modelAccess.state (aggregate) | `allowed` `denied` `exhausted` `temporarily_limited` `mixed` `unknown`; plus `retryAfterMs`, `source`, optional `reason` |
| quota.state | `available` `exhausted` `unknown` |

Additive: `modelAccess.models[]` = `{modelId,label,state,reusable?,retryAfterMs?,reason?,scope?}` with per-model `state`
`allowed|denied|unverified|catalogued|rate_limited|limited` (only present when the evidence names models).

- A temporary limit (429, T2) is `temporarily_limited` (aggregate) / `rate_limited` (per model) with `retryAfterMs`; never `denied`. Explicit denial stays `denied`. Cursor `exhausted` stays `exhausted` (per model `limited`).
- Unknown or unrecognised evidence is never upgraded to `allowed`; no evidence is `unknown`. Free-text reasons are dropped, only short codes survive.
- Results never contain raw stdout/stderr, emails, org ids or tokens. `accountFingerprint` is a salted one-way hash or `null`.

## preview({providerId, action:"login"})  (SYNCHRONOUS, pure: never spawns)

```json
{"providerId":"claude","action":"login","argv":["claude","auth","login","--claudeai"],"command":"claude auth login --claudeai",
 "surfaces":["browser","credential-store","network","terminal"],"networkVerification":"unverified",
 "createdAt":"2023-11-14T22:13:20.000Z","expiresAt":"2023-11-14T22:18:20.000Z","previewId":"<64 hex>"}
```

`surfaceNote` is added for OpenCode Go. Unknown provider/action or any extra key (`argv`, `command`) throws `ConnectionsError`.
It cannot report a missing CLI (that would need a spawn); `connect` reports it instead.

## connect({preview, confirm, signal?, timeoutMs?})  (stateless)

`confirm` must be exactly `true`. `connect` recomputes `previewId` from (provider, action, allowlisted argv, expiresAt), so a tampered or expired
preview is `{outcome:"rejected", reason:"confirmation_required"|"invalid_preview"|"preview_expired"}`. The caller never supplies argv; only the
allowlist runs, no shell, secret env vars stripped, never `--with-api-key`/`--with-access-token`/`--api-key`. There is no held/one-shot preview.

| outcome | reason |
|---|---|
| `connected` | `login_completed` (exit 0 AND fresh status `authenticated`) |
| `failed` | `exit_nonzero`, `not_installed`, `spawn_error`, **`auth_not_confirmed`**, **`auth_check_incomplete`** |
| `cancelled` / `timeout` | same word; the process is killed |
| `rejected` | see above |

Result: `{outcome, reason, status, accountChanged, evidenceInvalidated, needsTerminal}` (`needsTerminal` is additive; `status` is the fresh row).

```json
{"outcome":"connected","reason":"login_completed","status":{"providerId":"claude","...":"row as above"},"accountChanged":true,"evidenceInvalidated":true,"needsTerminal":true}
```

### T8: exit 0 is not success

After exit 0 the module re-runs that provider's status (fresh). `connected` only if `authentication.state === "authenticated"`; `unauthenticated`
and `unknown` (including Cursor, whose status is advisory) give `outcome:"failed", reason:"auth_not_confirmed"`. Non-zero exit is
`failed/exit_nonzero`. If the account fingerprint changed or is unidentifiable, prior access evidence is invalidated via the evidence store.

## Defaults (T9, cache-only) and merging

Defaults merge with injected values: for each provider key missing from `accessReaders`/`quotaReaders` the default reader is used; an
`evidenceStore` of `null`/`undefined` means the default store; `runner` = spawn runner, `interactiveRunner` = `runner`, `now` = `Date.now`,
`homeDir` = `resolveHomeDir()`. So a consumer passing `{runner, interactiveRunner, accessReaders:{}, quotaReaders:{}, evidenceStore:null, now}` gets real readers.
Readers never probe and never spawn beyond the allowlisted version/auth argv.

| Provider | modelAccess | quota | identity |
|---|---|---|---|
| claude | per documented model from the entitlement cache, bound to subscription type + account fingerprint (no evidence = `catalogued`) | usage cache (worst window, max age 30 min) | `claude auth status --json` (email\|orgId) |
| cursor | per POOL (`cursor_models`, `other_models`, `scope:"pool"`) from the access cache; no cache-only catalog exists | `unknown` | generic parse of `cursor-agent status --format json` |
| codex | `unknown`, no source | usage cache | none |
| opencode-go | `unknown`, no source | usage cache | none |

Unknown by design: offline-safety of any status command (`network:"unverified"` everywhere); per-model access for Codex/OpenCode Go and for
Cursor models; Cursor quota; Cursor's real auth (advisory); account identity for Codex/OpenCode Go.

## OpenCode finding (T10)

Login argv is `["opencode","auth","login"]`: no `-p`, no `-m`. Syntax verified from `opencode auth login --help`
(`[url] -p <provider id or name> -m <method label>`). The local catalog `~/.cache/opencode/models.json` has provider id `opencode-go`
(name "OpenCode Go", env `OPENCODE_API_KEY`), and `opencode models opencode-go` works, but none of that proves `auth login` accepts that id.
The user picks interactively; the post-login `opencode auth list` check decides. Go counts as authenticated only when its own line is in the
Credentials section (whole-word match; "OpenCode Zen" does not count; Environment-only or ambiguous output is `unknown`).

### R4: inconclusive recheck (additive)

The post-login recheck has its own fresh `statusTimeoutMs` budget and honors the caller's signal. `authenticated` => `connected`; `unauthenticated` or an unparseable/ambiguous output => `failed/auth_not_confirmed`; an inconclusive check (timeout, spawn error, binary missing) => `failed/auth_check_incomplete`; cancelled => `cancelled`. Cursor `modelAccess.models[].reason` may be `cursor_identity_not_recorded` (cache has evidence but no recorded account fingerprint).

## Cursor adapter checklist (kairo-plan1-baseline worktree)

Files: `src/global/host/settings-provider-connections.js` (`adaptProviderConnectionsApi`, `classifyModelAccess`, `buildProviderInventory`,
`loadConnectionsBackend`), `src/global/host/kairo-ui-rpc-stdio.js` (`connections.*` ops), `src/global/host/provider-connections-simulated.js` (double).

1. `classifyModelAccess`: map aggregate `temporarily_limited` to `quota_limited` (today it falls through to `unverified`); `exhausted` stays exhausted; `mixed` to unverified/mixed. Per-model `rate_limited`/`limited` already map to quota-limited.
2. `api.preview({providerId, action})` is synchronous and pure; keep the try/catch (it throws `ConnectionsError` with `.code`). It cannot return `cli_absent`.
3. `api.connect` result `outcome:"failed", reason:"auth_not_confirmed"` must surface as **"No conectado"** (login exited 0 but the account is not authenticated).
4. `needsTerminal` = `preview.surfaces.includes("terminal")` in the adapter (the connect result also carries it as an additive field).
5. `loadConnectionsBackend` should pass a real `runner`/`interactiveRunner` or omit them (the module defaults to a spawn runner); passing `accessReaders:{}`, `quotaReaders:{}`, `evidenceStore:null` is fine, defaults merge.
6. `outcome:"failed", reason:"auth_check_incomplete"` (post-login status check timed out, was cancelled or could not run; `status` is included) must be shown as "not confirmed, retry the check", NOT as a failed login: re-run only `connections.status`. A caller cancel gives `outcome:"cancelled"`.
