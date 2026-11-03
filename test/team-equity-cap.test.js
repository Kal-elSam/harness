// Synthetic fixtures: no real prices or capabilities are asserted.
import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectStrategy } from "../src/global/team/project-strategy.js";
import { resolveProjectRoute } from "../src/global/team/project-router.js";

const eligibility = { codex: { ok: true }, claude: { ok: true } };
const roleIds = Array.from({ length: 13 }, (_, i) => `Role${i + 1}`);
const profile = { fingerprint: "synthetic", roleRequirements: roleIds.map(role => ({ role, capabilities: ["reasoning"] })) };
const analyst = { model: { adapterId: "codex", modelId: "m1" }, selectionSource: "manual" };
// quality[i] is model i's score; a weak model is available but clears no floor.
const fleet = quality => quality.map((score, i) => ({
  adapterId: i % 2 ? "claude" : "codex", modelId: `m${i + 1}`, displayName: `m${i + 1}`,
  intelligenceIndex: score, codingIndex: score
}));
const strategyFor = (quality, options = {}) => buildProjectStrategy(profile, { scoredAll: fleet(quality), eligibility, ...options }, analyst);
const usage = team => {
  const counts = {};
  for (const entry of team) counts[entry.model.modelId] = (counts[entry.model.modelId] ?? 0) + 1;
  return counts;
};
const capOf = team => Math.max(...team.map(entry => entry.selection?.modelRoleCap ?? 2));
const STRONG = 100;
const WEAK = 40;

test("13 roles over 8 available models: no model holds more than 2 roles, cap 2", () => {
  const strategy = strategyFor([STRONG, STRONG, STRONG, STRONG, STRONG, STRONG, STRONG, WEAK]);
  assert.equal(strategy.projectTeam.length, 13);
  assert.ok(Math.max(...Object.values(usage(strategy.projectTeam))) <= 2, JSON.stringify(usage(strategy.projectTeam)));
  assert.equal(capOf(strategy.qualityTeam), 2);
});

test("the cap follows the available models, not the models that clear the floors", () => {
  // Only 5 of 8 models clear the floor; the old rule derived cap 3 from those 5.
  const strategy = strategyFor([STRONG, STRONG, STRONG, STRONG, STRONG, WEAK, WEAK, WEAK]);
  assert.equal(capOf(strategy.qualityTeam), 2);
  assert.equal(capOf(strategy.efficientTeam), 2);
});

test("more available models lower the cap", () => {
  assert.equal(capOf(strategyFor(Array(8).fill(STRONG)).qualityTeam), 2);
  assert.equal(capOf(strategyFor(Array(13).fill(STRONG)).qualityTeam), 1);
  assert.equal(Math.max(...Object.values(usage(strategyFor(Array(13).fill(STRONG)).projectTeam))), 1);
});

test("the role floor wins: when every floor-clearing model is at the cap the role exceeds it with the only-adequate reason", () => {
  const strategy = strategyFor([STRONG, STRONG, STRONG, WEAK, WEAK, WEAK, WEAK, WEAK]);
  const counts = usage(strategy.projectTeam);
  assert.deepEqual(Object.keys(counts).sort(), ["m1", "m2", "m3"], "a weak model never takes a role to respect the cap");
  assert.ok(Math.max(...Object.values(counts)) > 2);
  const overflow = strategy.qualityTeam.filter(entry => /overflow|exceed/i.test(entry.selection?.capReason ?? ""));
  assert.ok(overflow.length >= 5, "roles beyond the cap record why");
  assert.ok(overflow.every(entry => /only adequate/i.test(entry.selection.capReason)));
});

test("analyze, rebuild and automatic re-form use the same cap (one formation path)", () => {
  const first = strategyFor([STRONG, STRONG, STRONG, STRONG, STRONG, WEAK, WEAK, WEAK]);
  const rebuilt = strategyFor([STRONG, STRONG, STRONG, STRONG, STRONG, WEAK, WEAK, WEAK], { teamShape: true });
  assert.equal(capOf(first.qualityTeam), capOf(rebuilt.qualityTeam));
  assert.equal(capOf(first.efficientTeam), capOf(rebuilt.efficientTeam));
  assert.deepEqual(usage(first.projectTeam), usage(rebuilt.projectTeam));
});

// Per-launch distribution
const NOW = Date.parse("2026-10-22T12:00:00Z");
const ref = (adapterId, modelId) => ({ candidateKey: `${adapterId}::${modelId}`, adapterId, modelId, displayName: modelId, accessMode: "automatic", utility: 1 });
const pool = [ref("codex", "gpt-a"), ref("codex", "gpt-b"), ref("claude", "son-a"), ref("claude", "son-b")];
const team = [
  { role: "Builder", model: pool[2], assignmentSource: "recommended" },
  { role: "Test Runner", model: pool[3], assignmentSource: "recommended" },
  { role: "Planner", model: pool[1], assignmentSource: "recommended" }
];
const routeInputs = { strategy: { status: "active", profileFingerprint: "fp", projectTeam: team }, pool, ledger: [], now: NOW,
  eligibility: { codex: { ok: true }, claude: { ok: true } }, providerCapacity: { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 50 } } };

test("a tie on an empty ledger routes each role to its approved model", () => {
  for (const entry of team) {
    const route = resolveProjectRoute({ ...routeInputs, role: entry.role });
    assert.equal(route.decision, "ROUTED");
    assert.equal(route.model.modelId, entry.model.modelId, entry.role);
  }
});

test("admission still rejects an unaffordable approved model and picks an admitted peer", () => {
  const route = resolveProjectRoute({ ...routeInputs, role: "Builder",
    providerCapacity: { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 0 } } });
  assert.equal(route.decision, "ROUTED");
  assert.equal(route.provider, "codex");
});

test("admission runs before the tie rule: an unaffordable approved model is replaced by an admitted peer", () => {
  const reset = NOW + 3600000;
  const windows = pct => [{ kind: "5h", remainingPercent: pct, resetsAt: reset }, { kind: "weekly", remainingPercent: 80, resetsAt: NOW + 5 * 86400000 }];
  const route = resolveProjectRoute({ ...routeInputs, role: "Planner",
    eligibility: { codex: { ok: false, cause: "quota_reserve", reason: "quota reserve", limit: { resetsAt: new Date(reset).toISOString() } }, claude: { ok: true } },
    providerCapacity: { codex: { quotaRemainingPercent: 3, quotaWindows: windows(3) }, claude: { quotaRemainingPercent: 80, quotaWindows: windows(80) } },
    samples: [{ provider: "claude", window: "5h", timestamp: NOW - 1000, remainingPercent: 80, resetsAt: reset }] });
  assert.equal(route.decision, "ROUTED");
  assert.equal(route.provider, "claude");
  assert.ok(route.admission.candidates.some(row => row.provider === "codex" && row.admitted === false));
});

test("the same model id on two providers counts as two available models for the cap", () => {
  const twin = Array.from({ length: 8 }, (_, i) => ({
    adapterId: i < 4 ? "codex" : "claude", modelId: `twin${(i % 4) + 1}`, displayName: `twin${(i % 4) + 1}`,
    intelligenceIndex: STRONG, codingIndex: STRONG
  }));
  const strategy = buildProjectStrategy(profile, { scoredAll: twin, eligibility }, analyst);
  assert.equal(capOf(strategy.qualityTeam), 2, "8 provider-specific models, 13 roles: ceil(13 / 8)");
});

test("overflow goes to the floor-clearing model with the fewest roles, never to the top-ranked one", () => {
  // Two floor-clearing models for every demanding role plus six weak ones, cap 2.
  const strategy = strategyFor([STRONG, STRONG, WEAK, WEAK, WEAK, WEAK, WEAK, WEAK]);
  const counts = usage(strategy.projectTeam);
  assert.ok(Math.abs(counts.m1 - counts.m2) <= 1, `strong models stay balanced: ${JSON.stringify(counts)}`);
  const overflow = strategy.qualityTeam.filter(entry => /exceeded/i.test(entry.selection?.capReason ?? ""));
  assert.ok(overflow.every(entry => /only adequate/i.test(entry.selection.capReason)));
});
