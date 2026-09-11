"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const {
  createArchitectActions, exactPlanPath, runKairoJson
} = require("../src/architect-actions.js");

test("runKairoJson spawns without shell and parses output", async () => {
  let captured;
  const result = await runKairoJson(["plans", "list"], {
    cwd: "/repo",
    spawnFn(command, args, options) {
      captured = { command, args, options };
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.setEncoding = () => {};
      child.stderr.setEncoding = () => {};
      process.nextTick(() => {
        child.stdout.emit("data", '{"plans":[]}');
        child.emit("close", 0);
      });
      return child;
    }
  });
  assert.deepEqual(result, { plans: [] });
  assert.equal(captured.command, "kairo");
  assert.equal(captured.options.shell, false);
  assert.equal(captured.args.at(-1), "--json");
});

test("Cursor architect action launches bounded CLI and opens exact artifact", async () => {
  const opened = [];
  const vscode = {
    ProgressLocation: { Notification: 1 },
    workspace: {
      isTrusted: true,
      workspaceFolders: [{ uri: { scheme: "file", fsPath: "/repo" } }],
      async openTextDocument(path) { opened.push(path); return { path }; }
    },
    window: {
      async showInputBox() { return "Design auth"; },
      async withProgress(_options, work) { return work(); },
      async showTextDocument() {},
      showErrorMessage(message) { throw new Error(message); },
      showInformationMessage() {}
    }
  };
  const calls = [];
  const actions = createArchitectActions(vscode, {
    runKairoJson: async (args) => {
      calls.push(args);
      return { taskId: "id", state: "awaiting_approval", artifacts: { plan: ".ai/tasks/id/plan.md" } };
    }
  });
  await actions.architect();
  assert.deepEqual(calls[0], ["architect", "--task", "Design auth", "--cwd", "/repo"]);
  assert.deepEqual(opened, ["/repo/.ai/tasks/id/plan.md"]);
  assert.throws(() => exactPlanPath("/repo", { taskId: "id", artifacts: { plan: "../escape.md" } }), /task id/);
});

test("Cursor requires modal confirmation before starting Claude execution", async () => {
  const confirmations = [];
  const calls = [];
  const vscode = {
    workspace: {
      isTrusted: true,
      workspaceFolders: [{ uri: { scheme: "file", fsPath: "/repo" } }]
    },
    window: {
      async showWarningMessage(message, options, label) {
        confirmations.push({ message, options, label });
        return label;
      },
      showErrorMessage(message) { throw new Error(message); }
    }
  };
  const actions = createArchitectActions(vscode, {
    runKairoJson: async (args) => { calls.push(args); return { execution: { state: "starting" } }; }
  });
  const result = await actions.executeById("task-id");
  assert.equal(confirmations[0].options.modal, true);
  assert.match(confirmations[0].message, /subscription authentication and safe permissions/);
  assert.deepEqual(calls[0], ["conversation", "execute", "task-id", "--cwd", "/repo"]);
  assert.equal(result.execution.state, "starting");
});
