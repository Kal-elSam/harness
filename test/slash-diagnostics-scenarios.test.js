import test from "node:test";
import assert from "node:assert/strict";
import { formatSubscriptionUsageSegments } from "../src/global/conversation/usage-summary.js";
import * as slashDiagnostics from "../src/global/conversation/slash-diagnostics.js";

// Ported from the retired legacy cockpit view test: every scenario below exercised
// live slash-diagnostics logic through the view's delegating methods. The scenario
// bodies are unchanged; this thin test-only adapter replaces the legacy view.
class DiagnosticsView {
  setRows() {}
  setSnapshot(snapshot) { this.snapshot = snapshot; }
  fitLines() { return slashDiagnostics.fitLines(this.snapshot); }
  modelsExplainLines() { return slashDiagnostics.modelsExplainLines(this.snapshot); }
  aiTeamDetailLines() { return slashDiagnostics.aiTeamDetailLines(this.snapshot); }
  fitWhyLines() { return slashDiagnostics.fitWhyLines(this.snapshot); }
  providerLines() { return slashDiagnostics.providerLines(this.snapshot); }
  integrationsLine() { return slashDiagnostics.integrationsLine(this.snapshot); }
  usageLines() { return slashDiagnostics.usageLines(this.snapshot); }
  teamEvidenceLines(team, options) { return slashDiagnostics.teamEvidenceLines(team, options); }
  projectTeamEvidenceLines(strategy, options) { return slashDiagnostics.projectTeamEvidenceLines(strategy, options); }
  aiTeamLabel(model) { return slashDiagnostics.aiTeamLabel(model); }
  aiTeamLabelWithProvider(model) { return slashDiagnostics.aiTeamLabelWithProvider(model); }
}

function makeView() {
  return { view: new DiagnosticsView(), calls: [] };
}

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

test("REGRESSION: /why surfaces the real Cursor catalog error instead of an unexplained 'unknown catalog, 0/0 matched' line", () => {
  const { view } = makeView();
  view.setSnapshot({
    projectRoot: "/repo/demo",
    modelIntelligence: {
      eligibility: { cursor: { ok: true, reason: null } },
      coverage: [
        { adapterId: "cursor", catalogStatus: "unknown", totalModels: 0, matchedModels: 0, error: "cursor-agent models exited with code 1: Authentication required" }
      ]
    }
  });
  const lines = view.fitWhyLines().join("\n");
  assert.match(lines, /cursor: unknown catalog, 0\/0 models matched to Artificial Analysis — cursor-agent models exited with code 1: Authentication required/);
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

test("AI TEAM reports honestly when there is no benchmark data yet", () => {
  const { view } = makeView();
  view.setRows([]);
  view.setSnapshot({ projectRoot: "/repo/demo", modelIntelligence: { status: "unknown", source: null, age: null, models: [], error: "no API key configured" } });
  const lines = view.fitLines().join("\n");
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
  const lines = view.fitLines().join("\n");
  assert.match(lines, /No eligible model signals right now/);
  assert.match(lines, /codex: Codex quota nearly exhausted \(2% left\)/);
  assert.match(lines, /claude: Claude quota nearly exhausted \(1% left\)/);
});

test("QUALITY TEAM: fitLines() reads the real, portfolio-coordinated aiTeam/efficientTeam — never globalGuide, which is /models-only evidence", () => {
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

});

test("subscription usage segments show every measured Go window's real percentage and never Zen (ported from the compact USAGE bar scenario)", () => {
  const segments = formatSubscriptionUsageSegments({
    usage: {
      opencode: {
        go: { windows: [
          { name: "rolling", remainingPercent: 100, status: "ok" },
          { name: "weekly", remainingPercent: 75, status: "ok" },
          { name: "monthly", remainingPercent: 0, status: "rate-limited" }
        ] },
        zen: { status: "local_recorded", totalCost: 33.81 }
      }
    },
    providers: undefined
  });
  const text = segments.join(" │ ");
  assert.match(text, /Go 100% \/ 75% \/ 0% LIMITED/);
  assert.doesNotMatch(text, /Zen/);
  assert.doesNotMatch(text, /PAYG blocked/);
});
