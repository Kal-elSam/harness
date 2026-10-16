import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam } from "../src/global/intelligence/model-intelligence.js";
import { INCOMPLETE_EVIDENCE_PENALTY } from "../src/global/intelligence/role-demand.js";

// S20: a model missing a required signal competes on the signals it has, with an explicit penalty.
const eligibility = { claude: { ok: true }, codex: { ok: true } };
const row = (adapterId, modelId, intelligenceIndex, codingIndex, price = 1) => ({ adapterId, modelId, intelligenceIndex, codingIndex, priceInputPerMTok: price, priceOutputPerMTok: price, accessMode: "automatic" });
const roles = { Architect: { required: ["reasoning", "coding"] } };
const builders = {
  quality: rows => buildAiTeam(rows, eligibility, null, roles),
  efficient: rows => buildEfficientTeam(rows, eligibility, null, { roleCapabilities: roles })
};
const evaluated = (entry, modelId) => entry.selection.evaluated.find(candidate => candidate.modelId === modelId);

test("penalty is a positive documented constant", () => {
  assert.ok(INCOMPLETE_EVIDENCE_PENALTY > 0 && INCOMPLETE_EVIDENCE_PENALTY <= .2);
});

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: a model missing one required signal enters the pool with a lower score than an equal fully-evidenced model`, () => {
    const entry = build([row("claude", "partial", 70, null), row("codex", "full", 70, 70), row("codex", "full2", 50, 50)])[0];
    assert.equal(entry.primary.modelId, "full");
    const partial = evaluated(entry, "partial");
    assert.ok(partial, "partial-evidence model competes");
    assert.ok(partial.gapValue < evaluated(entry, "full").gapValue);
    assert.ok(Math.abs(evaluated(entry, "full").gapValue - partial.gapValue - INCOMPLETE_EVIDENCE_PENALTY / 2) < 1e-9);
  });
  test(`${name}: a model with none of the required signals stays excluded`, () => {
    const entry = build([row("claude", "none", null, null), row("codex", "full", 70, 70), row("codex", "full2", 50, 50)])[0];
    assert.equal(evaluated(entry, "none"), undefined);
    assert.equal(entry.primary.modelId, "full");
  });
  test(`${name}: the penalized score is what the floor judges`, () => {
    // 64 reasoning only: .64 - .05 = .59 < .60 floor, so the full-evidence .61 wins.
    const entry = build([row("claude", "partial", 64, null), row("codex", "full", 61, 61, 5), row("codex", "full2", 50, 50)])[0];
    assert.equal(entry.primary.modelId, "full");
  });
  test(`${name}: the reason names the missing signal and the penalty`, () => {
    const entry = build([row("claude", "partial", 70, null), row("codex", "weak", 40, 40), row("codex", "weak2", 30, 30)])[0];
    assert.equal(entry.primary.modelId, "partial");
    assert.match(entry.reason, /missing coding evidence, scored on reasoning only with -0\.05 penalty/i);
  });
}
