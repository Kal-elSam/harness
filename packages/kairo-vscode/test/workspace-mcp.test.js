"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const {
  SERVER_ID,
  boundMcpArgs,
  planWorkspaceMcpServer,
  buildNativeServerConfig,
  nativeMcpApi,
  registerWorkspaceMcpProvider,
  getWorkspaceMcpRegistration
} = require("../src/workspace-mcp.js");
const { parseNodeMajor, resolveNodeExecutable } = require("../src/node-runtime.js");

const RUNTIME = { nodePath: "/usr/bin/node", bundlePath: "/ext/dist/kairo-workspace.cjs" };
const ctx = (over = {}) => ({ subscriptions: [], ...RUNTIME, ...over });

function fakeVscode({ folders, trusted = true, registerImpl } = {}) {
  const list = folders ? [...folders] : [];
  let folderHandler;
  const lm = {
    calls: 0,
    registerMcpServerDefinitionProvider() {
      this.calls += 1;
      return { dispose() {} };
    }
  };
  const mcp = {
    registerCalls: [],
    unregisterCalls: [],
    registerServer(config) {
      this.registerCalls.push(config);
      if (typeof registerImpl === "function") return registerImpl(config);
    },
    unregisterServer(name) { this.unregisterCalls.push(name); }
  };
  return {
    lm,
    cursor: { mcp },
    get folderHandler() { return folderHandler; },
    folders: list,
    workspace: {
      isTrusted: trusted,
      get workspaceFolders() { return list; },
      onDidChangeWorkspaceFolders(fn) {
        folderHandler = fn;
        return { dispose() {} };
      },
      onDidGrantWorkspaceTrust() { return { dispose() {} }; }
    }
  };
}

test("single-root plans absolute Node + bundle; empty and multi-root fail closed", () => {
  assert.equal(planWorkspaceMcpServer([], RUNTIME).register, false);
  assert.equal(planWorkspaceMcpServer([], RUNTIME).code, "workspace_unbound");
  assert.equal(planWorkspaceMcpServer(null, RUNTIME).register, false);
  const ambiguous = planWorkspaceMcpServer([
    { uri: { fsPath: "/ws/a" } },
    { uri: { fsPath: "/ws/b" } }
  ], RUNTIME);
  assert.equal(ambiguous.register, false);
  assert.equal(ambiguous.code, "workspace_ambiguous");
  const plan = planWorkspaceMcpServer([{ uri: { fsPath: "/ws/only" } }], RUNTIME);
  assert.equal(plan.register, true);
  assert.equal(plan.id, SERVER_ID);
  assert.equal(plan.command, RUNTIME.nodePath);
  assert.notEqual(plan.command, "kairo");
  assert.deepEqual(plan.args, boundMcpArgs("/ws/only", RUNTIME.bundlePath));
  assert.equal(plan.cwd, "/ws/only");
  assert.deepEqual(buildNativeServerConfig(plan).server.env, {});
  assert.equal(nativeMcpApi({ lm: { registerMcpServerDefinitionProvider() {} } }), null);
  assert.equal(
    planWorkspaceMcpServer([{ uri: { fsPath: "/ws/only" } }], { ...RUNTIME, nodePath: null }).reason,
    "runtime_unavailable"
  );
});

test("registers native server only for trusted single-root; captures success or failure", async () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
  assert.equal(manifest.contributes.mcpServerDefinitionProviders, undefined);
  assert.match(manifest.scripts.package, /bundle:workspace-mcp/);

  const empty = fakeVscode({ folders: [] });
  await registerWorkspaceMcpProvider(empty, ctx()).pending;
  assert.equal(empty.cursor.mcp.registerCalls.length, 0);
  assert.equal(empty.lm.calls, 0);
  assert.equal(getWorkspaceMcpRegistration().state, "unbound");

  const multi = fakeVscode({
    folders: [{ uri: { fsPath: "/a" } }, { uri: { fsPath: "/b" } }]
  });
  await registerWorkspaceMcpProvider(multi, ctx()).pending;
  assert.equal(multi.cursor.mcp.registerCalls.length, 0);
  assert.equal(getWorkspaceMcpRegistration().state, "ambiguous");

  const ok = fakeVscode({ folders: [{ uri: { fsPath: "/proj" } }] });
  const handle = registerWorkspaceMcpProvider(ok, ctx());
  const result = await handle.pending;
  assert.equal(result.registered, true);
  assert.equal(result.state, "registered");
  assert.equal(ok.lm.calls, 0);
  const cfg = ok.cursor.mcp.registerCalls[0].server;
  assert.equal(cfg.command, RUNTIME.nodePath);
  assert.deepEqual(cfg.args, boundMcpArgs("/proj", RUNTIME.bundlePath));
  assert.equal(Object.keys(cfg.env).length, 0);
  await handle.syncRegistration();
  assert.equal(ok.cursor.mcp.registerCalls.length, 1);
  ok.folders.splice(0, 1, { uri: { fsPath: "/x" } }, { uri: { fsPath: "/y" } });
  ok.folderHandler();
  await handle.syncRegistration();
  assert.equal(getWorkspaceMcpRegistration().registered, false);
  assert.equal(getWorkspaceMcpRegistration().state, "ambiguous");
  assert.deepEqual(ok.cursor.mcp.unregisterCalls, ["kairo-workspace"]);

  const boom = fakeVscode({
    folders: [{ uri: { fsPath: "/proj" } }],
    registerImpl() { throw new Error("no"); }
  });
  await registerWorkspaceMcpProvider(boom, ctx()).pending;
  assert.equal(getWorkspaceMcpRegistration().state, "registration_failed");
  const untrusted = fakeVscode({ folders: [{ uri: { fsPath: "/proj" } }], trusted: false });
  await registerWorkspaceMcpProvider(untrusted, ctx()).pending;
  assert.equal(getWorkspaceMcpRegistration().reason, "workspace_untrusted");
  const stubOnly = {
    lm: { calls: 0, registerMcpServerDefinitionProvider() { this.calls += 1; } },
    workspace: { workspaceFolders: [{ uri: { fsPath: "/proj" } }], isTrusted: true }
  };
  await registerWorkspaceMcpProvider(stubOnly, ctx()).pending;
  assert.equal(stubOnly.lm.calls, 0);
  assert.equal(getWorkspaceMcpRegistration().reason, "api_unavailable");
  const remote = fakeVscode({ folders: [{ uri: { fsPath: "/proj", scheme: "vscode-remote" } }] });
  await registerWorkspaceMcpProvider(remote, ctx()).pending;
  assert.equal(getWorkspaceMcpRegistration().reason, "unsupported_scheme");
  const noNode = fakeVscode({ folders: [{ uri: { fsPath: "/proj" } }] });
  await registerWorkspaceMcpProvider(noNode, ctx({ nodePath: null })).pending;
  assert.equal(getWorkspaceMcpRegistration().reason, "runtime_unavailable");
  assert.equal(parseNodeMajor("18.0.0") < 20 && resolveNodeExecutable({
    execPath: "/Applications/Cursor.app/Contents/MacOS/Cursor", pathValue: "",
    spawnSync: () => ({ status: 0, stdout: "20.0.0" })
  }) == null, true);
});
