import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CockpitView } from "../src/global/cockpit/view.js";

const ROWS = [
  { taskId: "task-a", planState: "awaiting_approval", approval: "not_decided", execState: "not_started", execActive: false, execMessage: null },
  { taskId: "task-b", planState: "approved", approval: "approved", execState: "not_started", execActive: false, execMessage: null }
];

function makeView(overrideActions = {}) {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const actions = {
    onShowPlan: record("onShowPlan"),
    onApprove: record("onApprove"),
    onReject: record("onReject"),
    onRequestExecute: record("onRequestExecute"),
    onExecute: record("onExecute"),
    onCancel: record("onCancel"),
    onRefresh: record("onRefresh"),
    onQuit: record("onQuit"),
    ...overrideActions
  };
  const view = new CockpitView({ actions, requestRender: () => {} });
  view.setRows(ROWS);
  return { view, calls };
}

test("conversation render never exceeds the requested width", () => {
  const { view } = makeView();
  const lines = view.render(60);
  for (const line of lines) assert.ok(visibleWidth(line) <= 60, `line "${line}" exceeds width`);
  assert.match(lines.join("\n"), /KAIRO/);
});

test("render gives conversation priority and keeps compact usage in the header", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    providers: { claude: { status: "Pro · usage unknown" } },
    integrations: { engram: { status: "connected" } }
  });
  view.addTranscript("user", "Fix the login flow");
  const joined = view.render(120).join("\n");
  assert.match(joined, /KAIRO/);
  assert.match(joined, /demo · BALANCED/);
  assert.match(joined, /USAGE/);
  assert.match(joined, /WORKFLOW/);
  assert.match(joined, /WAITING APPROVAL/);
  assert.match(joined, /Claude\s+Pro/);
  assert.match(joined, /Fix the login flow/);
  assert.match(joined, /Enter send/);
  assert.doesNotMatch(joined, /TASKS/);
  assert.doesNotMatch(joined, /ACTIVITY/);
  // Integration detail (Engram/MCP/etc.) is deliberately kept out of the
  // always-visible workspace — it's still reachable via view.integrationsLine()
  // behind /status, but shouldn't compete with the current task on screen.
  assert.doesNotMatch(joined, /Engram connected/);
});

test("narrow dashboard keeps Go and Zen on separate readable rows", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    usage: {
      codex: null,
      claude: null,
      opencode: {
        go: { windows: [
          { name: "rolling", remainingPercent: 100, status: "ok" },
          { name: "weekly", remainingPercent: 100, status: "ok" },
          { name: "monthly", remainingPercent: 0, status: "rate-limited" }
        ] },
        zen: { status: "local_recorded", totalCost: 33.81, totalTokens: 10_200_000 }
      }
    }
  });
  const lines = view.render(70).join("\n");
  assert.match(lines, /Go\s+roll 100%/);
  assert.match(lines, /week 100%/);
  assert.match(lines, /month 0% LIMITED/);
  assert.match(lines, /Zen\s+\$33\.81 local \/ 7d/);
  assert.doesNotMatch(lines, /PAYG blocked/);
});

test("workspace health shows every measured Go window and Zen local spend without policy noise", () => {
  const { view } = makeView();
  view.setSnapshot({
    usage: {
      opencode: {
        go: { windows: [
          { name: "rolling", remainingPercent: 100, status: "ok" },
          { name: "weekly", remainingPercent: 75, status: "ok" },
          { name: "monthly", remainingPercent: 0, status: "rate-limited" }
        ] },
        zen: { status: "local_recorded", totalCost: 33.81 }
      }
    }
  });
  const lines = view.compactHealthLines().join("\n");
  assert.match(lines, /Go\s+roll 100%/);
  assert.match(lines, /week 75%/);
  assert.match(lines, /month 0% LIMITED/);
  assert.match(lines, /Zen\s+\$33\.81 local \/ 7d/);
  assert.doesNotMatch(lines, /PAYG blocked/);
});

test("render keeps a complete multi-line usage response visible", () => {
  const { view } = makeView();
  for (const text of ["Codex usage", "Claude usage", "Go usage", "Zen usage", "Integrations"]) {
    view.addTranscript("kairo", text);
  }
  const lines = view.render(80).join("\n");
  assert.match(lines, /Codex usage/);
  assert.match(lines, /Claude usage/);
  assert.match(lines, /Go usage/);
  assert.match(lines, /Zen usage/);
  assert.match(lines, /Integrations/);
});

test("up/down moves selection and clamps at the edges", () => {
  const { view } = makeView();
  assert.equal(view.selectedIndex, 0);
  view.handleInput("\x1b[B"); // down
  assert.equal(view.selectedIndex, 1);
  view.handleInput("\x1b[B"); // down again, clamps
  assert.equal(view.selectedIndex, 1);
  view.handleInput("\x1b[A"); // up
  assert.equal(view.selectedIndex, 0);
});

test("enter requests the selected plan's markdown and switches to detail mode", () => {
  const { view, calls } = makeView();
  view.handleInput("\r");
  assert.deepEqual(calls, [["onShowPlan", "task-a"]]);
});

test("a/j only fire approve/reject when available for the selected row", () => {
  const { view, calls } = makeView();
  view.handleInput("a"); // task-a is awaiting_approval: allowed
  view.handleInput("j");
  assert.deepEqual(calls, [["onApprove", "task-a"], ["onReject", "task-a"]]);

  const { view: view2, calls: calls2 } = makeView();
  view2.moveSelection(1); // select task-b (approved, not awaiting_approval)
  view2.handleInput("a");
  assert.deepEqual(calls2, []);
});

test("x asks for the real routing decision first; the confirm prompt only appears once app.js supplies it", () => {
  const { view, calls } = makeView();
  view.moveSelection(1); // task-b is approved + not_started: executable
  view.handleInput("x");
  assert.equal(view.mode, "list"); // still list — awaiting the async decision from app.js
  assert.deepEqual(calls, [["onRequestExecute", "task-b"]]);

  const decision = { decision: "ROUTED", provider: "codex", model: "gpt-6-astra", why: "reasoning task" };
  view.showExecuteConfirm("task-b", decision);
  assert.equal(view.mode, "confirm-execute");
  const lines = view.render(120).join("\n");
  assert.match(lines, /codex · gpt-6-astra/);
  assert.match(lines, /reasoning task/);

  view.handleInput("n");
  assert.equal(view.mode, "list");
  assert.deepEqual(calls, [["onRequestExecute", "task-b"]]);
});

test("y confirms and forwards the exact decision shown, so the preview and the real launch never disagree", () => {
  const { view, calls } = makeView();
  view.moveSelection(1);
  const decision = { decision: "ROUTED", provider: "claude", model: null, why: "default implementation provider" };
  view.showExecuteConfirm("task-b", decision);
  view.handleInput("y");
  assert.equal(view.mode, "list");
  assert.deepEqual(calls, [["onExecute", "task-b", decision]]);
});

test("a WAIT_FOR_APPROVAL decision shows the real reason and blocks 'y' from launching anything", () => {
  const { view, calls } = makeView();
  view.moveSelection(1);
  const decision = { decision: "WAIT_FOR_APPROVAL", provider: null, model: null, why: "high risk (auth) combined with reasoning scope" };
  view.showExecuteConfirm("task-b", decision);
  const lines = view.render(120).join("\n");
  assert.match(lines, /Cannot auto-execute/);
  assert.match(lines, /high risk \(auth\)/);

  view.handleInput("y");
  assert.equal(view.mode, "confirm-execute"); // 'y' is ignored — never launches a non-ROUTED decision
  assert.deepEqual(calls, []);

  view.handleInput("n");
  assert.equal(view.mode, "list");
});

test("c cancels only when the row has an active execution", () => {
  const { view, calls } = makeView();
  view.handleInput("c"); // task-a has no active execution
  assert.deepEqual(calls, []);
  view.setRows([
    ...ROWS,
    { taskId: "task-c", planState: "approved", approval: "approved", execState: "running", execActive: true, execMessage: "Claude run is running." }
  ]);
  view.moveSelection(2); // task-c is active
  view.handleInput("c");
  assert.deepEqual(calls, [["onCancel", "task-c"]]);
});

test("q and ctrl+c quit from list mode", () => {
  const { view, calls } = makeView();
  view.handleInput("q");
  assert.deepEqual(calls, [["onQuit"]]);
});

test("ctrl+c quits even while viewing plan detail", () => {
  const { view, calls } = makeView();
  view.showDetail("task-a", "# Plan");
  assert.equal(view.mode, "detail");
  view.handleInput("\x03"); // ctrl+c
  assert.deepEqual(calls, [["onQuit"]]);
});

test("escape backs out of detail view to the list", () => {
  const { view } = makeView();
  view.showDetail("task-a", "# Plan\nbody");
  assert.equal(view.mode, "detail");
  const lines = view.render(80).join("\n");
  assert.match(lines, /Plan: task-a/);
  assert.match(lines, /body/);
  view.handleInput("\x1b"); // escape
  assert.equal(view.mode, "list");
});

test("r refreshes and setStatus/setRows update state without throwing on empty rows", () => {
  const { view, calls } = makeView();
  view.handleInput("r");
  assert.deepEqual(calls, [["onRefresh"]]);
  view.setRows([]);
  assert.equal(view.selectedIndex, 0);
  const lines = view.render(40).join("\n");
  assert.match(lines, /Ask Kairo about this project/);
});
