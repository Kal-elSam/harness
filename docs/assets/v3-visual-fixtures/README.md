# V3 visual fixtures (FIXTURE mock — not live provider)

**V3 is NOT approved.** These captures are for human review only. Do not treat
this directory as a visual gate pass.

All painted copy and sidecar data are **FIXTURE mock — not live provider**.
No Pi / real model was contacted.

## How to regenerate

From the repo root (or worktree):

```bash
scripts/kairo-ui-v3-capture
# or:
cd crates/kairo-ui && unset CARGO_TARGET_DIR && cargo run --release -- --v3-capture ../../docs/assets/v3-visual-fixtures
```

Optional live sidecar (never talks to Pi):

`scripts/fixtures/kairo-ui-v3-visual-mock-sidecar.mjs`

Prefer the Buffer dump path above — same `render_shell` / overlays as the host,
no TTY / `script(1)` flakiness.

## Matrix

### 60x30 (60×30) — sidebar collapsed (&lt;90 cols); USAGE still painted

- `60x30-conversation.ansi` / `.txt` / `.html`
- `60x30-tools.ansi` / `.txt` / `.html`
- `60x30-plans.ansi` / `.txt` / `.html`
- `60x30-dialog.ansi` / `.txt` / `.html`
- `60x30-error.ansi` / `.txt` / `.html`

### 100x30 (100×30) — sidebar visible (agents + USAGE)

- `100x30-conversation.ansi` / `.txt` / `.html`
- `100x30-tools.ansi` / `.txt` / `.html`
- `100x30-plans.ansi` / `.txt` / `.html`
- `100x30-dialog.ansi` / `.txt` / `.html`
- `100x30-error.ansi` / `.txt` / `.html`

### 160x48 (160×48) — sidebar visible (agents + USAGE)

- `160x48-conversation.ansi` / `.txt` / `.html`
- `160x48-tools.ansi` / `.txt` / `.html`
- `160x48-plans.ansi` / `.txt` / `.html`
- `160x48-dialog.ansi` / `.txt` / `.html`
- `160x48-error.ansi` / `.txt` / `.html`


## Review

- Open any `.html` in a browser (TrueColor spans, monospace).
- Or `cat` a `.ansi` in a TrueColor terminal (`cat docs/assets/v3-visual-fixtures/100x30-conversation.ansi`).
- Grep cues in `.txt`: `FIXTURE`, `you`, `assistant`, `thinking`, `Read`, `Plan`, `Extension`, `ERROR`.

**Status: V3 not approved — awaiting human review.**
