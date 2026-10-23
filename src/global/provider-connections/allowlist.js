// Fixed, explicit argv allowlists for the provider connections backend.
// Nothing outside these lists is ever executed: callers choose a provider id
// and an action, never an argv, a command string or an environment.
//
// Deliberately absent (never to be added): `--with-api-key`,
// `--with-access-token`, `--api-key`, `CURSOR_API_KEY` and any other flag or
// variable that moves a secret through argv/stdin/env. Kairo only ever starts
// the vendor's own interactive login and lets the vendor store credentials.

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const PROVIDER_IDS = Object.freeze(["codex", "claude", "cursor", "opencode-go"]);

/** Read-only checks. [0] is the install check, [1] the auth/identity check. */
export const STATUS_ARGV = deepFreeze({
  codex: { version: ["codex", "--version"], auth: ["codex", "login", "status"] },
  claude: { version: ["claude", "--version"], auth: ["claude", "auth", "status", "--json"] },
  cursor: { version: ["cursor-agent", "--version"], auth: ["cursor-agent", "status", "--format", "json"] },
  "opencode-go": { version: ["opencode", "--version"], auth: ["opencode", "auth", "list"] }
});

/**
 * Interactive login, one fixed argv per provider.
 *
 * OpenCode Go: the argv is deliberately just `opencode auth login`.
 *  - Syntax verified from `opencode auth login --help` (no command was run):
 *    `opencode auth login [url] -p <provider id or name> -m <method label>`.
 *  - The local provider catalog (~/.cache/opencode/models.json) contains the
 *    provider id `opencode-go` (name "OpenCode Go", env OPENCODE_API_KEY), and
 *    `opencode models opencode-go` is how Kairo already lists its models.
 *    Neither proves that `auth login -p opencode-go` ACCEPTS that id, so no
 *    `-p`/`-m` is passed: the user picks provider and method interactively and
 *    the post-login `opencode auth list` check (T8) decides success.
 */
export const LOGIN_ARGV = deepFreeze({
  codex: ["codex", "login"],
  claude: ["claude", "auth", "login", "--claudeai"],
  cursor: ["cursor-agent", "login"],
  "opencode-go": ["opencode", "auth", "login"]
});

export const PROVIDER_LABELS = deepFreeze({
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  "opencode-go": "OpenCode Go"
});

export const SUPPORTED_ACTIONS = Object.freeze(["login"]);

// None of these checks has been confirmed offline-safe by a recorded isolated
// run, so every surface that may touch the network is reported "unverified".
export const NETWORK_VERIFICATION = "unverified";

/** Surfaces a login touches. OpenCode's browser use depends on the chosen method. */
export const LOGIN_SURFACES = deepFreeze({
  codex: ["browser", "credential-store", "network", "terminal"],
  claude: ["browser", "credential-store", "network", "terminal"],
  cursor: ["browser", "credential-store", "network", "terminal"],
  "opencode-go": ["browser", "credential-store", "network", "terminal"]
});

export const LOGIN_SURFACE_NOTES = deepFreeze({
  "opencode-go": "You choose the provider and login method interactively; browser use depends on that choice."
});

/** Env vars that carry credentials; stripped before any provider CLI runs. */
export const SECRET_ENV_KEYS = Object.freeze([
  "CURSOR_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "OPENCODE_API_KEY"
]);

export function isProviderId(value) {
  return typeof value === "string" && PROVIDER_IDS.includes(value);
}
