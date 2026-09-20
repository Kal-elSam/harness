import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { CockpitView, explainTeamDecision, resolveAssignmentAvailability } from "../src/global/cockpit/view.js";

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
          role: "Builder",
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
  assert.match(lines, /Builder\s+│ GPT-5\.6-Luna/);
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
        role: "Debugger",
        primary: { adapterId: "opencode-go", modelId: "go-hy3", displayName: "Hy3", available: false },
        fallback: null, reason: "No eligible provider currently covers this role."
      }]
    }
  });
  const lines = view.fitLines().join("\n");
  assert.match(lines, /Debugger[\s\S]*?no eligible option right now/);
});

test("QUALITY TEAM: fitLines() and teamsColumnsLines() read the real, portfolio-coordinated aiTeam/efficientTeam — never globalGuide, which is /models-only evidence", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      // aiTeam hands Architect to Muse Spark — a real, coordinated
      // diversity pick (Astra was already used elsewhere in the
      // portfolio). The dashboard's QUALITY TEAM/EFFICIENT TEAM widget
      // must show that real team, not the uncoordinated individual
      // leader (globalGuide, Astra) — that belongs in /models only.
      aiTeam: [{
        role: "Architect",
        primary: { adapterId: "opencode-go", modelId: "muse-spark", displayName: "Muse Spark", available: true },
        fallback: null, reason: "Near-equivalent alternatives — assigned to a different model/provider to avoid concentration."
      }],
      efficientTeam: [{
        role: "Architect",
        primary: { adapterId: "opencode-go", modelId: "gpt-5-6-luna", displayName: "GPT-5.6 Luna", available: true },
        fallback: null, reason: null
      }],
      globalGuide: {
        capability: [{
          role: "Architect",
          primary: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", available: true },
          fallback: null, reason: null
        }],
        efficient: []
      }
    }
  });
  const fit = view.fitLines().join("\n");
  assert.match(fit, /Muse Spark/);
  assert.doesNotMatch(fit, /GPT-6 Astra/, "the dashboard headline must never show the uncoordinated individual leader");

  const columns = view.teamsColumnsLines(80).join("\n");
  assert.match(columns, /QUALITY TEAM/);
  assert.match(columns, /EFFICIENT TEAM/);
  assert.match(columns, /Muse Spark/);
  assert.match(columns, /GPT-5\.6 Luna/);
  assert.doesNotMatch(columns, /GPT-6 Astra/);
});

test("modelsExplainLines() shows the uncoordinated individual leader (globalGuide) only when it actually differs from the QUALITY TEAM pick", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [
        {
          role: "Architect",
          primary: { adapterId: "opencode-go", modelId: "muse-spark", displayName: "Muse Spark", available: true },
          fallback: null, reason: "Near-equivalent alternatives — assigned to a different model/provider to avoid concentration."
        },
        {
          role: "Builder",
          primary: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", available: true },
          fallback: null, reason: null
        }
      ],
      efficientTeam: [],
      globalGuide: {
        capability: [
          { role: "Architect", primary: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", available: true }, fallback: null, reason: null },
          { role: "Builder", primary: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", available: true }, fallback: null, reason: null }
        ],
        efficient: []
      }
    }
  });
  const lines = view.modelsExplainLines().join("\n");
  assert.match(lines, /Architect[\s\S]*?Individual leader: GPT-6 Astra/, "Architect's diversity pick differs from the real leader — must show it");
  const builderSection = lines.split("·").find((section) => section.includes("Builder"));
  assert.doesNotMatch(builderSection, /Individual leader/, "Builder's QUALITY TEAM pick already IS the real leader — no redundant line");
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

test("/models --evidence renders decisionEvidence's real per-capability coverage, EFFICIENT's retention/floor, and Pareto/tiebreak savings — never recalculating any of it", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [
        {
          role: "Architect",
          primary: { adapterId: "claude", modelId: "claude-sonnet-5", displayName: "Claude Sonnet 5", available: true },
          fallback: null, reason: null,
          decisionEvidence: {
            coverage: { reasoning: { have: 2, active: 3, comparable: true }, coding: { have: 1, active: 2, comparable: true } },
            confidence: "medium", isProvisional: false, decisionType: "leader", retention: null, requiredFloor: null, riskLevel: null, savings: null
          }
        }
      ],
      efficientTeam: [
        {
          role: "Architect",
          primary: { adapterId: "codex", modelId: "gpt-5-6-terra", displayName: "GPT-5.6 Terra", available: true },
          fallback: null, reason: "Retains ~93% of QUALITY's real capability — chosen for lower real full input+output price.",
          decisionEvidence: {
            coverage: { reasoning: { have: 2, active: 3, comparable: true }, coding: { have: 0, active: 2, comparable: false } },
            confidence: "medium", isProvisional: false, decisionType: "pareto", retention: 0.93, requiredFloor: 0.9, riskLevel: "high",
            savings: { dimension: "totalPricePerMTok", label: "lower real full input+output price", from: 60, to: 12 }
          }
        }
      ]
    }
  });
  const lines = view.aiTeamDetailLines().join("\n");
  assert.match(lines, /reasoning 2\/3 · coding 1\/2 · comparable · confidence medium/);
  assert.match(lines, /reasoning 2\/3 · coding 0\/2 \(composite fallback\) · provisional · confidence medium/);
  assert.match(lines, /retention 93% · required 90% · high-risk role/);
  assert.match(lines, /Pareto balance · lower real full input\+output price 60 → 12/);
});

test("/models --evidence reports a real retention ratio above 100% as 'exceeds QUALITY reference', never a nonsensical 'retention 117%'", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      aiTeam: [
        { role: "Architect", primary: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", available: true }, fallback: null, reason: null }
      ],
      efficientTeam: [
        {
          role: "Architect",
          primary: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1", available: true },
          fallback: null, reason: "Only adequate option — no real alternative clears the capability floor.",
          decisionEvidence: {
            coverage: { reasoning: { have: 3, active: 3, comparable: true }, coding: { have: 1, active: 2, comparable: true } },
            confidence: "medium", isProvisional: false, decisionType: "fallback", retention: 1.1748813435560423, requiredFloor: 0.9, riskLevel: "high", savings: null
          }
        }
      ]
    }
  });
  const lines = view.aiTeamDetailLines().join("\n");
  assert.match(lines, /exceeds QUALITY reference by 17% · required 90% · high-risk role/);
  assert.doesNotMatch(lines, /retention 117%/);
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
  assert.match(joined, /QUALITY TEAM/);
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
  assert.match(joined, /Project Analyst\s+GPT-6 Astra/);
  assert.match(joined, /Orchestrator\s+Fable 5\.1/);
  assert.doesNotMatch(joined, /Architect's quality pick/);
  assert.match(joined, /Architect\s+Fable 5\.1/);
  assert.match(joined, /Builder\s+GPT-6 Astra/);
  assert.match(joined, /Suggested from real project analysis\. Use \/project approve to activate\./);
});

test("REGRESSION: projectTeamPanel aligns every row's ' · Provider' to the same column, regardless of how much each model name's own length varies", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/crm",
    projectStrategy: {
      status: "suggested",
      bootstrapAnalyst: { adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5" },
      orchestrator: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1" },
      projectTeam: [
        { role: "Builder", model: { adapterId: "cursor", modelId: "muse-spark", displayName: "Muse Spark 1.3 1M Extra High" }, reason: null },
        { role: "Tester", model: { adapterId: "codex", modelId: "gpt-terra", displayName: "GPT-5.6-Terra" }, reason: null }
      ]
    }
  });
  const lines = view.projectTeamPanel(120).lines;
  const dotColumns = new Set(lines
    .filter((line) => line.includes("·"))
    .map((line) => stripTerminalSequences(line).indexOf("·")));
  assert.equal(dotColumns.size, 1, `every row must place its provider separator at the same column; got positions ${[...dotColumns].join(", ")} in:\n${lines.join("\n")}`);
});

test("REGRESSION: projectTeamPanel shows the real OPERATIONAL projectTeam, never qualityTeam, when the two genuinely diverge (e.g. after a manual override)", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/crm",
    projectStrategy: {
      status: "suggested",
      bootstrapAnalyst: null,
      orchestrator: null,
      // A real override diverged projectTeam from qualityTeam — the exact
      // reported bug: the dashboard's own "PROJECT TEAM" title must
      // reflect the same real operational assignment the /project
      // overlay itself shows under that identical title, never the
      // comparative-reference qualityTeam.
      qualityTeam: [{ role: "Architect", model: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" }, reason: null }],
      projectTeam: [{
        role: "Architect", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
        assignmentSource: "override", decisionEvidence: null, fallback: null, reason: null,
        recommendedAssignment: { model: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" }, fallback: null, decisionEvidence: null, reason: null },
        overrideEvidence: null
      }]
    }
  });
  const { lines } = view.projectTeamPanel(80);
  const joined = lines.join("\n");
  assert.match(joined, /Architect\s+GPT-6 Astra/, "must show the real operational (overridden) model");
  assert.doesNotMatch(joined, /Quality leader:/, "comparative evidence belongs in the overlay's explicit evidence view");
  const roleAssignmentLine = lines.find((line) => /Architect\s+GPT-6 Astra/.test(stripTerminalSequences(line)));
  assert.ok(roleAssignmentLine);
  assert.doesNotMatch(stripTerminalSequences(roleAssignmentLine), /Fable 5\.1/, "the role row itself must still be the operational pick, never qualityTeam's model");
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
  assert.match(joined, /QUALITY TEAM/);
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
        cursor: { ok: false, reason: "Cursor agent CLI \"cursor-agent\" is not on PATH. Install Cursor CLI." }
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

test("compactUsageLines flags a provider window as LOW once it drops below the shared early-warning threshold, but never at/above it", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    usage: {
      codex: { primary: { remainingPercent: 99 }, secondary: { remainingPercent: 10 } },
      claude: { primary: { remainingPercent: 100 }, secondary: { remainingPercent: 31 } },
      opencode: { go: { windows: [{ remainingPercent: 100, status: "ok" }, { remainingPercent: 0, status: "rate-limited" }] } }
    }
  });
  const lines = stripTerminalSequences(view.compactUsageLines(200).join("\n"));
  assert.match(lines, /Codex 5h 99% \/ W 10% LOW/, "10% left is below the warning threshold — must be flagged before it's ever excluded");
  assert.match(lines, /Claude S 100% \/ W 31%(?! LOW)/, "31% left is above the warning threshold — must never be flagged");
  assert.match(lines, /Go 100% \/ 0% LIMITED/, "an already rate-limited window keeps its own LIMITED tag, never a redundant LOW alongside it");
});

test("/usage flags a low window the same way the compact bar does, without duplicating an already rate-limited tag", () => {
  const { view } = makeView();
  view.setSnapshot({
    usage: {
      codex: { windows: [{ name: "5h", remainingPercent: 99 }, { name: "weekly", remainingPercent: 10 }], source: "codex app-server" },
      claude: { windows: [{ label: "S", remainingPercent: 100 }, { label: "W", remainingPercent: 31 }], source: "claude -p usage" },
      opencode: { go: { windows: [{ name: "rolling", remainingPercent: 100, status: "ok" }, { name: "weekly", remainingPercent: 0, status: "rate-limited" }], source: "opencode go" } }
    }
  });
  const lines = view.usageLines().join("\n");
  assert.match(lines, /weekly 10% left LOW/);
  assert.doesNotMatch(lines, /100% left LOW/, "31%\/100% must never be flagged — only genuinely low windows are");
  assert.match(lines, /week 0%.*RATE LIMITED/);
  assert.doesNotMatch(lines, /RATE LIMITED LOW/, "an already rate-limited window never gets a redundant LOW tag too");
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

test("x with a real active project team opens the role picker; picking a role asks for the real routing decision, and the confirm prompt only appears once app.js supplies it", () => {
  const { view, calls } = makeView();
  view.setWorkMode("agent"); // execute is only ever available in AGENT
  view.setSnapshot({ projectRoot: "/repo/demo", projectStrategy: { status: "active", projectTeam: [{ role: "Builder" }] } });
  view.moveSelection(1); // task-b is approved + not_started: executable
  view.handleInput("x");
  assert.equal(view.mode, "select-role");
  view.handleInput("\r");
  assert.equal(view.mode, "list"); // still list — awaiting the async decision from app.js
  assert.deepEqual(calls, [["onRequestExecute", "task-b", "Builder"]]);

  const decision = { decision: "ROUTED", role: "Builder", provider: "codex", model: "gpt-6-astra", why: "reasoning task", confirmationTarget: { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" } };
  view.showExecuteConfirm("task-b", decision);
  assert.equal(view.mode, "confirm-execute");
  const lines = view.render(120).join("\n");
  assert.match(lines, /codex · gpt-6-astra/);
  assert.match(lines, /reasoning task/);

  view.handleInput("n");
  assert.equal(view.mode, "list");
  assert.deepEqual(calls, [["onRequestExecute", "task-b", "Builder"]]);
});

test("y confirms and forwards the exact decision shown, so the preview and the real launch never disagree", () => {
  const { view, calls } = makeView();
  view.moveSelection(1);
  const decision = { decision: "ROUTED", role: "Builder", provider: "claude", model: null, why: "default implementation provider", confirmationTarget: { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "claude::claude-fable" } };
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

test("x opens the role picker instead of requesting execution directly when the project has an active, real team", () => {
  const { view, calls } = makeView();
  view.setWorkMode("agent");
  view.setSnapshot({
    projectRoot: "/repo/demo",
    projectStrategy: {
      status: "active",
      projectTeam: [{ role: "Builder" }, { role: "Debugger" }]
    }
  });
  view.moveSelection(1); // task-b: approved + not_started, executable
  view.handleInput("x");
  assert.equal(view.mode, "select-role");
  assert.deepEqual(calls, [], "no onRequestExecute yet — the user hasn't picked a role");
  const lines = view.render(120).join("\n");
  assert.match(lines, /Which role is this task for\?/);
  assert.match(lines, /Builder/);
  assert.match(lines, /Debugger/);
});

test("role picker: down moves the selection, Enter confirms the selected role and requests execution for it", () => {
  const { view, calls } = makeView();
  view.setWorkMode("agent");
  view.setSnapshot({
    projectRoot: "/repo/demo",
    projectStrategy: { status: "active", projectTeam: [{ role: "Builder" }, { role: "Debugger" }] }
  });
  view.moveSelection(1);
  view.handleInput("x");
  view.handleInput("\x1b[B"); // down
  view.handleInput("\r"); // enter
  assert.equal(view.mode, "list");
  assert.deepEqual(calls, [["onRequestExecute", "task-b", "Debugger"]]);
});

test("role picker: n/esc cancels without ever requesting execution", () => {
  const { view, calls } = makeView();
  view.setWorkMode("agent");
  view.setSnapshot({
    projectRoot: "/repo/demo",
    projectStrategy: { status: "active", projectTeam: [{ role: "Builder" }] }
  });
  view.moveSelection(1);
  view.handleInput("x");
  view.handleInput("n");
  assert.equal(view.mode, "list");
  assert.deepEqual(calls, []);
});

test("x with no active project team blocks execution outright — PROJECT TEAM is the sole authority, there is no legacy fallback to request", () => {
  const { view, calls } = makeView();
  view.setWorkMode("agent");
  view.setSnapshot({ projectRoot: "/repo/demo", projectStrategy: { status: "suggested", projectTeam: [{ role: "Builder" }] } });
  view.moveSelection(1);
  view.handleInput("x");
  assert.equal(view.mode, "list"); // no picker, no confirm-execute — nothing to execute yet
  assert.deepEqual(calls, [], "onRequestExecute must never be called without a real role");
  assert.match(view.statusMessage, /No active project team/);
});

test("a real ProjectExecutionPreview's MANUAL_HANDOFF decision shows the manual continuation, never lets 'y' launch anything", () => {
  const { view, calls } = makeView();
  view.moveSelection(1);
  const decision = {
    decision: "MANUAL_HANDOFF", role: "Builder", provider: "cursor",
    modelRef: { displayName: "Cursor Model" }, model: "cursor-model",
    why: "cursor isn't executable by Kairo automatically — continue manually with Cursor Model.",
    confirmationTarget: null
  };
  view.showExecuteConfirm("task-b", decision);
  const lines = view.render(120).join("\n");
  assert.match(lines, /Builder is manual-only/);
  assert.match(lines, /Continue in cursor with Cursor Model/);

  view.handleInput("y");
  assert.equal(view.mode, "confirm-execute"); // never confirmable — no confirmationTarget
  assert.deepEqual(calls, []);
});

test("a real ProjectExecutionPreview's WAIT_FOR_PROJECT_TEAM with a suggested alternative can be explicitly confirmed", () => {
  const { view, calls } = makeView();
  view.moveSelection(1);
  const confirmationTarget = { role: "Builder", selection: "suggested-alternative", strategyFingerprint: "fp-1", candidateKey: "claude::claude-opus-5" };
  const decision = {
    decision: "WAIT_FOR_PROJECT_TEAM", role: "Builder", provider: null, model: null,
    blockedAssignment: { provider: "codex", model: { modelId: "gpt-6-astra" } },
    suggestedAlternative: { provider: "claude", model: { modelId: "claude-opus-5", displayName: "Claude Opus 5" } },
    why: "codex is not currently eligible — confirm the suggested alternative for Builder before proceeding.",
    confirmationTarget
  };
  view.showExecuteConfirm("task-b", decision);
  const lines = view.render(120).join("\n");
  assert.match(lines, /Assigned model unavailable for Builder/);
  assert.match(lines, /Suggested alternative: claude · Claude Opus 5/);

  view.handleInput("y");
  assert.equal(view.mode, "list");
  assert.deepEqual(calls, [["onExecute", "task-b", decision]]);
});

test("a real ProjectExecutionPreview's WAIT_FOR_PROJECT_TEAM with no eligible alternative blocks 'y' — no silent substitution", () => {
  const { view, calls } = makeView();
  view.moveSelection(1);
  const decision = {
    decision: "WAIT_FOR_PROJECT_TEAM", role: "Builder", provider: null, model: null,
    blockedAssignment: { provider: "codex", model: { modelId: "gpt-6-astra" } },
    suggestedAlternative: null,
    why: "codex is not currently eligible — no automatic alternative is available for Builder right now.",
    confirmationTarget: null
  };
  view.showExecuteConfirm("task-b", decision);
  const lines = view.render(120).join("\n");
  assert.match(lines, /Cannot auto-execute/);
  assert.match(lines, /no automatic alternative/);

  view.handleInput("y");
  assert.equal(view.mode, "confirm-execute");
  assert.deepEqual(calls, []);
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

test("beginAction starts a real live spinner+elapsed-time indicator; tickSpinner advances it; endAction clears it", () => {
  const { view } = makeView();
  assert.equal(view.actionStatusLine(), null, "nothing is running yet");

  view.beginAction("Analyzing project");
  assert.equal(view.actionLabel, "Analyzing project");
  assert.ok(view.actionStartedAt, "a real start timestamp must be recorded");
  const first = view.actionStatusLine();
  assert.match(first, /Analyzing project… \(0s\)/);
  assert.match(first, new RegExp(CockpitView.SPINNER_FRAMES[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  view.tickSpinner();
  const second = view.actionStatusLine();
  assert.notEqual(first, second, "the spinner frame must actually advance");
  assert.match(second, new RegExp(CockpitView.SPINNER_FRAMES[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  view.endAction();
  assert.equal(view.actionLabel, null);
  assert.equal(view.actionStartedAt, null);
  assert.equal(view.actionStatusLine(), null);
});

test("tickSpinner is a real no-op when no action is running — app.js's fast timer can call it unconditionally", () => {
  const { view } = makeView();
  const before = view.spinnerFrame;
  view.tickSpinner();
  assert.equal(view.spinnerFrame, before);
  assert.equal(view.actionStatusLine(), null);
});

test("the live action indicator wins over a leftover static statusMessage in both render paths, and the welcome screen never shows while an action is running", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setStatus("stale leftover message");
  view.beginAction("Approving");

  const conversationLines = view.renderConversation(80).join("\n");
  assert.match(conversationLines, /Approving…/);
  assert.doesNotMatch(conversationLines, /stale leftover message/);
  assert.doesNotMatch(conversationLines, /Ask Kairo about this project/, "the empty-state welcome must not show while a real action is in flight");

  const chatLines = view.chatLines().join("\n");
  assert.match(chatLines, /Approving…/);
  assert.doesNotMatch(chatLines, /stale leftover message/);
});

// --- Increment 4: selection explanations + quality leader visibility ---

test("INC4: explainTeamDecision for reason:null + decisionType:leader yields a non-empty role-specific description", () => {
  const text = explainTeamDecision({
    role: "Builder",
    reason: null,
    assignmentSource: "recommended",
    decisionEvidence: { decisionType: "leader", requiredFloor: 0.8, riskLevel: "medium", retention: 1 }
  });
  assert.ok(text && text.trim().length > 0, "leader with null reason must never render an empty description");
  assert.match(text, /Ranked first for coding capability/);
  assert.match(text, /80% capability floor/);
  assert.match(text, /medium-risk role/);
  assert.doesNotMatch(text, /no cheaper alternative existed/i);
});

test("INC4: explainTeamDecision degrades when requiredFloor/riskLevel are null", () => {
  const text = explainTeamDecision({
    role: "Architect",
    reason: null,
    decisionEvidence: { decisionType: "leader", requiredFloor: null, riskLevel: null }
  });
  assert.match(text, /Ranked first for general reasoning capability among eligible candidates/);
  assert.doesNotMatch(text, /capability floor/);
});

test("INC4: explainTeamDecision prefers existing reason and keeps override text", () => {
  assert.equal(
    explainTeamDecision({ role: "Builder", reason: "Chosen for lower real price.", decisionEvidence: { decisionType: "pareto" } }),
    "Chosen for lower real price."
  );
  assert.equal(
    explainTeamDecision({ role: "Builder", reason: null, assignmentSource: "override", decisionEvidence: null }),
    "Manual override — not the automatic ranking's own pick."
  );
});

test("INC5: compact PROJECT TEAM panel keeps only primary assignments and concise strategy status", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/crm",
    modelIntelligence: { status: "live", eligibility: { claude: { ok: true }, codex: { ok: true } }, claudeEntitlement: {} },
    projectStrategy: {
      status: "suggested",
      bootstrapAnalyst: null,
      orchestrator: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" },
      qualityTeam: [{ role: "Builder", model: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" }, reason: null }],
      projectTeam: [{
        role: "Builder",
        model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" },
        fallback: null,
        reason: null,
        assignmentSource: "recommended",
        decisionEvidence: { decisionType: "pareto", retention: 0.93, requiredFloor: 0.8, riskLevel: "medium", savings: null }
      }]
    }
  });
  const { lines } = view.projectTeamPanel(80);
  const joined = lines.join("\n");
  assert.match(joined, /Builder\s+GPT-6 Astra/);
  assert.match(joined, /Orchestrator\s+Fable 5\.1/);
  assert.match(joined, /Suggested from real project analysis\. Use \/project approve to activate\./);
  assert.doesNotMatch(joined, /Quality leader:/);
  assert.doesNotMatch(joined, /retains 93%/);
  assert.doesNotMatch(joined, /Architect's quality pick/);
  assert.doesNotMatch(joined, /Operational picks:/);
});

test("INC4: same pick + available yields no muted extra line on the compact panel", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/crm",
    modelIntelligence: { status: "live", eligibility: { claude: { ok: true } }, claudeEntitlement: { "claude-fable-5-1": { status: "allowed", reason: null } } },
    projectStrategy: {
      status: "active",
      bootstrapAnalyst: null,
      orchestrator: null,
      qualityTeam: [{ role: "Builder", model: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" }, reason: null }],
      projectTeam: [{
        role: "Builder",
        model: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1", accessMode: "automatic" },
        reason: null,
        assignmentSource: "recommended",
        decisionEvidence: { decisionType: "leader", retention: 1, requiredFloor: 0.8, riskLevel: "medium" }
      }]
    }
  });
  const roleLines = view.projectTeamPanel(80).lines.filter((line) => /Builder/.test(stripTerminalSequences(line)));
  assert.equal(roleLines.length, 1, "same pick + available must not add a muted extra line under the role");
});

test("INC5: compact panel omits per-role availability detail while explicit evidence retains it", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/crm",
    modelIntelligence: {
      status: "live",
      eligibility: { claude: { ok: true } },
      claudeEntitlement: { "claude-fable-5-1": { status: "unverified", reason: null } }
    },
    projectStrategy: {
      status: "active",
      bootstrapAnalyst: null,
      orchestrator: null,
      qualityTeam: [{ role: "Builder", model: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" }, reason: null }],
      projectTeam: [{
        role: "Builder",
        model: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1", accessMode: "automatic" },
        reason: null,
        assignmentSource: "recommended",
        decisionEvidence: { decisionType: "leader", retention: 1, requiredFloor: 0.8, riskLevel: "medium" }
      }]
    }
  });
  const compact = view.projectTeamPanel(80).lines.join("\n");
  const evidence = view.projectTeamEvidenceLines(view.snapshot.projectStrategy, {
    eligibility: view.snapshot.modelIntelligence.eligibility,
    claudeEntitlement: view.snapshot.modelIntelligence.claudeEntitlement
  }).join("\n");
  assert.doesNotMatch(compact, /Unavailable — model entitlement not verified/);
  assert.match(evidence, /Unavailable — model entitlement not verified \(run \/models --verify-access\)/);
});

test("INC4: legacy strategy without qualityTeam does not break the compact panel", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/crm",
    modelIntelligence: { status: "live", eligibility: {}, claudeEntitlement: {} },
    projectStrategy: {
      status: "suggested",
      bootstrapAnalyst: null,
      orchestrator: null,
      projectTeam: [{
        role: "Architect",
        model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
        reason: null,
        assignmentSource: "recommended",
        decisionEvidence: { decisionType: "leader", requiredFloor: null, riskLevel: null }
      }]
    }
  });
  const { title, lines } = view.projectTeamPanel(80);
  assert.equal(title, "PROJECT TEAM · crm · SUGGESTED");
  const joined = lines.join("\n");
  assert.match(joined, /Architect\s+GPT-6 Astra/);
  assert.doesNotMatch(joined, /Quality leader/);
  assert.doesNotThrow(() => view.projectTeamEvidenceLines(view.snapshot.projectStrategy, {}));
});

test("INC4: resolveAssignmentAvailability — entitlement beats adapter ineligibility; denied uses real reason", () => {
  const model = { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" };
  const denied = resolveAssignmentAvailability(model, {
    eligibility: { claude: { ok: false, reason: "quota exhausted" } },
    claudeEntitlement: { "claude-fable-5-1": { status: "denied", reason: "credits_required" } }
  });
  assert.equal(denied.available, false);
  assert.match(denied.warning, /your Claude plan denies this model \(credits_required\)/);
  assert.doesNotMatch(denied.warning, /quota exhausted/);

  const ineligible = resolveAssignmentAvailability(
    { adapterId: "codex", modelId: "gpt-6-astra" },
    { eligibility: { codex: { ok: false, reason: "rate limited" } }, claudeEntitlement: {} }
  );
  assert.equal(ineligible.available, false);
  assert.equal(ineligible.warning, "Unavailable — rate limited");
});

test("INC4: projectTeamEvidenceLines names quality leader when it differs and retains real retention%", () => {
  const { view } = makeView();
  const strategy = {
    qualityTeam: [{ role: "Builder", model: { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" }, reason: null }],
    projectTeam: [{
      role: "Builder",
      model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
      fallback: null,
      reason: "Retains ~93% of QUALITY's real capability — chosen for lower real price.",
      decisionEvidence: {
        decisionType: "pareto", retention: 0.93, requiredFloor: 0.8, riskLevel: "medium",
        coverage: {}, confidence: "medium", isProvisional: false, savings: null
      }
    }]
  };
  const lines = view.projectTeamEvidenceLines(strategy, {
    eligibility: { claude: { ok: true }, codex: { ok: true } },
    claudeEntitlement: {}
  }).join("\n");
  assert.match(lines, /Quality leader: Fable 5\.1 — operational pick retains 93%/);
  assert.match(lines, /retention 93%/);
});
