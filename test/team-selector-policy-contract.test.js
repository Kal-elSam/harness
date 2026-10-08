import test from "node:test";
import assert from "node:assert/strict";
import { EFFICIENT_CAPABILITY_FLOOR, buildAiTeam, buildEfficientTeam, scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";

// Contract tests for the team selector's QUALITY-vs-EFFICIENT policy.
// Every model below is SYNTHETIC ("synth-*"): scores are invented purely to
// place candidates at known positions relative to the policy's own band and
// floor. They are not benchmarks of any real model and must not be read as
// such. No policy threshold is modified here; the tests only pin behavior
// the existing policy already documents (see assignOneRole in
// model-intelligence.js).

const AA_SYNTHETIC = [
  { slug: "synth-lead", name: "Synth Lead", intelligenceIndex: 60, codingIndex: 80, mathIndex: null, priceInputPerMTok: 10, priceOutputPerMTok: 40 },
  // Clearly behind the leader (outside every role's narrow near-equivalence
  // band) yet well above the EFFICIENT floor, and much cheaper.
  { slug: "synth-mid", name: "Synth Mid", intelligenceIndex: 54, codingIndex: 72, mathIndex: null, priceInputPerMTok: 1, priceOutputPerMTok: 4 }
];
const ROLES = {
  Explorer: { required: ["reasoning"], optional: [] },
  Architect: { required: ["reasoning", "coding"], optional: [] },
  Reviewer: { required: ["reasoning", "coding"], optional: [] }
};
const ELIGIBLE = { codex: { ok: true }, claude: { ok: true } };

function pool() {
  return scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "synth-lead" }] },
    { adapterId: "claude", models: [{ id: "synth-mid" }] }
  ], AA_SYNTHETIC);
}
const pick = (team, role) => team.find((entry) => entry.role === role).primary;

test("QUALITY repeats the leader up to the per-model cap, then widens to a floor-adequate alternative", () => {
  const team = buildAiTeam(pool(), ELIGIBLE, null, ROLES);
  const used = ["Explorer", "Architect", "Reviewer"].map((role) => pick(team, role).modelId);
  // Per-model cap is 2: the leader cannot take all three roles while an
  // adequate alternative exists, and the exception must be the widened search.
  assert.equal(used.filter((id) => id === "synth-lead").length, 2);
  assert.equal(used.filter((id) => id === "synth-mid").length, 1);
  const widened = team.find((entry) => entry.primary.modelId === "synth-mid");
  assert.match(widened.reason, /widened the search|different model\/provider/);
});

test("EFFICIENT admits a candidate QUALITY's narrow band excludes, when it clears the floor", () => {
  const efficient = buildEfficientTeam(pool(), ELIGIBLE, null, { roleCapabilities: ROLES });
  const mid = efficient.filter((entry) => entry.primary.modelId === "synth-mid");
  assert.ok(mid.length >= 1, "a floor-adequate cheaper candidate must be reachable by EFFICIENT");
  for (const entry of mid) {
    assert.match(entry.reason, /Retains ~\d+% of QUALITY/);
    const retained = Number(/~(\d+)%/.exec(entry.reason)[1]) / 100;
    assert.ok(retained >= EFFICIENT_CAPABILITY_FLOOR, `retention ${retained} must clear the floor`);
  }
});

test("a repeat beyond the cap is only allowed when no candidate respects the limits (labelled exception)", () => {
  const solo = scoreAvailableModels([{ adapterId: "codex", models: [{ id: "synth-lead" }] }], AA_SYNTHETIC);
  const team = buildAiTeam(solo, { codex: { ok: true } }, null, ROLES);
  const repeats = team.filter((entry) => entry.primary.modelId === "synth-lead");
  assert.equal(repeats.length, 3);
  // Beyond the cap with no alternative anywhere: must be labelled, never silent.
  assert.ok(repeats.some((entry) => /Only adequate option|Decisive real capability advantage/.test(entry.reason ?? "")));
});
