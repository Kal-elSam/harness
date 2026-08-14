"use strict";

const SERVER_ID = "kairo-workspace";
const SERVER_LABEL = "Kairo (workspace)";
const COMMAND = "kairo";
const STATES = Object.freeze({
  registering: "registering",
  registered: "registered",
  unbound: "unbound",
  ambiguous: "ambiguous",
  registration_failed: "registration_failed"
});

let registrationState = {
  registered: false,
  state: STATES.unbound,
  code: "workspace_unbound",
  reason: null,
  root: null
};
let registeredName = null;
let registeredRoot = null;
let queue = Promise.resolve();

function getWorkspaceMcpRegistration() {
  return { ...registrationState };
}

function setRegistrationState(next) {
  registrationState = {
    registered: next.state === STATES.registered,
    state: next.state,
    code: next.code ?? null,
    reason: next.reason ?? null,
    root: next.root ?? null
  };
}

function boundMcpArgs(absPath) {
  return ["mcp", "--workspace-bound", "--cwd", absPath];
}

function folderPath(folder) {
  if (!folder || typeof folder !== "object") return null;
  const uri = folder.uri && typeof folder.uri === "object" ? folder.uri : null;
  const fsPath = uri && typeof uri.fsPath === "string"
    ? uri.fsPath
    : (typeof folder.fsPath === "string" ? folder.fsPath : null);
  const trimmed = typeof fsPath === "string" ? fsPath.trim() : "";
  if (!trimmed) return null;
  const scheme = typeof uri?.scheme === "string" ? uri.scheme : "file";
  return { path: trimmed, scheme };
}

/**
 * Decide whether this window may register a writable workspace MCP.
 * Trusted file:// single-root only — no inferred HOME/`/` cwd.
 *
 * @param {readonly { uri?: { fsPath?: string, scheme?: string }, fsPath?: string }[] | null | undefined} folders
 */
function planWorkspaceMcpServer(folders, options = {}) {
  const list = Array.isArray(folders) ? folders : [];
  const base = { register: false, id: SERVER_ID, command: COMMAND, args: null, env: {}, cwd: null };
  if (options.trusted === false) {
    return { ...base, code: "workspace_unbound", reason: "workspace_untrusted" };
  }
  if (list.length === 0) return { ...base, code: "workspace_unbound", reason: "empty_window" };
  if (list.length > 1) return { ...base, code: "workspace_ambiguous", reason: "multi_root" };
  const info = folderPath(list[0]);
  if (!info) return { ...base, code: "workspace_unbound", reason: "empty_window" };
  if (info.scheme !== "file") return { ...base, code: "workspace_unbound", reason: "unsupported_scheme" };
  return {
    register: true,
    code: null,
    reason: null,
    id: SERVER_ID,
    label: SERVER_LABEL,
    command: COMMAND,
    args: boundMcpArgs(info.path),
    env: {},
    cwd: info.path
  };
}

function nativeMcpApi(vscodeApi) {
  const registerServer = vscodeApi?.cursor?.mcp?.registerServer;
  const unregisterServer = vscodeApi?.cursor?.mcp?.unregisterServer;
  if (typeof registerServer !== "function" || typeof unregisterServer !== "function") return null;
  return {
    registerServer: registerServer.bind(vscodeApi.cursor.mcp),
    unregisterServer: unregisterServer.bind(vscodeApi.cursor.mcp)
  };
}

function buildNativeServerConfig(plan) {
  if (!plan || plan.register !== true) return null;
  return { name: plan.id, server: { command: plan.command, args: [...plan.args], env: {} } };
}

async function unregisterCurrent(api) {
  const name = registeredName;
  registeredName = null;
  registeredRoot = null;
  if (!name || !api) return;
  try { api.unregisterServer(name); } catch { /* window already gone */ }
}

function enqueue(work) {
  const run = queue.then(work, work);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function syncRegistration(vscodeApi) {
  const api = nativeMcpApi(vscodeApi);
  const plan = planWorkspaceMcpServer(
    vscodeApi?.workspace?.workspaceFolders,
    { trusted: vscodeApi?.workspace?.isTrusted === true }
  );
  if (!api) {
    await unregisterCurrent(null);
    setRegistrationState({ state: STATES.unbound, code: "workspace_unbound", reason: "api_unavailable" });
    return getWorkspaceMcpRegistration();
  }
  if (plan.register !== true) {
    setRegistrationState({
      state: plan.code === "workspace_ambiguous" ? STATES.ambiguous : STATES.unbound,
      code: plan.code,
      reason: plan.reason
    });
    await unregisterCurrent(api);
    return getWorkspaceMcpRegistration();
  }
  if (registeredRoot === plan.cwd && registrationState.state === STATES.registered) {
    return getWorkspaceMcpRegistration();
  }
  setRegistrationState({ state: STATES.registering, code: null, reason: null, root: plan.cwd });
  try {
    await unregisterCurrent(api);
    api.registerServer(buildNativeServerConfig(plan));
    registeredName = plan.id;
    registeredRoot = plan.cwd;
    setRegistrationState({ state: STATES.registered, code: null, reason: null, root: plan.cwd });
  } catch {
    registeredName = null;
    registeredRoot = null;
    setRegistrationState({
      state: STATES.registration_failed, code: "workspace_unbound", reason: "register_failed"
    });
  }
  return getWorkspaceMcpRegistration();
}

function registerWorkspaceMcpProvider(vscodeApi, context) {
  const sync = () => enqueue(() => syncRegistration(vscodeApi));
  const pending = sync();
  if (context?.subscriptions) {
    context.subscriptions.push({
      dispose: () => enqueue(() => unregisterCurrent(nativeMcpApi(vscodeApi)))
    });
    if (typeof vscodeApi.workspace?.onDidChangeWorkspaceFolders === "function") {
      context.subscriptions.push(vscodeApi.workspace.onDidChangeWorkspaceFolders(() => { void sync(); }));
    }
    if (typeof vscodeApi.workspace?.onDidGrantWorkspaceTrust === "function") {
      context.subscriptions.push(vscodeApi.workspace.onDidGrantWorkspaceTrust(() => { void sync(); }));
    }
  }
  return { pending, syncRegistration: sync, id: SERVER_ID, getWorkspaceMcpRegistration };
}

module.exports = {
  SERVER_ID,
  SERVER_LABEL,
  COMMAND,
  STATES,
  boundMcpArgs,
  planWorkspaceMcpServer,
  buildNativeServerConfig,
  nativeMcpApi,
  registerWorkspaceMcpProvider,
  getWorkspaceMcpRegistration
};
