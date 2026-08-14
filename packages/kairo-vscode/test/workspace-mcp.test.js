"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const {
  SERVER_ID,
  ARGS,
  planWorkspaceMcpServer,
  createWorkspaceMcpDefinition,
  registerWorkspaceMcpProvider,
  getWorkspaceMcpRegistration
} = require("../src/workspace-mcp.js");

function fakeVscode({ folders, registerImpl } = {}) {
  const created = [];
  class McpStdioServerDefinition {
    constructor(label, command, args) {
      this.label = label;
      this.command = command;
      this.args = args;
      created.push(this);
    }
  }
  let folderHandler;
  const list = folders ? [...folders] : [];
  const lm = {
    calls: 0,
    id: null,
    provider: null,
    registerMcpServerDefinitionProvider(id, provider) {
      this.calls += 1;
      this.id = id;
      this.provider = provider;
      if (typeof registerImpl === "function") return registerImpl(id, provider);
      return { dispose() { this.disposed = true; } };
    }
  };
  return {
    created,
    lm,
    get folderHandler() { return folderHandler; },
    folders: list,
    McpStdioServerDefinition,
    Uri: { file: (p) => ({ fsPath: p }) },
    EventEmitter: class {
      constructor() { this.event = () => {}; }
      fire() { this.fired = true; }
    },
    workspace: {
      get workspaceFolders() { return list; },
      onDidChangeWorkspaceFolders(fn) {
        folderHandler = fn;
        return { dispose() {} };
      }
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
  assert.deepEqual(plan.args, [...ARGS]);
  assert.equal(plan.cwd, "/ws/only");
});

test("registers provider only for single-root and captures success or failure", () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
  const contrib = manifest.contributes.mcpServerDefinitionProviders;
  assert.equal(contrib[0].id, "kairo-workspace");

  const empty = fakeVscode({ folders: [] });
  const emptyResult = registerWorkspaceMcpProvider(empty, { subscriptions: [] });
  assert.equal(emptyResult.registered, false);
  assert.equal(empty.lm.calls, 0);
  assert.equal(getWorkspaceMcpRegistration().state, "unbound");

  const multi = fakeVscode({
    folders: [{ uri: { fsPath: "/a" } }, { uri: { fsPath: "/b" } }]
  });
  assert.equal(registerWorkspaceMcpProvider(multi, { subscriptions: [] }).registered, false);
  assert.equal(multi.lm.calls, 0);
  assert.equal(getWorkspaceMcpRegistration().state, "ambiguous");

  const ok = fakeVscode({ folders: [{ uri: { fsPath: "/proj" } }] });
  const subs = [];
  const result = registerWorkspaceMcpProvider(ok, { subscriptions: subs });
  assert.equal(result.registered, true);
  assert.equal(result.state, "ready");
  assert.equal(ok.lm.calls, 1);
  assert.equal(ok.lm.id, "kairo-workspace");
  assert.equal(ok.lm.provider.provideMcpServerDefinitions()[0].cwd.fsPath, "/proj");
  ok.folders.splice(0, 1, { uri: { fsPath: "/x" } }, { uri: { fsPath: "/y" } });
  ok.folderHandler();
  assert.equal(getWorkspaceMcpRegistration().registered, false);
  assert.equal(getWorkspaceMcpRegistration().state, "ambiguous");

  const boom = fakeVscode({
    folders: [{ uri: { fsPath: "/proj" } }],
    registerImpl() { throw new Error("no"); }
  });
  const failed = registerWorkspaceMcpProvider(boom, { subscriptions: [] });
  assert.equal(failed.registered, false);
  assert.equal(failed.reason, "register_failed");
  assert.equal(registerWorkspaceMcpProvider({ workspace: {} }, { subscriptions: [] }).registered, false);
  assert.equal(createWorkspaceMcpDefinition({}, { register: true, cwd: "/proj" }), null);
});
