import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * Stable workspace key derived from an absolute project path.
 * Agents must not supply this — callers compute it from runtime cwd/workspace.
 */
export function projectKeyForPath(projectPath) {
  const normalized = resolve(String(projectPath ?? "")).toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
