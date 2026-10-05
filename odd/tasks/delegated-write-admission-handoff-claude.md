# Handoff — Delegated write admission (for Claude)

## Correction (2026-10-05)

Strict floor is **opt-in** (`requireVerifiedWriteContainment: true`). Ordinary
`startRun` is unchanged. `source_declared` ≠ `verified_effective`.

## Ask

Promote an adapter to `verified_effective` only with applicable effective
evidence. Until then, callers that request the strict floor must not launch.

Ordinary Codex flags (Track A): `--approve-for-me` only — installed CLI rejects
`--sandbox` + `--approve-for-me`. That fix is compatibility, not verification.
Optional OS wrap helpers: `codex-delegated-sandbox.js` (Track B); do not cite
Bootstrap canaries.

## Matrix

| Adapter | Status | Strict launch |
|---|---|---|
| codex | `source_declared` (`verifiedEffective: false`) | no |
| claude / cursor / opencode | `unverified` | no |
| pi | `read_only_only` | no (writes) |

Under the strict floor: force/yolo bypass is **always** rejected
(`delegated_write_bypass_forbidden`), even with unsafe consent.

## Wire

- Matrix: `src/global/runtime/delegated-write-admission.js`
- Gate: `prepareRun` only if `requireVerifiedWriteContainment`
- Docs: `docs/delegated-execution-containment.md`
