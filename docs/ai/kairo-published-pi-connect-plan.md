# Published Pi connect — handshake only (no ASK)

Status: **EXECUTED once (2026-10-01).** Authorized handshake-only: published Pi + claude.ai Pro HOME + existing entitlement; temp state; `SSH_AUTH_SOCK` stripped; no ASK/prompt/sim/retry. Evidence: `/tmp/kairo-acceptance-prep/published-pi-connect/` + `odd/evidence/published-pi-connect/`.
Tracker: `odd/tasks/kairo-pi-connect-evidence.md`.
Harness: `scripts/kairo-ui-published-pi-connect-pty-e2e.py`.

## Observed (PASS)

`ready.engine.status == connected` with model:
- `id`: `claude::claude-haiku-4-5`
- `name`: `Claude Haiku 4.5 · Architect`
- `provider`: `kairo` / `api`: `kairo-cli`

No ASK prompt sent. Adapter OK PASSes unchanged / not re-run.


## Purpose

Certify **product handshake** with the **published** `@kal-elsam/kairo-pi-coding-agent`: after a seeded approved Architect team, `ready.engine.status` is `connected` (from `sidecar.jsonl`), then quit.

Separates **Pi connection inside the product** from **adapter OK prompts** (Codex/Claude/OpenCode Go already PASS — do not re-run).

No ASK / no `Reply…` / no second inference turn.

## Auth gate

```bash
KAIRO_PUBLISHED_PI_CONNECT=1 \
  KAIRO_UI_BINARY=$PWD/dist/kairo-ui/darwin-arm64/kairo-ui \
  python3 scripts/kairo-ui-published-pi-connect-pty-e2e.py
```

Without the gate → exit 2 (refuse).

## Credentials / surfaces (required)

| # | Surface | Detail |
|---|---------|--------|
| 1 | Published Pi CLI | `@kal-elsam/kairo-pi-coding-agent` under this repo `node_modules` |
| 2 | Claude login | **claude.ai Pro** in real `HOME` (`~/.claude`); leave `CLAUDE_CONFIG_DIR` unset |
| 3 | Entitlement | `claude-entitlement.json` with `claude-haiku-4-5` **allowed** (copied from real harness home / `KAIRO_REAL_HARNESS_HOME`) |
| 4 | Host binary | rebuilt/prebuilt `kairo-ui` |

Architect assignment under test: **Claude Haiku 4.5** (`claude::claude-haiku-4-5`) — same seed as packaged approved-team, without the OK prompt.

## Pass / fail

| Check | PASS |
|-------|------|
| Seed approve | `status: active` |
| `ready` | arrives ≤25 s (tee `sidecar.jsonl`) |
| Engine | `ready.engine.status == connected` + model id |
| Prompt | **not sent** |

## Limits

- Not in-host `A` approval (seeded approve before launch).
- Not published-Pi cold-start `no_model` (already covered elsewhere).
- Not ASK / tools / cancel / other providers.
- Adapter happy-path OK evidence stays valid and is not repeated.

## Authorization needed (blocking)

Answer before any execution:

1. **Run or skip** this published-Pi handshake-only scenario?
2. Confirm **claude.ai Pro** in this machine’s `HOME` may be used (read login + entitlement copy only; no OK prompt)?
3. Confirm published Pi package is the intended child (no sim fallback)?
