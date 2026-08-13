# Intelligence layer

Kairo owns **Harness Engineering** governance: compile relevant project context, route to a backend, and require human confirmation for cloud transmission. It does not store credentials and never reads OpenCode `auth.json`.

**0.8.0 freeze:** intelligence routing does **not** feed the Gentle workflow
section of `kairo control-plane`. Methodology, SDD, and `next_transition`
stay Gentle’s — see [Gentle companion boundary](gentle-companion.md).

| Backend | Detection | Invoke |
|---|---|---|
| Ollama | `GET $OLLAMA_HOST/api/tags` (default `http://127.0.0.1:11434`) | Local chat |
| OpenCode Go | `OPENCODE_API_KEY` → `https://opencode.ai/zen/go/v1` | Chat Completions (subscription labels; entitlement unverified from key alone) |
| OpenCode Zen | `OPENCODE_API_KEY` → `https://opencode.ai/zen/v1` | Chat Completions + Responses (credits; never auto-spent from Go failures) |
| OpenCode CLI (`opencode`) | CLI installed + `opencode auth list` providers | `opencode run --format json --model` with an analysis-only preamble (not a universal non-mutation guarantee) |
| OpenRouter | `OPENROUTER_API_KEY` in env | `openrouter/free` after `--cloud-consent` + `--yes` |
| Custom HTTP | Profile `customProviders` (`baseUrl`, `modelId`, optional local-only `apiKeyEnv`) | OpenAI-compatible `/chat/completions` |

Routing order: ephemeral CLI `--backend`/`--model` → profile override → Ollama → OpenCode Go → OpenCode Zen → OpenRouter free → diagnostics. OpenCode CLI runtime is override-only (not auto-routed).

```bash
export OPENCODE_API_KEY=...   # env only; never persisted by Kairo
kairo intelligence status --json
kairo intelligence models --backend opencode-go
kairo intelligence route --backend opencode-go --model kimi-k2.7-code --cloud-consent
kairo intelligence ask --prompt "Summarize risks" --backend opencode --model opencode/claude-haiku-4-5 --cloud-consent --yes
```

Detection states stay differentiated: configured ≠ authenticated ≠ entitlement ≠ balance. An API key means a credential is present, not that login, subscription, or spend was verified.

Private paths (`.env`, secrets, keys) are excluded from context packs unless `--include-private`.
Remote custom providers require explicit cloud consent and cannot receive an `apiKeyEnv` credential in 0.2.0; use a built-in provider or a local custom endpoint for env-backed authentication.

