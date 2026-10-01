# Kairo parity — packaged host: approved team → usable provider

Status: **EXECUTED once (2026-10-01); evidence-only review corrected the same day.** Authorized: published Pi + `claude-haiku-4-5` via claude.ai Pro; temp repo/state; real `approveProjectTeam`; one `OK` prompt ≤60s. Evidence: `/tmp/kairo-acceptance-prep/packaged-approved-team/`.

**Honest verdict (existing evidence only — no re-call, matcher not weakened):**
- **PASS:** equipo aprobado + respuesta real `claude · claude-haiku-4-5: OK`.
- **NOT verified:** conexión Pi / engine `connected` — no aparece la cadena `connected` en screens/flats/ask-history; ready = `USAGE · waiting for bridge`, post-prompt = `USAGE · checking`. Placeholder fixes and ASK `OK` do **not** certify Pi connection (still a separate pending delivery item).
- **Leading `R`:** pérdida de **entrada** (ask-history `eply…`) — **CLOSED** on rebuilt binary with SIMULATED provider (`f9bf66ca7`; evidence `odd/evidence/empty-compose-reply-r/`). Draft, UI `you:` line, and sidecar task all keep `Reply…`. **No further real provider call** for this bug.

Does not certify analysis/other providers/tools/cancel/Pi-connected.
Tracker: `odd/tasks/kairo-parity.md` / `odd/tasks/kairo-cursor-plan1-baseline.md`.

## Purpose

Certify the **packaged product path** that the isolated strategy-less check does **not** cover:

| Already certified | Still open (this plan) |
|---|---|
| Adapter happy path: Codex / Claude / OpenCode Go reply `OK` | Packaged `kairo-ui` + sidecar with an **approved** `projectTeam` and a **usable** Architect provider |
| Packaged host + real Pi offline with **no** active strategy → `no_model` (“No active strategy…”) | Engine reaches `connected` (or an honest non-strategy `no_model` / `set_model` failure) **after** team approval, then a bounded chat turn |

Separates **"provider responds"** from **"the integrated packaged product works with that provider"**.

## What this is not

- Not a re-run of the three adapter `OK` prompts (Claude evidence already recorded in `kairo-parity-provider-plan.md`).
- Not Cursor-provider certification (still pending its own auth).
- Not human visual acceptance of the product UI (fixture HTML review stays separate).
- Not foreign-platform binary exec.

## Scope (proposed — authorize before run)

1. **Host:** prebuilt `dist/kairo-ui/<host-triple>/kairo-ui` (same packaged binary as the strategy-less check).
2. **Sidecar:** real `runKairoUiRpcStdio` + published Pi (`@kal-elsam/kairo-pi-coding-agent`) when authorized; no silent simulation if real Pi is requested and missing.
3. **Project:** temp git repo (extension requires Git), isolated `HOME` / `HARNESS_HOME` / `PI_CODING_AGENT_DIR` where isolation is safe.
4. **Team:** seed or drive `team.analyze` → human/`team.approve` so `projectTeam` is **active** with an Architect route that has automatic access and a launchable adapter.
5. **Provider (one):** pick **one** already-proven adapter provider — default proposal **OpenCode Go `opencode-go/space-bunny-free`** (lowest observed spend) or **Claude `claude-haiku-4-5`** / **Codex `gpt-6-luna`**. Do **not** re-run their adapter-only `OK` harness; the product chat is a different certification.
6. **Prompt:** one tiny read-only ASK/chat turn (`Reply with the single word OK.` or equivalent through the host compose path). Abort at 60 s wall clock.
7. **Evidence:** PTY screens + sidecar log showing `ready.engine.status` after approve, then chat outcome. Redact secrets; never commit credentials.

## Honest limits

- Real provider login cannot use a fully scrubbed credential env for the chosen adapter — that needs **explicit** auth naming which account/CLI login to use.
- Offline Pi (`--offline`) may still be required for cold start; the usable-provider step then needs network/credentials for that one adapter only when authorized.
- A PASS here certifies only the observed packaged path (approved team + that one provider + that one prompt). It does not certify Cursor, error paths, tools/thinking, or cancel/switch/quit/restore.

## Pass / fail criteria

| Check | PASS means |
|---|---|
| Before approve | Engine may still be `no_model` with strategy-less reason (already known). |
| After `team.approve` + reapply Architect | `set_model` attempted for Architect; engine is `connected` **or** a concrete `no_model`/`unavailable` reason that is **not** the empty-strategy string. |
| Chat turn | Host shows a real answer (or an honest provider/host error). Never silent success. |
| Isolation honesty | REAL vs SIMULATED labeled; missing published Pi under REAL_PI → fail (no sim fallback). |

## Authorization needed (blocking)

Answer all of the following before any execution:

1. **Run or skip** this packaged approved-team scenario?
2. **Provider:** OpenCode Go / Claude / Codex (one only for the first run)?
3. **Credential surface:** which CLI login / home to use (cannot invent)?
4. **Pi child:** published real Pi offline for handshake, or allow simulated Pi only for the host wiring while the **provider** call is real? (Default proposal: real Pi + one real provider.)
5. **Spend acknowledgement:** one short turn; expect ~similar baseline CLI context cost as the adapter `OK` runs (~19k–25k input tokens or ~$0.01 on Claude).

Authorization for the first run was granted and consumed; further runs need a new explicit auth.

## Implementation sketch (prepared, not run)

- Fixture/smoke sibling to `scripts/kairo-ui-packaged-no-model-pty-e2e.py` that:
  - `git init` temp proj;
  - seeds or drives analyze→approve with a launchable Architect assignment for the chosen provider;
  - asserts post-approve engine status ≠ empty-strategy reason;
  - sends one compose turn;
  - records evidence under `/tmp/kairo-acceptance-prep/packaged-approved-team/`.
- Env gate e.g. `KAIRO_PACKAGED_APPROVED_TEAM=1` plus provider id; refuse to start without the gate.

## Related evidence already on the Cursor baseline

- Strategy-less packaged PASS (real Pi): `/tmp/kairo-acceptance-prep/packaged-no-model-real-pi/`
- Adapter happy paths: `docs/ai/kairo-parity-provider-plan.md`
- Claude `is_error` fix (fixture): `b72305be2` / `fd877dcc7`; native review of redaction+`is_error` range **DECLINED** (`1efd0db9a`) — OMITTED, not approval.

## Instrumented evidence (simulated Pi)

The packaged harness now runs the real sidecar behind a transparent tee and waits on the real `ready` record in `sidecar.jsonl` (explicit FAIL after 25 s; no screen-text proxy). The in-host approval -> `set_model` -> `engine` path and its negative cases are proven with a fake Pi in `docs/ai/kairo-pi-connect-evidence.md`. That proves harness and wiring only, not the published Pi.
