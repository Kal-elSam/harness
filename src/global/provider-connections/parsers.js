// Defensive parsers for the allowlisted status commands. They return only a
// classified state plus an in-memory `identifier` (raw, used solely to compute
// the one-way fingerprint and then dropped). Anything ambiguous is "unknown",
// never "authenticated". Raw output never leaves this module.

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const MAX_VERSION_LENGTH = 48;

const unknown = (reason = "unparseable") => ({ state: "unknown", identifier: null, reason });
const result = (state, identifier = null) => ({ state, identifier, reason: null });

function clean(text) {
  return String(text ?? "").replace(ANSI, "");
}

export function parseVersion(stdout) {
  const match = /\d+(?:\.\d+)+[\w.+-]*/.exec(clean(stdout));
  if (!match) return null;
  return match[0].slice(0, MAX_VERSION_LENGTH);
}

function parseJson(text) {
  try {
    const parsed = JSON.parse(clean(text).trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function joinIdentity(source, keys) {
  const parts = keys
    .map((key) => (typeof source?.[key] === "string" ? source[key].trim() : ""))
    .filter(Boolean);
  return parts.length > 0 ? parts.join("|") : null;
}

const NOT_LOGGED_IN = /not logged in|logged out|not authenticated|login required|authentication required|please log ?in/i;
const LOGGED_IN = /logged in/i;

/** Generic "Not logged in" / "Logged in ..." text status. */
function parseLoginText(text, code) {
  const body = clean(text);
  if (NOT_LOGGED_IN.test(body)) return result("unauthenticated");
  if (code === 0 && LOGGED_IN.test(body)) return result("authenticated");
  return unknown();
}

// Codex exposes no stable account identity in `login status`.
export function parseCodexAuth({ stdout, stderr, code }) {
  return parseLoginText(`${stdout}\n${stderr}`, code);
}

// Same identifier recipe as runtime/execution-adapters/claude.js so a
// fingerprint computed here equals the one binding the Claude access cache.
export function parseClaudeAuth({ stdout }) {
  const status = parseJson(stdout);
  if (!status || typeof status.loggedIn !== "boolean") return unknown();
  if (status.loggedIn === false) return result("unauthenticated");
  const identifier = joinIdentity(status, ["email", "orgId", "organizationId", "accountUuid", "userId"]);
  const subscriptionType = typeof status.subscriptionType === "string" && status.subscriptionType.trim()
    ? status.subscriptionType.trim()
    : null;
  return { ...result("authenticated", identifier), subscriptionType };
}

function firstIdentity(scopes, keys) {
  for (const scope of scopes) {
    const identity = joinIdentity(scope, keys);
    if (identity) return identity;
  }
  return null;
}

const CURSOR_FLAGS = ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"];
const CURSOR_ID_KEYS = ["email", "userId", "user_id", "id"];

// The exact `cursor-agent status --format json` field names are NOT evidenced
// in this repo, so identity is read generically and stays null when absent.
export function parseCursorAuth({ stdout, stderr, code }) {
  const status = parseJson(stdout);
  if (!status) return parseLoginText(`${stdout}\n${stderr}`, code);
  const scopes = [status, status.user, status.account].filter((s) => s && typeof s === "object");
  const identifier = firstIdentity(scopes, CURSOR_ID_KEYS) ?? firstIdentity(scopes, ["name"]);
  const flag = CURSOR_FLAGS.map((key) => status[key]).find((value) => typeof value === "boolean");
  if (flag === false) return result("unauthenticated");
  if (flag === true) return result("authenticated", identifier);
  return identifier ? result("authenticated", identifier) : unknown();
}

// `opencode auth list` prints a "Credentials" section (one line per stored
// credential), optionally an "Environment" section, and an "N credentials"
// line. OpenCode Go counts as authenticated ONLY when its own entry is in the
// Credentials section. A whole-word match keeps "OpenCode Zen"/"OpenCode
// Gopher" out. An entry that only appears under Environment is not a stored
// credential, so it is ambiguous (unknown), never authenticated.
const SECTION_HEADER = /^[^\w]*(credentials|environment)\b/i;
const GO_ENTRY = /^[^\w]*(?:opencode[\s_-]*go)(?![\w-])/i;

export function parseOpenCodeGoAuth({ stdout }) {
  const body = clean(stdout);
  const count = /(\d+)\s+credentials?/i.exec(body);
  if (!count) return unknown();
  if (Number(count[1]) === 0) return result("unauthenticated");
  let section = null;
  let inCredentials = false;
  let inEnvironment = false;
  let sawCredentialsHeader = false;
  for (const line of body.split("\n")) {
    const header = SECTION_HEADER.exec(line);
    if (header) {
      section = header[1].toLowerCase();
      sawCredentialsHeader ||= section === "credentials";
      continue;
    }
    if (!GO_ENTRY.test(line)) continue;
    if (section === "credentials") inCredentials = true;
    else if (section === "environment") inEnvironment = true;
  }
  if (!sawCredentialsHeader) return unknown();
  if (inCredentials) return result("authenticated");
  if (inEnvironment) return unknown("environment_only");
  return result("unauthenticated");
}

export const AUTH_PARSERS = Object.freeze({
  codex: parseCodexAuth,
  claude: parseClaudeAuth,
  cursor: parseCursorAuth,
  "opencode-go": parseOpenCodeGoAuth
});
