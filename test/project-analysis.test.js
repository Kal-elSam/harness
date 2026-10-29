import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalystPrompt, deriveRoleRequirements, parseProjectAnalysis, validateReferences, verifyDemandAssessment } from "../src/global/team/project-analysis.js";

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

test("parseProjectAnalysis takes the first complete JSON object even when braces follow it", () => {
  const json = JSON.stringify({
    architectureTraits: ["uses {braces} in a string"], complexitySignals: [], criticalAreas: [],
    contextNeeds: [], workflowNeeds: [], recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: []
  });
  const result = parseProjectAnalysis(`Here is the analysis:\n${json}\nNote: see {"extra": true} for details.`);
  assert.equal(result.valid, true);
  assert.deepEqual(result.analysis.architectureTraits, ["uses {braces} in a string"]);
  assert.equal(parseProjectAnalysis("no json here").valid, false);
  assert.equal(parseProjectAnalysis('{"architectureTraits": [').valid, false);
});

test("parseProjectAnalysis carries each recommendedRoleNeeds entry's own real evidence, defaulting to an empty array (never invented) when the analyst omits it", () => {
  const raw = JSON.stringify({
    architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
    recommendedRoleNeeds: [
      { role: "Reviewer", capabilities: ["reasoning"], reason: "sensitive", evidence: ["src/auth/route.ts"] },
      { role: "Test Runner", capabilities: ["coding"], reason: "no evidence field given at all" }
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
      { role: "Debugger (fix)", capabilities: ["reasoning"], reason: "real finding", evidence: ["src/app/api/chat/route.ts"] }
    ]
  };
  const mechanicalFloor = [{ role: "Explorer", capabilities: ["reasoning"], reason: "baseline" }];
  const realFiles = ["src/app/api/chat/route.ts", "package.json"];
  const requirements = deriveRoleRequirements(analysis, mechanicalFloor, realFiles);
  const roles = requirements.map((r) => r.role);
  assert.ok(!roles.includes("Reviewer"), "Reviewer must be dropped — nothing IT cited was real, regardless of Debugger (fix) being well-evidenced");
  assert.ok(roles.includes("Debugger (fix)"), "Debugger (fix) must be kept — its own evidence verified against a real file");
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
  { role: "Test Runner", capabilities: ["terminalExecution"], reason: "test", source: "command" },
  { role: "Explorer", capabilities: ["reasoning"], reason: "baseline", source: "template" }
];
test("S2 keeps command-detected Builder and Test Runner alongside a valid Architect and baseline Explorer", () => {
  const needs = deriveRoleRequirements({ recommendedRoleNeeds: [
    { role: "Architect", capabilities: ["reasoning"], evidence: ["package.json"] }
  ] }, commandFloor, ["package.json"]);
  assert.deepEqual(needs.map((need) => need.role), ["Architect", "Builder", "Test Runner", "Explorer"]);
  assert.deepEqual(needs.slice(1), commandFloor);
});
test("S2 returns the full floor when all analyst needs fail validation", () => {
  assert.deepEqual(deriveRoleRequirements({ recommendedRoleNeeds: [
    { role: "Architect", capabilities: ["reasoning"], evidence: ["missing.js"] }
  ] }, commandFloor, ["package.json"]), commandFloor);
});
test("S2 merges analyst Builder capabilities without dropping command-detected Test Runner", () => {
  const needs = deriveRoleRequirements({ recommendedRoleNeeds: [
    { role: "Builder", capabilities: ["reasoning", "coding"], evidence: ["package.json"] }
  ] }, commandFloor, ["package.json"]);
  assert.deepEqual(needs.map((need) => need.role), ["Builder", "Test Runner", "Explorer"]);
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

// ---- S35 / C18: structured demand assessment ----
const cat = (level, ...evidence) => ({ level, evidence });
const emmaAssessment = {
  productPurpose: "Personal assistant: an LLM proposes OS actions and a PolicyEngine authorizes them (README.md)",
  riskCategories: {
    actionsAndSecurity: cat(5, "README.md", "src/policy/policy-engine.js"),
    money: cat(1, "README.md"), personalData: cat(3, "README.md"),
    realtimeConcurrency: cat(2, "src/policy/policy-engine.js"),
    aiIntegration: cat(5, "src/agent/loop.js"), domainComplexity: cat(4, "README.md")
  }
};
const landingAssessment = {
  productPurpose: "Static landing page (README.md)",
  riskCategories: {
    actionsAndSecurity: cat(1, "README.md"), money: cat(1, "README.md"), personalData: cat(1, "README.md"),
    realtimeConcurrency: cat(1, "README.md"), aiIntegration: cat(1, "README.md"), domainComplexity: cat(2, "README.md")
  }
};
const baseRaw = (extra = {}) => JSON.stringify({
  architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
  recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: [], ...extra
});

test("S35 prompt requests the demand assessment with level anchors and the optional snapshotReport", () => {
  const prompt = buildAnalystPrompt(profile());
  for (const token of [/demandAssessment/, /productPurpose/, /actionsAndSecurity/, /money/, /personalData/, /realtimeConcurrency/, /aiIntegration/, /domainComplexity/, /1 = trivial static content/, /3 = typical CRUD/, /5 = autonomous agent/, /snapshot lacks/i]) {
    assert.match(prompt, token);
  }
  assert.doesNotMatch(prompt, /SNAPSHOT-REPORT-MARK/);
  const withReport = buildAnalystPrompt(profile(), undefined, "SNAPSHOT-REPORT-MARK: src/ excluded");
  assert.match(withReport, /SNAPSHOT-REPORT-MARK: src\/ excluded/);
});

test("S35 parseProjectAnalysis accepts v2 demandAssessment; v1 responses still parse with a null assessment", () => {
  const v2 = parseProjectAnalysis(baseRaw({ demandAssessment: emmaAssessment }));
  assert.equal(v2.valid, true);
  assert.equal(v2.analysis.schema, "kairo.project-analysis/v2");
  assert.equal(v2.analysis.demandAssessment.riskCategories.actionsAndSecurity.level, 5);
  const v1 = parseProjectAnalysis(baseRaw());
  assert.equal(v1.valid, true);
  assert.equal(v1.analysis.schema, "kairo.project-analysis/v1");
  assert.equal(v1.analysis.demandAssessment, null);
});

test("S35 malformed assessment categories are dropped, never trusted", () => {
  const parsed = parseProjectAnalysis(baseRaw({ demandAssessment: { productPurpose: "x", riskCategories: {
    money: cat(9, "README.md"), personalData: cat("high", "README.md"), aiIntegration: { level: 3 }, bogus: cat(5, "README.md"), domainComplexity: cat(3, "README.md")
  } } }));
  assert.deepEqual(Object.keys(parsed.analysis.demandAssessment.riskCategories), ["aiIntegration", "domainComplexity"]);
  assert.deepEqual(parsed.analysis.demandAssessment.riskCategories.aiIntegration.evidence, []);
  assert.equal(parseProjectAnalysis(baseRaw({ demandAssessment: "nope" })).analysis.demandAssessment, null);
});

test("S35 verifyDemandAssessment caps a category without verified evidence at level 2", () => {
  const files = ["README.md", "src/policy/policy-engine.js"];
  const verified = verifyDemandAssessment(emmaAssessment, files);
  assert.equal(verified.categories.actionsAndSecurity.level, 5);
  assert.equal(verified.categories.aiIntegration.level, 2); // src/agent/loop.js not in snapshot
  assert.equal(verified.categories.aiIntegration.claimedLevel, 5);
  assert.equal(verified.categories.aiIntegration.capped, true);
  assert.deepEqual(verified.categories.aiIntegration.unverifiedEvidence, ["src/agent/loop.js"]);
  assert.equal(verified.categories.money.level, 1); // low claims are never raised
  assert.equal(verifyDemandAssessment(null, files), null);
  assert.equal(verifyDemandAssessment({ productPurpose: "x", riskCategories: {} }, files), null);
});

const gapFloor = [
  { role: "Architect", capabilities: ["reasoning"], reason: "baseline", source: "template" },
  { role: "Explorer", capabilities: ["reasoning"], reason: "baseline", source: "template" },
  { role: "Reviewer", capabilities: ["coding"], reason: "gap reviewer", source: "gap" },
  { role: "Test Runner", capabilities: ["coding"], reason: "gap tester", source: "gap" },
  { role: "Builder", capabilities: ["coding"], reason: "build", source: "command" },
  { role: "Debugger (fix)", capabilities: ["coding"], reason: "debug", source: "command" }
];
const oneNeed = { role: "Builder", capabilities: ["coding"], evidence: ["README.md"] };
test("S35 gap-sourced roles survive deriveRoleRequirements next to analyst needs", () => {
  const needs = deriveRoleRequirements({ recommendedRoleNeeds: [oneNeed] }, gapFloor, ["README.md"]);
  assert.deepEqual(new Set(needs.map(n => n.role)), new Set(["Architect", "Explorer", "Reviewer", "Test Runner", "Builder", "Debugger (fix)"]));
});

test("S35 high categories add required capabilities per role", () => {
  const files = ["README.md", "src/policy/policy-engine.js", "src/agent/loop.js"];
  const analysis = { recommendedRoleNeeds: [oneNeed], demandAssessment: emmaAssessment };
  const needs = Object.fromEntries(deriveRoleRequirements(analysis, gapFloor, files).map(n => [n.role, n]));
  assert.ok(needs.Reviewer.capabilities.includes("reasoning"));
  assert.ok(needs.Architect.capabilities.includes("reasoning"));
  assert.ok(needs.Architect.capabilities.includes("agenticExecution"));
  assert.ok(needs.Builder.capabilities.includes("agenticExecution"));
  assert.ok(!needs["Debugger (fix)"].capabilities.includes("terminalExecution")); // realtime only level 2
  assert.match(needs.Reviewer.reason, /actionsAndSecurity/);
  const realtime = { productPurpose: "x", riskCategories: { realtimeConcurrency: cat(4, "README.md") } };
  const rt = Object.fromEntries(deriveRoleRequirements({ recommendedRoleNeeds: [oneNeed], demandAssessment: realtime }, gapFloor, files).map(n => [n.role, n]));
  assert.ok(rt["Debugger (fix)"].capabilities.includes("terminalExecution"));
});

test("S35 capability additions use the verified (capped) level, and a low assessment adds nothing", () => {
  const unverified = { recommendedRoleNeeds: [oneNeed], demandAssessment: emmaAssessment };
  const capped = Object.fromEntries(deriveRoleRequirements(unverified, gapFloor, ["README.md"]).map(n => [n.role, n]));
  assert.ok(!capped.Architect.capabilities.includes("agenticExecution")); // aiIntegration evidence unverified
  assert.ok(capped.Reviewer.capabilities.includes("reasoning")); // actionsAndSecurity cites README.md
  const low = deriveRoleRequirements({ recommendedRoleNeeds: [oneNeed], demandAssessment: landingAssessment }, gapFloor, ["README.md"]);
  assert.deepEqual(low.find(n => n.role === "Reviewer").capabilities, ["coding"]);
});


for (const [role, categories, threshold] of [
  ["Planner", ["domainComplexity"], 3],
  ["Refactorer", ["domainComplexity"], 4],
  ["Security Reviewer", ["actionsAndSecurity", "money", "personalData"], 4]
]) test(`S40 ${role} activates from verified assessment levels only`, () => {
  for (const category of categories) for (const level of [threshold - 1, threshold]) {
    for (const evidence of [["src/app.js"], ["invented.js"]]) {
      const analysis = { recommendedRoleNeeds: [], demandAssessment: { riskCategories: { [category]: { level, evidence } } } };
      const requirements = deriveRoleRequirements(analysis, [], ["src/app.js"]);
      assert.equal(requirements.some(r => r.role === role), level >= threshold && evidence[0] === "src/app.js");
    }
  }
  assert.ok(!deriveRoleRequirements({ recommendedRoleNeeds: [] }, [], []).some(r => r.role === role));
});
test("S40 analyst can activate catalog roles with per-role verified evidence", () => {
  const need = { role: "Planner", capabilities: ["agenticExecution", "reasoning"], evidence: ["src/app.js"] };
  const requirements = deriveRoleRequirements({ recommendedRoleNeeds: [need] }, [], ["src/app.js"]);
  assert.ok(requirements.some(r => r.role === "Planner"));
  assert.ok(requirements[0].capabilities.includes("agenticExecution"));
  assert.deepEqual(deriveRoleRequirements({ recommendedRoleNeeds: [need] }, [], ["other.js"]), []);
  assert.match(buildAnalystPrompt(profile()), /Security Reviewer/);
});


// Namespace import keeps the missing export an observed assertion failure.
import * as demandAnalysis from "../src/global/team/project-analysis.js";
const stableAssessment = level => verifyDemandAssessment({ productPurpose: "Landing page", riskCategories: {
  ...landingAssessment.riskCategories, actionsAndSecurity: cat(level, "README.md")
}}, ["README.md"]);

test("S42 stabilizer retains stored levels for one-level cva-page drift without mutating inputs", () => {
  assert.equal(typeof demandAnalysis.stabilizeDemandAssessment, "function");
  const previous = stableAssessment(3);
  const next = stableAssessment(4);
  const before = structuredClone({ previous, next });
  const result = demandAnalysis.stabilizeDemandAssessment(previous, next);
  assert.equal(result.categories.actionsAndSecurity.level, 3);
  assert.equal(result.stabilized, true);
  assert.equal(result.evidence.rawLevels.actionsAndSecurity, 4);
  assert.deepEqual({ previous, next }, before);
  // The stored strategy uses flat levels rather than verified categories.
  const stored = { levels: Object.fromEntries(Object.entries(previous.categories).map(([name, value]) => [name, value.level])) };
  assert.deepEqual(demandAnalysis.stabilizeDemandAssessment(stored, next), result);
});

test("S42 stabilizer adopts all new levels for a two-level jump and records changed categories", () => {
  assert.equal(typeof demandAnalysis.stabilizeDemandAssessment, "function");
  const previous = stableAssessment(2);
  const next = stableAssessment(4);
  next.categories.domainComplexity.level = 3;
  const result = demandAnalysis.stabilizeDemandAssessment(previous, next);
  assert.deepEqual(result.categories, next.categories);
  assert.equal(result.stabilized, false);
  assert.deepEqual(result.evidence.changedCategories, ["actionsAndSecurity", "domainComplexity"]);
  assert.equal(demandAnalysis.stabilizeDemandAssessment(previous, null), null);
  assert.deepEqual(demandAnalysis.stabilizeDemandAssessment(null, next), next);
});

test("S43 analyst cannot restore generic Builder beside either split Builder", () => {
  for (const role of ["Frontend Builder", "Backend Builder"]) {
    const requirements = deriveRoleRequirements({ recommendedRoleNeeds: [
      { role, capabilities: ["coding"], reason: "source evidence", evidence: ["src/app.js"] },
      { role: "Builder", capabilities: ["coding"], reason: "generic", evidence: ["src/app.js"] }
    ] }, [{ role: "Builder", capabilities: ["coding"], source: "stack", reason: "stack" }], ["src/app.js"]);
    assert.ok(requirements.some(entry => entry.role === role));
    assert.ok(!requirements.some(entry => entry.role === "Builder"));
  }
});
