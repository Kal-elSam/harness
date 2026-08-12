/**
 * Resolve the workspace path for Kairo MCP identity.
 *
 * Cursor IDE launches global `mcpServers.kairo` with process cwd = $HOME even
 * when the entry sets `cwd: "."`. It does inject the open folder via
 * VSCODE_CWD / WORKSPACE_FOLDER_PATHS — prefer those over process.cwd().
 */
import { resolve } from "node:path";
import { canonicalizeProjectPath } from "../next/project-key.js";

function firstNonEmpty(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse Cursor/VS Code workspace folder env into an ordered path list.
 * WORKSPACE_FOLDER_PATHS uses commas when Cursor opens multiple roots.
 */
export function parseWorkspaceFolderPaths(raw) {
  const text = firstNonEmpty(raw);
  if (!text) return [];
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string} absolute workspace path
 */
export function resolveMcpWorkspaceCwd({
  cwd,
  env = process.env
} = {}) {
  let chosen;
  if (typeof cwd === "string" && cwd.trim()) {
    chosen = resolve(cwd.trim());
  } else {
    const fromFolders = parseWorkspaceFolderPaths(env.WORKSPACE_FOLDER_PATHS);
    if (fromFolders.length > 0) {
      chosen = resolve(fromFolders[0]);
    } else {
      const vscodeCwd = firstNonEmpty(env.VSCODE_CWD);
      chosen = vscodeCwd ? resolve(vscodeCwd) : resolve(process.cwd());
    }
  }
  return canonicalizeProjectPath(chosen);
}
