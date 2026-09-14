import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalystPrompt, deriveRoleRequirements, parseProjectAnalysis } from "../src/global/conversation/project-analysis.js";

function profile(overrides = {}) {
  return {
    projectName: "crm", stack: ["React"], architecture: { pattern: "Layered" },
    quality: { buildCommand: "pnpm build", testCommand: "pnpm test", lintCommand: "pnpm lint", typeCheckCommand: null },
    hotspots: [{ path: "src/app.js", changes: 5 }],
    workflowCapabilities: ["sdd"], risks: [{ kind: "no-static-checks", detail: "no lint" }],
    ...overrides
  };
}

test("buildAnalystPrompt includes only real, already-collected evidence and explicitly forbids file changes", () => {
  const prompt = buildAnalystPrompt(profile());
  assert.match(prompt, /READ-ONLY/);
  assert.match(prompt, /pnpm build/);
  assert.match(prompt, /pnpm test/);
  assert.match(prompt, /src\/app\.js/);
  assert.match(prompt, /never invent/);
});

test("parseProjectAnalysis accepts a real, complete, valid JSON response", () => {
  const raw = JSON.stringify({
    architectureTraits: ["monolithic"], complexitySignals: ["large src/ tree"], criticalAreas: ["auth"],
    contextNeeds: ["payment flow docs"], workflowNeeds: ["sdd"],
    recommendedRoleNeeds: [{ role: "Reviewer", capabilities: ["reasoning", "coding"], reason: "auth is sensitive" }],
    uncertainties: ["test coverage unknown"], evidenceReferences: ["src/auth/"]
  });
  const result = parseProjectAnalysis(raw);
  assert.equal(result.valid, true);
  assert.equal(result.analysis.recommendedRoleNeeds[0].role, "Reviewer");
});

test("parseProjectAnalysis extracts JSON even when the model wraps it in prose or markdown fences", () => {
  const raw = "Here is my analysis:\n```json\n" + JSON.stringify({
    architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
    recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: []
  }) + "\n```\nLet me know if you need more.";
  const result = parseProjectAnalysis(raw);
  assert.equal(result.valid, true);
});

test("parseProjectAnalysis fails closed on unparseable or malformed output — never a partially-trusted guess", () => {
  assert.equal(parseProjectAnalysis("not json at all").valid, false);
  assert.equal(parseProjectAnalysis("{}").valid, false, "missing required array fields must fail");
  assert.equal(parseProjectAnalysis(JSON.stringify({
    architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
    recommendedRoleNeeds: "not an array", uncertainties: [], evidenceReferences: []
  })).valid, false);
});

test("deriveRoleRequirements sanitizes the analyst's role/capability tokens against the known vocabulary, dropping anything unrecognized", () => {
  const analysis = {
    recommendedRoleNeeds: [
      { role: "Reviewer", capabilities: ["reasoning", "made-up-capability"], reason: "sensitive area" },
      { role: "NotARealRole", capabilities: ["reasoning"], reason: "should be dropped entirely" }
    ]
  };
  const requirements = deriveRoleRequirements(analysis, []);
  assert.equal(requirements.length, 1);
  assert.equal(requirements[0].role, "Reviewer");
  assert.deepEqual(requirements[0].capabilities, ["reasoning"]);
});

test("deriveRoleRequirements unions the analyst's real findings with the project's mechanical floor, never dropping the floor's own roles", () => {
  const analysis = { recommendedRoleNeeds: [{ role: "Reviewer", capabilities: ["reasoning"], reason: "risk area" }] };
  const mechanicalFloor = [
    { role: "Explorer", capabilities: ["reasoning", "instructionFollowing"], reason: "baseline" },
    { role: "Builder", capabilities: ["coding"], reason: "real build command" }
  ];
  const requirements = deriveRoleRequirements(analysis, mechanicalFloor);
  const roles = requirements.map((r) => r.role);
  assert.ok(roles.includes("Explorer") && roles.includes("Builder") && roles.includes("Reviewer"));
});

test("deriveRoleRequirements merges capabilities when both the analyst and the mechanical floor name the same real role", () => {
  const analysis = { recommendedRoleNeeds: [{ role: "Builder", capabilities: ["terminalExecution"], reason: "real CI pipeline observed" }] };
  const mechanicalFloor = [{ role: "Builder", capabilities: ["coding"], reason: "real build command" }];
  const requirements = deriveRoleRequirements(analysis, mechanicalFloor);
  const builder = requirements.find((r) => r.role === "Builder");
  assert.deepEqual(new Set(builder.capabilities), new Set(["coding", "terminalExecution"]));
});

test("a thin analysis with no real recommendedRoleNeeds still leaves the project with its real mechanical floor, never zero requirements", () => {
  const analysis = { recommendedRoleNeeds: [] };
  const mechanicalFloor = [{ role: "Explorer", capabilities: ["reasoning"], reason: "baseline" }];
  const requirements = deriveRoleRequirements(analysis, mechanicalFloor);
  assert.equal(requirements.length, 1);
});
