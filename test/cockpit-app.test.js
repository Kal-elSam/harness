import test from "node:test";
import assert from "node:assert/strict";
import { runCockpitApp } from "../src/global/cockpit/app.js";

function makeFakeTui() {
  return {
    children: [],
    started: false,
    stopped: false,
    inputListeners: [],
    focused: null,
    addChild(child) { this.children.push(child); },
    setFocus(component) { this.focused = component; },
    getFocusedComponent() { return this.focused; },
    addInputListener(fn) { this.inputListeners.push(fn); },
    requestRender() {},
    start() { this.started = true; },
    stop() { this.stopped = true; }
  };
}

function makeFakeEditor() {
  return {
    text: "",
    disableSubmit: false,
    onSubmit: null,
    setText(value) { this.text = value; },
    getText() { return this.text; },
    addToHistory() {},
    render() { return [""]; },
    handleInput() {},
    invalidate() {}
  };
}

function makeSnapshot(timeline) {
  return {
    schema: "kairo.conversation/v1",
    projectRoot: "/repo/demo",
    providers: { claude: { status: "Pro · usage unknown" } },
    integrations: { engram: { status: "connected" } },
    timeline
  };
}

const BASE_ROW = {
  taskId: "task-a", state: "awaiting_approval", approval: "not_decided",
  execution: { state: "not_started", active: false, message: "Approval is required." }
};

test("runCockpitApp boots the tui, loads an initial snapshot, and polls on an interval", async () => {
  let tui;
  const snapshots = [makeSnapshot([BASE_ROW]), makeSnapshot([{ ...BASE_ROW, state: "approved" }])];
  let snapshotCalls = 0;
  const service = {
    snapshot: async () => { const s = snapshots[Math.min(snapshotCalls, snapshots.length - 1)]; snapshotCalls += 1; return s; }
  };
  const intervalCallbacks = [];

  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: (t) => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: (fn) => { intervalCallbacks.push(fn); return 1; },
    clearIntervalImpl: () => {}
  });

  assert.equal(tui.started, true);
  assert.equal(tui.children.length, 2);
  assert.equal(snapshotCalls, 1);
  assert.equal(app.view.rows[0].planState, "awaiting_approval");
  assert.equal(app.view.snapshot.projectRoot, "/repo/demo");

  // Simulate the poll tick.
  await intervalCallbacks[0]();
  assert.equal(snapshotCalls, 2);
  assert.equal(app.view.rows[0].planState, "approved");

  app.stop();
  assert.equal(tui.stopped, true);
  await app.done;
});

test("approve action calls decidePlan then refreshes, surfacing errors via status", async () => {
  let tui;
  const decideCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    decidePlan: async (args) => { decideCalls.push(args); return {}; }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  await app.view.actions.onApprove("task-a");
  assert.deepEqual(decideCalls, [{ cwd: "/repo", taskId: "task-a", decision: "approved" }]);
  assert.equal(app.view.statusMessage, "");

  app.stop();
});

test("a failing action surfaces the error message on the status line instead of throwing", async () => {
  let tui;
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    decidePlan: async () => { throw new Error("boom"); }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  await app.view.actions.onApprove("task-a");
  assert.match(app.view.statusMessage, /boom/);

  app.stop();
});

test("onRequestExecute fetches the real routing decision and shows the confirm prompt with it", async () => {
  let tui;
  const planCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    planExecution: async (args) => {
      planCalls.push(args);
      return { decision: "ROUTED", provider: "codex", model: "gpt-6-astra", why: "reasoning task" };
    }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  await app.view.actions.onRequestExecute("task-a");
  assert.deepEqual(planCalls, [{ cwd: "/repo", taskId: "task-a" }]);
  assert.equal(app.view.mode, "confirm-execute");
  assert.equal(app.view.executeDecision.provider, "codex");

  app.stop();
});

test("onExecute passes the exact decision shown as the confirm-execute agentId/model — never a re-decided one", async () => {
  let tui;
  const executeCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    executePlan: async (args) => { executeCalls.push(args); return {}; }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  await app.view.actions.onExecute("task-a", { decision: "ROUTED", provider: "opencode-go", model: "glm-5.3" });
  assert.deepEqual(executeCalls, [{ cwd: "/repo", taskId: "task-a", agentId: "opencode-go", model: "glm-5.3" }]);

  app.stop();
});

test("/models prints the AI TEAM into the chat even when a task row is selected", async () => {
  let editor;
  const service = {
    snapshot: async () => ({
      ...makeSnapshot([BASE_ROW]),
      modelIntelligence: {
        status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
        aiTeam: [{
          role: "Architect",
          primary: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6-Astra", available: true },
          fallback: null
        }]
      }
    })
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  // A row is selected by default (BASE_ROW), matching the real scenario
  // that broke STATUS's idle-only display.
  editor.setText("/models");
  await editor.onSubmit(editor.getText());
  const printed = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(printed, /Artificial Analysis, live/);
  assert.match(printed, /Architect\s+Codex · GPT-6-Astra/);
  app.stop();
});

test("boot loads real persisted transcript history before the first render", async () => {
  const service = {
    snapshot: async () => makeSnapshot([]),
    loadTranscript: async (args) => {
      assert.deepEqual(args, { cwd: "/repo" });
      return [{ role: "user", text: "what is this project?" }, { role: "kairo", text: "claude: an orchestrator." }];
    }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  assert.equal(app.view.transcript.length, 2);
  assert.equal(app.view.transcript[0].text, "what is this project?");
  app.stop();
});

test("a message the user sends is persisted via service.appendTranscript, not just kept in memory", async () => {
  let editor;
  const appended = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    submitTask: async () => ({ kind: "answer", provider: "claude", answer: "It orchestrates providers." }),
    appendTranscript: async (args) => { appended.push(args); }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  editor.setText("What is this project about?");
  await editor.onSubmit(editor.getText());
  assert.deepEqual(appended, [
    { cwd: "/repo", role: "user", text: "What is this project about?" },
    { cwd: "/repo", role: "kairo", text: "claude: It orchestrates providers." }
  ]);
  app.stop();
});

test("a transcript save failure surfaces on the status line instead of silently losing the message", async () => {
  // Uses /help (no runAction wrapping, so nothing else clears statusMessage
  // afterward) to deterministically observe the background save's own
  // failure handling, isolated from an unrelated success status racing it.
  let editor;
  const service = {
    snapshot: async () => makeSnapshot([]),
    appendTranscript: async () => { throw new Error("disk full"); }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  editor.setText("/help");
  await editor.onSubmit(editor.getText());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(app.view.statusMessage, /Transcript save failed/);
  app.stop();
});

test("/clear wipes the persisted transcript too, so a cleared chat stays cleared after a restart", async () => {
  let editor;
  const cleared = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    clearTranscript: async (args) => { cleared.push(args); }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  editor.setText("/clear");
  await editor.onSubmit(editor.getText());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cleared, [{ cwd: "/repo" }]);
  app.stop();
});

test("submitting a change request goes through submitTask, creates a plan, clears the text, and refreshes", async () => {
  let tui, editor;
  const submitted = [];
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    submitTask: async (args) => { submitted.push(args); return { kind: "plan", taskId: "task-id" }; }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  editor.setText("Add OAuth login");
  await editor.onSubmit(editor.getText());
  assert.deepEqual(submitted, [{ cwd: "/repo", task: "Add OAuth login" }]);
  assert.equal(editor.getText(), "");
  assert.equal(editor.disableSubmit, false);

  app.stop();
});

test("submitting a real question answers it directly via submitTask — never creates a plan", async () => {
  let editor;
  const submitted = [];
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    submitTask: async (args) => {
      submitted.push(args);
      return { kind: "answer", provider: "claude", model: "claude-opus-5", answer: "It orchestrates Codex/Claude/OpenCode." };
    }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  editor.setText("What is this project about?");
  await editor.onSubmit(editor.getText());
  assert.deepEqual(submitted, [{ cwd: "/repo", task: "What is this project about?" }]);
  assert.equal(app.view.transcript.some((entry) => entry.text.includes("It orchestrates Codex/Claude/OpenCode.")), true);

  app.stop();
});

test("/plan forces a plan even for question-shaped text, bypassing submitTask's classification", async () => {
  let editor;
  const architectCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    submitArchitecture: async (args) => { architectCalls.push(args); return {}; },
    submitTask: async () => { throw new Error("submitTask should not be called for /plan"); }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  editor.setText("/plan What is the best auth strategy here?");
  await editor.onSubmit(editor.getText());
  assert.deepEqual(architectCalls, [{ cwd: "/repo", task: "What is the best auth strategy here?" }]);

  app.stop();
});

test("blank or whitespace-only submissions are ignored", async () => {
  let editor;
  const service = { snapshot: async () => makeSnapshot([]), submitArchitecture: async () => { throw new Error("should not be called"); } };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  await editor.onSubmit("   ");
  app.stop();
});

test("Tab toggles focus between the task editor and the plan/run list", async () => {
  let tui, editor;
  const service = { snapshot: async () => makeSnapshot([]) };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  assert.equal(tui.getFocusedComponent(), editor);
  const result = tui.inputListeners[0]("\t");
  assert.equal(result?.consume, true);
  assert.equal(tui.getFocusedComponent(), app.view);
  tui.inputListeners[0]("\t");
  assert.equal(tui.getFocusedComponent(), editor);

  app.stop();
});

test("onQuit stops the tui and resolves done exactly once", async () => {
  let tui;
  let clears = 0;
  const service = { snapshot: async () => makeSnapshot([]) };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 42,
    clearIntervalImpl: () => { clears += 1; }
  });

  app.view.actions.onQuit();
  app.view.actions.onQuit(); // idempotent
  assert.equal(tui.stopped, true);
  assert.equal(clears, 1);
  await app.done;
});
