import test from "node:test";
import assert from "node:assert/strict";
import { ScrollView, stripTerminalSequences } from "@earendil-works/pi-tui";
import { buildViewportLayoutRoot, runCockpitApp } from "../src/global/cockpit/app.js";
import { CockpitView } from "../src/global/cockpit/view.js";

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
  assert.match(printed, /Evidence: live/);
  assert.match(printed, /Architect\s+GPT-6-Astra/);
  app.stop();
});

test("/models --evidence keeps the technical breakdown (corroboration/source detail); plain /models does not", async () => {
  let editor;
  const service = {
    snapshot: async () => ({
      ...makeSnapshot([BASE_ROW]),
      modelIntelligence: {
        status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
        aiTeam: [{
          role: "Architect",
          primary: {
            adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6-Astra", available: true,
            corroboration: [{ metric: "gpqa", value: 0.6, source: "other-source" }]
          },
          fallback: null, reason: null
        }],
        efficientTeam: []
      }
    })
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });

  editor.setText("/models");
  await editor.onSubmit(editor.getText());
  const plain = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.doesNotMatch(plain, /gpqa=/);
  assert.doesNotMatch(plain, /other-source/);
  assert.match(plain, /Selected for general reasoning capability\./);

  app.view.clearTranscript();
  editor.setText("/models --evidence");
  await editor.onSubmit(editor.getText());
  const evidence = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(evidence, /gpqa=0\.6 \(other-source\)/);
  app.stop();
});

test("/models' role separators survive the real persisted-transcript pipeline, not just the raw line array", async () => {
  // Regression: a blank-string ("") separator looks correct against
  // aiTeamDetailLines() in isolation, but addTranscript trims and drops
  // empty text — so it silently vanished once actually routed through
  // pushTranscript. This exercises the real pipeline, not just the array.
  let editor;
  const service = {
    snapshot: async () => ({
      ...makeSnapshot([BASE_ROW]),
      modelIntelligence: {
        status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
        aiTeam: [
          { role: "Explorer", primary: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6-Astra", available: true }, fallback: null },
          { role: "Builder", primary: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1", available: true }, fallback: null }
        ]
      }
    })
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/models");
  await editor.onSubmit(editor.getText());
  const texts = app.view.transcript.map((entry) => entry.text);
  const explorerIndex = texts.findIndex((t) => t.includes("Explorer"));
  const builderIndex = texts.findIndex((t) => t.includes("Builder"));
  // Each role now emits a headline + a "why" line before the next role's
  // separator, so the gap is 3 entries, not 2 — but the real point of this
  // regression test still holds: a real, non-empty separator entry sits
  // between the two roles in the persisted transcript.
  assert.equal(builderIndex, explorerIndex + 3, "the separator entry must actually be present between the two roles in the real transcript");
  assert.match(texts[explorerIndex + 2], /\S/, "the separator must be visible content, not a blank line addTranscript would drop");
  app.stop();
});

test("a slash command is echoed into the transcript as the user's own message before Kairo's response", async () => {
  let editor;
  const service = { snapshot: async () => makeSnapshot([BASE_ROW]) };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });

  editor.setText("/usage");
  await editor.onSubmit(editor.getText());
  const [first, second] = app.view.transcript;
  assert.equal(first.role, "You");
  assert.equal(first.text, "/usage");
  assert.notEqual(second.role, "You");
  app.stop();
});

test("/usage and /providers stay scoped to their own data — only /status also shows integration status", async () => {
  let editor;
  const service = {
    snapshot: async () => ({
      ...makeSnapshot([BASE_ROW]),
      providers: { claude: { status: "Pro · usage unknown" } },
      integrations: { engram: { status: "connected" } }
    })
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });

  editor.setText("/usage");
  await editor.onSubmit(editor.getText());
  editor.setText("/providers");
  await editor.onSubmit(editor.getText());
  const beforeStatus = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.doesNotMatch(beforeStatus, /Engram connected/);

  editor.setText("/status");
  await editor.onSubmit(editor.getText());
  const afterStatus = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(afterStatus, /Engram connected/);
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
  assert.deepEqual(submitted, [{ cwd: "/repo", task: "Add OAuth login", mode: "ask" }]);
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
  assert.deepEqual(submitted, [{ cwd: "/repo", task: "What is this project about?", mode: "ask" }]);
  assert.equal(app.view.transcript.some((entry) => entry.text.includes("It orchestrates Codex/Claude/OpenCode.")), true);

  app.stop();
});

test("/project status reports NOT_ANALYZED honestly when there's no real strategy yet", async () => {
  let editor;
  const service = { snapshot: async () => makeSnapshot([]) };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project status");
  await editor.onSubmit(editor.getText());
  const texts = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(texts, /Project not analyzed/);
  app.stop();
});

test("/project analyze runs a real LOCAL_PREFLIGHT (no strategy yet) and lists real Bootstrap Analyst alternatives, awaiting an explicit choice", async () => {
  let editor;
  const preflightCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    preflightProject: async (args) => {
      preflightCalls.push(args);
      return {
        profile: { fingerprint: "fp-1" },
        candidates: {},
        alternatives: [
          { choice: "quality", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" } },
          { choice: "efficient", model: { adapterId: "claude", modelId: "claude-x", displayName: "Claude X" } }
        ]
      };
    }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project analyze");
  await editor.onSubmit(editor.getText());
  assert.deepEqual(preflightCalls, [{ cwd: "/repo" }]);
  assert.ok(app.view.pendingProjectAnalysis, "AWAITING_ANALYST state must be held until a real choice is confirmed");
  const texts = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(texts, /Select Bootstrap Analyst — real alternatives/);
  assert.match(texts, /GPT-6 Astra/);
  assert.match(texts, /Claude X/);
  app.stop();
});

test("/project analyst quality|efficient WITHOUT --confirm warns about real quota consumption and never runs the analyst", async () => {
  let editor;
  const runCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    preflightProject: async () => ({
      profile: {}, candidates: {},
      alternatives: [{ choice: "quality", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" } }]
    }),
    runBootstrapAnalysis: async (args) => { runCalls.push(args); return { status: "suggested", activeRoles: [] }; }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project analyze");
  await editor.onSubmit(editor.getText());
  editor.setText("/project analyst quality");
  await editor.onSubmit(editor.getText());
  assert.equal(runCalls.length, 0, "the real analyst must never run without an explicit --confirm");
  assert.ok(app.view.pendingProjectAnalysis, "the pending choice stays open, awaiting confirmation");
  const texts = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(texts, /consume real quota/);
  app.stop();
});

test("/project analyst quality|efficient --confirm runs the real Bootstrap Analyst and reports the real resulting SUGGESTED team", async () => {
  let editor;
  const runCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    preflightProject: async () => ({
      profile: { fingerprint: "fp-1" }, candidates: { scoredAll: [] },
      alternatives: [{ choice: "quality", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" } }]
    }),
    runBootstrapAnalysis: async (args) => { runCalls.push(args); return { status: "suggested", activeRoles: ["Explorer", "Architect"] }; }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project analyze");
  await editor.onSubmit(editor.getText());
  editor.setText("/project analyst quality --confirm");
  await editor.onSubmit(editor.getText());
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].cwd, "/repo");
  assert.equal(runCalls[0].analyst.choice, "quality");
  assert.equal(runCalls[0].analyst.model.adapterId, "codex");
  assert.equal(app.view.pendingProjectAnalysis, null, "AWAITING_ANALYST clears once the real analysis actually ran");
  const texts = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(texts, /Suggested project team ready \(2 real roles\)/);
  app.stop();
});

test("/project analyst rejects a choice that isn't quality or efficient, and rejects a real choice with nothing pending, without ever calling the service", async () => {
  let editor;
  const runCalls = [];
  const service = { snapshot: async () => makeSnapshot([]), runBootstrapAnalysis: async (args) => { runCalls.push(args); return {}; } };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project analyst yolo");
  await editor.onSubmit(editor.getText());
  editor.setText("/project analyst quality --confirm");
  await editor.onSubmit(editor.getText());
  assert.equal(runCalls.length, 0);
  const texts = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(texts, /Usage: \/project analyst quality\|efficient/);
  assert.match(texts, /Run \/project analyze first/);
  app.stop();
});

test("/project approve calls the real approveProjectStrategy", async () => {
  let editor;
  const approveCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    approveProjectStrategy: async (args) => { approveCalls.push(args); return { status: "active" }; }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project approve");
  await editor.onSubmit(editor.getText());
  assert.deepEqual(approveCalls, [{ cwd: "/repo" }]);
  app.stop();
});

test("/project refresh calls the real refreshProjectStrategy", async () => {
  let editor;
  const refreshCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    refreshProjectStrategy: async (args) => { refreshCalls.push(args); return { status: "stale" }; }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project refresh");
  await editor.onSubmit(editor.getText());
  assert.deepEqual(refreshCalls, [{ cwd: "/repo" }]);
  app.stop();
});

test("/plan forces a plan even for question-shaped text, bypassing submitTask's classification, and switches WorkMode to PLAN", async () => {
  let editor;
  const architectCalls = [];
  const modeCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    submitArchitecture: async (args) => { architectCalls.push(args); return {}; },
    submitTask: async () => { throw new Error("submitTask should not be called for /plan"); },
    setMode: async (args) => { modeCalls.push(args); return { mode: args.mode }; }
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

  assert.equal(app.view.workMode, "ask");
  editor.setText("/plan What is the best auth strategy here?");
  await editor.onSubmit(editor.getText());
  assert.deepEqual(architectCalls, [{ cwd: "/repo", task: "What is the best auth strategy here?" }]);
  assert.equal(app.view.workMode, "plan");
  assert.deepEqual(modeCalls, [{ cwd: "/repo", mode: "plan" }]);

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

test("Shift+Tab cycles WorkMode ASK -> PLAN -> AGENT -> ASK and persists it via service.setMode, never touching plain Tab's focus-toggle job", async () => {
  let tui, editor;
  const modeCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    setMode: async (args) => { modeCalls.push(args); return { mode: args.mode }; }
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

  assert.equal(app.view.workMode, "ask");
  const result = tui.inputListeners[0]("\x1b[Z");
  assert.equal(result?.consume, true);
  assert.equal(app.view.workMode, "plan");
  tui.inputListeners[0]("\x1b[Z");
  assert.equal(app.view.workMode, "agent");
  tui.inputListeners[0]("\x1b[Z");
  assert.equal(app.view.workMode, "ask");
  assert.deepEqual(modeCalls, [{ cwd: "/repo", mode: "plan" }, { cwd: "/repo", mode: "agent" }, { cwd: "/repo", mode: "ask" }]);

  // Plain Tab is untouched — still toggles focus, never cycles mode.
  assert.equal(tui.getFocusedComponent(), editor);
  tui.inputListeners[0]("\t");
  assert.equal(tui.getFocusedComponent(), app.view);
  assert.equal(app.view.workMode, "ask");

  app.stop();
});

test("the persisted KairoSession's real WorkMode is restored at startup, not reset to ASK", async () => {
  const service = {
    snapshot: async () => makeSnapshot([]),
    getSession: async () => ({ mode: "agent" })
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
  assert.equal(app.view.workMode, "agent");
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

test("buildViewportLayoutRoot wires a real ScrollView around the conversation, with dashboard/composer/editor fixed around it", () => {
  const view = new CockpitView({ actions: {
    onShowPlan() {}, onApprove() {}, onReject() {}, onRequestExecute() {}, onExecute() {},
    onCancel() {}, onRefresh() {}, onQuit() {}
  }, requestRender: () => {} });
  view.setSnapshot({ projectRoot: "/repo/demo" });
  view.addTranscript("user", "hello");
  const editor = { render: () => [""], handleInput() {}, invalidate() {} };

  const root = buildViewportLayoutRoot(view, editor);
  assert.equal(root.entries.length, 4);

  const [dashboardEntry, scrollEntry, composerEntry, editorEntry] = root.entries;
  assert.equal(dashboardEntry.shrink, 0);
  assert.match(dashboardEntry.component.render(100).join("\n"), /KAIRO/);

  assert.ok(scrollEntry.component instanceof ScrollView, "the conversation zone must be a real pi-tui ScrollView, not a plain component");
  assert.equal(scrollEntry.grow, 1);
  assert.equal(scrollEntry.minSize, 4);
  assert.equal(scrollEntry.component.primary, true, "must be the primary scroll view so native PageUp/PageDown/mouse-wheel/scrollbar route to it");
  assert.equal(scrollEntry.component.followEnd, true);
  assert.equal(scrollEntry.component.overscroll, "contain");
  assert.equal(scrollEntry.component.scrollbar, "auto");
  assert.match(scrollEntry.component.render(100).join("\n"), /hello/);

  assert.equal(composerEntry.basis, 2);
  assert.equal(composerEntry.shrink, 0);
  assert.match(composerEntry.component.render(100).join("\n"), /Message Kairo · ASK/, "the real current WorkMode shows next to the composer");
  view.setWorkMode("agent");
  assert.match(composerEntry.component.render(100).join("\n"), /Message Kairo · AGENT/, "the composer header reflects a WorkMode change live, not just at build time");
  assert.equal(editorEntry.component, editor);
  assert.equal(editorEntry.basis, 3);
  assert.equal(editorEntry.shrink, 0);
});

test("renderConversation renders every retained transcript entry unsliced and unwrapped-off-screen (no chatBudget/historyLimit)", () => {
  const view = new CockpitView({ actions: {
    onShowPlan() {}, onApprove() {}, onReject() {}, onRequestExecute() {}, onExecute() {},
    onCancel() {}, onRefresh() {}, onQuit() {}
  }, requestRender: () => {} });
  for (let i = 0; i < 20; i += 1) view.addTranscript(i % 2 === 0 ? "user" : "kairo", `message ${i}`);
  const lines = view.renderConversation(80);
  // The old chatLines() fallback defaults to an 8-entry recent-history
  // window when no viewport budget is given; renderConversation() must
  // never do that — every one of the 20 retained messages should appear.
  for (let i = 0; i < 20; i += 1) assert.match(lines.join("\n"), new RegExp(`message ${i}(?!\\d)`));
});

test("renderConversation wraps a long message across multiple lines instead of truncating it", () => {
  const view = new CockpitView({ actions: {
    onShowPlan() {}, onApprove() {}, onReject() {}, onRequestExecute() {}, onExecute() {},
    onCancel() {}, onRefresh() {}, onQuit() {}
  }, requestRender: () => {} });
  const longText = "word ".repeat(40).trim();
  view.addTranscript("kairo", longText);
  const lines = view.renderConversation(30);
  assert.ok(lines.length > 1, "a message longer than the width must wrap onto more than one line");
  for (const line of lines) assert.ok(line.length < longText.length, "no line should be as long as the full unwrapped message");
  const rejoined = lines.map((line) => stripTerminalSequences(line).replace(/^Kairo /, "").trim()).join(" ").replace(/\s+/g, " ");
  assert.equal(rejoined, longText, "wrapping must never drop or truncate the original text");
});

test("renderConversation puts the pending confirm-execute prompt at the very end, after all history", () => {
  const view = new CockpitView({ actions: {
    onShowPlan() {}, onApprove() {}, onReject() {}, onRequestExecute() {}, onExecute() {},
    onCancel() {}, onRefresh() {}, onQuit() {}
  }, requestRender: () => {} });
  view.setRows([{ taskId: "task-a", planState: "approved", approval: "approved", execState: "not_started", execActive: false, execMessage: null }]);
  view.addTranscript("user", "please run this");
  view.showExecuteConfirm("task-a", { decision: "ROUTED", provider: "claude", model: "fable", why: "best fit" });
  const lines = view.renderConversation(100);
  const historyIndex = lines.findIndex((line) => line.includes("please run this"));
  const confirmIndex = lines.findIndex((line) => line.includes("Execute"));
  assert.ok(historyIndex >= 0 && confirmIndex > historyIndex, "the confirm prompt must come after the transcript history");
});
