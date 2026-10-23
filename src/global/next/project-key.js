import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

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
 * Repository root that owns a linked worktree's shared identity. A linked
 * worktree has a `.git` FILE (`gitdir: PATH`) whose gitdir holds a `commondir`
 * file pointing at the shared `.git` directory; its parent is the main
 * checkout. A `.git` directory, a missing `.git`, or any read error keeps the
 * path unchanged (synchronous fs reads only, no git process).
 */
function resolveRepositoryRoot(projectPath) {
  try {
    const gitPath = join(projectPath, ".git");
    if (!statSync(gitPath).isFile()) return projectPath;
    const pointer = readFileSync(gitPath, "utf8").match(/^gitdir:\s*(.+?)\s*$/m);
    if (!pointer) return projectPath;
    const gitDir = resolve(projectPath, pointer[1]);
    const commonDir = resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim());
    return dirname(commonDir);
  } catch {
    return projectPath;
  }
}

/**
 * Stable workspace key derived from an absolute project path.
 * A linked worktree shares its main checkout's key; the main checkout keeps
 * its historical key. Agents must not supply this — callers compute it from
 * runtime cwd/workspace.
 */
export function projectKeyForPath(projectPath) {
  const root = canonicalizeProjectPath(resolveRepositoryRoot(canonicalizeProjectPath(projectPath)));
  const normalized = root.toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
