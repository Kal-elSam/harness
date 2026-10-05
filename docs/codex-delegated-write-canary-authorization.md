# Codex delegated-write canary — authorization request (not executed)

Status: **prepared, not authorized, not run.**

This document is the concrete grant package for **one** live canary.
A future `contained` oracle verdict does **not** auto-promote
`verifiedEffective` and does **not** wire `startRun`.

Gentle receipt `review-4b66cfffd44c6167` (approved/burned) ≠ containment proof.

Advisory R2 WARNINGs (`R2-omitted-externals-misnomer`,
`R2-forbidden-sibling-name-drift`) stay informational; they do not block this
authorization decision.

---

## How to authorize (plain language)

Say in chat (or any clear written grant) that you authorize **one** live canary
under this package. Name the **model id** to pin. No ceremonial token text is
required.

A valid grant must make these constraints unambiguous:

- one run only
- isolated `CODEX_HOME` (not personal `~/.codex`)
- disposable paths below
- no credential copy by the harness
- no auto-promotion of `verifiedEffective`
- no `startRun` / production wiring
- a `contained` verdict still needs a **separate** scope decision afterward

Until that plain-language grant exists, agents must not run the live canary.
Status stays **prepared / not authorized / not run**.

---

## Scope of the grant (exactly once)

| Item | Value |
|---|---|
| Runs allowed | **1** (single process invocation of the exact command) |
| Adapter | Codex CLI (`codex`) via OS wrap (`/usr/bin/sandbox-exec` + SBPL) |
| Model | **Pin at grant time** with `--model <id>` (one Codex ChatGPT subscription model; no mid-run switch) |
| Account / auth | Isolated `CODEX_HOME` only — **no** personal `~/.codex`, **no** symlink alias, **no** credential copy by harness prep |
| Host | macOS with `/usr/bin/sandbox-exec` executable (fail-closed otherwise) |
| Auto-spawn | **Forbidden** — operator (or explicitly authorized agent turn) runs the exact command; `runDelegatedWriteCanary` does not spawn |
| Promotion | **Forbidden** on this grant — even if oracle returns `contained` |
| Wiring | **Forbidden** — no `startRun` / production path enablement |

---

## Disposable paths (fixed layout)

| Role | Absolute path |
|---|---|
| workspaceRoot | `/tmp/kairo-wt-delegated-1/tree` |
| providerHome (isolated) | `/tmp/kairo-wt-delegated-1/provider-home` |
| tempRoot | `/tmp/kairo-wt-delegated-1/tmp` |
| SBPL profile | `/tmp/kairo-wt-delegated-1/profile.sb` |
| INTERNAL attempt | `/tmp/kairo-wt-delegated-1/tree/canary-internal-write.txt` |
| EXTERNAL attempt | `/tmp/kairo-wt-delegated-1/canary-external-probe.txt` |

Pre-run: recreate empty disposable trees; write profile via
`prepareDelegatedWriteCanaryProtocol` (or equivalent).  
Post-run: delete the three disposable trees + profile (operator-owned cleanup).

---

## Isolated authentication steps

1. Create `/tmp/kairo-wt-delegated-1/provider-home` empty.
2. Place Codex subscription auth **only** under that home (operator-owned method — login/device flow against that `CODEX_HOME`).
3. Export for the single canary process:
   - `CODEX_HOME=/tmp/kairo-wt-delegated-1/provider-home`
   - `TMPDIR=/tmp/kairo-wt-delegated-1/tmp`
4. Forbidden: `CODEX_HOME=~/.codex`, `ln -s ~/.codex …`, probing personal Codex state.

---

## Exact pre-run build (no spawn)

```js
import { prepareDelegatedWriteCanaryProtocol } from
  "../src/global/runtime/codex-delegated-write-canary-protocol.js";

const protocol = await prepareDelegatedWriteCanaryProtocol({
  workspaceRoot: "/tmp/kairo-wt-delegated-1/tree",
  providerHome: "/tmp/kairo-wt-delegated-1/provider-home",
  tempRoot: "/tmp/kairo-wt-delegated-1/tmp",
  profilePath: "/tmp/kairo-wt-delegated-1/profile.sb"
});
// protocol.verifiedEffective === false
// protocol.realRunAuthorized === false
// protocol.command — print and run exactly once when granted
```

Gate for any API that would proceed past prep:

```js
authorizeRealCanary: true   // explicit human grant required
```

Still does **not** auto-spawn; after a plain-language grant, run
`protocol.command` once (insert `--model <id>` if missing).

---

## Evidence package (complete — required for oracle)

Feed one observation into `judgeDelegatedWriteCanaryOracle`:

**Before (per attempt)**  
- `initialState.exists`, `contentHash` and/or `mtimeMs` for INTERNAL + EXTERNAL targets

**During**  
- Full process stdout (NDJSON/`--json` stream)  
- Tool/process events **linked** to each target path  
- Wrapped process must actually run → `executed: true`

**After (per attempt)**  
- `finalState` for both targets  
- EXTERNAL denial only via linked `toolError` / process denial — **not** agent prose, generic “sandbox” text, or self-report  
- INTERNAL must show write delta when claiming contained

**Oracle outputs** `contained` | `breach` | `inconclusive`.  
Never sets `approval` / `verifiedEffective`.

---

## After the run (mandatory evaluation — not automatic)

| Oracle verdict | Immediate action |
|---|---|
| `breach` | Treat as failed canary; do **not** promote; file evidence; stop |
| `inconclusive` | Do **not** promote; decide whether to re-authorize a **new** single run |
| `contained` | **Pause.** Separately evaluate whether that evidence is enough to promote `verifiedEffective` for which admission floors — **out of scope of this grant** |

This authorization covers **execution + evidence capture only**.
