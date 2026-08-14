/**
 * Explicit workspace binding for MCP writes.
 * Agents never supply paths. Inherited VSCODE_CWD / WORKSPACE_FOLDER_PATHS
 * never authorize enroll or snapshot writes.
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

function fail(code) {
  return { writable: false, bound: false, cwd: null, projectKey: null, code };
}

function isForbiddenWriteRoot(canonical, userHome) {
  const root = canonicalizeProjectPath("/");
  if (canonical === root || canonical === "/") return true;
  return canonical === canonicalizeProjectPath(userHome);
}

export function resolveWorkspaceWriteBinding({
  workspaceBound = false,
  cwdExplicit = false,
  cwd,
  processCwd = process.cwd(),
  userHome = homedir(),
  env = process.env
} = {}) {
  const folders = parseWorkspaceFolderPaths(env.WORKSPACE_FOLDER_PATHS);
  if (folders.length > 1) {
    return { ...fail(WORKSPACE_BINDING_CODES.AMBIGUOUS), bound: Boolean(workspaceBound) };
  }

  if (!workspaceBound) return fail(WORKSPACE_BINDING_CODES.UNBOUND);
  if (!cwdExplicit || typeof cwd !== "string" || !cwd.trim()) {
    return { ...fail(WORKSPACE_BINDING_CODES.UNBOUND), bound: true };
  }

  let canonical;
  let processCanonical;
  try {
    canonical = canonicalizeProjectPath(resolve(processCwd, cwd));
    processCanonical = canonicalizeProjectPath(processCwd);
  } catch {
    return { ...fail(WORKSPACE_BINDING_CODES.UNBOUND), bound: true };
  }

  if (canonical !== processCanonical) {
    return { ...fail(WORKSPACE_BINDING_CODES.MISMATCH), bound: true };
  }
  if (isForbiddenWriteRoot(canonical, userHome)) {
    return { ...fail(WORKSPACE_BINDING_CODES.MISMATCH), bound: true };
  }
  try {
    if (!statSync(canonical).isDirectory()) {
      return { ...fail(WORKSPACE_BINDING_CODES.UNBOUND), bound: true };
    }
  } catch {
    return { ...fail(WORKSPACE_BINDING_CODES.UNBOUND), bound: true };
  }

  return {
    writable: true,
    bound: true,
    cwd: canonical,
    projectKey: projectKeyForPath(canonical),
    code: null
  };
}
