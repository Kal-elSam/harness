/**
 * Explicit workspace binding for MCP writes.
 * Agents never supply paths. Inherited VSCODE_CWD / WORKSPACE_FOLDER_PATHS
 * never authorize enroll or snapshot writes.
 */
export const WORKSPACE_BINDING_CODES = Object.freeze({
  UNBOUND: "workspace_unbound",
  AMBIGUOUS: "workspace_ambiguous",
  MISMATCH: "workspace_mismatch"
});
