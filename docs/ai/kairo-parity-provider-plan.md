# Kairo parity — bounded real-provider ASK verification plan

Status: **NOT EXECUTED.** Nothing here runs without explicit user authorization per provider.
Tracker: `odd/tasks/kairo-parity.md` (U3 item b).

## Purpose

Close the only open U3 item: confirm that the real ASK event shapes of each provider match what the parsers in `src/global/intelligence/quick-ask.js` expect. Today every provider path is covered only by fake-spawn tests; the Codex `--json` schema is explicitly marked UNVERIFIED in code (`quick-ask.js:187-191`).

## Common bounds (apply to every run)

- One run per provider. One tiny read-only prompt: `Reply with the single word OK.` No tools requested, no repository context added.
- Stop on the first failure of a provider; no retries without a new authorization.
- Use the adapter's own invocation (same argv as ASK), read-only, from an empty temp working directory.
- Capture the raw stdout/stderr to a temp file for shape comparison; redact before writing anything to the repo; never record credential values.
- Idle timeout is the existing 30 000 ms; abort after 60 s wall clock.
- Cheapest/default model only; no heavy or reasoning model.
- No push, PR, or file writes outside the temp directory.

## Per provider

| Provider | Operation (as ASK runs it) | Credential used | What we verify | Expected consumption |
|---|---|---|---|---|
| Codex | `codex exec --sandbox read-only --skip-git-repo-check -o <tmp>/answer.txt --json "<prompt>"` | The Codex CLI's own login via `CODEX_HOME`/`HOME` (no API-key env). Billing mode not determinable from code. | Real `--json` item/turn field names, whether item ids restart per run, whether reasoning/tool events appear, `-o` answer file. | One short turn on the default model. Exact tokens not determinable from code. |
| Claude | `claude -p "<prompt>" --output-format json --restricted --strict-mcp-config` | The Claude CLI's own login via `CLAUDE_CONFIG_DIR`/`HOME` (subscription checked by `claude auth status`, no API-key env). | Whether `--restricted` exists in the installed CLI; single JSON object has string `result`; `is_error` handling. | One short turn, light effort tier (haiku). Not determinable beyond that. |
| Cursor | `cursor-agent -p "<prompt>" --mode ask --output-format json` | `CURSOR_API_KEY`/`CURSOR_API_ENDPOINT` if set, otherwise the CLI's own login. Billing mode not determinable. | JSON `{type:"result", is_error, result}` shape; plain-stderr failure shape. Cursor credits are scarce: run only after the user confirms the account and model. | One short turn on the catalog default (`auto` omits `--model`). Not determinable. |
| OpenCode (Go/Zen) | `opencode run --agent kairo-ask --format json "<prompt>"` with the per-run `OPENCODE_CONFIG_CONTENT` read-only agent | `OPENCODE_API_KEY` if set, otherwise `opencode auth` state. Billing mode not determinable. | NDJSON `type:"text"` parts, `type:"error"` shape, tool/thinking events (currently not parsed). | One short turn on the cheapest Go model (Zen: catalog default). Not determinable. |

## Honest limits

- No hard token or turn cap exists in the ASK code; the practical bounds are the single tiny prompt, the cheapest model, the 30 s idle timeout and the 60 s wall-clock abort above.
- CLI agents add their own system prompt and context overhead, so real usage is larger than the prompt. We cannot state exact token or credit consumption in advance.
- Running requires the user's real CLI login state, so these runs cannot use an isolated HOME. This is why each provider needs a separate authorization.

## Authorization needed (one answer per provider)

For each provider the user states: authorize or skip; which account/credential to use; which model (default = cheapest/default listed above). Until then the status of each provider stays **pending**, and the feature is not declared 100% functional.
