# Analyze journey polish

Worktree: `agentic-harness-worktrees/kairo-startup-analyst`, branch `feat/kairo-startup-analyst-team`.

Track detailed acceptance in `odd/tasks/analyst-picker-fit-ranking.md` (section **Analyze journey polish**).

## Round 1 (done)

Commits (rewritten, no AI attribution trailer; tip as of 2026-10-02):

| Hash | Message |
|------|---------|
| `5cd50155a` | test(kairo): align bootstrap and wire fixtures with T29 flat picker |
| `45b679eee` | fix(kairo): verify-once cache for unverified probes and stable Rust gate |
| `504aa9501` | fix(kairo): keep Claude entitlement cache when merge auth is null |

Steps 1 + 2: green tests + verify-once cache/TTL + Rust `verification_ran` retention.
Follow-up: merge null-auth preserves max cache (`subscriptionTypeMatches` on write).

### Tradeoffs (recorded, not bugs)
- **Cursor EXHAUSTED TTL = 6h** (was 15m). Quota recovery may leave Cursor excluded until TTL or `invalidateCursorPoolAccess`. Chosen so analyze does not re-probe every open; reactive invalidation remains the fast path.
- **`verification_ran` is session-scoped.** After one verify in this host process, a later preflight with pending checks (e.g. 1h unverified TTL expired) will not re-open the Verify screen until Esc-cancel / restart. Acceptable for round 1; Settings “verify now” (T6) is the explicit refresh path.
- **`buildUnverifiedClaudePreflightNotice` still counts cached UNVERIFIED.** Round 2 filters the analyze notice (Cursor out of notice; unverified-recent should not nag).

## Round 2 (done)

### Dependency (cherry-pick into this branch)
| Hash | Message |
|------|---------|
| `bc9b5655f` | feat(intelligence): persist per-role selection causes for draft exclusions |

~1.3k lines including the `team-selection-repro-dfd018` fixture (~985). Needed so `selection.evaluated[].blockedBy` exists for concentration Descartados; not invented in Round 2.

### Round 2 commits (no AI attribution trailer)

| Hash | Message |
|------|---------|
| `ff6c18a5a` | feat(kairo): draft Descartados and quiet analyze preflight notice |
| `fee43ac98` | docs(odd): record round-2 commit hash for analyze journey polish |
| `90c4a88bd` | fix(kairo): honor analyze consent scope in verifyAccess |
| `14d8eb499` | feat(kairo): put eligibility exclusions into draft Descartados |

- [x] Draft exclusions (`Descartados`) — concentration peers **and** eligibility/`cursorAccess` causes (Claude cuota, Go rate-limit, Cursor sin verificar). Wired through `teamRow` → `agents` (not only `assignments`).
- [x] Filter Cursor out of analyze preflight **notice + execution** — `forAnalyzePreflightNotice` for UI; `verifyAccess({ scope: "analyze" })` from `verifyProjectTeamAccess` so consent matches probes. Unscoped `verifyAccess` still runs full plan (Settings).
- [x] Tighten unverified notice so recent cached UNVERIFIED does not re-nag — `countNaggingUnverifiedClaudeModels` (pending only).

Observed (consent + eligibility close): access-verification + analyst-picker-verified 34/34; team-decision-discarded 5/5; workspace-shell-snapshot 33/33.

### Round 2 UX follow-up (not blocking; presentation only)
- Eligibility lines are global but currently repeated under every role’s Descartados — split team-level “Proveedores fuera…” vs per-role concentration peers (`workspace-snapshot.js` + `surfaces.rs`).
- `check.reason` from `checkCandidate` is English; mixed with Spanish “sin verificar” — review live copy.
- Unauthenticated Cursor: pool “sin verificar” lines can stack on top of adapter-level “not eligible” — dampen duplicate Cursor noise.

## Round 3 — Claude sweep speed (done)

Ordered plan (concurrency blocked until step 1):

1. **[x] Cherry-pick `b6ed4f938` → `879ff3f`** — 429 → temporary UNVERIFIED (Retry-After TTL), never 7-day DENIED. Merged with Round 1 verify-once (plain UNVERIFIED still persists 1h; `subscriptionTypeMatches` null-auth keep). RED→GREEN: `connections-access-classification.test.js` + fingerprint suite.
2. **[x] Measure** real probe latency — see **Latency evidence** below.
3. **[x] Concurrency 2** default inside `probeClaudeModelEntitlements`; on temporary 429 stop new launches and finish at concurrency 1. Result array stays in catalog order.
4. **[x] Timeout** analyze scope only → `ANALYZE_PROBE_TIMEOUT_MS = 20_000` (p95 14315 + margin). Settings/unscoped keep default 30s.
5. **[x] Tests**: max in-flight=2, stable result order + out-of-order progress, 429 cutover, concurrency=1 sequential, analyze passes 20s timeout (`claude-model-entitlement.test.js`, `access-verification.test.js`).

### Latency evidence (2026-10-02, user-authorized)

- Script: `scripts/measure-claude-probe-latency.js`
- Raw: `odd/evidence/claude-probe-latency-2026-10-02.json`
- Constraints: concurrency **1**, max **30**, **2** sequential passes over documented catalog (9 models) = **18** probes, `timeoutMs=30000`.
- Wall: ~121s for the whole run.
- Overall: n=18, min=3927, **p50=6601**, **p95=14315**, max=14315.
- By model (p50 / p95 ms):

| model | n | p50 | p95 | notes |
|-------|---|-----|-----|-------|
| claude-opus-5 | 2 | 7783 | 7875 | allowed |
| claude-sonnet-5 | 2 | 7079 | 7754 | allowed |
| claude-haiku-4-5 | 2 | 7906 | 14315 | allowed; pass2 outlier |
| claude-fable-5-1 | 2 | 3927 | 4031 | denied (credits) |
| claude-fable-5 | 2 | 3929 | 4990 | denied (credits) |
| claude-opus-4-8 | 2 | 5907 | 6040 | allowed |
| claude-opus-4-7 | 2 | 6601 | 8449 | allowed |
| claude-opus-4-6 | 2 | 3981 | 7570 | pass2 = temporary 429 |
| claude-sonnet-4-6 | 2 | 3945 | 7666 | pass2 = temporary 429 |

- Observed mid-run: 2× `unverified/temporary` (429) on pass 2 — confirms step 1 is load-bearing before concurrency.
- Recommended analyze timeout: **20s** (above p95 14.3s with margin). Keep Settings/unscoped at 30s unless measured separately.

### Blame (`never Promise.all`)
- Introduced in `df18ced13` (2026-09-19) with INC1 entitlement probe — same commit as `probeClaudeModelEntitlements`.
- ODD constraint in `odd/tasks/claude-model-entitlement.md`: **“Probes sequential, never Promise.all”** — policy choice at feature birth, not a discovered CLI lock/mutex.
- Implementation: independent `spawn("claude", …)` per model; default `timeoutMs = 30_000`, `maxProbes = 12` → worst case ~6 min sequential.
- No process-wide lock in this module. Cursor pool probes already use `Promise.all` in `verifyAccess`.
- Real risks if parallelized: Anthropic 429/overload (today cached as DENIED 7d — **blocking**, fixed by step 1), concurrent CLI load, cost of N allowed probes (~1¢ each) firing together.

### Proposed change (after step 1)
- Bounded concurrency 2 (conservative) + timeout from measured p95 for analyze verify sweeps; keep fail-closed classification.
- Leave unscoped Settings/`--verify-access` timeout decision explicit if different.

## Round 3+ (also pending)
- README / real-provider acceptance / Settings onboarding (separate ODD).
- Cleanup 4 legacy T24 ranking/trace tests vs T26/T27 flat picker.
- IDE: turn off **Cursor Settings → Agent → Attribution** (CLI already `false` in `~/.cursor/cli-config.json`).
- Evidence commit: `cad96b8ea` — concurrency 2 + analyze 20s timeout + tests.
