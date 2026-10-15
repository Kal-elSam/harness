/**
 * E4 — owned-evidence competition. Offline only; no provider calls.
 * Synthetic evidence must never enable production selection.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompleteCandidateCatalog,
  buildTeamSelectionPool
} from "../src/global/intelligence/model-candidate-catalog.js";
import { buildAiTeam, buildEfficientTeam } from "../src/global/intelligence/model-intelligence.js";
import { createRoleAptitudeEvidenceStore } from "../src/global/intelligence/role-aptitude-evidence.js";
import { currentProbeForRole } from "../src/global/intelligence/role-aptitude-selection.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";

function scored(adapterId, modelId, intelligenceIndex, codingIndex) {
  return {
    adapterId,
    modelId,
    displayName: modelId,
    intelligenceIndex,
    codingIndex,
    mathIndex: null
  };
}

function operationalPass(store, { adapterId, modelId, role, accountKey = "default", cost = null, durationMs = 1000 }) {
  const probe = currentProbeForRole(role);
  assert.ok(probe, `probe for ${role}`);
  store.recordAttempt({
    adapterId,
    modelId,
    accountKey,
    role,
    probeId: probe.probeId,
    probeVersion: probe.probeVersion,
    verdict: "pass",
    origin: "operational",
    executionKind: "real-bridge",
    cost,
    durationMs,
    validatorId: probe.validatorId,
    validatorVersion: probe.validatorVersion
  });
}

test("buildTeamSelectionPool includes entitlement-ok unscored catalog identities", () => {
  const providerCatalogs = [
    { adapterId: "codex", models: [{ id: "gpt-scored", displayName: "Scored" }] },
    { adapterId: "opencode-go", models: [{ id: "glm-unscored", displayName: "Unscored Go" }] }
  ];
  const aa = [{ slug: "gpt-scored", name: "Scored", intelligenceIndex: 50, codingIndex: 50 }];
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aa);
  const scoredAll = [scored("codex", "gpt-scored", 50, 50)];
  const pool = buildTeamSelectionPool(scoredAll, catalog);
  assert.ok(pool.some((m) => m.modelId === "gpt-scored"));
  const unscored = pool.find((m) => m.modelId === "glm-unscored");
  assert.ok(unscored);
  assert.equal(unscored.evidenceStatus, "unscored");
  assert.equal(unscored.intelligenceIndex, null);
});

test("unscored model with operational pass competes on QUALITY owned path", () => {
  const store = createRoleAptitudeEvidenceStore();
  operationalPass(store, { adapterId: "opencode-go", modelId: "glm-unscored", role: "Explorer" });
  const models = [
    scored("codex", "gpt-scored", 80, 80),
    {
      adapterId: "opencode-go",
      modelId: "glm-unscored",
      displayName: "Unscored",
      intelligenceIndex: null,
      codingIndex: null,
      evidenceStatus: "unscored",
      entitlement: ENTITLEMENT.NOT_APPLICABLE,
      accessMode: "automatic"
    }
  ];
  const eligibility = { codex: { ok: true }, "opencode-go": { ok: true } };
  const team = buildAiTeam(models, eligibility, null, undefined, {
    ownedEvidenceStore: store,
    accountKey: "default"
  });
  const explorer = team.find((e) => e.role === "Explorer");
  assert.ok(explorer);
  assert.equal(explorer.primary.modelId, "glm-unscored");
  assert.equal(explorer.decisionEvidence.decisionType, "owned-evidence");
  assert.equal(explorer.decisionEvidence.ownedEvidence.origin, "operational");
  assert.match(explorer.reason, /Evidencia propia operativa/);
});

test("synthetic pass never enables production competition", () => {
  const store = createRoleAptitudeEvidenceStore();
  const probe = currentProbeForRole("Explorer");
  store.recordAttempt({
    adapterId: "opencode-go",
    modelId: "glm-unscored",
    accountKey: "default",
    role: "Explorer",
    probeId: probe.probeId,
    probeVersion: probe.probeVersion,
    verdict: "pass",
    origin: "synthetic",
    executionKind: "synthetic-runner",
    validatorId: probe.validatorId,
    validatorVersion: probe.validatorVersion
  });
  const models = [
    scored("codex", "gpt-scored", 80, 80),
    {
      adapterId: "opencode-go",
      modelId: "glm-unscored",
      intelligenceIndex: null,
      codingIndex: null,
      evidenceStatus: "unscored"
    }
  ];
  const team = buildAiTeam(models, { codex: { ok: true }, "opencode-go": { ok: true } }, null, undefined, {
    ownedEvidenceStore: store
  });
  const explorer = team.find((e) => e.role === "Explorer");
  assert.ok(explorer);
  assert.notEqual(explorer.primary.modelId, "glm-unscored");
  assert.notEqual(explorer.decisionEvidence?.decisionType, "owned-evidence");
});

test("owned evidence is isolated by accountKey and probe version", () => {
  const store = createRoleAptitudeEvidenceStore();
  const probe = currentProbeForRole("Explorer");
  operationalPass(store, {
    adapterId: "codex",
    modelId: "gpt-a",
    role: "Explorer",
    accountKey: "acct-a"
  });
  store.recordAttempt({
    adapterId: "codex",
    modelId: "gpt-b",
    accountKey: "acct-b",
    role: "Explorer",
    probeId: probe.probeId,
    probeVersion: "999",
    verdict: "pass",
    origin: "operational",
    validatorId: probe.validatorId,
    validatorVersion: probe.validatorVersion
  });
  const models = [
    scored("codex", "gpt-a", 40, 70),
    scored("claude", "gpt-b", 90, 90)
  ];
  const eligibility = { codex: { ok: true }, claude: { ok: true } };
  const teamA = buildAiTeam(models, eligibility, null, undefined, {
    ownedEvidenceStore: store,
    accountKey: "acct-a"
  });
  assert.equal(teamA.find((e) => e.role === "Explorer")?.primary.modelId, "gpt-a");

  const teamB = buildAiTeam(models, eligibility, null, undefined, {
    ownedEvidenceStore: store,
    accountKey: "acct-b"
  });
  // gpt-b's pass is on wrong probeVersion — public AA path, stronger model wins
  assert.equal(teamB.find((e) => e.role === "Explorer")?.primary.modelId, "gpt-b");
  assert.notEqual(teamB.find((e) => e.role === "Explorer")?.decisionEvidence?.decisionType, "owned-evidence");
});

test("later operational fail removes competition; later error keeps prior pass", () => {
  const store = createRoleAptitudeEvidenceStore();
  const probe = currentProbeForRole("Tester");
  const models = [
    scored("codex", "gpt-pass", 30, 60),
    scored("claude", "claude-strong", 90, 90)
  ];
  const eligibility = { codex: { ok: true }, claude: { ok: true } };
  operationalPass(store, { adapterId: "codex", modelId: "gpt-pass", role: "Tester" });

  let team = buildAiTeam(models, eligibility, null, undefined, { ownedEvidenceStore: store });
  assert.equal(team.find((e) => e.role === "Tester")?.primary.modelId, "gpt-pass");

  store.recordAttempt({
    adapterId: "codex",
    modelId: "gpt-pass",
    accountKey: "default",
    role: "Tester",
    probeId: probe.probeId,
    probeVersion: probe.probeVersion,
    verdict: "fail",
    origin: "operational",
    validatorId: probe.validatorId,
    validatorVersion: probe.validatorVersion
  });
  team = buildAiTeam(models, eligibility, null, undefined, { ownedEvidenceStore: store });
  assert.notEqual(team.find((e) => e.role === "Tester")?.decisionEvidence?.decisionType, "owned-evidence");

  operationalPass(store, { adapterId: "codex", modelId: "gpt-pass", role: "Tester" });
  store.recordAttempt({
    adapterId: "codex",
    modelId: "gpt-pass",
    accountKey: "default",
    role: "Tester",
    probeId: probe.probeId,
    probeVersion: probe.probeVersion,
    verdict: "error",
    origin: "operational",
    error: "transport",
    validatorId: probe.validatorId,
    validatorVersion: probe.validatorVersion
  });
  team = buildAiTeam(models, eligibility, null, undefined, { ownedEvidenceStore: store });
  assert.equal(team.find((e) => e.role === "Tester")?.primary.modelId, "gpt-pass");
  assert.equal(team.find((e) => e.role === "Tester")?.decisionEvidence?.decisionType, "owned-evidence");
});

test("blocked provider cannot win via owned evidence", () => {
  const store = createRoleAptitudeEvidenceStore();
  operationalPass(store, { adapterId: "codex", modelId: "gpt-blocked", role: "Architect" });
  const models = [
    scored("codex", "gpt-blocked", 10, 10),
    scored("claude", "claude-ok", 70, 70)
  ];
  const team = buildAiTeam(models, {
    codex: { ok: false, reason: "quota" },
    claude: { ok: true }
  }, null, undefined, { ownedEvidenceStore: store });
  const architect = team.find((e) => e.role === "Architect");
  assert.notEqual(architect?.primary.modelId, "gpt-blocked");
});

test("EFFICIENT owned path prefers lower observed cost when comparable", () => {
  const store = createRoleAptitudeEvidenceStore();
  operationalPass(store, {
    adapterId: "codex",
    modelId: "cheap",
    role: "Explorer",
    cost: 0.01,
    durationMs: 5000
  });
  operationalPass(store, {
    adapterId: "claude",
    modelId: "pricey",
    role: "Explorer",
    cost: 0.5,
    durationMs: 100
  });
  const models = [
    scored("codex", "cheap", 50, 50),
    scored("claude", "pricey", 90, 90)
  ];
  const team = buildEfficientTeam(models, {
    codex: { ok: true },
    claude: { ok: true }
  }, null, { ownedEvidenceStore: store });
  const explorer = team.find((e) => e.role === "Explorer");
  assert.equal(explorer.primary.modelId, "cheap");
  assert.equal(explorer.decisionEvidence.decisionType, "owned-evidence");
  assert.match(explorer.reason, /costo=0\.01/);
});

test("EFFICIENT does not treat unknown cost as zero", () => {
  const store = createRoleAptitudeEvidenceStore();
  operationalPass(store, {
    adapterId: "codex",
    modelId: "known-cost",
    role: "Explorer",
    cost: 0.2,
    durationMs: 1000
  });
  operationalPass(store, {
    adapterId: "claude",
    modelId: "unknown-cost",
    role: "Explorer",
    cost: null,
    durationMs: 100
  });
  const models = [
    scored("codex", "known-cost", 50, 50),
    scored("claude", "unknown-cost", 90, 90)
  ];
  const team = buildEfficientTeam(models, {
    codex: { ok: true },
    claude: { ok: true }
  }, null, { ownedEvidenceStore: store });
  // Known cost sorts before unknown — unknown is not treated as 0.
  assert.equal(team.find((e) => e.role === "Explorer")?.primary.modelId, "known-cost");
});

test("without ownedEvidenceStore, public AA path unchanged", () => {
  const models = [
    scored("codex", "gpt-weak", 20, 20),
    scored("claude", "claude-strong", 90, 90)
  ];
  const team = buildAiTeam(models, { codex: { ok: true }, claude: { ok: true } });
  const explorer = team.find((e) => e.role === "Explorer");
  assert.equal(explorer.primary.modelId, "claude-strong");
  assert.notEqual(explorer.decisionEvidence?.decisionType, "owned-evidence");
});
