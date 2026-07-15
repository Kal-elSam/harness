import { BACKEND_IDS } from "./intelligence/index.js";

const EPHEMERAL_BACKENDS = new Set([
  BACKEND_IDS.OLLAMA,
  BACKEND_IDS.OPENROUTER,
  BACKEND_IDS.OPENCODE_GO,
  BACKEND_IDS.OPENCODE_ZEN,
  BACKEND_IDS.OPENCODE
]);

const BACKEND_HINT =
  "Use opencode-go, opencode-zen, opencode, ollama, or openrouter.";

/**
 * Resolve ephemeral CLI --backend/--model overrides.
 * Does not read or write profiles; credentials stay in env.
 */
export function resolveSessionOverride(options = {}) {
  if (options.intelligenceBackend != null && String(options.intelligenceBackend).trim() === "") {
    throw new Error(`Missing --backend value. ${BACKEND_HINT}`);
  }

  const preferredBackend = options.intelligenceBackend == null
    ? null
    : String(options.intelligenceBackend).trim();
  const preferredModel = options.model == null || String(options.model).trim() === ""
    ? null
    : String(options.model).trim();

  if (!preferredBackend && !preferredModel) return null;

  if (preferredBackend && !EPHEMERAL_BACKENDS.has(preferredBackend)) {
    throw new Error(`Unknown --backend "${preferredBackend}". ${BACKEND_HINT}`);
  }

  return { preferredBackend, preferredModel };
}
