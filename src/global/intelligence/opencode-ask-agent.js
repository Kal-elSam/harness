import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

// OpenCode's real CLI (`opencode run --help`) has no flag-driven read-only
// mode — its permission model lives only in opencode.json (verified via
// its own published schema, https://opencode.ai/config.json, and a real
// working precedent already present in this machine's own global config:
// gentle-ai/sdd's "explore" agent, which uses this exact same
// bash/edit/task/write-deny shape to stay read-only). So a genuinely
// portable read-only ASK call needs Kairo to own one real agent entry in
// the user's GLOBAL opencode.json — never per-project (would pollute
// every repo it touches) — merged in non-destructively and never
// overwriting anything else already there.
export const KAIRO_ASK_AGENT_NAME = "kairo-ask";

// No "model" field on purpose — the real model comes from askOpencode's
// own `--model` CLI flag per call, exactly like askCodex/askClaude/
// askCursor already do; this agent only ever fixes the PERMISSION shape.
// No "read" key: the same real, working "explore" agent precedent above
// carries no explicit "read" entry either — omitted means allowed.
//
// Deliberately NO "__managed_by" marker (unlike the sibling "explore"
// agent's convention this was modeled on) — verified live that it isn't
// a real AgentConfig property at all: the real opencode.ai/config.json
// schema never defines it, and a live `opencode run` call with it present
// failed outright ("Unsupported parameter(s): `__managed_by`" from the
// real upstream API, which apparently receives it verbatim). Ownership is
// tracked by the unique key name (KAIRO_ASK_AGENT_NAME) instead.
export const KAIRO_ASK_AGENT_CONFIG = Object.freeze({
  description: "Kairo's own real, read-only agent for ASK mode — investigates and answers, never edits, writes, or runs shell commands.",
  hidden: true,
  mode: "primary",
  permission: Object.freeze({ bash: "deny", edit: "deny", task: "deny", write: "deny" })
});

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function resolveOpencodeConfigPath(homeDir = homedir()) {
  return join(homeDir, ".config", "opencode", "opencode.json");
}

/**
 * Idempotently ensures the real, global opencode.json carries Kairo's own
 * read-only "kairo-ask" agent — merged non-destructively (every other real
 * key, including every other agent, is preserved byte-for-byte) and only
 * ever written when actually missing or drifted, never on every call.
 * A missing config file is created fresh with just $schema + this agent —
 * never treated as an error (a real, common first-run state).
 * @param {{homeDir?: string, readFileImpl?: Function, writeAtomicJsonImpl?: Function}} [deps]
 * @returns {Promise<{changed: boolean, configPath: string}>}
 */
export async function ensureKairoAskAgent({
  homeDir = homedir(), readFileImpl = readFile, writeAtomicJsonImpl = writeAtomicJson
} = {}) {
  const configPath = resolveOpencodeConfigPath(homeDir);
  let config = { $schema: "https://opencode.ai/config.json" };
  try {
    const raw = await readFileImpl(configPath, "utf8");
    config = JSON.parse(raw);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const existing = config.agent?.[KAIRO_ASK_AGENT_NAME];
  if (deepEqual(existing, KAIRO_ASK_AGENT_CONFIG)) {
    return { changed: false, configPath };
  }
  const updated = { ...config, agent: { ...(config.agent ?? {}), [KAIRO_ASK_AGENT_NAME]: KAIRO_ASK_AGENT_CONFIG } };
  await writeAtomicJsonImpl(configPath, updated);
  return { changed: true, configPath };
}
