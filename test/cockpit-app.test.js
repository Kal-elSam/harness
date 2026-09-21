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
    overlays: [],
    addChild(child) { this.children.push(child); },
    setFocus(component) { this.focused = component; },
    getFocusedComponent() { return this.focused; },
    addInputListener(fn) { this.inputListeners.push(fn); },
    requestRender() {},
    start() { this.started = true; },
    stop() { this.stopped = true; },
    showOverlay(component, options) {
      const entry = { component, options, hidden: false };
      this.overlays.push(entry);
      return {
        hide: () => { entry.hidden = true; },
        setHidden: (h) => { entry.hidden = h; },
        isHidden: () => entry.hidden,
        focus: () => {},
        unfocus: () => {},
        isFocused: () => !entry.hidden,
        getBounds: () => undefined
      };
    }
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

test("REGRESSION: tui.start() happens before snapshot() resolves — a human is never blocked staring at a blank terminal waiting on usage/model probes", async () => {
  let tui;
  let releaseSnapshot;
  const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
  const service = { snapshot: async () => { await snapshotGate; return makeSnapshot([]); } };

  const appPromise = runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  // runCockpitApp's own returned promise resolves once tui.start() has
  // already run — never waits on the still-pending snapshot.
  const app = await appPromise;
  assert.equal(tui.started, true);
  releaseSnapshot();
  await app.ready;
  app.stop();
});

test("REGRESSION: a slow snapshot() shows a compact loading indicator while it's in flight, cleared once ready resolves", async () => {
  let releaseSnapshot;
  const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
  const service = { snapshot: async () => { await snapshotGate; return makeSnapshot([]); } };
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  assert.match(app.view.actionStatusLine() ?? "", /Loading usage and model intelligence/);
  releaseSnapshot();
  await app.ready;
  assert.equal(app.view.actionLabel, null, "the loading indicator clears once the first real snapshot lands");
  app.stop();
});

test("REGRESSION: concurrent refresh() calls coalesce into a single queued follow-up — never overlapping real snapshot() calls", async () => {
  let snapshotCalls = 0;
  const gates = [];
  const service = {
    snapshot: async () => {
      snapshotCalls += 1;
      const gate = new Promise((resolve) => { gates.push(resolve); });
      await gate;
      return makeSnapshot([]);
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

  // The background hydration's own snapshot() call is already in flight —
  // two more refresh() calls arrive while it's pending.
  assert.equal(snapshotCalls, 1);
  const second = app.refresh();
  const third = app.refresh();
  assert.equal(second, third, "both coalesce into the exact same queued promise, never a second overlapping call");
  assert.equal(snapshotCalls, 1, "no new real snapshot() call starts while one is still in flight");

  gates[0]();
  while (gates.length < 2) await new Promise((resolve) => setImmediate(resolve));
  // Exactly one queued follow-up ran after the first — never one per
  // coalesced caller.
  assert.equal(snapshotCalls, 2);
  gates[1]();
  await second;
  app.stop();
});

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
  assert.deepEqual(decideCalls, [{ cwd: "/repo", taskId: "task-a", decision: "approved", sessionId: null }]);
  assert.equal(app.view.statusMessage, "");

  app.stop();
});

test("a real in-flight action shows a live spinner (not a static string) while it runs, and clears it once it resolves", async () => {
  let tui;
  let resolveDecide;
  const decidePromise = new Promise((resolve) => { resolveDecide = resolve; });
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    decidePlan: async () => decidePromise
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

  const pending = app.view.actions.onApprove("task-a");
  assert.equal(app.view.actionLabel, "Approving");
  assert.ok(app.view.actionStartedAt, "a real start timestamp must be recorded");
  assert.match(app.view.actionStatusLine(), /Approving…/);
  app.view.tickSpinner();
  const secondFrame = app.view.actionStatusLine();
  app.view.tickSpinner();
  const thirdFrame = app.view.actionStatusLine();
  assert.notEqual(secondFrame, thirdFrame, "the spinner frame must actually advance on each tick");

  resolveDecide({});
  await pending;
  assert.equal(app.view.actionLabel, null, "the live indicator must clear once the real action resolves");
  assert.equal(app.view.actionStatusLine(), null);

  app.stop();
});

test("runCockpitApp drives the spinner from its own fast timer, independent of the poll timer", async () => {
  let tui;
  let resolveDecide;
  const decidePromise = new Promise((resolve) => { resolveDecide = resolve; });
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    decidePlan: async () => decidePromise
  };
  const intervalCallbacks = [];
  const app = await runCockpitApp({
    cwd: "/repo",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: (fn) => { intervalCallbacks.push(fn); return intervalCallbacks.length; },
    clearIntervalImpl: () => {}
  });
  assert.equal(intervalCallbacks.length, 2, "must register both the poll timer and a separate, faster spinner timer");

  const pending = app.view.actions.onApprove("task-a");
  const before = app.view.spinnerFrame;
  intervalCallbacks[1](); // the spinner timer's own tick
  assert.notEqual(app.view.spinnerFrame, before, "the app's own spinner timer must be the thing driving tickSpinner()");

  resolveDecide({});
  await pending;
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

// The two legacy no-role/free-agentId app-level tests that used to live
// here were removed — that path no longer exists (PROJECT TEAM is the
// sole execution authority). The role-based/confirmationTarget-based
// regressions below cover the real replacement behavior.

test("onRequestExecute(taskId, role) threads the user's explicit role choice through to planExecution", async () => {
  let tui;
  const planCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    planExecution: async (args) => {
      planCalls.push(args);
      return { decision: "ROUTED", role: "Builder", provider: "codex", model: "gpt-6-astra", why: "Builder delegates to GPT-6 Astra per the approved project team.", confirmationTarget: { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" } };
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

  await app.view.actions.onRequestExecute("task-a", "Builder");
  assert.deepEqual(planCalls, [{ cwd: "/repo", taskId: "task-a", role: "Builder", sessionId: null }]);
  assert.equal(app.view.executeDecision.confirmationTarget.role, "Builder");

  app.stop();
});

test("a WAIT_FOR_PROJECT_TEAM decision with a real suggested alternative auto-executes with zero confirmation, narrating the substitution", async () => {
  let tui;
  const executeCalls = [];
  const confirmationTarget = { role: "Builder", selection: "suggested-alternative", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" };
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    planExecution: async () => ({
      decision: "WAIT_FOR_PROJECT_TEAM", role: "Builder",
      provider: null, model: null, modelRef: null, assignmentSource: null, strategyFingerprint: "fp-1",
      blockedAssignment: { provider: "claude", model: { displayName: "Fable 5.1" }, assignmentSource: "recommended" },
      suggestedAlternative: { provider: "codex", model: { displayName: "GPT-6 Astra", candidateKey: "codex::gpt-6-astra" } },
      why: "claude is not currently eligible (quota exhausted) — no automatic substitution; confirm the suggested alternative for Builder before proceeding.",
      confirmationTarget, taskPrompt: null
    }),
    executePlan: async (args) => { executeCalls.push(args); return { decision: "ROUTED", provider: "codex", model: "gpt-6-astra" }; }
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

  await app.view.actions.onRequestExecute("task-a", "Builder");

  assert.deepEqual(executeCalls, [{ cwd: "/repo", taskId: "task-a", confirmationTarget, sessionId: null }]);
  assert.equal(app.view.executeDecision, null, "never opens the y/n confirm prompt for an automatic fallback substitution");
  const texts = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(texts, /Fable 5\.1/);
  assert.match(texts, /codex/);
  assert.match(texts, /GPT-6 Astra/);

  app.stop();
});

test("REGRESSION: a MANUAL_HANDOFF decision pushes the real, ready-to-paste task text into the transcript — never leaves the human to reconstruct the prompt themselves", async () => {
  let tui;
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    planExecution: async () => ({
      decision: "MANUAL_HANDOFF", role: "Builder", provider: "opencode-go",
      model: "glm-5-3", modelRef: { displayName: "GLM-5.3" },
      why: "opencode-go isn't executable by Kairo automatically — continue manually with GLM-5.3.",
      confirmationTarget: null, taskPrompt: "Implement the explicitly approved architecture plan below.\n\n# Real Plan"
    })
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

  await app.view.actions.onRequestExecute("task-a", "Builder");
  const texts = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.match(texts, /GLM-5\.3/);
  assert.match(texts, /paste this into its chat/);
  assert.match(texts, /# Real Plan/, "the real task text must actually reach the transcript, not just a mention that one exists");

  app.stop();
});

test("onExecute forwards a real ProjectExecutionPreview's confirmationTarget instead of the legacy agentId/model override", async () => {
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

  const confirmationTarget = { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" };
  await app.view.actions.onExecute("task-a", { decision: "ROUTED", role: "Builder", provider: "codex", model: "gpt-6-astra", confirmationTarget });
  assert.deepEqual(executeCalls, [{ cwd: "/repo", taskId: "task-a", confirmationTarget, sessionId: null }]);

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

test("REGRESSION: boot resolves the real active session first and scopes transcript/session load to it", async () => {
  const calls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    resolveActiveSession: async () => ({ id: "session-42" }),
    loadTranscript: async (args) => { calls.push(["loadTranscript", args]); return []; },
    getSession: async (args) => { calls.push(["getSession", args]); return { mode: "ask" }; }
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

  assert.deepEqual(calls, [
    ["loadTranscript", { cwd: "/repo", sessionId: "session-42" }],
    ["getSession", { cwd: "/repo", sessionId: "session-42" }]
  ]);
  app.stop();
});

test("REGRESSION: the resolved sessionId is shown in the dashboard header via view.setSessionId", async () => {
  const service = { snapshot: async () => makeSnapshot([]) };
  const app = await runCockpitApp({
    cwd: "/repo",
    sessionId: "header-session-id",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });
  assert.equal(app.view.sessionId, "header-session-id");
  app.stop();
});

test("REGRESSION: an explicit sessionId (from kairo start/resume) is used as-is and never overridden by resolveActiveSession", async () => {
  let resolveActiveSessionCalled = false;
  const calls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    resolveActiveSession: async () => { resolveActiveSessionCalled = true; return { id: "auto-picked" }; },
    loadTranscript: async (args) => { calls.push(["loadTranscript", args]); return []; },
    getSession: async (args) => { calls.push(["getSession", args]); return { mode: "ask" }; }
  };
  const app = await runCockpitApp({
    cwd: "/repo",
    sessionId: "explicit-session",
    service,
    terminalFactory: () => ({}),
    tuiFactory: () => makeFakeTui(),
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  assert.equal(resolveActiveSessionCalled, false, "an explicit sessionId must never be second-guessed by auto-resolution");
  assert.deepEqual(calls, [
    ["loadTranscript", { cwd: "/repo", sessionId: "explicit-session" }],
    ["getSession", { cwd: "/repo", sessionId: "explicit-session" }]
  ]);
  app.stop();
});

test("boot loads real persisted transcript history before the first render", async () => {
  const service = {
    snapshot: async () => makeSnapshot([]),
    loadTranscript: async (args) => {
      assert.deepEqual(args, { cwd: "/repo", sessionId: null });
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
    { cwd: "/repo", role: "user", text: "What is this project about?", sessionId: null },
    { cwd: "/repo", role: "kairo", text: "claude: It orchestrates providers.", sessionId: null }
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
  assert.deepEqual(cleared, [{ cwd: "/repo", sessionId: null }]);
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
  assert.deepEqual(submitted, [{ cwd: "/repo", task: "Add OAuth login", mode: "ask", sessionId: null }]);
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
  assert.deepEqual(submitted, [{ cwd: "/repo", task: "What is this project about?", mode: "ask", sessionId: null }]);
  assert.equal(app.view.transcript.some((entry) => entry.text.includes("It orchestrates Codex/Claude/OpenCode.")), true);

  app.stop();
});

test("REGRESSION: asking a real question shows the real provider in the action label, not a generic 'Asking Kairo' — and on failure, names the real provider that failed", async () => {
  let editor;
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    planAsk: async () => ({ decision: { decision: "ROUTED", provider: "codex", model: "gpt-5-codex" } }),
    submitTask: async () => { throw new Error("sandboxed codex exec timed out"); }
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

  editor.setText("donde estamos parados?");
  await editor.onSubmit(editor.getText());
  assert.match(app.view.statusMessage, /^Asking Codex/, "the failure label must name the real provider, never the generic 'Asking Kairo'");
  assert.match(app.view.statusMessage, /sandboxed codex exec timed out/);

  app.stop();
});

test("a submitTask call without a real planAsk preview falls back to the generic label — never throws", async () => {
  let editor;
  const service = {
    snapshot: async () => makeSnapshot([BASE_ROW]),
    submitTask: async () => ({ kind: "answer", provider: "claude", answer: "ok" })
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

  editor.setText("hola");
  await editor.onSubmit(editor.getText());
  assert.equal(app.view.statusMessage, "");

  app.stop();
});

test("bare /project (no subcommand) opens the real interactive overlay on the tui, never printing the old usage text", async () => {
  let editor;
  let tui;
  const service = {
    snapshot: async () => makeSnapshot([]),
    preflightProject: async () => ({ profile: {}, candidates: {}, alternatives: [] })
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project");
  await editor.onSubmit(editor.getText());
  assert.equal(tui.overlays.length, 1, "bare /project must open the interactive overlay");
  assert.equal(tui.overlays[0].hidden, false);
  const texts = app.view.transcript.map((entry) => entry.text).join("\n");
  assert.doesNotMatch(texts, /Usage: \/project status\|analyze/, "must not fall through to the old text-usage message");
  app.stop();
});

test("the interactive /project overlay's own real milestones (analysis started/ready, approved, etc.) are mirrored into the conversation transcript, not just shown on the overlay itself", async () => {
  let editor;
  let tui;
  const service = {
    snapshot: async () => makeSnapshot([]),
    preflightProject: async () => ({ profile: {}, candidates: {}, alternatives: [] })
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project");
  await editor.onSubmit(editor.getText());
  const overlay = tui.overlays[0].component;
  // The overlay's own real onNarrate hook — exercised directly rather than
  // driving the full picker flow, since that's already covered by
  // project-overlay.test.js's own dedicated narration regressions.
  overlay.onNarrate("Suggested project team ready (1 real role). Open /project to review, edit, or approve it.");
  const texts = app.view.transcript.map((entry) => entry.text);
  assert.ok(texts.some((t) => t === "Suggested project team ready (1 real role). Open /project to review, edit, or approve it."));
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

test("/project analyze opens the same interactive analyst overlay and runs exactly one local preflight", async () => {
  let editor;
  let tui;
  const preflightCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    preflightProject: async (args) => {
      preflightCalls.push(args);
      return {
        profile: { fingerprint: "fp-1" },
        candidates: {},
        analystCatalog: { recommendedModel: null, models: [] }
      };
    }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project analyze");
  await editor.onSubmit(editor.getText());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tui.overlays.length, 1);
  assert.deepEqual(preflightCalls, [{ cwd: "/repo" }]);
  assert.equal(tui.overlays[0].component.state, "no-analyst");
  app.stop();
});

test("/project analyze bypasses an existing suggested strategy and starts the same fresh picker flow without double preflight", async () => {
  let editor;
  let tui;
  const preflightCalls = [];
  const service = {
    snapshot: async () => ({
      ...makeSnapshot([]),
      projectStrategy: { status: "suggested", bootstrapAnalyst: { adapterId: "codex", modelId: "old" }, projectTeam: [] }
    }),
    preflightProject: async (args) => {
      preflightCalls.push(args);
      return {
        profile: {}, candidates: {},
        analystCatalog: {
          recommendedModel: { candidateKey: "codex::new", recommendationTags: ["quality"] },
          models: [{ candidateKey: "codex::new", adapterId: "codex", modelId: "new", displayName: "New Analyst", evidenceStatus: "scored", available: true, recommendationTags: ["quality"] }]
        }
      };
    }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project analyze");
  await editor.onSubmit(editor.getText());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tui.overlays.length, 1);
  assert.equal(tui.overlays[0].component.state, "select-analyst");
  assert.deepEqual(preflightCalls, [{ cwd: "/repo" }], "must not initialize from the old strategy and then launch a second preflight");
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

test("/project cursor exhausted|available calls the real setCursorManualQuota with the real intent — the only way Cursor's quota state ever changes", async () => {
  let editor;
  const quotaCalls = [];
  const service = {
    snapshot: async () => makeSnapshot([]),
    setCursorManualQuota: async (args) => { quotaCalls.push(args); return { manualExhausted: args.exhausted }; }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project cursor exhausted");
  await editor.onSubmit(editor.getText());
  editor.setText("/project cursor available");
  await editor.onSubmit(editor.getText());
  assert.deepEqual(quotaCalls, [{ exhausted: true }, { exhausted: false }]);
  app.stop();
});

test("/project cursor with no real exhausted|available argument never calls setCursorManualQuota — an ambiguous toggle must never guess", async () => {
  let editor;
  let called = false;
  const service = {
    snapshot: async () => makeSnapshot([]),
    setCursorManualQuota: async () => { called = true; return {}; }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service, terminalFactory: () => ({}), tuiFactory: () => makeFakeTui(),
    editorFactory: () => { editor = makeFakeEditor(); return editor; },
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  editor.setText("/project cursor");
  await editor.onSubmit(editor.getText());
  assert.equal(called, false);
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
  assert.deepEqual(architectCalls, [{ cwd: "/repo", task: "What is the best auth strategy here?", sessionId: null }]);
  assert.equal(app.view.workMode, "plan");
  assert.deepEqual(modeCalls, [{ cwd: "/repo", mode: "plan", sessionId: null }]);

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
  assert.deepEqual(modeCalls, [
    { cwd: "/repo", mode: "plan", sessionId: null },
    { cwd: "/repo", mode: "agent", sessionId: null },
    { cwd: "/repo", mode: "ask", sessionId: null }
  ]);

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
  const clearsAfterFirstQuit = clears;
  app.view.actions.onQuit(); // idempotent
  assert.equal(tui.stopped, true);
  assert.equal(clearsAfterFirstQuit, 2, "must clear both real timers (poll + spinner) exactly once each");
  assert.equal(clears, clearsAfterFirstQuit, "a second onQuit must never clear anything again");
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

test("a real active run's new transcript lines are pushed into the chat on refresh, tagged with their own real provider", async () => {
  let tui;
  const readCalls = [];
  const row = { taskId: "task-a", state: "approved", approval: "approved", execution: { state: "running", active: true, runId: "run_1", message: "codex run is running." } };
  const service = {
    snapshot: async () => makeSnapshot([row]),
    readRunTranscript: async (args) => {
      readCalls.push(args);
      return { runId: args.runId, nextIndex: 2, entries: [
        { provider: "codex", timestamp: "t1", text: "Reading the failing test…" },
        { provider: "codex", timestamp: "t2", text: "Found it." }
      ] };
    }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service,
    terminalFactory: () => ({}), tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(), setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  // The real snapshot hydrates in the background now (Increment 2 of
  // cockpit trust recovery — see runCockpitApp's own doc); the tailed run
  // lines only land once that first background refresh actually completes.
  await app.ready;
  assert.deepEqual(readCalls, [{ runId: "run_1", sinceIndex: 0 }]);
  const texts = app.view.transcript.map((e) => e.text);
  assert.ok(texts.some((t) => t.includes("[codex]") && t.includes("Reading the failing test…")));
  assert.ok(texts.some((t) => t.includes("[codex]") && t.includes("Found it.")));
  app.stop();
});

test("a live-tailed run never shows the same real line twice across two polls, and stops being tailed once it's no longer active", async () => {
  let tui;
  const readCalls = [];
  let active = true;
  const snapshots = [
    makeSnapshot([{ taskId: "task-a", state: "approved", approval: "approved", execution: { state: "running", active: true, runId: "run_1", message: "running" } }]),
    makeSnapshot([{ taskId: "task-a", state: "approved", approval: "approved", execution: { state: "completed", active: false, runId: "run_1", message: "done" } }])
  ];
  let call = 0;
  const service = {
    snapshot: async () => snapshots[Math.min(call++, snapshots.length - 1)],
    readRunTranscript: async (args) => {
      readCalls.push(args);
      if (args.sinceIndex === 0) return { runId: "run_1", nextIndex: 1, entries: [{ provider: "claude", timestamp: "t1", text: "First line." }] };
      return { runId: "run_1", nextIndex: 2, entries: [{ provider: "claude", timestamp: "t2", text: "Final line." }] };
    }
  };
  const intervalCallbacks = [];
  const app = await runCockpitApp({
    cwd: "/repo", service,
    terminalFactory: () => ({}), tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(),
    setIntervalImpl: (fn) => { intervalCallbacks.push(fn); return intervalCallbacks.length; }, clearIntervalImpl: () => {}
  });
  await intervalCallbacks[0](); // poll tick 2: run now inactive, one final tail
  await intervalCallbacks[0](); // poll tick 3: run no longer tracked — must not call readRunTranscript again
  assert.deepEqual(readCalls, [{ runId: "run_1", sinceIndex: 0 }, { runId: "run_1", sinceIndex: 1 }]);
  const texts = app.view.transcript.map((e) => e.text);
  assert.equal(texts.filter((t) => t.includes("First line.")).length, 1);
  assert.equal(texts.filter((t) => t.includes("Final line.")).length, 1);
  app.stop();
});

test("a readRunTranscript failure for one run never breaks the rest of the poll loop", async () => {
  let tui;
  const service = {
    snapshot: async () => makeSnapshot([{ taskId: "task-a", state: "approved", approval: "approved", execution: { state: "running", active: true, runId: "run_1", message: "running" } }]),
    readRunTranscript: async () => { throw new Error("boom"); }
  };
  const app = await runCockpitApp({
    cwd: "/repo", service,
    terminalFactory: () => ({}), tuiFactory: () => { tui = makeFakeTui(); return tui; },
    editorFactory: () => makeFakeEditor(), setIntervalImpl: () => 1, clearIntervalImpl: () => {}
  });
  assert.equal(app.view.rows[0].taskId, "task-a", "the rest of refresh() must still have applied despite the tail failure");
  app.stop();
});
