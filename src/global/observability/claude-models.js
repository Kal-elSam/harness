import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveHomeDir } from "../paths.js";

// Claude Code's CLI has no dedicated machine-readable model-discovery
// command (`claude --help` exposes no `models` subcommand like Codex's
// `model/list` RPC or OpenCode's `models` command). Claude Code does keep
// the catalog behind its own `/model` menu in
// `~/.claude/cache/model-catalog/<id>-cc.json` and refreshes it itself, so
// that file is the live source when present. It is an INTERNAL, undocumented
// format: every read is validated strictly and any failure falls back to the
// documented list below, never throws and never blocks a caller.
//
// Result labels stay honest: `status: "cached"` (with `fetchedAt`) when the
// Claude Code cache was read, `status: "documented"` when only the list in
// this file was used. Neither is a live entitlement check, and neither is
// ever "measured" the way Codex/OpenCode/Cursor's catalogs are.
//
// Cached IDs are ADDED to the documented ones (union, never replace), so a
// model that left the menu does not vanish from inventory. Access
// (allowed/denied/unverified) is orthogonal and comes from the entitlement
// store: a newly seen ID with no entitlement entry surfaces as unverified,
// never as silently available.
const SOURCE = "documented catalog (no live discovery command exists for claude)";
const CACHE_SOURCE = "Claude Code model-catalog cache (~/.claude/cache/model-catalog) + documented catalog";
const CACHE_SCHEMA_VERSION = 2;
const CACHE_FILE_PATTERN = /-cc\.json$/;
const CLAUDE_ID_PATTERN = /^claude-[a-z0-9][a-z0-9.-]*$/;

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
 * Newest `*-cc.json` in Claude Code's model-catalog cache, parsed and
 * validated. Returns null on ANY problem (missing dir, unreadable file,
 * corrupt JSON, other schema version, no usable models).
 * @returns {{fetchedAt: string|null, models: Array<{id: string, displayName: string}>}|null}
 */
function readClaudeCodeCache(homeDir) {
  try {
    const dir = join(homeDir, ".claude", "cache", "model-catalog");
    const newest = readdirSync(dir)
      .filter((name) => CACHE_FILE_PATTERN.test(name))
      .map((name) => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!newest) return null;
    const doc = JSON.parse(readFileSync(join(dir, newest.name), "utf8"));
    if (doc?.version !== CACHE_SCHEMA_VERSION) return null;
    const entries = doc?.catalog?.config?.models;
    if (!Array.isArray(entries)) return null;
    const models = [];
    for (const entry of entries) {
      if (typeof entry?.id !== "string" || !CLAUDE_ID_PATTERN.test(entry.id)) continue;
      const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : entry.id;
      models.push({ id: entry.id, displayName: name.startsWith("Claude ") ? name : `Claude ${name}` });
    }
    if (models.length === 0) return null;
    const fetchedMs = Number(doc.fetchedAt);
    return { fetchedAt: Number.isFinite(fetchedMs) ? new Date(fetchedMs).toISOString() : null, models };
  } catch {
    return null;
  }
}

/**
 * Returns the Claude model catalog: the documented list, plus any extra IDs
 * Claude Code's own cache knows about. Always synchronous and never throws.
 * @param {{homeDir?: string}} [options]
 */
export function readClaudeModels({ homeDir } = {}) {
  const documented = DOCUMENTED_MODELS.slice();
  const cache = readClaudeCodeCache(homeDir ?? resolveHomeDir());
  if (!cache) return { status: "documented", source: SOURCE, models: documented, error: null };
  const known = new Set(documented.map((model) => model.id));
  const added = cache.models.filter((model) => !known.has(model.id) && known.add(model.id));
  return {
    status: "cached",
    source: CACHE_SOURCE,
    fetchedAt: cache.fetchedAt,
    models: [...documented, ...added],
    error: null
  };
}
