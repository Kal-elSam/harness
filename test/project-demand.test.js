import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam } from "../src/global/intelligence/model-intelligence.js";
import { projectDemand, roleDemandFloor, PROJECT_FLOOR_RAISE } from "../src/global/intelligence/role-demand.js";
import { buildProjectStrategy } from "../src/global/conversation/project-strategy.js";

const eligibility = { claude: { ok: true }, codex: { ok: true } };
const row = (adapterId, score, price) => ({ adapterId, modelId: `${adapterId}-${score}`, intelligenceIndex: score, codingIndex: score, priceInputPerMTok: price, priceOutputPerMTok: price, accessMode: "automatic" });
const capabilities = role => ({ [role]: { required: ["reasoning"] } });
const builders = {
  quality: (rows, role, options = {}) => buildAiTeam(rows, eligibility, null, capabilities(role), options),
  efficient: (rows, role, options = {}) => buildEfficientTeam(rows, eligibility, null, { ...options, roleCapabilities: capabilities(role) })
};
// Real ProjectProfile fields only (project-profile.js): architecture.pattern, risks[].kind.
const layered = { architecture: { pattern: "Layered or Clean Architecture" }, risks: [] };
const plain = { architecture: { pattern: "To be documented" }, risks: [] };
const noTests = { architecture: { pattern: "To be documented" }, risks: [{ kind: "no-test-command", detail: "x" }] };

test("no profile, empty profile or unknown values yield no adjustment", () => {
  assert.equal(projectDemand(null), null);
  assert.equal(projectDemand(plain), null);
  assert.equal(projectDemand({ architecture: { pattern: "Something new" }, risks: [{ kind: "unheard-of" }] }), null);
  assert.equal(roleDemandFloor("Builder", null), .55);
});

test("S34 a project risk raise lifts the Builder floor back from .55 to .60", () => {
  assert.equal(roleDemandFloor("Builder", null), .55);
  assert.equal(roleDemandFloor("Builder", projectDemand(layered)), .60);
  // The S26 coding-only discount is superseded: capability mix no longer moves the floor.
  assert.equal(roleDemandFloor("Builder", null, ["coding"]), .55);
});

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: layered architecture raises Builder floor and moves the pick off a model that only met the old floor`, () => {
    const rows = [row("codex", 57, .1), row("claude", 70, 2)]; // .57 meets S34 .55, misses raised .60
    assert.equal(build(rows, "Builder")[0].primary.adapterId, "codex");
    const entry = build(rows, "Builder", { projectDemand: projectDemand(layered) })[0];
    assert.equal(entry.primary.adapterId, "claude");
    assert.match(entry.reason, /project architecture.*Layered or Clean Architecture/i);
  });
  test(`${name}: light roles keep the cheap pick under a demanding project profile`, () => {
    const rows = [row("codex", 40, .1), row("claude", 70, 2)];
    const demand = projectDemand({ ...layered, risks: [{ kind: "no-test-command" }, { kind: "env-file-present" }] });
    for (const role of ["Explorer", "Tester"]) {
      const entry = build(rows, role, { projectDemand: demand })[0];
      assert.equal(entry.primary.adapterId, "codex");
      assert.doesNotMatch(entry.reason ?? "", /project/i);
    }
  });
  test(`${name}: a risk signal raises Reviewer's floor and the reason names the risk`, () => {
    const roles = { Builder: { required: ["reasoning"] }, Reviewer: { required: ["reasoning"] } };
    const rows = [row("claude", 80, 2), row("codex", 62, .1)];
    const run = options => name === "quality" ? buildAiTeam(rows, eligibility, null, roles, options)
      : buildEfficientTeam(rows, eligibility, null, { ...options, roleCapabilities: roles });
    const base = run({}).find(e => e.role === "Reviewer");
    const raised = run({ projectDemand: projectDemand(noTests) }).find(e => e.role === "Reviewer");
    assert.match(raised.reason, /no-test-command/);
    assert.doesNotMatch(base.reason ?? "", /project/i);
    assert.equal(raised.decisionEvidence.requiredFloor ?? roleDemandFloor("Reviewer", projectDemand(noTests)), roleDemandFloor("Reviewer") + PROJECT_FLOOR_RAISE);
  });
  test(`${name}: no profile is byte-identical to today's output`, () => {
    const rows = [row("codex", 62, .1), row("claude", 70, 2)];
    for (const role of ["Architect", "Builder", "Reviewer", "Tester"]) {
      assert.deepEqual(build(rows, role, { projectDemand: null }), build(rows, role));
      assert.deepEqual(build(rows, role, { projectDemand: projectDemand(plain) }), build(rows, role));
    }
  });
}

test("buildProjectStrategy applies the project profile to the PROJECT team only", () => {
  const rows = [row("codex", 57, .1), row("claude", 70, 2)]; // .57 meets S34 .55, misses raised .60
  const roleRequirements = [{ role: "Builder", capabilities: ["reasoning"], reason: "" }];
  const candidates = { scoredAll: rows, eligibility, registry: null, providerCapacity: null };
  const analyst = { model: { adapterId: "claude", modelId: "claude-70" } };
  const base = buildProjectStrategy({ fingerprint: "f", roleRequirements, ...plain }, candidates, analyst);
  const raised = buildProjectStrategy({ fingerprint: "f", roleRequirements, ...layered }, candidates, analyst);
  assert.equal(base.projectTeam[0].model.adapterId, "codex");
  assert.equal(raised.projectTeam[0].model.adapterId, "claude");
  assert.match(raised.projectTeam[0].reason, /project architecture/i);
  const noProfileFields = buildProjectStrategy({ fingerprint: "f", roleRequirements }, candidates, analyst);
  assert.deepEqual(noProfileFields.projectTeam, base.projectTeam);
});

// ---- S35 / C18: assessment-driven demand ----
import { verifyDemandAssessment } from "../src/global/conversation/project-analysis.js";
const cite = (level, ...evidence) => ({ level, evidence });
const FILES = ["README.md", "src/engine.js"];
const assess = categories => verifyDemandAssessment({ productPurpose: "p (README.md)", riskCategories: categories }, FILES);
const emma = assess({ actionsAndSecurity: cite(5, "README.md"), aiIntegration: cite(5, "src/engine.js"), money: cite(1, "README.md"), personalData: cite(3, "README.md"), realtimeConcurrency: cite(2, "README.md"), domainComplexity: cite(4, "README.md") });
const landing = assess({ actionsAndSecurity: cite(1, "README.md"), money: cite(1, "README.md"), personalData: cite(1, "README.md"), realtimeConcurrency: cite(1, "README.md"), aiIntegration: cite(1, "README.md"), domainComplexity: cite(3, "README.md") });
const toolingRich = { architecture: { pattern: "Layered or Clean Architecture" }, risks: [{ kind: "env-file-present" }, { kind: "no-test-command" }] };

test("S35 Emma-shaped assessment raises Architect/Reviewer/Debugger above a landing-page assessment even with layered tooling", () => {
  const emmaDemand = projectDemand({ ...plain, demandAssessment: emma });
  const landingDemand = projectDemand({ ...toolingRich, demandAssessment: landing });
  assert.equal(roleDemandFloor("Architect", emmaDemand), .65);
  assert.equal(roleDemandFloor("Reviewer", emmaDemand), .65);
  assert.equal(roleDemandFloor("Debugger", emmaDemand), .65);
  assert.equal(roleDemandFloor("Architect", landingDemand), .60);
  assert.equal(roleDemandFloor("Reviewer", landingDemand), .60);
  assert.equal(roleDemandFloor("Builder", landingDemand), .55);
  assert.equal(roleDemandFloor("Builder", emmaDemand), .55); // only demanding roles are raised
  assert.equal(roleDemandFloor("Explorer", emmaDemand), .35);
});

test("S35 a low assessment never raises floors despite lint/tests/layered signals, and records the assessment", () => {
  const demand = projectDemand({ ...toolingRich, demandAssessment: landing });
  assert.deepEqual(demand.floors, {});
  assert.equal(demand.assessment.source, "assessment");
  assert.equal(demand.assessment.demandLevel, "low");
  assert.equal(demand.assessment.levels.domainComplexity, 3);
});

test("S35 high and critical demanding floors are capped at .65 (S39)", () => {
  const high = projectDemand({ ...plain, demandAssessment: assess({ money: cite(4, "README.md") }) });
  assert.equal(high.assessment.demandLevel, "high");
  assert.equal(roleDemandFloor("Reviewer", high), .65);
  const critical = projectDemand({ ...plain, demandAssessment: assess({ money: cite(5, "README.md") }) });
  assert.equal(critical.assessment.demandLevel, "critical");
  assert.equal(roleDemandFloor("Reviewer", critical), .65);
  for (const role of ["Architect", "Reviewer", "Debugger"]) assert.ok(critical.floors[role] <= .65);
  const meanOnly = projectDemand({ ...plain, demandAssessment: assess({ money: cite(3, "README.md"), personalData: cite(3, "README.md"), domainComplexity: cite(4, "README.md"), aiIntegration: cite(4, "README.md") }) });
  assert.equal(meanOnly.assessment.demandLevel, "high");
});

test("S35 a category without verified evidence is capped at 2 and cannot raise floors", () => {
  const demand = projectDemand({ ...plain, demandAssessment: assess({ actionsAndSecurity: cite(5, "src/missing.js"), aiIntegration: cite(5) }) });
  assert.equal(demand.assessment.demandLevel, "low");
  assert.equal(demand.assessment.levels.actionsAndSecurity, 2);
  assert.equal(demand.assessment.claimedLevels.actionsAndSecurity, 5);
  assert.equal(roleDemandFloor("Architect", demand), .60);
});

test("S35 reasons name the assessment, the verified levels and the Reviewer security emphasis", () => {
  const demand = projectDemand({ ...plain, demandAssessment: emma });
  assert.match(demand.reasons.Architect, /Raised demand floor 0\.6 to 0\.65/);
  assert.match(demand.reasons.Architect, /critical/);
  assert.match(demand.reasons.Architect, /actionsAndSecurity 5/);
  assert.match(demand.reasons.Reviewer, /security emphasis/i);
  assert.doesNotMatch(demand.reasons.Architect, /security emphasis/i);
  assert.deepEqual(demand.assessment.raises.Reviewer, { from: .6, to: .65 });
});

test("S35 without a valid assessment (offline/v1) the mechanical raise remains the fallback", () => {
  const demand = projectDemand({ ...layered, demandAssessment: null });
  assert.equal(roleDemandFloor("Architect", demand), .65);
  assert.equal(demand.assessment ?? null, null);
  assert.equal(projectDemand({ ...plain, demandAssessment: null }), null);
});

test("S35 buildProjectStrategy records the assessment evidence and the raised Reviewer reason", () => {
  const rows = [{ ...row("claude", 80, 2), slug: "c", provider: "anthropic" }, row("codex", 62, .1)];
  const profile = { ...plain, demandAssessment: emma, fingerprint: "f", roleRequirements: [{ role: "Reviewer", capabilities: ["reasoning"], reason: "r" }, { role: "Architect", capabilities: ["reasoning"], reason: "a" }] };
  const strategy = buildProjectStrategy(profile, { scoredAll: rows, eligibility, registry: null }, { model: rows[0], choice: "quality" });
  assert.equal(strategy.demandAssessment.demandLevel, "critical");
  assert.equal(strategy.demandAssessment.levels.actionsAndSecurity, 5);
  assert.deepEqual(strategy.demandAssessment.raises.Architect, { from: .6, to: .65 });
  assert.match(strategy.projectTeam.find(e => e.role === "Reviewer").reason, /security emphasis/i);
  const mechanical = buildProjectStrategy({ ...profile, demandAssessment: null, architecture: layered.architecture }, { scoredAll: rows, eligibility, registry: null }, { model: rows[0], choice: "quality" });
  assert.equal(mechanical.demandAssessment, null);
});
