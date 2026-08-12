/**
 * Resolve the workspace path for Kairo MCP identity.
 *
 * Cursor IDE launches global `mcpServers.kairo` with process cwd = $HOME even
 * when the entry sets `cwd: "."`. It does inject the open folder via
 * VSCODE_CWD / WORKSPACE_FOLDER_PATHS — prefer those over process.cwd().
 */
import { resolve } from "node:path";

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
  if (typeof cwd === "string" && cwd.trim()) {
    return resolve(cwd.trim());
  }

  const fromFolders = parseWorkspaceFolderPaths(env.WORKSPACE_FOLDER_PATHS);
  if (fromFolders.length > 0) {
    return resolve(fromFolders[0]);
  }

  const vscodeCwd = firstNonEmpty(env.VSCODE_CWD);
  if (vscodeCwd) {
    return resolve(vscodeCwd);
  }

  return resolve(process.cwd());
}
