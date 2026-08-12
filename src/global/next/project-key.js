import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * Canonical absolute path for workspace identity.
 * On macOS `/tmp` → `/private/tmp`; without realpath those alias to different keys.
 * Walks up to an existing ancestor when the leaf path does not exist yet.
 */
export function canonicalizeProjectPath(projectPath) {
  const resolved = resolve(String(projectPath ?? ""));
  try {
    return realpathSync(resolved);
  } catch {
    const parts = resolved.split(sep);
    for (let i = parts.length - 1; i > 0; i -= 1) {
      const prefix = parts.slice(0, i).join(sep) || sep;
      try {
        const realPrefix = realpathSync(prefix);
        return resolve(realPrefix, ...parts.slice(i));
      } catch {
        // keep walking up
      }
    }
    return resolved;
  }
}

/**
 * Stable workspace key derived from an absolute project path.
 * Agents must not supply this — callers compute it from runtime cwd/workspace.
 */
export function projectKeyForPath(projectPath) {
  const normalized = canonicalizeProjectPath(projectPath).toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
