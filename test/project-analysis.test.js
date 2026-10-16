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

test("buildAnalystPrompt asks for languages, structure, dependencies, constraints and risks and a repo-evidenced team justification", () => {
  const prompt = buildAnalystPrompt(profile());
  for (const topic of [/languages/i, /structure/i, /dependencies/i, /constraints/i, /risks/i]) assert.match(prompt, topic);
  assert.match(prompt, /justif/i);
  assert.match(prompt, /architecture/i);
  assert.match(prompt, /design/i);
  assert.match(prompt, /evidence/i);
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

test("deriveRoleRequirements: analyst-justified roles retain baseline and command-detected roles", () => {
  const analysis = { recommendedRoleNeeds: [{ role: "Reviewer", capabilities: ["reasoning"], reason: "risk area" }] };
  const mechanicalFloor = [
    { role: "Explorer", capabilities: ["reasoning", "instructionFollowing"], reason: "baseline", source: "template" },
    { role: "Builder", capabilities: ["coding"], reason: "real build command", source: "command" }
  ];
  const requirements = deriveRoleRequirements(analysis, mechanicalFloor);
  const roles = requirements.map((r) => r.role);
  assert.deepEqual(roles, ["Reviewer", "Explorer", "Builder"]);
  assert.ok(roles.includes("Explorer"), "baseline Explorer survives analyst recommendations");
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
  assert.ok(roles.includes("Explorer"), "baseline Explorer survives per-need evidence validation");
});

test("deriveRoleRequirements trusts a role need with no real file list available at all (pre-sanitized-snapshot fallback) — never blocks on vocabulary alone", () => {
  const analysis = { recommendedRoleNeeds: [{ role: "Reviewer", capabilities: ["reasoning"], reason: "no snapshot info available", evidence: [] }] };
  const mechanicalFloor = [{ role: "Explorer", capabilities: ["reasoning"], reason: "baseline" }];
  const requirements = deriveRoleRequirements(analysis, mechanicalFloor); // no 3rd arg — real file list genuinely unavailable
  assert.ok(requirements.some((r) => r.role === "Reviewer"));
});

const citationCases = [
  ["src/my file.js", "src/my file.js"],
  ["src/secure_sql/_client.py (wiring of secrets, connection, query behind facade)", "src/secure_sql/_client.py"],
  ["src/secure_sql/_errors.py (wrap_driver_errors decorator and _clear_chain logic)", "src/secure_sql/_errors.py"],
  ["pyproject.toml: project metadata, dependencies (pyodbc, bitwarden-sdk, pandas), test/type/lint config", "pyproject.toml"],
  ["package.json — defines runtime dependencies (React, Ink, Zod, MCP), scripts", "package.json"],
  ["CHANGELOG.md (v0.30-0.35 session refactoring entries)", "CHANGELOG.md"],
  ["src/hooks/siniestros/usePagosFlexiControl.js lines 40-150", "src/hooks/siniestros/usePagosFlexiControl.js"],
  ["src/services/pagosFlexi/pagosFlexiBackendAdapter.js:116", "src/services/pagosFlexi/pagosFlexiBackendAdapter.js"],
  ["src/app.js - runtime entry point", "src/app.js"],
  ["src/app.js:40-150", "src/app.js"],
  ["src/app.js#L40", "src/app.js"]
];
for (const [citation, path] of citationCases) {
  test(`S1 verifies citation and role evidence: ${citation}`, () => {
    assert.deepEqual(validateReferences([citation], [path]), { verified: [citation], unverified: [] });
    const needs = deriveRoleRequirements({ recommendedRoleNeeds: [
      { role: "Architect", capabilities: ["reasoning"], evidence: [citation] }
    ] }, [], [path]);
    assert.deepEqual(needs.map((need) => need.role), ["Architect"]);
  });
}
for (const citation of ["src/missing.py (not in snapshot)", "this is pure prose", "client.py (partial basename)"]) {
  test(`S1 rejects non-file citation: ${citation}`, () => {
    assert.deepEqual(validateReferences([citation], ["src/secure_sql/_client.py"]), { verified: [], unverified: [citation] });
    assert.deepEqual(deriveRoleRequirements({ recommendedRoleNeeds: [
      { role: "Architect", capabilities: ["reasoning"], evidence: [citation] }
    ] }, [], ["src/secure_sql/_client.py"]), []);
  });
}
test("S1 preserves the existing slash-boundary basename suffix match", () => {
  assert.deepEqual(validateReferences(["_client.py"], ["src/secure_sql/_client.py"]).verified, ["_client.py"]);
});

const commandFloor = [
  { role: "Builder", capabilities: ["coding"], reason: "build", source: "command" },
  { role: "Tester", capabilities: ["terminalExecution"], reason: "test", source: "command" },
  { role: "Explorer", capabilities: ["reasoning"], reason: "baseline", source: "template" }
];
test("S2 keeps command-detected Builder and Tester alongside a valid Architect and baseline Explorer", () => {
  const needs = deriveRoleRequirements({ recommendedRoleNeeds: [
    { role: "Architect", capabilities: ["reasoning"], evidence: ["package.json"] }
  ] }, commandFloor, ["package.json"]);
  assert.deepEqual(needs.map((need) => need.role), ["Architect", "Builder", "Tester", "Explorer"]);
  assert.deepEqual(needs.slice(1), commandFloor);
});
test("S2 returns the full floor when all analyst needs fail validation", () => {
  assert.deepEqual(deriveRoleRequirements({ recommendedRoleNeeds: [
    { role: "Architect", capabilities: ["reasoning"], evidence: ["missing.js"] }
  ] }, commandFloor, ["package.json"]), commandFloor);
});
test("S2 merges analyst Builder capabilities without dropping command-detected Tester", () => {
  const needs = deriveRoleRequirements({ recommendedRoleNeeds: [
    { role: "Builder", capabilities: ["reasoning", "coding"], evidence: ["package.json"] }
  ] }, commandFloor, ["package.json"]);
  assert.deepEqual(needs.map((need) => need.role), ["Builder", "Tester", "Explorer"]);
  assert.deepEqual(needs[0].capabilities, ["coding", "reasoning"]);
  assert.match(needs[0].reason, /Bootstrap Analyst/);
});

test("S27 analyst naming only Builder retains Architect and Explorer and can extend their capabilities", () => {
  const floor = [
    { role: "Architect", capabilities: ["reasoning"], reason: "baseline", source: "template" },
    { role: "Explorer", capabilities: ["reasoning", "instructionFollowing"], reason: "baseline", source: "template" }
  ];
  const needs = deriveRoleRequirements({ recommendedRoleNeeds: [
    { role: "Builder", capabilities: ["coding"], evidence: ["package.json"] }
  ] }, floor, ["package.json"]);
  assert.deepEqual(new Set(needs.map(need => need.role)), new Set(["Builder", "Architect", "Explorer"]));
  const extended = deriveRoleRequirements({ recommendedRoleNeeds: [
    { role: "Architect", capabilities: ["coding"], evidence: ["package.json"] }
  ] }, floor, ["package.json"]);
  assert.deepEqual(extended.find(need => need.role === "Architect").capabilities, ["reasoning", "coding"]);
});
