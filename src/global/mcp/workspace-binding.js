/**
 * Explicit workspace binding for MCP writes.
 * Agents never supply paths. VSCODE_CWD never authorizes writes.
 * Canonical `--cwd` may match process.cwd() or the unique
 * WORKSPACE_FOLDER_PATHS entry (Cursor stdio has no cwd field).
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { canonicalizeProjectPath, projectKeyForPath } from "../next/project-key.js";
import { parseWorkspaceFolderPaths } from "./resolve-mcp-workspace.js";

export const WORKSPACE_BINDING_CODES = Object.freeze({
  UNBOUND: "workspace_unbound",
  AMBIGUOUS: "workspace_ambiguous",
  MISMATCH: "workspace_mismatch"
});

function fail(code, bound = false) {
  return { writable: false, bound, cwd: null, projectKey: null, code };
}

function isForbiddenWriteRoot(canonical, userHome) {
  const root = canonicalizeProjectPath("/");
  if (canonical === root || canonical === "/") return true;
  return canonical === canonicalizeProjectPath(userHome);
}

function tryCanonical(pathValue) {
  try {
    return canonicalizeProjectPath(pathValue);
  } catch {
    return null;
  }
}

function uniqueFolderCanonical(env) {
  const folders = parseWorkspaceFolderPaths(env.WORKSPACE_FOLDER_PATHS);
  if (folders.length > 1) return { code: WORKSPACE_BINDING_CODES.AMBIGUOUS, canonical: null };
  if (folders.length === 0) return { code: null, canonical: null };
  const canonical = tryCanonical(folders[0]);
  return { code: canonical ? null : WORKSPACE_BINDING_CODES.UNBOUND, canonical };
}

export function resolveWorkspaceWriteBinding({
  workspaceBound = false,
  cwdExplicit = false,
  cwd,
  processCwd = process.cwd(),
  userHome = homedir(),
  env = process.env
} = {}) {
  if (!workspaceBound) return fail(WORKSPACE_BINDING_CODES.UNBOUND);
  if (!cwdExplicit || typeof cwd !== "string" || !cwd.trim()) {
    return fail(WORKSPACE_BINDING_CODES.UNBOUND, true);
  }

  const canonical = tryCanonical(resolve(processCwd, cwd));
  if (!canonical) return fail(WORKSPACE_BINDING_CODES.UNBOUND, true);
  try {
    if (!statSync(canonical).isDirectory()) {
      return fail(WORKSPACE_BINDING_CODES.UNBOUND, true);
    }
  } catch {
    return fail(WORKSPACE_BINDING_CODES.UNBOUND, true);
  }
  if (isForbiddenWriteRoot(canonical, userHome)) {
    return fail(WORKSPACE_BINDING_CODES.MISMATCH, true);
  }

  const folder = uniqueFolderCanonical(env);
  if (folder.code) return fail(folder.code, true);

  const processCanonical = tryCanonical(processCwd);
  const matchesProcess = processCanonical != null && canonical === processCanonical;
  const matchesFolder = folder.canonical != null && canonical === folder.canonical;
  if (!matchesProcess && !matchesFolder) {
    return fail(WORKSPACE_BINDING_CODES.MISMATCH, true);
  }

  return {
    writable: true,
    bound: true,
    cwd: canonical,
    projectKey: projectKeyForPath(canonical),
    code: null
  };
}
