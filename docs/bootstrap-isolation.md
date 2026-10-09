# Bootstrap Analysis isolation

Bootstrap Analysis (`runBootstrapAnalysis`) is the only path that claims a
**filesystem confinement** for investigating a snapshot. General ASK does not
inherit this guarantee. **Delegated productive runs** (worktrees, `startRun`,
authorized writes) use a different containment model — see
[`delegated-execution-containment.md`](delegated-execution-containment.md).
Do not cite Bootstrap canaries as evidence for delegated write posture.

Two axes stay separate:

| Axis | Values | Meaning |
|---|---|---|
| `isolation` | `verified` \| `restricted` \| `unverified` | **Who** enforces the boundary |
| `canaryTested` | boolean | **Whether** that boundary was empirically proven (real out-of-bounds attempt denied) |

Never treat a vendor `--sandbox` / `--restricted` flag as `verified` without an
independent canary. Never silently fall back to a non-confining mode when the
real boundary is unavailable.

## Adapter guarantee matrix

| Adapter | Can guarantee Bootstrap confinement? | `isolation` when eligible | Mechanism | Evidence |
|---|---|---|---|---|
| **Codex** | **Yes**, on macOS with `/usr/bin/sandbox-exec` | `verified` | External `sandbox-exec` profile around `codex exec`; Codex’s own sandbox **disabled** (`--dangerously-bypass-approvals-and-sandbox`) so layers do not nest | Canary: in-bounds read OK; absolute-path read outside snapshot denied (`Operation not permitted`). Codex’s own `--sandbox read-only` alone still allows out-of-bounds **reads** (write-only restriction) — **not** the Bootstrap guarantee |
| **Cursor** | **Yes**, on macOS with `sandbox-exec` | `verified` | Same external wrapper around `cursor-agent`; Cursor’s `--sandbox` set to **`disabled`** | Canary: in-bounds read OK; out-of-bounds absolute read denied (`Permission denied`). Cursor’s own `--sandbox enabled` alone **does not** confine reads (absolute outside path succeeded and disclosed content) — **not** the Bootstrap guarantee |
| **Claude** | **Partial** (application-enforced only) | `restricted` | Claude CLI `--restricted` / tool-permission logic inside the process | Canary: out-of-bounds absolute Read denied via `permission_denials`; in-bounds succeeds. A bug in Claude’s own permission logic could bypass this — never labeled `verified` |
| **OpenCode / Pi / others** | **No** | `unverified` | No Bootstrap analyzer adapter | `createBootstrapAnalyzerAdapter` returns ineligible `not implemented`; never invents a boundary |

Platform rule: Codex and Cursor report `isolation: unverified` / `isolation_unavailable` off macOS or without `sandbox-exec`. Callers fail closed — no silent fallback to the provider’s non-confining flag.

## What the SBPL profiles actually allow

External profiles (`codex-sandbox.js`, `cursor-sandbox.js`) use `(deny default)` and
then allow reads/writes only under explicit subpaths (snapshot root, provider
home, and Cursor-specific paths such as `~/.local` + Keychains).

- **Writes outside the snapshot** (and outside those explicit homes) are denied
  by the OS profile, not by model prose.
- Honest limit: provider home (e.g. `CODEX_HOME`) must also be writable for the
  CLI to start; the whole confined process tree shares that allow — it still
  cannot escape the snapshot boundary into an arbitrary workspace path.

## Incompatible configuration (fail closed)

These setups must never be reported as a held Bootstrap boundary:

| Config | Why incompatible |
|---|---|
| Codex/Cursor on Linux/Windows | No `sandbox-exec` implementation |
| Cursor `--sandbox enabled` alone (no external wrapper) | Empirically non-confining for reads |
| Nesting Codex’s internal sandbox **and** outer `sandbox-exec` | Empirically breaks every tool call (`sandbox_apply`) |
| Missing/failed Cursor auth for Auto, or unknown model id | Eligible gate fails before isolation is claimed |
| Claude without auth / unknown model / DENIED entitlement | Ineligible; isolation reported `unverified` |
| Unknown `adapterId` | Honest “not implemented”, never falls through to another provider |

## Related code

- Adapters: `src/global/conversation/bootstrap-analyzer-adapters.js`
- Boundaries: `src/global/conversation/codex-sandbox.js`, `cursor-sandbox.js`
- Tests: `test/bootstrap-analyzer-adapters.test.js`, `test/codex-sandbox.test.js`,
  `test/cursor-sandbox.test.js`, `test/bootstrap-isolation-boundary.test.js`

## Native RDD note (separate)

Persistence commits on this branch may still show Gentle assess
`risk: high` / `review_due: true` without a granted receipt. That review state is
orthogonal to this isolation contract and must not be treated as approval.

## Not this document

Authorized-write delegated execution (worktrees, Codex `workspace-write`,
permission authority) is documented in
[`delegated-execution-containment.md`](delegated-execution-containment.md).
