# Codex write-containment canary

Objective: promote Codex strict-floor writes from `source_declared` to a runtime-verified `verified_effective` so aptitude write probes (Builder, Debugger, Tester) can run.
Branch: delivery/kairo-runtime-clean. Delivery: ask-on-risk. Test runner: `npm test` (node --test); focused `node --test test/<file>.test.js`.

## Specs

- S1. User request (verbatim): "dale, arrancá con el canario de Codex".
- S2. User decision (verbatim): "1" — chosen option: "Cerrar la escalada: para lanzamientos que exigen contención, Codex corre con `--sandbox workspace-write`, sin aprobación automática y sin config del usuario. Si no hay escalada posible, el canario sin modelo prueba exactamente la postura con la que se lanza."
- S3. Promotion criteria (docs/delegated-execution-containment.md:87-90, delegated-write-admission.js:44-49): in-cwd write succeeds; absolute path outside cwd denied; auto-approval / native config behavior accounted for; no force/yolo bypass even with consent.
- S4. The canary uses no model call (`codex sandbox`), fails closed on launch error, timeout, unsupported behavior, or a failed control, and is bound to the launch posture it verifies.
- S5. Ordinary (non-strict) Codex runs keep their current launch args and behavior unchanged.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S2, S3 | delegated (team-builder-codex; Claude quota critical) | done (L8) | 0a1b6897d |
| T2 | S3, S4 | delegated (same unit as T1) | done (L8) | 0a1b6897d |
| T3 | S3, S5 | delegated (same unit as T1) | done (L8) | 0a1b6897d |
| T4 | S1-S5 | parent inline review (agents blocked by quota hook) | done (L9) | 0a1b6897d |

- T1: strict-floor Codex launch posture: when `requireVerifiedWriteContainment` is set, launch `codex exec` with `--sandbox workspace-write --ignore-user-config` and approvals disabled (no `--approve-for-me`, no bypass). Confirm flag combination against the installed CLI without a model call. — done (0a1b6897d)
- T2: Codex write canary next to the read-only one (`src/global/runtime/readonly-containment.js` pattern): in-cwd write succeeds, absolute outside write (non-temp path) denied with no leakage, success control; injectable runner for offline tests plus a gated live test. — done (0a1b6897d)
- T3: `assertDelegatedWriteAdmission` admits Codex only when a fresh canary for that cwd and posture passed; static table stays `source_declared`; force/yolo still rejected; Claude/Cursor/OpenCode/Pi unchanged. — done (0a1b6897d)
- T4: independent verification of T1-T3. — done (L9)

## Log

- L1 (2026-10-20) User: "dale, arrancá con el canario de Codex".
- L2 (2026-10-20) Mapping (codex read-only): read-only canary is a per-launch preflight that persists nothing (readonly-containment.js:67-143, execution-adapters/codex.js:93-96); admission is a frozen table with no evidence path (delegated-write-admission.js:40-124); outer OS wrapper inserts the dangerous bypass and has no production callers (codex-delegated-sandbox.js:93-138).
- L3 (2026-10-20) User chose option 1 (close escalation): "1".
- L4 (2026-10-20) Live no-model probes, codex-cli 0.162.1: `codex sandbox -P :workspace -C <tmp>`: in-cwd write allowed; write to a dir under $HOME denied ("Operation not permitted"). Writes to $TMPDIR and /tmp are ALLOWED by `:workspace`; `-c sandbox_workspace_write.exclude_tmpdir_env_var=true -c sandbox_workspace_write.exclude_slash_tmp=true` did NOT close them under `-P :workspace`. `:write` and `:workspace_write` are unknown profiles. Open: S3 "absolute path outside cwd denied" fails for temp dirs until they are excluded or the gap is accepted by the user.
- L5 (2026-10-20) T1-T3 delegated to team-builder-codex: blocked at Step 0, no edits. `codex sandbox` without `-P` exits 2 ("required arguments were not provided: --permission-profile <NAME>"); legacy `-c sandbox_mode` posture cannot launch. Its nested probes ran inside Codex's own seatbelt ("sandbox-exec: sandbox_apply: Operation not permitted", exit 71), so live sandbox probes must run from the parent shell, not from a Codex worker. Unexplored: custom permission profiles via config and `codex sandbox --sandbox-state-json` (schema unknown). Status: Needs decision.
- L6 (2026-10-20) Research via codex:codex-rescue failed before running ("Codex CLI is not installed or is missing required runtime support ... rerun /codex:setup"). Parent probes: custom profiles can be defined inline (`-P kairo -c 'permissions.kairo.extends=":workspace"'` runs; `-P nonexist` errors "default_permissions requires a `[permissions]` table"); unknown keys such as `permissions.kairo.bogus_key=1` are accepted silently, so profile keys must come from the documented schema, never guessed. `extends=":workspace"` still leaves TMPDIR and /tmp writable. Next: obtain the permissions-profile schema from openai/codex docs/source.
- L7 (2026-10-20) Schema (codex research, openai/codex rust-v0.162.1 codex-rs/config/src/permissions_toml.rs L29-L225): profiles grant writes via `filesystem` entries; no `extends` = empty deny-all base; explicit `-P` ignores `[sandbox_workspace_write]`; `codex exec` has no `-P`, selects via `-c default_permissions="NAME"`; exec defaults to approval never. Parent live no-model probes (workspace and outside dir under $HOME, not temp), with `-C DIR -P kairo_cwd -c 'permissions.kairo_cwd.filesystem={":root"="read","DIR"="write"}'`: in-cwd write allowed, $HOME outside denied, $TMPDIR denied, /tmp denied, echo control OK. Same with `extends=":read-only"`. Step 0 RESOLVED with this posture (no extends). The `:workspace` + `":slash_tmp"="read"` variant errors ("filesystem path must be absolute ... or start with `:`").
- L8 (2026-10-20) T1-T3 implemented by team-builder-codex (RED 15 then GREEN; follow-up fix: `codex sandbox` rejects `--ignore-user-config`, removed from canary only; obsolete test/run-spawn-adapter.test.js:206 updated, user-approved surfaces run-supervisor.js, test/run-supervisor.test.js, test/run-spawn-adapter.test.js). Parent unsandboxed shell: npm test 3682 pass / 0 fail / 5 skipped; live canary test/codex-write-canary-live.test.js 1 pass, no probe dirs left in $HOME. Uncommitted. T4 pending: Claude reviewer blocked by quota hook (suggested review-risk-codex does not exist); retry after Claude 5h reset.
- L9 (2026-10-20) T4: Claude review agents blocked by the quota hook (weekly projection CRITICAL); parent (Claude, cross-vendor to the Codex writer) reviewed the full diff inline. No blockers. Advisories: (a) `codex exec` honoring `default_permissions` under `--ignore-user-config` is source-backed, not live-proven (needs a model call; first Builder aptitude run exercises it); (b) a cwd swapped for a symlink between canary and launch stays cwd-only but may target a different directory.
