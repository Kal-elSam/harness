# Empty-compose shortcuts must not steal editor input

## Objective

Bare shared shortcuts (`a`/`A`/`r`/`R`/`p`/`1`–`6`) must never consume the first keystroke while the compose editor is focused. Typed drafts and submitted chat history stay intact across engine `starting`, `no_model`, and `connected`. Navigation shortcuts remain available from non-editor focus (and via slash commands).

## Why

Packaged approved-team evidence showed ASK history `eply with the single word OK.` — input loss, not capture. Root cause: `team_keys_available` treated empty Editor compose as shortcut-eligible in every engine state. Mid-draft `c` (clear notice) had the same integrity bug.

## Scope

- Gate: `team_keys_available` + callers (`try_team_shortcut`, `try_recovery_shortcut`, `try_view_shortcut`, `try_plan_shortcut`)
- Editor arm: empty-only `q`/`n`/`c`
- Local host tests only (recorder / no providers)
- Docs/comments + ODD trackers

## Out of scope

- Pi engine `connected` certification (still a separate pending delivery item; ASK `OK` and placeholder fixes do not prove it)
- Real provider calls

## Tasks

- [x] T1 — RED: unit + host tests for first key across starting / no_model / connected and shared letter/digit shortcuts; draft + history intact; sidebar navigation still works
- [x] T2 — Fix gate so Editor focus never yields bare shared shortcuts; keep non-editor focus shortcuts; empty-only `c`/`n` in editor
- [x] T3 — GREEN: cargo tests for the new cases + update callers/docs that assumed empty-compose editor shortcuts
- [x] T4 — Note in parity trackers: Pi connection remains unverified / separate pending

## Acceptance

- RED observed before the gate change (`team_keys_never_fire…`, `editor_keeps_first_shared…`)
- Typing keeps the full draft under Editor focus in all three engine states
- Submit (recorder, no provider) puts the full question in chat history / pending prompt
- Sidebar focus still runs `a`/`p`/`1`–`6` / recovery keys
- No provider network calls in this work unit

## Evidence

- RED: `/tmp/kairo-empty-compose-red-unit.txt`, `/tmp/kairo-empty-compose-red-host.txt`
- GREEN: `editor_keeps_first_shared…`, `editor_reply_prompt_keeps…`, `shared_shortcuts_still_work…`, `reanalyze_key_works_with_hidden…`, `team_keys_never_fire…`

## Route

Direct inline (gate + tests in known files).
