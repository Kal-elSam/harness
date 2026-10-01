# Empty-compose shortcuts must not steal editor input

## Objective

Bare shared shortcuts (`a`/`A`/`r`/`R`/`p`/`1`–`6`) must never consume the first keystroke while the compose editor is focused. Typed drafts and submitted chat history stay intact across engine `starting`, `no_model`, and `connected`. Navigation shortcuts remain available from non-editor focus (and via slash commands).

## Why

Packaged approved-team evidence showed ASK history `eply with the single word OK.` — input loss, not capture. Root cause: `team_keys_available` treated empty Editor compose as shortcut-eligible in every engine state. Mid-draft `c` (clear notice) had the same integrity bug.

## Scope

- Gate: `team_keys_available` + callers (`try_team_shortcut`, `try_recovery_shortcut`, `try_view_shortcut`, `try_plan_shortcut`)
- Editor arm: empty-only `q`/`n`/`c`
- Local host tests + rebuilt-binary PTY with **SIMULATED** provider
- Docs/comments + ODD trackers

## Out of scope

- Pi engine `connected` certification (still a separate pending delivery item; ASK `OK` and placeholder fixes do not prove it)
- Real provider calls (none required to close this bug)

## Status

**CLOSED** for the input bug (leading `R` preserved). Fix commit `f9bf66ca7`; package rebuilt and revalidated; full Rust suite + Reply… PTY on rebuilt binary recorded below. **No further real provider call.**

## Tasks

- [x] T1 — RED: unit + host tests for first key across starting / no_model / connected and shared letter/digit shortcuts; draft + history intact; sidebar navigation still works
- [x] T2 — Fix gate so Editor focus never yields bare shared shortcuts; keep non-editor focus shortcuts; empty-only `c`/`n` in editor
- [x] T3 — GREEN: cargo tests for the new cases + update callers/docs that assumed empty-compose editor shortcuts
- [x] T4 — Note in parity trackers: Pi connection remains unverified / separate pending
- [x] T5 — Full Rust suite + rebuilt-binary PTY `Reply…` (SIMULATED); register evidence with commit

## Acceptance

- RED observed before the gate change (`team_keys_never_fire…`, `editor_keeps_first_shared…`)
- Typing keeps the full draft under Editor focus in all three engine states
- Submit puts the full question in chat history / pending prompt / sidecar task
- Sidebar focus still runs `a`/`p`/`1`–`6` / recovery keys
- No provider network calls in this work unit

## Evidence

### Fix + unit/host

- Commit: `f9bf66ca7` — `fix(kairo-ui): stop empty-compose shortcuts from stealing editor input`
- RED: `/tmp/kairo-empty-compose-red-unit.txt`, `/tmp/kairo-empty-compose-red-host.txt`
- GREEN: `editor_keeps_first_shared…`, `editor_reply_prompt_keeps…`, `shared_shortcuts_still_work…`, `reanalyze_key_works_with_hidden…`, `team_keys_never_fire…`

### Rebuilt binary verification (2026-10-01) — closes input bug

- Full Rust: **334 passed; 0 failed** (`cargo test` in `crates/kairo-ui`)
- Binary: `dist/kairo-ui/darwin-arm64/kairo-ui` (rebuild after `f9bf66ca7`)
- Harness: `scripts/kairo-ui-reply-r-pty-e2e.py` + team-flow **SIMULATED** sidecar
- Prompt: `Reply with the single word OK.`
- Observed:
  - Draft: `Reply with the single word OK.` (not `eply…`)
  - UI history: `you: Reply with the single word OK.`
  - Sidecar: `chat mode=ask task=Reply with the single word OK.`
- Bundled copy: `odd/evidence/empty-compose-reply-r/`
- Limits: SIMULATED only — **does not certify Pi `connected`**; no real Claude/Codex/OpenCode call

## Route

Direct inline (gate + tests in known files).
