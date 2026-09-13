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
  assert.match(joined, /demo/);
  assert.match(joined, /USAGE/);
  assert.match(joined, /Claude\s+Pro/);
  assert.match(joined, /Fix the login flow/);
  assert.match(joined, /Enter send/);
  assert.doesNotMatch(joined, /TASKS/);
  assert.doesNotMatch(joined, /ACTIVITY/);
  // STATUS added no real value (only ever showed a leftover task's phase)
  // and was removed outright per explicit user decision.
  assert.doesNotMatch(joined, /STATUS/);
  assert.doesNotMatch(joined, /WORKFLOW/);
  // Integration detail (Engram/MCP/etc.) is deliberately kept out of the
  // always-visible workspace — it's still reachable via view.integrationsLine()
  // behind /status, but shouldn't compete with the current task on screen.
  assert.doesNotMatch(joined, /Engram connected/);
});

test("AI TEAM's compact widget shows only Role -> effective model, never fallback or reason noise", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [
        {
          role: "Explorer",
          primary: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6-Astra", available: true },
          fallback: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1", available: true },
          reason: "Near-equivalent alternatives (~1.1%) — assigned to balance provider load."
        },
        {
          role: "Economy",
          primary: { adapterId: "opencode-go", modelId: "go-luna", displayName: "GPT-5.6-Luna", available: true },
          fallback: null, reason: null
        }
      ]
    }
  });
  const lines = view.render(160).join("\n");
  assert.match(lines, /Artificial Analysis, live/);
  assert.match(lines, /Explorer\s+Codex · GPT-6-Astra/);
  assert.match(lines, /Economy\s+Opencode-go · GPT-5\.6-Luna/);
  assert.doesNotMatch(lines, /fallback/);
  assert.doesNotMatch(lines, /Near-equivalent/);
  assert.doesNotMatch(lines, /Global signals — not a project strategy/);
});

test("AI TEAM's compact widget shows the real fallback as the headline (not the unavailable primary) when the preferred model can't run", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [
        {
          role: "Tester",
          primary: { adapterId: "opencode-go", modelId: "go-tester", displayName: "OpenCode Go Tester", available: false },
          fallback: { adapterId: "claude", modelId: "claude-sonnet-5", displayName: "Claude Sonnet 5", available: true },
          reason: null
        }
      ]
    }
  });
  const lines = view.fitLines().join("\n");
  assert.match(lines, /Tester\s+Claude · Claude Sonnet 5/);
  assert.doesNotMatch(lines, /not available/);
  assert.doesNotMatch(lines, /OpenCode Go Tester/);
});

test("AI TEAM's compact widget honestly says so when neither primary nor fallback is available", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [{
        role: "Economy",
        primary: { adapterId: "opencode-go", modelId: "go-hy3", displayName: "Hy3", available: false },
        fallback: null, reason: "No eligible provider currently covers this role."
      }]
    }
  });
  const lines = view.fitLines().join("\n");
  assert.match(lines, /Economy[\s\S]*?no eligible option right now/);
});

test("/models writes the full primary/fallback/reason breakdown that the compact widget leaves out", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [
        {
          role: "Tester",
          primary: { adapterId: "opencode-go", modelId: "go-tester", displayName: "OpenCode Go Tester", available: false },
          fallback: { adapterId: "claude", modelId: "claude-sonnet-5", displayName: "Claude Sonnet 5", available: true },
          reason: "Real capability leader is temporarily unavailable (rate limited)."
        }
      ]
    }
  });
  const lines = view.aiTeamDetailLines().join("\n");
  assert.match(lines, /Tester\s+Opencode-go · OpenCode Go Tester \(not available\)/);
  assert.match(lines, /fallback Claude · Claude Sonnet 5/);
  assert.match(lines, /temporarily unavailable/);
});

test("/models separates each role's block with a blank line, so scrolling through the full breakdown stays readable", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [
        { role: "Explorer", primary: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", available: true }, fallback: null, reason: null },
        { role: "Builder", primary: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1", available: true }, fallback: null, reason: null }
      ]
    }
  });
  const lines = view.aiTeamDetailLines();
  const builderIndex = lines.findIndex((line) => line.includes("Builder"));
  // A blank string ("") would be silently dropped once routed through the
  // persisted chat transcript (addTranscript trims and discards empty
  // text) — the separator must be real, visible, non-whitespace content
  // so it survives into the actual chat history, not just this array.
  assert.match(lines[builderIndex - 1], /\S/, "the separator must be visible content, not a blank line that gets dropped by addTranscript");
});

test("modelsExplainLines() gives concrete plain-language reasons, never raw metrics, percentages, or source names", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [{
        role: "Debugger",
        primary: {
          adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", available: true,
          corroboration: [{ metric: "terminal-bench", value: 57.9, source: "openai-official" }]
        },
        fallback: { adapterId: "codex", modelId: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", available: true },
        reason: null
      }],
      efficientTeam: [{
        role: "Debugger",
        primary: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1", available: true },
        fallback: null,
        reason: "Near-equivalent capability — chosen for lower real subscription quota pressure."
      }]
    }
  });
  const lines = view.modelsExplainLines().join("\n");
  assert.match(lines, /Debugger\s+Codex · GPT-6 Astra/);
  assert.match(lines, /Selected for reasoning and terminal-debugging capability\./);
  assert.match(lines, /Efficient: Claude · Fable 5\.1 — Near-equivalent capability — chosen for lower real subscription quota pressure\./);
  assert.match(lines, /Fallback: Codex · GPT-5\.6 Sol — used if this model becomes unavailable\./);
  assert.doesNotMatch(lines, /terminal-bench=/);
  assert.doesNotMatch(lines, /openai-official/);
  assert.doesNotMatch(lines, /%/);
  assert.doesNotMatch(lines, /gpt-6-astra/); // no raw model-id slugs, only display names
});

test("modelsExplainLines() says so plainly when EFFICIENT TEAM has no cheaper or faster real alternative", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [{
        role: "Builder",
        primary: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1", available: true },
        fallback: null, reason: null
      }],
      efficientTeam: [{
        role: "Builder",
        primary: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1", available: true },
        fallback: null, reason: null
      }]
    }
  });
  const lines = view.modelsExplainLines().join("\n");
  assert.match(lines, /Efficient: same pick — no cheaper or faster real alternative within the capability floor\./);
});

test("modelsExplainLines() marks a currently-unavailable primary and names the real fallback used instead", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [{
        role: "Tester",
        primary: { adapterId: "opencode-go", modelId: "go-tester", displayName: "OpenCode Go Tester", available: false },
        fallback: { adapterId: "claude", modelId: "claude-sonnet-5", displayName: "Claude Sonnet 5", available: true },
        reason: "Real capability leader is temporarily unavailable (rate limited)."
      }],
      efficientTeam: []
    }
  });
  const lines = view.modelsExplainLines().join("\n");
  assert.match(lines, /Tester\s+Opencode-go · OpenCode Go Tester \(currently unavailable\)/);
  assert.match(lines, /Real capability leader is temporarily unavailable \(rate limited\)\./);
  assert.match(lines, /Fallback: Claude · Claude Sonnet 5 — used if this model becomes unavailable\./);
});

test("efficientTeamLines() renders one line per role, same shape as AI TEAM's compact widget", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      efficientTeam: [{
        role: "Economy",
        primary: { adapterId: "opencode-go", modelId: "go-hy3", displayName: "Hy3", available: true },
        fallback: null, reason: null
      }]
    }
  });
  const lines = view.efficientTeamLines().join("\n");
  assert.match(lines, /Artificial Analysis, live/);
  assert.match(lines, /Economy\s+Opencode-go · Hy3/);
});

function aiPlusEfficientSnapshot() {
  return {
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [{
        role: "Builder",
        primary: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1", available: true },
        fallback: null, reason: null
      }],
      efficientTeam: [{
        role: "Builder",
        primary: { adapterId: "opencode-go", modelId: "go-glm", displayName: "GLM 5.3", available: true },
        fallback: null, reason: "Near-equivalent capability — chosen for lower real price."
      }]
    }
  };
}

test("USAGE, AI TEAM, and EFFICIENT TEAM tile side by side once the terminal is wide enough", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot(aiPlusEfficientSnapshot());
  const lines = view.render(220);
  const topLine = lines.find((line) => line.includes("KAIRO"));
  assert.ok(topLine.includes("AI TEAM"));
  assert.ok(topLine.includes("EFFICIENT TEAM"));
  assert.match(lines.join("\n"), /Builder\s+Claude · Claude Fable 5\.1/);
  assert.match(lines.join("\n"), /Builder\s+Opencode-go · GLM 5\.3/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 220, `line "${line}" exceeds width`);
});

test("at medium width, USAGE sits full-width on top and AI TEAM + EFFICIENT TEAM tile below it", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot(aiPlusEfficientSnapshot());
  const lines = view.render(160);
  const topLine = lines.find((line) => line.includes("KAIRO"));
  assert.ok(!topLine.includes("AI TEAM"), "USAGE's own top border shouldn't share a row with AI TEAM at medium width");
  const teamHeaderLine = lines.find((line) => line.includes("AI TEAM"));
  assert.ok(teamHeaderLine.includes("EFFICIENT TEAM"), "AI TEAM and EFFICIENT TEAM tile side by side below USAGE");
  assert.match(lines.join("\n"), /Builder\s+Claude · Claude Fable 5\.1/);
  assert.match(lines.join("\n"), /Builder\s+Opencode-go · GLM 5\.3/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 160, `line "${line}" exceeds width`);
});

test("below the medium threshold, AI TEAM and EFFICIENT TEAM collapse into one TEAMS panel with CAPABILITY/EFFICIENT columns", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot(aiPlusEfficientSnapshot());
  const lines = view.render(100);
  const topLine = lines.find((line) => line.includes("KAIRO"));
  assert.ok(!topLine.includes("AI TEAM"));
  assert.ok(lines.some((line) => line.includes("TEAMS")));
  const joined = lines.join("\n");
  assert.match(joined, /CAPABILITY/);
  assert.match(joined, /EFFICIENT/);
  assert.match(joined, /Builder\s+Claude · Claude Fable 5\.1\s+Opencode-go · GLM 5\.3/);
});

test("AI TEAM reports honestly when there is no benchmark data yet", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot({ projectRoot: "/repo/demo", modelIntelligence: { status: "unknown", source: null, age: null, models: [], error: "no API key configured" } });
  const lines = view.render(100).join("\n");
  assert.match(lines, /No model benchmark data yet \(no API key configured\)/);
});

test("AI TEAM shows real rejection reasons when no provider is eligible", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [],
      eligibility: {
        codex: { ok: false, reason: "Codex quota nearly exhausted (2% left)" },
        claude: { ok: false, reason: "Claude quota nearly exhausted (1% left)" },
        "opencode-go": { ok: false, reason: "opencode-go: not available" },
        "opencode-zen": { ok: false, reason: "OpenCode Zen is excluded from automatic routing (PAYG risk)" },
        cursor: { ok: false, reason: "Cursor is manual-only, not used for automatic recommendations" }
      }
    }
  });
  const lines = view.render(100).join("\n");
  assert.match(lines, /No eligible model signals right now/);
  assert.match(lines, /codex: Codex quota nearly exhausted \(2% left\)/);
  assert.match(lines, /claude: Claude quota nearly exhausted \(1% left\)/);
});

test("/why-style fitWhyLines names every candidate's real eligibility outcome, not just the excluded ones", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      eligibility: {
        codex: { ok: true, reason: null },
        claude: { ok: false, reason: "Claude quota nearly exhausted (2% left)" }
      }
    }
  });
  const lines = view.fitWhyLines().join("\n");
  assert.match(lines, /codex: eligible/);
  assert.match(lines, /claude: excluded — Claude quota nearly exhausted \(2% left\)/);
});

test("/why also shows real catalog coverage — separate from runtime eligibility, so 'best available' is never confused with 'the only thing Kairo can see'", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      eligibility: { codex: { ok: true, reason: null } },
      coverage: [
        { adapterId: "codex", catalogStatus: "measured", totalModels: 5, matchedModels: 5 },
        { adapterId: "claude", catalogStatus: "documented", totalModels: 9, matchedModels: 8 }
      ]
    }
  });
  const lines = view.fitWhyLines().join("\n");
  assert.match(lines, /codex: measured catalog, 5\/5 models matched to Artificial Analysis/);
  assert.match(lines, /claude: documented catalog, 8\/9 models matched to Artificial Analysis/);
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
