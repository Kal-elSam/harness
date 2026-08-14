"use strict";

const SERVER_ID = "kairo-workspace";
const SERVER_LABEL = "Kairo (workspace)";
const COMMAND = "kairo";
const ARGS = Object.freeze(["mcp", "--workspace-bound", "--cwd", "."]);

let registrationState = {
  registered: false,
  state: "unbound",
  code: "workspace_unbound",
  reason: null
};

function getWorkspaceMcpRegistration() {
  return { ...registrationState };
}

function setRegistrationState(next) {
  registrationState = {
    registered: next.registered === true,
    state: next.state,
    code: next.code ?? null,
    reason: next.reason ?? null
  };
}

function folderPath(folder) {
  if (!folder || typeof folder !== "object") return null;
  const fsPath = folder.uri && typeof folder.uri.fsPath === "string"
    ? folder.uri.fsPath
    : (typeof folder.fsPath === "string" ? folder.fsPath : null);
  const trimmed = typeof fsPath === "string" ? fsPath.trim() : "";
  return trimmed || null;
}

/**
 * Decide whether this window may register a writable workspace MCP.
 * Multi-root and empty windows fail closed — no inferred HOME/`/` cwd.
 *
 * @param {readonly { uri?: { fsPath?: string }, fsPath?: string }[] | null | undefined} folders
 */
function planWorkspaceMcpServer(folders) {
  const list = Array.isArray(folders) ? folders : [];
  if (list.length === 0) {
    return {
      register: false,
      code: "workspace_unbound",
      id: SERVER_ID,
      command: COMMAND,
      args: [...ARGS],
      cwd: null
    };
  }
  if (list.length > 1) {
    return {
      register: false,
      code: "workspace_ambiguous",
      id: SERVER_ID,
      command: COMMAND,
      args: [...ARGS],
      cwd: null
    };
  }
  const cwd = folderPath(list[0]);
  if (!cwd) {
    return {
      register: false,
      code: "workspace_unbound",
      id: SERVER_ID,
      command: COMMAND,
      args: [...ARGS],
      cwd: null
    };
  }
  return {
    register: true,
    code: null,
    id: SERVER_ID,
    label: SERVER_LABEL,
    command: COMMAND,
    args: [...ARGS],
    cwd
  };
}

function createWorkspaceMcpDefinition(vscodeApi, plan) {
  if (!plan || plan.register !== true || typeof vscodeApi?.McpStdioServerDefinition !== "function") {
    return null;
  }
  const def = new vscodeApi.McpStdioServerDefinition(
    plan.label,
    plan.command,
    [...plan.args],
    {},
    undefined
  );
  if (plan.cwd && vscodeApi.Uri?.file) def.cwd = vscodeApi.Uri.file(plan.cwd);
  else if (plan.cwd) def.cwd = plan.cwd;
  return def;
}

function disposeRegistration(disposable) {
  if (!disposable || typeof disposable.dispose !== "function") return;
  try {
    disposable.dispose();
  } catch {
    // Cursor may dispose twice on window close.
  }
}

function registerWorkspaceMcpProvider(vscodeApi, context) {
  const registerFn = vscodeApi?.lm?.registerMcpServerDefinitionProvider;
  const apiAvailable = typeof registerFn === "function";
  let disposable = null;
  let provider = null;
  const emitter = apiAvailable && typeof vscodeApi.EventEmitter === "function"
    ? new vscodeApi.EventEmitter()
    : null;

  function syncRegistration() {
    const plan = planWorkspaceMcpServer(vscodeApi.workspace?.workspaceFolders);
    if (!apiAvailable) {
      disposeRegistration(disposable);
      disposable = null;
      provider = null;
      setRegistrationState({
        registered: false,
        state: "unbound",
        code: "workspace_unbound",
        reason: "api_unavailable"
      });
      return getWorkspaceMcpRegistration();
    }
    if (plan.register !== true) {
      disposeRegistration(disposable);
      disposable = null;
      provider = null;
      setRegistrationState({
        registered: false,
        state: plan.code === "workspace_ambiguous" ? "ambiguous" : "unbound",
        code: plan.code
      });
      return getWorkspaceMcpRegistration();
    }
    if (disposable) {
      setRegistrationState({ registered: true, state: "ready", code: null });
      return getWorkspaceMcpRegistration();
    }
    provider = {
      onDidChangeMcpServerDefinitions: emitter.event,
      provideMcpServerDefinitions: () => {
        const next = planWorkspaceMcpServer(vscodeApi.workspace?.workspaceFolders);
        const def = createWorkspaceMcpDefinition(vscodeApi, next);
        return def ? [def] : [];
      },
      refresh: () => emitter.fire()
    };
    try {
      disposable = registerFn.call(vscodeApi.lm, SERVER_ID, provider);
      setRegistrationState({ registered: true, state: "ready", code: null });
    } catch {
      disposable = null;
      provider = null;
      setRegistrationState({
        registered: false,
        state: "unbound",
        code: "workspace_unbound",
        reason: "register_failed"
      });
    }
    return getWorkspaceMcpRegistration();
  }

  const result = syncRegistration();
  if (context?.subscriptions && emitter && typeof vscodeApi.workspace?.onDidChangeWorkspaceFolders === "function") {
    context.subscriptions.push(
      emitter,
      { dispose: () => disposeRegistration(disposable) },
      vscodeApi.workspace.onDidChangeWorkspaceFolders(() => {
        syncRegistration();
      })
    );
  }
  return { ...result, provider, id: SERVER_ID, syncRegistration };
}

module.exports = {
  SERVER_ID,
  SERVER_LABEL,
  COMMAND,
  ARGS,
  planWorkspaceMcpServer,
  createWorkspaceMcpDefinition,
  registerWorkspaceMcpProvider,
  getWorkspaceMcpRegistration
};
