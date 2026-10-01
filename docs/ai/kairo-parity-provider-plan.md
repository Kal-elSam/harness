# Kairo parity — bounded real-provider ASK verification plan

Status: **PARTIAL.** Codex, Claude and OpenCode Go basic real `OK` responses **PASS** (2026-10-01). Cursor provider still pending. Approved-team → usable-provider product path not verified. Nothing further runs without explicit per-provider authorization.
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

## Local inventory (2026-10-01, user-authorized, no network, no prompts)

Collected with `--version`, `--help` and three login-state commands run under `sandbox-exec` with the network denied (a control `curl` failed under the same sandbox, so these commands did not need the network). No credential values, emails or org identifiers are recorded here.

| Provider | Version | Flags confirmed in `--help` | Local login state |
|---|---|---|---|
| Codex | codex-cli 0.159.3 | `exec`, `--sandbox`, `--json`, `-o/--output-last-message`, `--skip-git-repo-check`, `--ephemeral`, `--model` | `codex login status`: logged in using ChatGPT (subscription login, not an API key) |
| Claude | 2.1.286 | `-p`, `--output-format`, `--restricted`, `--strict-mcp-config`, `--model` | `claude auth status`: logged in, `authMethod claude.ai`, `apiProvider firstParty`, `subscriptionType pro` |
| Cursor | 2026.09.28-64d2043 | `-p`, `--mode ask` (read-only), `--output-format`, `--model`, `--list-models` | NOT inspected (`cursor-agent status` may use the network; separate authorization) |
| OpenCode | 1.18.33 | `run`, `--agent`, `--format json`, `--model provider/model` | `opencode auth list`: 6 credentials: GitHub Copilot (oauth), OpenAI (oauth), Google (api), Anthropic (api), OpenCode Zen (api), OpenCode Go (api) |

### Exact commands per test (model left explicit; nothing has been run)

Run each from an empty temp directory, with the adapter's allowlisted env, one prompt `Reply with the single word OK.`, abort at 60 s.

1. Codex: `codex --model <MODEL> exec --sandbox read-only --skip-git-repo-check -o <TMP>/answer.txt --json "Reply with the single word OK."`
2. Claude: `claude -p "Reply with the single word OK." --output-format json --restricted --strict-mcp-config --model <MODEL>`
3. OpenCode (Go): `opencode run --agent kairo-ask --format json --model opencode-go/<MODEL> "Reply with the single word OK."` with the read-only `OPENCODE_CONFIG_CONTENT` built by `opencode-ask-agent.js`.
4. Cursor: pending (account not inspected).

### What each run can verify vs what stays pending

Verifiable by one run per provider: the real stdout/stderr event shape against the parser (`mapCodexEvent` for Codex; single JSON `result` for Claude; NDJSON `text`/`error` for OpenCode), whether thinking/tool events appear, that the final answer surfaces, and exit codes. A successful `OK` run certifies only the events actually observed in that run; it does NOT verify the error path (auth failure, rate limit, invalid model, malformed output), which stays pending unless an error is observed or provoked under a separate authorization.

Stays pending even after these runs: the provider error paths, cancel mid-stream and session switch/quit/restore with a real provider (needs a longer prompt and more spend), tool-using prompts, Cursor, OpenAI/Google/Anthropic/Copilot routes through OpenCode, behavior under rate limits or expired sessions, and the exact token/credit cost (not exposed before the run).

### Still needed before running

- `<MODEL>` per provider. Listing models (`opencode models`, `codex` catalog, `claude` model aliases) may query the provider, so it needs its own authorization; alternatively the user names the model.
- Per-provider go/no-go.

## Model availability (2026-10-01, user-authorized model query; nothing was executed against a model)

All three lookups were answered from local sources. No provider availability query, prompt or inference was made; Cursor and the other five OpenCode credentials were not touched. Availability below is "listed locally", not "proven usable by this account" (only a real run can prove that).

| Provider | Candidate model (exact ID) | Credential used | Origin of availability |
|---|---|---|---|
| Codex | `gpt-6-luna` (visibility `list`, `supported_in_api` true, priority 4). Other listed: `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` | ChatGPT login of the Codex CLI (`CODEX_HOME`/`HOME`) | `~/.codex/models_cache.json`, written by the Codex CLI itself (client 0.159.3, `fetched_at` 2026-10-01T17:40Z). Account-specific list as of that fetch. Per-model cost is not exposed there; "luna" is only a naming hint of a smaller tier. |
| Claude | `claude-haiku-4-5` (light tier in the router mapping). Other documented: `claude-sonnet-5`, `claude-opus-5`, `claude-fable-5-1`, `claude-fable-5`, `claude-opus-4-8/4-7/4-6`, `claude-sonnet-4-6` | claude.ai Pro login (`CLAUDE_CONFIG_DIR`/`HOME`) | Static documented list in `src/global/observability/claude-models.js` (`status: "documented"`, no live read). The Claude CLI has no model-listing command; whether the Pro plan can use `claude-haiku-4-5` can only be proven by a run. |
| OpenCode Go | `opencode-go/space-bunny-free` (catalog cost input/output 0). Alternatives: `opencode-go/longcat-2.5-preview-free` (cost 0); cheapest paid: `muse-spark-1.2-contributor` / `1.3-contributor` (0.1 in / 0.2 out per M tokens) | `OpenCode Go (api)` entry of `opencode auth list` (entry name only; the other 5 credentials are not used) | `opencode models opencode-go` run offline under a network-denied sandbox (29 models, local cache `~/.cache/opencode/models.json` refreshed 2026-10-01 11:19). Costs come from that catalog; actual Go plan billing is not determinable from it. |

Notes: the offline `opencode-go` list (29) and the cache entry for `opencode-go` differ slightly (e.g. cache also has `qwen3.7-max`, `kimi-k2.6`, `grok-4.5`, `qwen3.6-plus`); the CLI list is the authoritative one for what can be selected. "Free" in the catalog means zero listed per-token cost, not proof that no quota is consumed.

Availability, model selection and execution are three separate decisions. Listing models authorizes none of the runs above.

## Results of the authorized runs (2026-10-01)

One run per provider, prompt `Reply with the single word OK.`, empty temp cwd, adapter env allowlist, 60 s abort, stdin ignored. All three exited 0 well inside the limit and answered `OK`. A successful `OK` run certifies only the events observed below; it says nothing about error paths.

| Provider / model | Wall time | Observed events | Observed consumption | Matches parser? |
|---|---|---|---|---|
| Codex `gpt-6-luna` | 7.8 s | stdout JSONL: `thread.started`, `turn.started`, `item.completed` (`agent_message`, text `OK`), `turn.completed` (with `usage`). `-o` file contained `OK`. stderr: `Reading additional input from stdin...` | 18 949 input tokens (7 936 cached), 5 output | Yes. `mapCodexEvent` ignores `agent_message`/`thread.*`/`turn.*`; the final answer correctly comes from the `-o` file. First observation of the real Codex `--json` schema (previously UNVERIFIED in code). Item id `item_0` seen; whether ids restart per run is now observed once (per-turn `item_0`), not proven. |
| Claude `claude-haiku-4-5` | 2.2 s | One JSON object: `type:"result"`, `subtype:"success"`, `is_error:false`, `result:"OK"`, `modelUsage` key `claude-haiku-4-5`, `usage`, `total_cost_usd`. stderr empty. `--restricted` accepted. | `total_cost_usd` about 0.0093 (10 input + 3 997 cache-creation + 10 607 cache-read tokens) | Yes for the success path. |
| OpenCode Go `opencode-go/space-bunny-free` | 4.7 s | NDJSON: `step_start`, `text` (`part.text` `OK`), `step_finish` (`reason:"stop"`). stderr: two `[skill-registry] skipping refresh` lines. | 24 621 total tokens (22 698 input, 3 output); reported `cost` 0 | Yes. The parser reads `type:"text"` and ignores step events. |

Observed with all three: no thinking events, no tool events (none were requested), no error events.

### Verified by these runs
- The real success-path event/JSON shapes of Codex, Claude and OpenCode Go match what `quick-ask.js` parses.
- `claude --restricted` and the other planned flags are accepted by the installed CLIs.
- Real baseline consumption is dominated by CLI context, not the prompt (about 19k to 25k input tokens for a one-word answer).

### Still pending (not verified)
- Provider error paths (auth failure, rate limit, invalid model, malformed output). One specific risk to test before trusting it: `quick-ask.js` for Claude does not check `is_error`; the real shape does carry `is_error` and `subtype`, so an `is_error:true` response whose `result` is an error string would currently be reported as an answer. This is a code-reading concern, not an observed failure.
- Cancel mid-stream, session switch, quit and restore with a real provider.
- Thinking and tool-event shapes (needs a prompt that triggers tools, more spend).
- Cursor (not authorized or inspected).
- Whether item ids restart across runs in Codex (observed `item_0` only once).

### Product vs provider (separate certifications)
- **"Provider responds"** (above): adapter/CLI + parser happy path for Codex / Claude / OpenCode Go.
- **"Packaged product works with that provider"** is NOT certified by those runs. Still open: packaged host with an **approved team** and a **usable provider**, plus human visual acceptance of the real product (fixture HTML review is separate).
- Do not re-run the three real `OK` prompts to re-collect Claude's evidence.
