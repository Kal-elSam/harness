# settings-provider-connections

Branch: `feat/kairo-cursor-baseline` (Cursor ownership).
Mirror: Engram topic `odd/settings-provider-connections/tasks`.
Ownership: Settings/Ratatui, RPC bridge, integration/PTY tests.
Do NOT implement provider auth/CLI allowlists — consume Claude's `connections.status|preview|connect` contract (`docs/ai/provider-connections-contract.md`, `odd/tasks/provider-connections-backend.md`).

## Objective
Settings Connect + per-account/model inventory + journey connect → refresh → verify pending → analyst → team, with terminal yield/restore and no auto-login on open.

## Contract (consumed)
Backend tip tree matches `feat/connections-backend` (`b6ed4f938` + `671c5d79c` + `f0b541f52`):
- `status` → layers `installation` / `authentication` / `modelAccess` / `quota` (never one boolean)
- `preview({ providerId, action: "login" })` → allowlisted argv, surfaces, `previewId`, expiry (pure; no spawn)
- `connect({ preview, confirm: true })` → `connected` only after fresh auth status; exit 0 alone can be `failed`/`auth_not_confirmed`
- `evidenceStore: null` merges the default cache store (invalidation stays on)
- Runners may be omitted (module defaults) or injected; Settings injects host-bridged interactive so RPC stdio is never inherited

Inventory labels: `catalogued` | `verified` | `unverified` | `quota_limited` | `denied` | `exhausted` | `mixed`.
`temporarily_limited` / `rate_limited` → `quota_limited` (not plain unverified).
`auth_not_confirmed` UI/RPC label → **No conectado**.

## Tasks
- [x] T1 inventory mapper + connect-action resolver (`classifyModelAccess`, `resolveConnectAction`)
- [x] T2 RPC `connections.status|preview|connect` + boot never auto-connects
- [x] T3 Ratatui `ProviderConnectFlow` (preview → confirm → yield/restore → result; cancel/fail clear busy)
- [x] T4 Protocol evidence: PTY script + simulated double unit tests; no login on open
- [x] T5 Settings glue (`c` / `v` / refresh); analyst verify stays separate consent

## Commits (this lane, after trailer strip)
- `feat(connections): …` — Claude backend contract (tree ≡ `feat/connections-backend`)
- `feat(settings): …` — host adapter, host-bridge, simulated test double, RPC/PTY tests, tracker
- `feat(kairo-ui): …` — ProviderConnectFlow + Settings wiring (`No conectado` for `auth_not_confirmed`)

## What is simulated vs real
| Surface | Real | Simulated |
|---------|------|-----------|
| `createProviderConnections` status/preview/connect | contract + parsers | fake `runner` / hang / exit codes in unit+PTY tests |
| Interactive login | host-bridged yield + `terminal.session_result` | no real `claude auth login` process |
| `provider-connections-simulated.js` | — | explicit Settings-shape double for unit tests only |
| Account caches / HOME | — | temp `homeDir` / `HARNESS_HOME` in tests |
| Ratatui UI | state machine + bridge ops | no live TTY yield in `cargo test` |

## Progress / evidence
- Backend tree: identical to `feat/connections-backend` tip (`ab6c8454…`).
- Host: `settings-provider-connections.js`, `connections-interactive-pty.js`, `kairo-ui-rpc-stdio.js`.
- UI: `crates/kairo-ui/src/provider_connect_flow.rs` (+ bridge/main/settings_panel).
- Checks: Node connections suites; `cargo test -p kairo-ui`; `python3 scripts/kairo-ui-connections-pty-e2e.py`.
- Review: Cursor runtime is **unassessable** for immutable RDD — deliver `60a0102a7..HEAD` to claude-code / opencode / codex. Do not treat unassessable as pass; do not disable RDD.

## Next step
Hand range `60a0102a7..HEAD` to an admitted review runtime for receipt-driven evaluation.
