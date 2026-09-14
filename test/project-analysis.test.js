import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalystPrompt, deriveRoleRequirements, parseProjectAnalysis, validateReferences } from "../src/global/conversation/project-analysis.js";

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

test("parseProjectAnalysis carries each recommendedRoleNeeds entry's own real evidence, defaulting to an empty array (never invented) when the analyst omits it", () => {
  const raw = JSON.stringify({
    architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
    recommendedRoleNeeds: [
      { role: "Reviewer", capabilities: ["reasoning"], reason: "sensitive", evidence: ["src/auth/route.ts"] },
      { role: "Tester", capabilities: ["coding"], reason: "no evidence field given at all" }
    ],
    uncertainties: [], evidenceReferences: []
  });
  const result = parseProjectAnalysis(raw);
  assert.equal(result.valid, true);
  assert.deepEqual(result.analysis.recommendedRoleNeeds[0].evidence, ["src/auth/route.ts"]);
  assert.deepEqual(result.analysis.recommendedRoleNeeds[1].evidence, []);
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

test("validateReferences matches a real cited path exactly, and honestly marks a fabricated one as unverified", () => {
  const { verified, unverified } = validateReferences(["src/app/api/chat/route.ts", "src/totally/made/up.ts"], ["src/app/api/chat/route.ts", "package.json"]);
  assert.deepEqual(verified, ["src/app/api/chat/route.ts"]);
  assert.deepEqual(unverified, ["src/totally/made/up.ts"]);
});

test("validateReferences tolerates real path-phrasing differences (leading ./, citing a shorter real suffix) without treating them as fabricated", () => {
  const { verified, unverified } = validateReferences(["./package.json", "route.ts"], ["package.json", "src/app/api/chat/route.ts"]);
  assert.deepEqual(verified, ["./package.json", "route.ts"]);
  assert.deepEqual(unverified, []);
});

test("deriveRoleRequirements checks evidence PER recommendedRoleNeeds entry — a role need with no real evidence of ITS OWN is dropped, even when a different role need in the same response is well-evidenced", () => {
  const analysis = {
    recommendedRoleNeeds: [
      { role: "Reviewer", capabilities: ["reasoning"], reason: "made up", evidence: ["src/made/up.ts"] },
      { role: "Debugger", capabilities: ["reasoning"], reason: "real finding", evidence: ["src/app/api/chat/route.ts"] }
    ]
  };
  const mechanicalFloor = [{ role: "Explorer", capabilities: ["reasoning"], reason: "baseline" }];
  const realFiles = ["src/app/api/chat/route.ts", "package.json"];
  const requirements = deriveRoleRequirements(analysis, mechanicalFloor, realFiles);
  const roles = requirements.map((r) => r.role);
  assert.ok(!roles.includes("Reviewer"), "Reviewer must be dropped — nothing IT cited was real, regardless of Debugger being well-evidenced");
  assert.ok(roles.includes("Debugger"), "Debugger must be kept — its own evidence verified against a real file");
  assert.ok(roles.includes("Explorer"), "the mechanical floor always survives");
});

test("deriveRoleRequirements trusts a role need with no real file list available at all (pre-sanitized-snapshot fallback) — never blocks on vocabulary alone", () => {
  const analysis = { recommendedRoleNeeds: [{ role: "Reviewer", capabilities: ["reasoning"], reason: "no snapshot info available", evidence: [] }] };
  const mechanicalFloor = [{ role: "Explorer", capabilities: ["reasoning"], reason: "baseline" }];
  const requirements = deriveRoleRequirements(analysis, mechanicalFloor); // no 3rd arg — real file list genuinely unavailable
  assert.ok(requirements.some((r) => r.role === "Reviewer"));
});
