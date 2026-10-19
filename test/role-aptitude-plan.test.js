import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAptitudePlan, DEFAULT_APTITUDE_TOKENS_PER_CALL } from "../src/global/intelligence/role-aptitude-plan.js";

const model = (adapterId, modelId, cost) => ({ adapterId, modelId, costPerTask: cost, priceInputPerMTok: 1, priceOutputPerMTok: 5 });
const candidates = [model("claude", "strong", 10), model("codex", "cheap", 1), model("claude", "small", 2), model("codex", "near", 4), model("codex", "weak", 5)];
const probes = [{ role: "Builder", probeId: "one" }, { role: "Builder", probeId: "two" }];
const capabilityByRole = { Builder: new Map([["codex::cheap", .6], ["claude::small", .59], ["codex::near", .61], ["codex::weak", .3], ["claude::strong", .9]]) };
const args = { probes, candidates, capabilityByRole };

test("team provider allowlist excludes other providers from candidates, stages and totals", () => {
  const extra = [model("opencode-go", "cheap-other", .01), model("opencode-go", "near-other", .02)];
  const expanded = { ...args, candidates: [...candidates, ...extra], capabilityByRole: {
    Builder: new Map([...capabilityByRole.Builder, ["opencode-go::cheap-other", .6], ["opencode-go::near-other", .61]])
  } };
  assert.deepEqual(buildAptitudePlan(expanded), buildAptitudePlan(args));
  const custom = buildAptitudePlan({ ...expanded, teamProviders: ["opencode-go"] });
  assert.deepEqual(custom.roles[0].candidates.map(m => m.modelId), ["cheap-other", "near-other"]);
  assert.deepEqual(custom.roles[0].stage1.map(m => m.modelId), ["cheap-other"]);
  assert.deepEqual(custom.roles[0].stage2.map(e => e.model.modelId), ["near-other"]);
  assert.equal(custom.totals.calls, 4);
  const empty = buildAptitudePlan({ ...expanded, teamProviders: [] });
  assert.deepEqual(empty.roles[0].candidates, []);
  assert.deepEqual(empty.roles[0].stage1, []);
  assert.deepEqual(empty.roles[0].stage2, []);
  assert.deepEqual(empty.roles[0].estimate, {});
  assert.deepEqual(empty.totals, { calls: 0, tokens: 0, usd: 0 });
});

test("cheap-first per-provider stage 1; stage 2 only competitive or strongest fallback", () => {
  const plan = buildAptitudePlan(args);
  assert.deepEqual(plan.roles[0].stage1.map(m => m.modelId), ["cheap", "small"]);
  assert.deepEqual(plan.roles[0].stage2.map(e => [e.model.modelId, e.reason]), [["near", "within-near-equivalence-band"], ["strong", "fallback-if-stage1-fails"]]);
  assert.match(plan.stage2Policy, /new authorization/);
  const paced = buildAptitudePlan({ ...args, providerCapacity: { codex: { quotaRemainingPercent: 10, quotaPaceFactor: .1 } } });
  assert.equal(paced.roles[0].stage1[0].modelId, "small");
});

test("measured role costs and tokens, conservative AA estimates and totals", () => {
  const roleTelemetry = { roles: { Builder: new Map([["codex::cheap", { runs: 5, medianCostUsd: .1, medianTokens: 1000 }]]) } };
  const plan = buildAptitudePlan({ ...args, roleTelemetry });
  const estimates = Object.values(plan.roles[0].estimate);
  assert.equal(plan.roles[0].estimate["codex::cheap"].tokenSource, "measured");
  assert.equal(plan.roles[0].estimate["codex::cheap"].tokens, 2000);
  assert.equal(plan.roles[0].estimate["codex::cheap"].usd, .01);
  assert.equal(plan.roles[0].estimate["claude::small"].tokenSource, "default");
  assert.equal(plan.roles[0].estimate["claude::small"].tokens, 2 * DEFAULT_APTITUDE_TOKENS_PER_CALL);
  assert.match(plan.roles[0].estimate["codex::cheap"].priceAssumption, /output/);
  assert.equal(plan.totals.calls, 8);
  assert.equal(plan.totals.tokens, estimates.reduce((n, e) => n + e.tokens, 0));
  assert.equal(plan.totals.usd, estimates.reduce((n, e) => n + e.usd, 0));
});

test("paced headroom, empty plan, unknown prices and missing capability", () => {
  const plan = buildAptitudePlan({ ...args, providerCapacity: { claude: { quotaRemainingPercent: 90, quotaPaceFactor: .5 }, codex: { quotaRemainingPercent: 60, quotaPaceFactor: 2 } } });
  assert.equal(plan.headroomProvider, "codex");
  assert.equal(buildAptitudePlan({}).totals.calls, 0);
  assert.equal(buildAptitudePlan({}).headroomProvider, null);
  const unknown = buildAptitudePlan({ probes, candidates: [{ adapterId: "codex", modelId: "unknown" }] });
  assert.equal(unknown.totals.usd, null);
  assert.deepEqual(unknown.roles[0].stage2, []);
});

test("planner has no IO and never mutates supplied data", () => {
  const before = structuredClone(args);
  assert.deepEqual(buildAptitudePlan(args), buildAptitudePlan(args));
  assert.deepEqual(args, before);
  const source = readFileSync(new URL("../src/global/intelligence/role-aptitude-plan.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:|fetch\(|process\.|role-aptitude-runner|writeFile|readFile/);
});

test("roles filter keeps only chosen roles and totals reflect it; omitted keeps previous output", () => {
  const two = [...probes, { role: "Explorer", probeId: "e1" }];
  const full = buildAptitudePlan({ ...args, probes: two });
  const filtered = buildAptitudePlan({ ...args, probes: two, roles: ["Explorer"] });
  assert.deepEqual(filtered.roles.map(r => r.role), ["Explorer"]);
  assert.equal(filtered.totals.calls, filtered.roles[0].stage1.length + filtered.roles[0].stage2.length);
  assert.ok(filtered.totals.calls < full.totals.calls);
  assert.deepEqual(buildAptitudePlan({ ...args, probes: two, roles: undefined }), full);
});

test("unknown role names are an error listing valid roles", () => {
  assert.throws(() => buildAptitudePlan({ ...args, roles: ["Builder", "Nope"] }), /Nope.*Builder/s);
});

test("read-only roles are derived from probes without editable paths", async () => {
  const { readOnlyAptitudeRoles } = await import("../src/global/intelligence/role-aptitude-plan.js");
  const { listRoleAptitudeProbes } = await import("../src/global/intelligence/role-aptitude-probes.js");
  const real = listRoleAptitudeProbes();
  const expected = [...new Set(real.map(p => p.role))].filter(role =>
    real.filter(p => p.role === role).every(p => p.editablePaths.length === 0)).sort();
  assert.deepEqual(readOnlyAptitudeRoles(real).sort(), expected);
  assert.deepEqual(expected, ["Architect", "Explorer", "Reviewer"]);
  assert.deepEqual(readOnlyAptitudeRoles([
    { role: "A", editablePaths: [] }, { role: "B", editablePaths: ["x"] },
    { role: "B", editablePaths: [] }, { role: "C", editablePaths: [] }
  ]), ["A", "C"]);
});
