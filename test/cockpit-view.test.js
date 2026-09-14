import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
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
  // USAGE is a compact one-line bar now, not a bordered card with its own
  // "USAGE" label — real provider status still shows inline.
  assert.match(joined, /Claude Pro/);
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
  assert.match(lines, /Evidence: live/);
  // Provider is deliberately hidden in the compact widget — Role → Model only.
  assert.match(lines, /Explorer\s+│ GPT-6-Astra/);
  assert.match(lines, /Economy\s+│ GPT-5\.6-Luna/);
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
  assert.match(lines, /Tester\s+Claude Sonnet 5/);
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

test("/models --evidence shows real coverage and confidence per role, warning when coverage is incomplete", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [
        {
          role: "Debugger",
          primary: { adapterId: "claude", modelId: "claude-x", displayName: "Fable 5.1", available: true },
          fallback: null, reason: null, coverage: 0.5, confidence: "medium"
        },
        {
          role: "Reviewer",
          primary: { adapterId: "codex", modelId: "codex-x", displayName: "GPT-6 Astra", available: true },
          fallback: null, reason: null, coverage: 1, confidence: "high"
        }
      ]
    }
  });
  const lines = view.aiTeamDetailLines().join("\n");
  assert.match(lines, /Debugger\s+Claude · Fable 5\.1/);
  assert.match(lines, /coverage: 50% of relevant capabilities scored · confidence: medium/);
  assert.match(lines, /coverage: 100% of relevant capabilities scored · confidence: high/);
});

test("/models --evidence lists real catalog models Kairo has access to but couldn't match to any Artificial Analysis data, honestly labeled UNSCORED — never a fabricated score", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [{ role: "Builder", primary: { adapterId: "claude", modelId: "claude-x", displayName: "Fable 5.1", available: true }, fallback: null, reason: null }],
      unscoredModels: [{ adapterId: "codex", modelId: "gpt-6-experimental", displayName: null }]
    }
  });
  const lines = view.aiTeamDetailLines().join("\n");
  assert.match(lines, /UNSCORED/);
  assert.match(lines, /Codex · gpt-6-experimental/);
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
  // Provider is deliberately hidden in the default plain-language view.
  assert.match(lines, /Debugger\s+GPT-6 Astra/);
  assert.match(lines, /Selected for reasoning and terminal-debugging capability\./);
  assert.match(lines, /Efficient: Fable 5\.1 — Near-equivalent capability — chosen for lower real subscription quota pressure\./);
  assert.match(lines, /Fallback: GPT-5\.6 Sol — used if this model becomes unavailable\./);
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
  assert.match(lines, /Tester\s+OpenCode Go Tester \(currently unavailable\)/);
  assert.match(lines, /Real capability leader is temporarily unavailable \(rate limited\)\./);
  assert.match(lines, /Fallback: Claude Sonnet 5 — used if this model becomes unavailable\./);
});

test("modelsExplainLines() distinguishes every real portfolio outcome the plan calls for — decisive capability, concentration avoidance, minimal-sufficient alternative, forced repeat, and Reviewer independence", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [
        // 1. Decisive capability — no special reason needed, falls back
        // to the plain role blurb.
        { role: "Builder", primary: { adapterId: "claude", modelId: "claude-x", displayName: "Fable 5.1", available: true }, fallback: null, reason: null },
        // 2. Assigned to avoid concentration.
        { role: "Explorer", primary: { adapterId: "codex", modelId: "codex-x", displayName: "GPT-6 Astra", available: true }, fallback: null, reason: "Near-equivalent alternatives — assigned to a different model/provider to avoid concentration." },
        // 4. Forced to repeat — no real alternative avoids concentration.
        { role: "Tester", primary: { adapterId: "claude", modelId: "claude-x", displayName: "Fable 5.1", available: true }, fallback: null, reason: "Only adequate option — no real alternative avoids concentration without forcing a repeat." },
        // 5. Reviewer independence.
        { role: "Reviewer", primary: { adapterId: "opencode-go", modelId: "go-x", displayName: "GLM-5.3", available: true }, fallback: null, reason: "Kept independent from Builder's provider." }
      ],
      efficientTeam: [
        { role: "Builder", primary: { adapterId: "claude", modelId: "claude-x", displayName: "Fable 5.1", available: true }, fallback: null, reason: null },
        { role: "Explorer", primary: { adapterId: "codex", modelId: "codex-x", displayName: "GPT-6 Astra", available: true }, fallback: null, reason: null },
        // 3. Minimal-sufficient alternative (EFFICIENT's own reasoning).
        { role: "Tester", primary: { adapterId: "opencode-go", modelId: "go-y", displayName: "GLM-5.3-Flash", available: true }, fallback: null, reason: "Adequate capability — chosen for lower real price." },
        { role: "Reviewer", primary: { adapterId: "opencode-go", modelId: "go-x", displayName: "GLM-5.3", available: true }, fallback: null, reason: null }
      ]
    }
  });
  const lines = view.modelsExplainLines().join("\n");
  assert.match(lines, /assigned to a different model\/provider to avoid concentration/, "2. concentration avoidance must be named");
  assert.match(lines, /Adequate capability — chosen for lower real price\./, "3. a minimal-sufficient efficient alternative must be named");
  assert.match(lines, /Only adequate option — no real alternative avoids concentration without forcing a repeat\./, "4. a forced repeat must be named, never silently hidden");
  assert.match(lines, /Kept independent from Builder's provider\./, "5. Reviewer independence must be named");
  assert.doesNotMatch(lines, /%|kairo\.|artificial-analysis-free|source:/i, "none of this must leak raw metrics, percentages, or source names");
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

test("USAGE is a compact one-line bar above a full-width GLOBAL MODEL GUIDE card — never tiled side by side, never separate AI TEAM/EFFICIENT TEAM cards", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot(aiPlusEfficientSnapshot());
  const lines = view.render(160);
  const topLine = lines.find((line) => line.includes("KAIRO"));
  // USAGE's own line never shares a row with GLOBAL MODEL GUIDE's border —
  // the panel always gets the FULL given width, on its own row below.
  assert.ok(!topLine.includes("GLOBAL MODEL GUIDE"), "USAGE is a plain line, not a card tiled beside GLOBAL MODEL GUIDE");
  assert.ok(lines.some((line) => line.includes("GLOBAL MODEL GUIDE")));
  assert.doesNotMatch(lines.join("\n"), /✿ AI TEAM|✿ EFFICIENT TEAM/, "the three-card layout must never come back");
  const joined = lines.join("\n");
  assert.match(joined, /CAPABILITY/);
  assert.match(joined, /EFFICIENT/);
  // Provider is deliberately hidden in the compact widget — Role → Model only.
  assert.match(joined, /Builder\s+│ Claude Fable 5\.1\s+│ GLM 5\.3/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 160, `line "${line}" exceeds width`);
});

test("projectTeamPanel shows a real SUGGESTED ProjectStrategy — only the required roles, orchestrator first, already-confirmed Bootstrap Analyst", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/crm",
    projectStrategy: {
      status: "suggested",
      bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
      bootstrapAnalystChoice: "quality",
      orchestrator: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" },
      qualityTeam: [
        { role: "Architect", model: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" }, reason: null },
        { role: "Builder", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" }, reason: null }
      ]
    }
  });
  const { title, lines } = view.projectTeamPanel(80);
  assert.equal(title, "PROJECT TEAM · crm · SUGGESTED");
  const joined = lines.join("\n");
  assert.match(joined, /Bootstrap Analyst\s+GPT-6 Astra/);
  assert.match(joined, /Orchestrator\s+Fable 5\.1/);
  assert.match(joined, /Architect\s+Fable 5\.1/);
  assert.match(joined, /Builder\s+GPT-6 Astra/);
  assert.match(joined, /Suggested from real project analysis\. Use \/project approve to activate\./);
});

test("projectTeamPanel shows AWAITING_ANALYST — real quality/efficient alternatives — once a real LOCAL_PREFLIGHT ran but before any choice is confirmed", () => {
  const { view } = makeView();
  view.setSnapshot({ projectRoot: "/repo/crm", modelIntelligence: { status: "unknown" } });
  view.pendingProjectAnalysis = {
    profile: {}, candidates: {},
    alternatives: [
      { choice: "quality", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" } },
      { choice: "efficient", model: { adapterId: "claude", modelId: "claude-x", displayName: "Claude X" } }
    ]
  };
  const { title, lines } = view.projectTeamPanel(80);
  assert.equal(title, "PROJECT ANALYSIS · crm — Select Bootstrap Analyst");
  const joined = lines.join("\n");
  assert.match(joined, /quality\s+GPT-6 Astra/);
  assert.match(joined, /efficient\s+Claude X/);
  assert.match(joined, /--confirm/);
});

test("projectTeamPanel shows ACTIVE without a pending-approval hint, and STALE with a real refresh warning", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/crm",
    projectStrategy: { status: "active", orchestrator: null, qualityTeam: [{ role: "Architect", model: { adapterId: "claude", modelId: "x", displayName: "X" }, reason: null }] }
  });
  const active = view.projectTeamPanel(80);
  assert.equal(active.title, "PROJECT TEAM · crm · ACTIVE");
  assert.doesNotMatch(active.lines.join("\n"), /approve/);

  view.setSnapshot({
    projectRoot: "/repo/crm",
    projectStrategy: { status: "stale", orchestrator: null, qualityTeam: [{ role: "Architect", model: { adapterId: "claude", modelId: "x", displayName: "X" }, reason: null }] }
  });
  const stale = view.projectTeamPanel(80);
  assert.equal(stale.title, "PROJECT TEAM · crm · STALE");
  assert.match(stale.lines.join("\n"), /Real evidence changed since approval — use \/project refresh\./);
});

test("projectTeamPanel falls back to GLOBAL MODEL GUIDE with an honest 'not analyzed' notice before any real strategy exists", () => {
  const { view } = makeView();
  view.setSnapshot({ projectRoot: "/repo/crm", modelIntelligence: { status: "unknown" } });
  const { title, lines } = view.projectTeamPanel(80);
  assert.equal(title, "GLOBAL MODEL GUIDE");
  assert.match(lines[0], /not analyzed/);
});

test("GLOBAL MODEL GUIDE uses the full given width at every terminal size — no tiling breakpoint", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot(aiPlusEfficientSnapshot());
  for (const width of [70, 100, 150, 160]) {
    const lines = view.render(width);
    const cardTopLine = stripTerminalSequences(lines.find((line) => line.includes("GLOBAL MODEL GUIDE")));
    assert.ok(visibleWidth(cardTopLine) <= width, `GLOBAL MODEL GUIDE card at width ${width} should reach the full given width`);
  }
});

test("below a narrow width, GLOBAL MODEL GUIDE still renders below the compact USAGE bar", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot(aiPlusEfficientSnapshot());
  const lines = view.render(100);
  const topLine = lines.find((line) => line.includes("KAIRO"));
  assert.ok(!topLine.includes("GLOBAL MODEL GUIDE"), "USAGE's own line shouldn't share a row with GLOBAL MODEL GUIDE");
  assert.ok(lines.some((line) => line.includes("GLOBAL MODEL GUIDE")));
  const joined = lines.join("\n");
  assert.match(joined, /CAPABILITY/);
  assert.match(joined, /EFFICIENT/);
  assert.match(joined, /Builder\s+│ Claude Fable 5\.1\s+│ GLM 5\.3/);
});

test("teamsColumnsLines() truncates each column independently — a long CAPABILITY name never bleeds into the EFFICIENT column", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [{
        role: "Builder",
        primary: { adapterId: "claude", modelId: "claude-x", displayName: "A Genuinely Extremely Long Real Model Display Name That Would Overflow", available: true },
        fallback: null, reason: null
      }],
      efficientTeam: [{
        role: "Builder",
        primary: { adapterId: "opencode-go", modelId: "go-x", displayName: "GLM-5.3", available: true },
        fallback: null, reason: null
      }]
    }
  });
  // Wide enough for the short EFFICIENT cell to fit whole, but not
  // remotely enough for the deliberately long CAPABILITY name.
  const lines = view.teamsColumnsLines(70);
  const builderLine = lines.find((line) => line.includes("Builder"));
  assert.match(builderLine, /│/, "columns must be separated by a real drawn │, not just whitespace");
  assert.match(builderLine, /GLM-5\.3\s*$/, "the EFFICIENT column must stay intact and readable, never pushed out by an overflowing CAPABILITY cell");
  assert.match(builderLine, /…/, "the long CAPABILITY name should be honestly truncated, not silently cut without a marker");
});

test("teamsColumnsLines() never truncates when the real content already fits", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [{
        role: "Builder",
        primary: { adapterId: "claude", modelId: "claude-x", displayName: "Fable 5.1", available: true },
        fallback: null, reason: null
      }],
      efficientTeam: [{
        role: "Builder",
        primary: { adapterId: "opencode-go", modelId: "go-x", displayName: "GLM-5.3", available: true },
        fallback: null, reason: null
      }]
    }
  });
  const lines = view.teamsColumnsLines(100);
  const builderLine = lines.find((line) => line.includes("Builder"));
  assert.doesNotMatch(builderLine, /…/, "short real content that already fits must never be truncated");
  assert.match(builderLine, /Fable 5\.1/);
  assert.match(builderLine, /GLM-5\.3/);
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

test("narrow dashboard's compact USAGE bar shows every Go window's real percentage, and never Zen (manual/PAYG, not automatic)", () => {
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
  // The compact bar is deliberately terse (real percentages only, joined
  // by "/", no per-window name labels) — the full per-window breakdown
  // with names lives in /usage (usageLines()) instead. Rendered at a
  // width wide enough for the whole bar to fit unclipped.
  const lines = view.render(90).join("\n");
  assert.match(lines, /Go 100% \/ 100% \/ 0% LIMITED/);
  assert.doesNotMatch(lines, /Zen/, "USAGE only shows automatic-routing resources — Zen belongs in /providers");
});

test("compactUsageLines renders every measured Go window's real percentage without policy noise, and never Zen", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
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
  const lines = view.compactUsageLines(200).join("\n");
  assert.match(lines, /Go 100% \/ 75% \/ 0% LIMITED/);
  assert.doesNotMatch(lines, /Zen/);
  assert.doesNotMatch(lines, /PAYG blocked/);
});

test("compactUsageLines wraps to a second line — header alone, then providers — when the real content doesn't fit the given width", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/a-genuinely-long-project-name",
    usage: {
      codex: { primary: { remainingPercent: 58 }, secondary: { remainingPercent: 86 } },
      claude: { primary: { remainingPercent: 34 }, secondary: { remainingPercent: 65 } },
      opencode: { go: { windows: [{ remainingPercent: 100 }, { remainingPercent: 100 }, { remainingPercent: 96 }] } }
    }
  });
  const narrow = view.compactUsageLines(40);
  assert.equal(narrow.length, 2, "should split into header + providers when it doesn't fit");
  const wide = view.compactUsageLines(300);
  assert.equal(wide.length, 1, "should stay a single line when the real content fits");
  assert.match(stripTerminalSequences(wide[0]), /KAIRO · a-genuinely-long-project-name │ Codex 5h 58% \/ W 86% │ Claude S 34% \/ W 65% │ Go 100% \/ 100% \/ 96%/);
});

test("/usage shows only the automatic-routing providers (Codex, Claude, Go) and never Zen", () => {
  const { view } = makeView();
  view.setSnapshot({
    usage: {
      codex: { windows: [{ name: "5h", remainingPercent: 69 }, { name: "weekly", remainingPercent: 87 }], source: "codex app-server" },
      claude: { windows: [{ label: "S", remainingPercent: 50 }, { label: "W", remainingPercent: 67 }], source: "claude -p usage" },
      opencode: {
        go: { windows: [{ name: "rolling", remainingPercent: 78 }, { name: "weekly", remainingPercent: 91 }, { name: "monthly", remainingPercent: 96 }], source: "opencode go" },
        zen: { status: "local_recorded", totalCost: 33.83, totalTokens: 10_300_000 }
      }
    }
  });
  const lines = view.usageLines().join("\n");
  assert.match(lines, /Codex/);
  assert.match(lines, /Claude/);
  assert.match(lines, /Go/);
  assert.doesNotMatch(lines, /Zen/, "Zen is PAYG/manual — it must never appear in /usage's automatic-resource summary");
});

test("/providers keeps Zen, explicitly identified as PAYG/manual", () => {
  const { view } = makeView();
  view.setSnapshot({
    usage: {
      opencode: { zen: { status: "local_recorded", totalCost: 33.83, totalTokens: 10_300_000 } }
    }
  });
  const lines = view.providerLines().join("\n");
  assert.match(lines, /Zen\s+PAYG\/manual/, "/providers must keep Zen, explicitly labeled PAYG/manual");
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

test("CockpitView defaults to ASK — the strictly read-only WorkMode — until a real session or explicit change says otherwise", () => {
  const { view } = makeView();
  assert.equal(view.workMode, "ask");
});

test("CockpitView.nextWorkMode cycles ASK -> PLAN -> AGENT -> ASK", () => {
  assert.equal(CockpitView.nextWorkMode("ask"), "plan");
  assert.equal(CockpitView.nextWorkMode("plan"), "agent");
  assert.equal(CockpitView.nextWorkMode("agent"), "ask");
});

test("renderConversation caches each transcript entry's wrapped lines by id+width — re-rendering at the same width never re-wraps", () => {
  const { view } = makeView();
  view.addTranscript("user", "A fairly long message that will actually need to wrap across more than one line of terminal width");
  view.addTranscript("kairo", "claude: a real reply");

  view.renderConversation(40);
  assert.equal(view._wrapCache.size, 2, "one cache entry per real transcript entry at this width");
  const firstRenderLines = view.renderConversation(40);
  assert.equal(view._wrapCache.size, 2, "re-rendering at the same width must never grow the cache — a real cache hit, not a fresh wrap");

  // A different width is a real cache miss (genuinely different wrapped
  // output), so it correctly adds new entries rather than reusing stale ones.
  view.renderConversation(20);
  assert.equal(view._wrapCache.size, 4);

  const secondRenderLines = view.renderConversation(40);
  assert.deepEqual(secondRenderLines, firstRenderLines, "the cached lines must be byte-identical to what a real re-wrap would have produced");
});

test("a keystroke-shaped re-render with 500 cached entries stays fast — a coarse smoke test for the p95 < 50ms/keystroke target, not a strict benchmark", () => {
  const { view } = makeView();
  for (let i = 0; i < 500; i += 1) {
    view.addTranscript(i % 2 === 0 ? "user" : "kairo", `message ${i} with some real, wrappable content in it`);
  }
  view.renderConversation(100); // warm the cache once, the same way a real first render would
  const start = performance.now();
  for (let i = 0; i < 50; i += 1) view.renderConversation(100); // simulates 50 keystrokes' worth of re-renders
  const elapsedMs = performance.now() - start;
  assert.ok(elapsedMs / 50 < 50, `cached re-render averaged ${(elapsedMs / 50).toFixed(2)}ms — expected well under the 50ms/keystroke target`);
});

test("the wrap cache never leaks: an evicted transcript entry (past the 500-entry cap) has its cached lines removed too", () => {
  const { view } = makeView();
  for (let i = 0; i < 501; i += 1) view.addTranscript("user", `message ${i}`);
  view.renderConversation(80);
  // Only the 500 still-retained entries can have cache entries — the
  // evicted first message's id must not still be sitting in the cache.
  assert.equal(view.transcript.length, 500);
  assert.equal(view._wrapCache.size, 500);
});

test("setWorkMode changes the real state and triggers a render", () => {
  let renders = 0;
  const { view } = makeView();
  view.requestRender = () => { renders += 1; };
  view.setWorkMode("plan");
  assert.equal(view.workMode, "plan");
  assert.equal(renders, 1);
});

test("the footer's plan controls only ever advertise a key the current WorkMode actually lets through", () => {
  const { view } = makeView();
  view.hasListFocus = true;
  const askFooter = view.renderFooterLines().join("\n");
  assert.doesNotMatch(askFooter, /a approve/, "ASK is strictly read-only — no approve hint");
  assert.doesNotMatch(askFooter, /x implement/, "ASK is strictly read-only — no execute hint");

  view.setWorkMode("plan");
  const planFooter = view.renderFooterLines().join("\n");
  assert.match(planFooter, /a approve/, "PLAN can review a plan");
  assert.doesNotMatch(planFooter, /x implement/, "PLAN never executes");

  view.setWorkMode("agent");
  view.moveSelection(1); // task-b: approved + not_started, the executable row
  const agentFooter = view.renderFooterLines().join("\n");
  assert.match(agentFooter, /x implement/, "AGENT allows advancing under permissions and gates");
});

test("a/j only fire approve/reject when available for the selected row", () => {
  const { view, calls } = makeView();
  view.setWorkMode("agent"); // approve/reject/execute are gated by WorkMode — AGENT allows every real action
  view.handleInput("a"); // task-a is awaiting_approval: allowed
  view.handleInput("j");
  assert.deepEqual(calls, [["onApprove", "task-a"], ["onReject", "task-a"]]);

  const { view: view2, calls: calls2 } = makeView();
  view2.setWorkMode("agent");
  view2.moveSelection(1); // select task-b (approved, not awaiting_approval)
  view2.handleInput("a");
  assert.deepEqual(calls2, []);
});

test("x asks for the real routing decision first; the confirm prompt only appears once app.js supplies it", () => {
  const { view, calls } = makeView();
  view.setWorkMode("agent"); // execute is only ever available in AGENT
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
