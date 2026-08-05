import { statSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export const GRAPHIFY_PARSE_TTL_MS = 5_000;
export const GRAPHIFY_PARSE_MAX_ENTRIES = 8;

const CACHEABLE = new Set(["ok", "stale"]);

/** @type {Map<string, { value: object, expiresAt: number }>} */
const entries = new Map();

export function resetGraphifyParseCacheForTests() {
  entries.clear();
}

export function graphifyParseCacheSizeForTests() {
  return entries.size;
}

function touch(key, entry) {
  entries.delete(key);
  entries.set(key, entry);
}

function evictOldest(maxEntries) {
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next().value;
    if (oldest == null) break;
    entries.delete(oldest);
  }
}

export function buildGraphifyParseIdentity(resolvedPath, headSha, {
  stat = (p) => statSync(p)
} = {}) {
  const st = stat(resolvedPath);
  return [
    String(resolvedPath),
    String(st.dev),
    String(st.ino),
    String(st.size),
    String(st.mtimeMs),
    String(headSha ?? "")
  ].join("\0");
}

/**
 * Passive ok|stale parse cache. missing|malformed|error never cached.
 * Caller must pass `inspect` (usually inspectGraphArtifact) to avoid cycles.
 * Graphify ops must keep calling inspectGraphArtifact directly.
 */
export function inspectGraphArtifactCached(graphPath, options = {}) {
  const {
    inspect,
    now = Date.now,
    ttlMs = GRAPHIFY_PARSE_TTL_MS,
    maxEntries = GRAPHIFY_PARSE_MAX_ENTRIES,
    stat = (p) => statSync(p),
    realpath = (p) => realpathSync(p),
    cwd = process.cwd(),
    headSha = null,
    ...rest
  } = options;

  if (typeof inspect !== "function") {
    throw new Error("inspectGraphArtifactCached requires options.inspect");
  }

  if (typeof graphPath === "string" && graphPath.trim()) {
    try {
      const resolved = realpath(resolve(cwd, graphPath));
      const identity = buildGraphifyParseIdentity(resolved, headSha, { stat });
      const hit = entries.get(identity);
      if (hit && hit.expiresAt > now()) {
        touch(identity, hit);
        return hit.value;
      }
      const result = inspect(graphPath, { ...rest, cwd, headSha, realpath });
      if (CACHEABLE.has(result?.status)) {
        touch(identity, { value: result, expiresAt: now() + ttlMs });
        evictOldest(maxEntries);
      }
      return result;
    } catch {
      /* identity unavailable — fall through */
    }
  }

  return inspect(graphPath, { ...rest, cwd, headSha, realpath });
}
