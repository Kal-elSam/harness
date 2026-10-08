import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { slashDiagnosticLines } from "../src/global/conversation/slash-diagnostics.js";
import { slashDiagnosticLines as viaSidecar } from "../src/global/host/kairo-ui-rpc-stdio.js";
import { CockpitView } from "../src/global/cockpit/view.js";

// Golden captured from the legacy CockpitView-backed implementation BEFORE the
// extraction: the neutral module must reproduce it byte for byte.
const golden = JSON.parse(readFileSync(new URL("./fixtures/slash-diagnostics/golden-before-extraction.json", import.meta.url), "utf8"));

const m = (adapterId, modelId, displayName, extra = {}) => ({ adapterId, modelId, displayName, ...extra });
const rich = {
  projectRoot: "/repo/demo",
  usage: {
    codex: { windows: [{ name: "5h", remainingPercent: 80 }, { name: "weekly", remainingPercent: 12 }], primary: { remainingPercent: 58 }, secondary: { remainingPercent: 86 }, source: "measured" },
    claude: { windows: [{ name: "s", label: "Session", remainingPercent: 34 }], primary: { remainingPercent: 34 }, secondary: { remainingPercent: 65 } },
    opencode: { go: { windows: [{ name: "rolling", remainingPercent: 10, status: "rate-limited" }, { name: "weekly", remainingPercent: 55, status: "ok" }, { name: "monthly", remainingPercent: 96 }], source: "measured" }, zen: { status: "local_recorded", totalCost: 12.3456, totalTokens: 1234567 } }
  },
  providers: { Codex: { status: "READY" }, cursor: { status: "NEEDS LOGIN" } },
  integrations: { engram: { status: "available" }, mcp: { state: "degraded" }, codegraph: { status: "ready" } },
  modelIntelligence: {
    status: "cached", age: "3h",
    eligibility: { codex: { ok: true }, claude: { ok: false, reason: "Authentication required" } },
    coverage: [{ adapterId: "codex", catalogStatus: "measured", matchedModels: 3, totalModels: 5 }, { adapterId: "claude", catalogStatus: "unknown", matchedModels: 0, totalModels: 0, error: "Authentication required" }],
    unscoredModels: [m("cursor", "c-x", undefined), m("cursor", "c-y", "Composer 2")],
    aiTeam: [
      { role: "Builder", primary: m("codex", "gpt-6", "GPT-6 Sol 1M Extra High", { modelName: "GPT-6 Sol", available: true, corroboration: [{ metric: "mmlu", value: 0.9, source: "hf" }] }), fallback: m("claude", "f5", "Fable 5.1 High", { modelName: "Fable 5.1", available: true }), reason: "near-tie; independence swap", coverage: 0.5, confidence: "low",
        decisionEvidence: { coverage: { coding: { have: 0, active: 3, comparable: false }, reasoning: { have: 2, active: 2, comparable: true } }, confidence: "medium", retention: 1, requiredFloor: 0.8, riskLevel: "medium", decisionType: "leader" } },
      { role: "Tester", primary: m("opencode-go", "go-t", "Go Tester", { available: false }), fallback: null, reason: null, coverage: 0.4, confidence: "high" }
    ],
    efficientTeam: [
      { role: "Builder", primary: m("opencode-go", "go-b", "Go Builder", { available: true }), fallback: null, reason: "cheaper", decisionEvidence: { retention: 1.17, requiredFloor: 0.8, riskLevel: "low", decisionType: "pareto", savings: { label: "cost", from: "$3", to: "$1" }, coverage: {}, confidence: "high" } },
      { role: "Tester", primary: m("opencode-go", "go-t", "Go Tester", { available: false }), fallback: null }
    ],
    globalGuide: { capability: [{ role: "Builder", primary: m("claude", "f5", "Fable 5.1", { modelName: "Fable 5.1" }) }] }
  },
  projectStrategy: {
    status: "active",
    qualityTeam: [{ role: "Builder", model: m("claude", "claude-fable-5-1", "Fable 5.1") }],
    projectTeam: [{ role: "Builder", model: m("codex", "gpt-6", "GPT-6", { accessMode: "automatic" }), fallback: m("claude", "claude-fable-5-1", "Fable 5.1"), reason: null, decisionEvidence: { decisionType: "leader", retention: 0.9, requiredFloor: 0.8, riskLevel: "medium" } }]
  }
};
const unknownIntel = { modelIntelligence: { status: "unknown", error: "no data" } };
const emptyTeam = { modelIntelligence: { status: "live", eligibility: { codex: { ok: false, reason: "x" } }, aiTeam: [] } };
const snaps = { rich, unknownIntel, emptyTeam, empty: {}, nul: null };
const KINDS = ["usage", "providers", "status", "models", "models_evidence", "why", "bogus"];

test("slash diagnostics are byte-identical to the pre-extraction golden for every kind and snapshot", () => {
  for (const [name, snap] of Object.entries(snaps)) {
    for (const kind of KINDS) {
      assert.deepEqual(slashDiagnosticLines(snap, kind), golden[name][kind], `${name}/${kind}`);
    }
  }
});

test("the Ratatui sidecar re-exports the neutral implementation and the legacy view delegates to it", () => {
  assert.equal(viaSidecar, slashDiagnosticLines);
  const view = new CockpitView({ actions: {} });
  view.snapshot = rich;
  assert.deepEqual(view.providerLines(), golden.rich.providers);
  assert.deepEqual(view.modelsExplainLines(), golden.rich.models);
  assert.deepEqual(view.aiTeamDetailLines(), golden.rich.models_evidence);
  assert.deepEqual(view.fitWhyLines(), golden.rich.why);
  assert.equal(view.integrationsLine(), golden.rich.status.at(-1));
});
