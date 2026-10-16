import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam, scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";

// Contract tests for the team selector's QUALITY-vs-EFFICIENT policy.
// Every model below is SYNTHETIC ("synth-*"): scores are invented purely to
// place candidates at known positions relative to absolute per-role demand
// floors. They are not benchmarks of any real model and must not be read as
// such. No policy threshold is modified here; the tests only pin behavior
// the existing policy already documents in role-demand.js.

const AA_SYNTHETIC = [
  { slug: "synth-lead", name: "Synth Lead", intelligenceIndex: 60, codingIndex: 80, mathIndex: null, priceInputPerMTok: 10, priceOutputPerMTok: 40 },
  // Cheaper and qualified for light roles, but below demanding-role floors.
  { slug: "synth-mid", name: "Synth Mid", intelligenceIndex: 54, codingIndex: 64, mathIndex: null, priceInputPerMTok: 1, priceOutputPerMTok: 4 }
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

test("QUALITY uses the cheapest light-role candidate and reserves stronger models for demanding floors", () => {
  const team = buildAiTeam(pool(), ELIGIBLE, null, ROLES);
  assert.equal(pick(team, "Explorer").modelId, "synth-mid");
  assert.equal(pick(team, "Architect").modelId, "synth-lead");
  assert.equal(pick(team, "Reviewer").modelId, "synth-lead");
  assert.match(team.find((entry) => entry.role === "Explorer").reason,
    /Best capability\/cost trade-off for a light role \(capability weight 0\.10, cost weight 0\.90\) among models meeting this role's quality floor/);
  // No concentration pressure with just one role: the cheaper qualified model
  // must still win, rather than entering only after the leader reaches a cap.
  const explorerOnly = buildAiTeam(pool(), ELIGIBLE, null, { Explorer: ROLES.Explorer });
  assert.equal(pick(explorerOnly, "Explorer").modelId, "synth-mid");
});

test("EFFICIENT selects the cheapest qualified candidate within each absolute demand tier", () => {
  // Select each role alone so concentration cannot explain any choice.
  for (const [role, floor, expected] of [
    ["Explorer", .35, "synth-mid"],
    ["Architect", .60, "synth-lead"],
    ["Reviewer", .60, "synth-lead"]
  ]) {
    const efficient = buildEfficientTeam(pool(), ELIGIBLE, null, { roleCapabilities: { [role]: ROLES[role] } });
    assert.equal(pick(efficient, role).modelId, expected);
    assert.equal(efficient[0].decisionEvidence.requiredFloor, floor);
    if (role === "Explorer") {
      assert.match(efficient[0].reason, /^Meets absolute demand floor 0\.35 — Best capability\/cost trade-off for a light role \(capability weight 0\.10/);
    } else {
      assert.match(efficient[0].reason, /Only adequate option — no real alternative clears the capability floor/);
    }
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
