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

test("single-root plans bound kairo argv; empty and multi-root fail closed", () => {
  assert.equal(planWorkspaceMcpServer([]).register, false);
  assert.equal(planWorkspaceMcpServer([]).code, "workspace_unbound");
  assert.equal(planWorkspaceMcpServer(null).register, false);
  const ambiguous = planWorkspaceMcpServer([
    { uri: { fsPath: "/ws/a" } },
    { uri: { fsPath: "/ws/b" } }
  ]);
  assert.equal(ambiguous.register, false);
  assert.equal(ambiguous.code, "workspace_ambiguous");
  const plan = planWorkspaceMcpServer([{ uri: { fsPath: "/ws/only" } }]);
  assert.equal(plan.register, true);
  assert.equal(plan.id, SERVER_ID);
  assert.equal(plan.id === "kairo", false);
  assert.deepEqual(plan.args, boundMcpArgs("/ws/only"));
  assert.equal(plan.cwd, "/ws/only");
  assert.deepEqual(buildNativeServerConfig(plan).server.env, {});
  assert.equal(nativeMcpApi({ lm: { registerMcpServerDefinitionProvider() {} } }), null);
});

test("registers native server only for trusted single-root; captures success or failure", async () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
  assert.equal(manifest.contributes.mcpServerDefinitionProviders, undefined);

  const empty = fakeVscode({ folders: [] });
  await registerWorkspaceMcpProvider(empty, { subscriptions: [] }).pending;
  assert.equal(empty.cursor.mcp.registerCalls.length, 0);
  assert.equal(empty.lm.calls, 0);
  assert.equal(getWorkspaceMcpRegistration().state, "unbound");

  const multi = fakeVscode({
    folders: [{ uri: { fsPath: "/a" } }, { uri: { fsPath: "/b" } }]
  });
  await registerWorkspaceMcpProvider(multi, { subscriptions: [] }).pending;
  assert.equal(multi.cursor.mcp.registerCalls.length, 0);
  assert.equal(getWorkspaceMcpRegistration().state, "ambiguous");

  const ok = fakeVscode({ folders: [{ uri: { fsPath: "/proj" } }] });
  const handle = registerWorkspaceMcpProvider(ok, { subscriptions: [] });
  const result = await handle.pending;
  assert.equal(result.registered, true);
  assert.equal(result.state, "registered");
  assert.equal(ok.lm.calls, 0);
  assert.deepEqual(ok.cursor.mcp.registerCalls[0].server.args, boundMcpArgs("/proj"));
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
  await registerWorkspaceMcpProvider(boom, { subscriptions: [] }).pending;
  assert.equal(getWorkspaceMcpRegistration().state, "registration_failed");
  const untrusted = fakeVscode({ folders: [{ uri: { fsPath: "/proj" } }], trusted: false });
  await registerWorkspaceMcpProvider(untrusted, { subscriptions: [] }).pending;
  assert.equal(getWorkspaceMcpRegistration().reason, "workspace_untrusted");
  const stubOnly = {
    lm: { calls: 0, registerMcpServerDefinitionProvider() { this.calls += 1; } },
    workspace: { workspaceFolders: [{ uri: { fsPath: "/proj" } }], isTrusted: true }
  };
  await registerWorkspaceMcpProvider(stubOnly, { subscriptions: [] }).pending;
  assert.equal(stubOnly.lm.calls, 0);
  assert.equal(getWorkspaceMcpRegistration().reason, "api_unavailable");
  const remote = fakeVscode({ folders: [{ uri: { fsPath: "/proj", scheme: "vscode-remote" } }] });
  await registerWorkspaceMcpProvider(remote, { subscriptions: [] }).pending;
  assert.equal(getWorkspaceMcpRegistration().reason, "unsupported_scheme");
});
