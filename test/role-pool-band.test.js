import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bandFirstPool } from "../src/global/intelligence/price-tier.js";
import { scoreAvailableModels, annotateWithRegistryEvidence } from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { ingestArtificialAnalysisEvidence } from "../src/global/intelligence/model-capability-registry-sources.js";
import { ingestOfficialSnapshotEvidence } from "../src/global/intelligence/official-benchmark-snapshots.js";
import { ROLE_CAPABILITIES } from "../src/global/intelligence/role-profiles.js";
import { qualifiedRolePool } from "../src/global/team/service.js";

const m = (adapterId, modelId, input, output) => ({ adapterId, modelId, priceInputPerMTok: input, priceOutputPerMTok: output });
// Real Codex list prices: Luna light, Sol and Terra standard, Astra demanding.
const luna = m("codex", "gpt-6-luna", .1, .5), sol = m("codex", "gpt-6.1-sol", 2, 10);
const terra = m("codex", "gpt-5.6-terra", 2, 12), astra = m("codex", "gpt-6-astra", 10, 50);
const sonnet = m("claude", "claude-sonnet-5-5", 2, 10), haiku = m("claude", "claude-haiku-5-5", .1, .5), opus = m("claude", "claude-opus-5-5", 4, 20);
const CATALOG = [luna, sol, terra, astra, haiku, sonnet, opus];
const ids = pool => pool.map(row => row.modelId).sort();

test("a standard role keeps the standard Codex band when only Astra clears the floor", () => {
  const rescue = band => band;
  const { pool } = bandFirstPool([astra, sonnet], CATALOG, "standard", rescue);
  assert.deepEqual(ids(pool), ["claude-sonnet-5-5", "gpt-5.6-terra", "gpt-6.1-sol"]);
});

test("floor-qualified members of the band are kept and rescue is not consulted", () => {
  const { pool } = bandFirstPool([sol, astra, sonnet], CATALOG, "standard", () => { throw new Error("no rescue needed"); });
  assert.deepEqual(ids(pool), ["claude-sonnet-5-5", "gpt-6.1-sol"]);
});

test("a demanding role still gets Astra", () => {
  const { pool, note } = bandFirstPool([astra, opus, sol], CATALOG, "demanding", () => []);
  assert.deepEqual(ids(pool), ["claude-opus-5-5", "gpt-6-astra"]);
  assert.equal(note, null);
});

test("a provider with no standard model falls back down to its light band, never up (S6)", () => {
  const catalog = [luna, astra, haiku, sonnet];
  const { pool, note } = bandFirstPool([luna, astra, sonnet], catalog, "standard", () => []);
  // Claude has only haiku (light) and sonnet (demanding) here: it also steps down to haiku, which is not
  // floor-qualified, and the empty rescue yields nothing, so sonnet (demanding) is never taken.
  assert.deepEqual(ids(pool), ["gpt-6-luna"]);
  assert.match(note, /codex has no standard model; using its light band/);
});

test("an empty band after the floor yields to rescue, never to a pricier band", () => {
  const { pool, note } = bandFirstPool([], CATALOG, "standard", band => band.filter(row => row.adapterId === "codex" && row.modelId !== "gpt-5.6-terra"));
  assert.deepEqual(ids(pool), ["gpt-6.1-sol"]);
  assert.equal(note, null);
});

test("light roles keep Luna and Haiku", () => {
  const { pool } = bandFirstPool([luna, haiku, astra], CATALOG, "light", () => []);
  assert.deepEqual(ids(pool), ["claude-haiku-5-5", "gpt-6-luna"]);
});

// End to end through the pool builder `kairo team route` uses.
const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "team-selection-repro-dfd018.json"), "utf8"));
function world() {
  const catalogs = [{ adapterId: "codex", models: fixture.catalogs.codex.models }, { adapterId: "claude", models: fixture.catalogs.claude.models }];
  const registry = createCapabilityRegistry();
  ingestOfficialSnapshotEvidence(registry);
  ingestArtificialAnalysisEvidence(registry, catalogs, fixture.aa.models);
  return { registry, models: annotateWithRegistryEvidence(scoreAvailableModels(catalogs, fixture.aa.models), registry),
    eligibility: { codex: { ok: true }, claude: { ok: true } }, roleCapabilities: ROLE_CAPABILITIES };
}
const codexOf = pool => pool.filter(row => row.adapterId === "codex").map(row => row.modelId).sort();

test("pool builder: demanding Reviewer keeps Astra, standard Planner stays off Astra, light Explorer stays in the cheap band", () => {
  const w = world();
  assert.ok(codexOf(qualifiedRolePool({ role: "Reviewer", ...w }).pool).includes("gpt-6-astra"));
  const planner = qualifiedRolePool({ role: "Planner", ...w });
  assert.ok(!codexOf(planner.pool).includes("gpt-6-astra"));
  assert.ok(codexOf(planner.pool).length >= 1);
  assert.deepEqual(codexOf(qualifiedRolePool({ role: "Explorer", ...w }).pool), ["gpt-5.6-terra"]);
});

test("rescue supplies the band's best models even when the whole band is below the floor", () => {
  const { pool, note } = bandFirstPool([astra, sonnet], CATALOG, "standard", band => band.filter(row => row.adapterId === "codex"));
  assert.deepEqual(ids(pool), ["claude-sonnet-5-5", "gpt-5.6-terra", "gpt-6.1-sol"]);
  assert.equal(note, null);
});

// Synthetic scored world, no registry: Sol and Terra sit far below Astra.
const scored = (id, index, input, output) => ({ adapterId: "codex", modelId: id, accessMode: "automatic",
  intelligenceIndex: index, codingIndex: index, agenticIndex: index, priceInputPerMTok: input, priceOutputPerMTok: output });
const weakStandard = [scored("gpt-6-luna", 10, .1, .5), scored("gpt-6.1-sol", 30, 2, 10), scored("gpt-5.6-terra", 29, 2, 12), scored("gpt-6-astra", 60, 10, 50)];
const poolFor = role => qualifiedRolePool({ role, models: weakStandard, eligibility: { codex: { ok: true } }, registry: null, roleCapabilities: ROLE_CAPABILITIES });

test("pool builder: standard role keeps Sol and Terra below the floor, demanding keeps Astra, light keeps Luna", () => {
  assert.deepEqual(poolFor("Planner").pool.map(row => row.modelId).sort(), ["gpt-5.6-terra", "gpt-6.1-sol"]);
  assert.deepEqual(poolFor("Architect").pool.map(row => row.modelId), ["gpt-6-astra"]);
  assert.deepEqual(poolFor("Explorer").pool.map(row => row.modelId), ["gpt-6-luna"]);
});

test("pool builder: a standard role whose Codex band is entirely unscored still gets Sol or Terra, not Astra", () => {
  const unscored = weakStandard.map(row => ["gpt-6.1-sol", "gpt-5.6-terra"].includes(row.modelId) ? { ...row, evidenceStatus: "unscored" } : row);
  const pool = qualifiedRolePool({ role: "Planner", models: unscored, eligibility: { codex: { ok: true } }, registry: null, roleCapabilities: ROLE_CAPABILITIES }).pool;
  assert.deepEqual(pool.map(row => row.modelId).sort(), ["gpt-5.6-terra", "gpt-6.1-sol"]);
  assert.ok(pool.every(row => row.utility === 0));
});
