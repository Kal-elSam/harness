# Handoff — Delegated write admission matrix (for Claude)

## Ask

Close admission on the productive delegated-write path using this matrix.
Unverified write floors must not launch. Prefer prelaunch throw / no run (already
wired in `prepareRun`); do not invent `WorkResult.blocked` solely for admission.

## Matrix (authoritative code)

`src/global/runtime/delegated-write-admission.js` → `DELEGATED_WRITE_ADMISSION`

| Adapter | Status | Launch authorized write? | verifiedEffective | Gate |
|---|---|---|---|---|
| codex | `source_declared` | yes (conditions) | false | cwd required; normal→workspace-write; yolo+consent |
| claude | `unverified` | **no** | false | denied |
| cursor | `unverified` | **no** | false | denied |
| opencode (+go/zen) | `unverified` | **no** | false | denied |
| pi | `read_only_only` | **no** (writes) | false | only `permissions:["read-only"]` |

## Conditions (Codex)

1. non-empty cwd (project or `worktree.treePath`)
2. empty/normal permissions → `--sandbox workspace-write --approve-for-me`
3. yolo requires unsafe consent
4. do not cite Bootstrap sandbox-exec as proof

## Promote path

Only Claude (or agreed owner) should flip an adapter to `verified_effective`
after an effective canary: in-cwd write OK, outside denied, with auto-approval /
native config behavior accounted for. Until then Codex stays `source_declared`
(eligible, not verified).

## Docs / tests

- `docs/delegated-execution-containment.md`
- `test/delegated-write-admission.test.js`
- Wired: `run-manager.js` `prepareRun` → `assertDelegatedWriteAdmission`

## Out of scope for this handoff

- Bootstrap Analysis isolation (separate doc)
- Kernel WorkResult shape changes for admission
- Enabling Claude/Cursor/OpenCode write launches without a declared floor
