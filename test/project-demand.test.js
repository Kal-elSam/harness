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
  assert.equal(roleDemandFloor("Builder", null), .60);
});

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: layered architecture raises Builder floor and moves the pick off a model that only met the old floor`, () => {
    const rows = [row("codex", 62, .1), row("claude", 70, 2)];
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
  const rows = [row("codex", 62, .1), row("claude", 70, 2)];
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
