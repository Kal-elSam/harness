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

## Round 3 — Claude sweep speed (in progress)

### Blame (`never Promise.all`)
- Introduced in `df18ced13` (2026-09-19) with INC1 entitlement probe — same commit as `probeClaudeModelEntitlements`.
- ODD constraint in `odd/tasks/claude-model-entitlement.md`: **“Probes sequential, never Promise.all”** — policy choice at feature birth, not a discovered CLI lock/mutex.
- Implementation: independent `spawn("claude", …)` per model; default `timeoutMs = 30_000`, `maxProbes = 12` → worst case ~6 min sequential.
- No process-wide lock in this module. Cursor pool probes already use `Promise.all` in `verifyAccess`.
- Real risks if parallelized: Anthropic 429/overload (classified DENIED for some statuses), concurrent CLI load, cost of N allowed probes (~1¢ each) firing together.

### Proposed change (needs go-ahead)
- Bounded concurrency 2–3 + timeout ~15s for analyze verify sweeps; keep fail-closed classification; update the INC1 sequential test accordingly.
- Leave unscoped Settings/`--verify-access` policy decision explicit if different.

## Round 3+ (also pending)
- README / real-provider acceptance / Settings onboarding (separate ODD).
- Cleanup 4 legacy T24 ranking/trace tests vs T26/T27 flat picker.
- IDE: turn off **Cursor Settings → Agent → Attribution** (CLI already `false` in `~/.cursor/cli-config.json`).
