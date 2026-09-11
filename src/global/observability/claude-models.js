// Claude Code's CLI has no model-discovery command (`claude --help` exposes
// no `models` subcommand, unlike Codex's `model/list` RPC or OpenCode's
// `models` command) — verified by inspecting its full --help output, not
// assumed. So there is no live, per-account catalog to read.
//
// This is the documented model catalog only — current as of this file's
// last update — NOT a live entitlement check. It intentionally carries
// `status: "documented"` (never "measured") so callers can't mistake it for
// verified data the way Codex/OpenCode/Cursor's catalogs are.
const SOURCE = "documented catalog (no live discovery command exists for claude)";

const DOCUMENTED_MODELS = [
  { id: "claude-opus-5", displayName: "Claude Opus 5" },
  { id: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5" },
  { id: "claude-fable-5-1", displayName: "Claude Fable 5.1" },
  { id: "claude-fable-5", displayName: "Claude Fable 5" },
  { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
  { id: "claude-opus-4-7", displayName: "Claude Opus 4.7" },
  { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" }
];

/**
 * Returns the documented Claude model catalog. Always synchronous and
 * always `status: "documented"` — there is nothing to fail closed on since
 * no live read is attempted.
 */
export function readClaudeModels() {
  return { status: "documented", source: SOURCE, models: DOCUMENTED_MODELS.slice(), error: null };
}
