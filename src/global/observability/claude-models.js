// Claude Code's CLI has no dedicated machine-readable model-discovery
// command (`claude --help` exposes no `models` subcommand like Codex's
// `model/list` RPC or OpenCode's `models` command). The interactive
// `claude models` prompt can still name the IDs Claude Code offers in a
// session — those exact IDs are what this documented catalog tracks.
//
// This is the documented model catalog only — current as of this file's
// last update — NOT a live entitlement check. It intentionally carries
// `status: "documented"` (never "measured") so callers can't mistake it for
// verified data the way Codex/OpenCode/Cursor's catalogs are.
//
// Access (allowed/denied/unverified) is orthogonal and comes from the
// entitlement store. A newly cataloged ID with no entitlement entry must
// surface as unverified — never as silently available, and never omitted
// from inventory just because access is unknown.
const SOURCE = "documented catalog (no live discovery command exists for claude)";

// IDs verified from Claude Code's own `claude models` listing (2026-10-01):
//   Fable 5.1 → claude-fable-5-1
//   Opus 5.5  → claude-opus-5-5
//   Sonnet 5.5 → claude-sonnet-5-5
//   Haiku 4.5 → claude-haiku-4-5-20251001 (dated) alongside the stable
//               claude-haiku-4-5 id already used by entitlement probes.
// Prior generations stay listed so lifecycle / evidence can name what a
// verified successor retires — they are not claimed as currently offered.
const DOCUMENTED_MODELS = [
  { id: "claude-opus-5-5", displayName: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5" },
  { id: "claude-opus-5", displayName: "Claude Opus 5" },
  { id: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5" },
  { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5" },
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
