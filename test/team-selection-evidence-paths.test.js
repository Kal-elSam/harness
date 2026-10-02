/**
 * Selection evidence on the non-happy paths of the team selector: no eligible
 * provider, unavailable leader, widened search, exceptional repeats and
 * Builder/Reviewer independence.
 *
 * Every model below is SYNTHETIC ("synth-*"). Scores are invented only to
 * place candidates at known positions relative to the policy's own band and
 * floor; they are NOT benchmarks of any real model and must not be read as
 * such. No policy threshold is modified or re-derived here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam, scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";

const aa = (slug, intelligenceIndex, codingIndex) => ({
  slug, name: slug, intelligenceIndex, codingIndex, mathIndex: null, priceInputPerMTok: 10, priceOutputPerMTok: 40
});
// synth-lead vs synth-mid: clearly outside the narrow band, well above the floor.
const AA_GAP = [aa("synth-lead", 60, 80), aa("synth-mid", 54, 72)];
// synth-a vs synth-b: ~1% apart, i.e. inside every role's narrow band.
const AA_NEAR = [aa("synth-a", 60, 80), aa("synth-b", 59, 79)];

const REQ = { required: ["reasoning", "coding"], optional: [] };
const rolesOf = (...names) => Object.fromEntries(names.map((name) => [name, REQ]));
const ok = (...adapters) => Object.fromEntries(adapters.map((id) => [id, { ok: true }]));
const catalogs = (spec) => Object.entries(spec).map(([adapterId, ids]) => ({ adapterId, models: ids.map((id) => ({ id })) }));
const teams = (models, eligibility, roles) => ({
  quality: buildAiTeam(models, eligibility, null, roles),
  efficient: buildEfficientTeam(models, eligibility, null, { roleCapabilities: roles })
});
const entryOf = (team, role) => team.find((entry) => entry.role === role);

test("no eligible provider: QUALITY and EFFICIENT entries carry a no-eligible-provider selection", () => {
  const models = scoreAvailableModels(catalogs({ codex: ["synth-lead"], claude: ["synth-mid"] }), AA_GAP);
  const eligibility = { codex: { ok: false, reason: "quota" }, claude: { ok: false, reason: "quota" } };
  const { quality, efficient } = teams(models, eligibility, rolesOf("Explorer", "Architect", "Reviewer"));
  for (const team of [quality, efficient]) {
    assert.equal(team.length, 3);
    for (const entry of team) {
      assert.equal(entry.reason, "No eligible provider currently covers this role.");
      assert.deepEqual(entry.selection, { reasonKind: "no-eligible-provider", poolSize: 0, evaluated: [] });
    }
  }
});

test("leader temporarily unavailable: selection is present with the eligible candidates evaluated", () => {
  const models = scoreAvailableModels(catalogs({ codex: ["synth-lead"], claude: ["synth-mid"] }), AA_GAP);
  const eligibility = { codex: { ok: false, reason: "quota" }, claude: { ok: true } };
  const { quality, efficient } = teams(models, eligibility, rolesOf("Explorer", "Architect"));
  for (const team of [quality, efficient]) {
    for (const entry of team) {
      assert.match(entry.reason, /temporarily unavailable \(quota\)/);
      assert.equal(entry.primary.modelId, "synth-lead");
      assert.equal(entry.fallback.modelId, "synth-mid");
      assert.ok(entry.selection, `${entry.role} has selection`);
      // Only ELIGIBLE candidates are evaluated: the unavailable leader is the
      // displayed primary but was never a selectable candidate.
      assert.deepEqual(entry.selection.evaluated.map((row) => row.modelId), ["synth-mid"]);
      assert.equal(entry.selection.evaluated[0].blockedBy, null);
    }
  }
});

test("widened search: no concentration-safe candidate in the band, a floor-adequate one outside it is chosen", () => {
  const models = scoreAvailableModels(catalogs({ codex: ["synth-lead"], claude: ["synth-mid"] }), AA_GAP);
  const { quality } = teams(models, ok("codex", "claude"), rolesOf("Explorer", "Architect", "Reviewer"));
  // Per-model cap is 2: the third role cannot take synth-lead.
  const widened = quality.find((entry) => entry.selection.reasonKind === "wider-search-diversity");
  assert.ok(widened, "one role was widened");
  assert.equal(widened.primary.modelId, "synth-mid");
  const lead = widened.selection.evaluated.find((row) => row.modelId === "synth-lead");
  const mid = widened.selection.evaluated.find((row) => row.modelId === "synth-mid");
  assert.deepEqual({ inBand: lead.inBand, blockedBy: lead.blockedBy }, { inBand: true, blockedBy: "model_cap" });
  assert.deepEqual({ inBand: mid.inBand, blockedBy: mid.blockedBy }, { inBand: false, blockedBy: null });
  for (const row of widened.selection.evaluated.filter((r) => r.inBand)) assert.notEqual(row.blockedBy, null);
});

test("exceptional repeat (QUALITY decisive-override): sole candidate repeated past the cap, every evaluated row blocked", () => {
  const models = scoreAvailableModels(catalogs({ codex: ["synth-a"] }), AA_NEAR);
  const { quality } = teams(models, ok("codex"), rolesOf("Explorer", "Architect", "Debugger"));
  const repeat = quality.filter((entry) => entry.selection.reasonKind === "decisive-override");
  assert.equal(repeat.length, 1);
  assert.equal(repeat[0].role, "Debugger");
  assert.match(repeat[0].reason, /Decisive real capability advantage/);
  assert.equal(repeat[0].selection.evaluated.length >= 1, true);
  for (const row of repeat[0].selection.evaluated) assert.equal(row.blockedBy, "model_cap");
  // The two roles before the cap was reached are not exceptions.
  for (const entry of quality.filter((e) => e !== repeat[0])) assert.equal(entry.selection.reasonKind, null);
});

test("exceptional repeat (only-adequate-concentration): near-equal pair exhausts both caps, every row blocked", () => {
  // Two near-equal candidates: each can serve at most 2 roles, so a 5th
  // technical role finds both blocked and the leader is not decisive.
  const models = scoreAvailableModels(catalogs({ codex: ["synth-a"], claude: ["synth-b"] }), AA_NEAR);
  const roles = rolesOf("Explorer", "Architect", "Debugger", "Tester", "Builder");
  const { quality, efficient } = teams(models, ok("codex", "claude"), roles);
  for (const team of [quality, efficient]) {
    const repeat = team.filter((entry) => entry.selection.reasonKind === "only-adequate-concentration");
    assert.equal(repeat.length, 1, "exactly one role is the exceptional repeat");
    assert.match(repeat[0].reason, /Only adequate option/);
    assert.ok(repeat[0].selection.evaluated.length >= 2);
    for (const row of repeat[0].selection.evaluated) {
      assert.ok(["model_cap", "provider_cap"].includes(row.blockedBy), `row blocked: ${row.blockedBy}`);
    }
  }
});

test("Reviewer independence: the Reviewer's best candidate shares Builder's adapter and is blocked; a different adapter is chosen", () => {
  const models = scoreAvailableModels(catalogs({ codex: ["synth-a"], claude: ["synth-b"] }), AA_NEAR);
  const { quality, efficient } = teams(models, ok("codex", "claude"), rolesOf("Builder", "Reviewer"));
  for (const team of [quality, efficient]) {
    const builder = entryOf(team, "Builder");
    const reviewer = entryOf(team, "Reviewer");
    assert.equal(builder.primary.adapterId, "codex");
    assert.equal(reviewer.primary.adapterId, "claude");
    assert.equal(reviewer.selection.reasonKind, "diversity");
    const sameAdapter = reviewer.selection.evaluated.find((row) => row.adapterId === "codex");
    const other = reviewer.selection.evaluated.find((row) => row.adapterId === "claude");
    assert.equal(sameAdapter.blockedBy, "reviewer_independence");
    assert.equal(other.blockedBy, null);
    // Builder itself has no independence constraint.
    assert.ok(builder.selection.evaluated.every((row) => row.blockedBy === null));
  }
});

test("Reviewer independence with no alternative: the repeat on Builder's adapter is labelled and every row blocked", () => {
  const models = scoreAvailableModels(catalogs({ codex: ["synth-a"] }), AA_NEAR);
  const { quality, efficient } = teams(models, ok("codex"), rolesOf("Builder", "Reviewer"));
  const q = entryOf(quality, "Reviewer");
  assert.equal(q.selection.reasonKind, "decisive-override");
  assert.match(q.reason, /Decisive real capability advantage/);
  const e = entryOf(efficient, "Reviewer");
  assert.equal(e.selection.reasonKind, "only-adequate-concentration");
  assert.match(e.reason, /Only adequate option/);
  for (const reviewer of [q, e]) {
    assert.deepEqual(reviewer.selection.evaluated.map((row) => row.blockedBy), ["reviewer_independence"]);
    assert.equal(reviewer.primary.adapterId, "codex");
  }
});
