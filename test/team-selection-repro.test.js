/**
 * Deterministic offline reproduction of the saved Kairo team proposal
 * (fixture test/fixtures/team-selection-repro-dfd018.json).
 *
 * Walk: catalog → lifecycle → evidence → eligibility → QUALITY/EFFICIENT
 * → operational projectTeam. Explains the approved all-Codex outcome and
 * Astra×2 using preserved data only — never invents missing history.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  scoreAvailableModels, annotateWithRegistryEvidence, buildAiTeam, buildEfficientTeam
} from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { ingestArtificialAnalysisEvidence } from "../src/global/intelligence/model-capability-registry-sources.js";
import { ingestOfficialSnapshotEvidence } from "../src/global/intelligence/official-benchmark-snapshots.js";
import {
  buildCompleteCandidateCatalog, buildScoredCandidatePools
} from "../src/global/intelligence/model-candidate-catalog.js";
import { buildProviderCapacity } from "../src/global/intelligence/subscription-pressure-source.js";
import { buildProjectStrategy } from "../src/global/conversation/project-strategy.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "team-selection-repro-dfd018.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

const MAX_ROLES_PER_MODEL = 2;
const MAX_TECHNICAL_ROLES_PER_PROVIDER = 3;

function providerCatalogsFromFixture() {
  return [
    { adapterId: "codex", models: fixture.catalogs.codex.models },
    { adapterId: "claude", models: fixture.catalogs.claude.models },
    { adapterId: "opencode-go", models: fixture.catalogs["opencode-go"].models }
  ];
}

function modelEntitlementFromFixture() {
  return { claude: Object.fromEntries(
    Object.entries(fixture.claudeEntitlement).map(([id, e]) => [id, { status: e.status, reason: e.reason }])
  ) };
}

function providerCapacityFromFixture() {
  return buildProviderCapacity(fixture.providerCapacityDerived.remainingPercentByAdapter);
}

function buildScoredRecommendationPool() {
  const providerCatalogs = providerCatalogsFromFixture();
  const aa = fixture.aa.models;
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aa, {
    modelEntitlement: modelEntitlementFromFixture()
  });
  const registry = createCapabilityRegistry();
  ingestOfficialSnapshotEvidence(registry);
  ingestArtificialAnalysisEvidence(registry, providerCatalogs, aa);
  const scoredAll = annotateWithRegistryEvidence(scoreAvailableModels(providerCatalogs, aa), registry);
  const pools = buildScoredCandidatePools(scoredAll, catalog);
  return { catalog, registry, scoredAll, ...pools };
}

test("fixture declares shared base HEAD and historical gaps without fabricating catalogs", () => {
  assert.equal(fixture.sharedBase.head, "cf9cab8641872a68c8b467e39804f0b6e9998d11");
  assert.equal(fixture.sharedBase.branch, "feat/kairo-cursor-baseline");
  assert.ok(Array.isArray(fixture.gaps) && fixture.gaps.length >= 3, "missing history must be named");
  for (const gap of fixture.gaps) {
    assert.ok(gap.id && gap.status && gap.detail, `gap ${gap.id} must be fully declared`);
  }
  assert.equal(fixture.catalogs.codex.status, "reconstructed-from-strategy");
  assert.ok(fixture.aa.models.length > 0, "AA excerpt is preserved verbatim");
  assert.deepEqual(fixture.aa.unmatchedCatalogIds, ["claude-haiku-4-5-20251001"]);
});

test("saved approved outcome: four Codex technical roles, Astra×2, Reviewer only-adequate-concentration", () => {
  const quality = fixture.savedApproved.qualityTeam;
  assert.deepEqual(quality.map((e) => e.role), ["Explorer", "Architect", "Debugger", "Reviewer"]);

  const byRole = Object.fromEntries(quality.map((e) => [e.role, e]));
  assert.equal(byRole.Explorer.model.adapterId, "codex");
  assert.equal(byRole.Architect.model.adapterId, "codex");
  assert.equal(byRole.Debugger.model.adapterId, "codex");
  assert.equal(byRole.Reviewer.model.adapterId, "codex");
  assert.equal(byRole.Architect.model.modelId, "gpt-6-astra");
  assert.equal(byRole.Debugger.model.modelId, "gpt-6-astra");
  assert.match(byRole.Explorer.reason ?? "", /avoid concentration/);
  assert.match(byRole.Reviewer.reason ?? "", /Only adequate option/);

  // Policy limits that explain the saved shape (documented constants, not guessed):
  // Astra on Architect+Debugger = exactly MAX_ROLES_PER_MODEL (2).
  const astraRoles = quality.filter((e) => e.model.modelId === "gpt-6-astra").map((e) => e.role);
  assert.deepEqual(astraRoles, ["Architect", "Debugger"]);
  assert.equal(astraRoles.length, MAX_ROLES_PER_MODEL);

  // Four Codex rows exceed MAX_TECHNICAL_ROLES_PER_PROVIDER (3); the 4th
  // (Reviewer) carries only-adequate-concentration — the real exception
  // that permitted the repeat, not a silent override.
  const codexCount = quality.filter((e) => e.model.adapterId === "codex").length;
  assert.equal(codexCount, 4);
  assert.ok(codexCount > MAX_TECHNICAL_ROLES_PER_PROVIDER);
  assert.match(byRole.Reviewer.reason, /Only adequate option/);
});

test("journey: catalog → lifecycle → evidence → eligibility → pools (fixture entitlements)", () => {
  const providerCatalogs = providerCatalogsFromFixture();
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, fixture.aa.models, {
    modelEntitlement: modelEntitlementFromFixture()
  });
  const byKey = Object.fromEntries(catalog.map((c) => [`${c.adapterId}::${c.modelId}`, c]));

  // Lifecycle: allowed Opus 5 stays current; unverified 5.5 does not retire it;
  // allowed 4.8 is superseded by allowed Opus 5.
  assert.equal(byKey["claude::claude-opus-5"].lifecycle, "current");
  assert.equal(byKey["claude::claude-opus-5"].entitlement, ENTITLEMENT.ALLOWED);
  assert.equal(byKey["claude::claude-opus-5-5"].entitlement, ENTITLEMENT.UNVERIFIED);
  assert.equal(byKey["claude::claude-opus-5-5"].lifecycle, "current");
  assert.equal(byKey["claude::claude-opus-4-8"].lifecycle, "superseded");
  assert.equal(byKey["claude::claude-fable-5-1"].entitlement, ENTITLEMENT.DENIED);

  const { recommendationPool, manualSelectionPool } = buildScoredCandidatePools(
    scoreAvailableModels(providerCatalogs, fixture.aa.models),
    catalog
  );
  const recClaude = recommendationPool.filter((m) => m.adapterId === "claude").map((m) => m.modelId);
  assert.ok(recClaude.includes("claude-opus-5"), "allowed Opus 5 enters recommendation pool");
  assert.ok(!recClaude.includes("claude-fable-5-1"), "denied Fable excluded from recommendations");
  assert.ok(!recClaude.includes("claude-opus-5-5"), "unverified 5.5 excluded from recommendations");
  assert.ok(
    manualSelectionPool.some((m) => m.modelId === "claude-opus-5-5"),
    "unverified 5.5 remains in the internal manual/evidence pool"
  );

  // Eligibility from fixture
  assert.equal(fixture.eligibility.codex.ok, true);
  assert.equal(fixture.eligibility.claude.ok, true);
  assert.equal(fixture.eligibility["opencode-go"].ok, false);
  assert.equal(fixture.eligibility["opencode-go"].cause, "rate_limited");
  assert.equal(fixture.cursorAccess.cursor_models.status, "unverified");
});

test("journey: QUALITY/EFFICIENT/operational with fixture pool — Claude allowed diversifies; capacity reaches balancer", () => {
  const { recommendationPool, registry } = buildScoredRecommendationPool();
  const eligibility = fixture.eligibility;
  const providerCapacity = providerCapacityFromFixture();
  assert.equal(providerCapacity.codex.quotaRemainingPercent, 22);
  assert.equal(providerCapacity.claude.quotaRemainingPercent, 29);
  assert.equal(providerCapacity["opencode-go"].quotaRemainingPercent, 0);

  const roleCapabilities = Object.fromEntries(
    fixture.project.roleRequirements.map((r) => [r.role, { required: r.capabilities, optional: [] }])
  );

  const quality = buildAiTeam(recommendationPool, eligibility, registry, roleCapabilities);
  const efficient = buildEfficientTeam(recommendationPool, eligibility, registry, {
    providerCapacity,
    roleCapabilities
  });
  const strategy = buildProjectStrategy(
    {
      fingerprint: fixture.project.profileFingerprint,
      roleRequirements: fixture.project.roleRequirements
    },
    { scoredAll: recommendationPool, eligibility, registry, providerCapacity },
    {
      choice: "quality",
      model: fixture.savedApproved.bootstrapAnalyst,
      selectionSource: "automatic",
      recommendationTags: ["quality"]
    }
  );

  const qualityAdapters = new Set(quality.map((t) => t.primary.adapterId));
  const projectAdapters = new Set(strategy.projectTeam.map((t) => t.model.adapterId));
  const reviewer = quality.find((t) => t.role === "Reviewer");

  // With preserved ALLOWED Claude in the pool, current policy must not
  // reproduce the approved all-Codex + only-adequate Reviewer shape.
  assert.ok(
    qualityAdapters.has("claude") || projectAdapters.has("claude"),
    "adequate allowed Claude must appear once concentration pressure exists"
  );
  assert.notEqual(
    reviewer?.reason,
    "Only adequate option — no real alternative avoids concentration without forcing a repeat."
  );

  // Efficient sees real capacity (Claude headroom > Codex).
  assert.ok(efficient.length === fixture.project.activeRoles.length);
  assert.ok(strategy.efficientTeam.length === fixture.project.activeRoles.length);

  // Gap honesty: approved snapshot still records the historical all-Codex
  // outcome; current walk differs because Claude is in the recommendation pool.
  assert.notDeepEqual(
    quality.map((t) => `${t.role}:${t.primary.adapterId}/${t.primary.modelId}`),
    fixture.savedApproved.qualityTeam.map((t) => `${t.role}:${t.model.adapterId}/${t.model.modelId}`),
    "current pool with ALLOWED Claude must not silently rewrite history as identical to the approved all-Codex snapshot"
  );
});

test("rule evidence: saved approval recorded four Codex roles and Astra×2; exception justification not verifiable", () => {
  // Recorded outcome + policy constants. The only-adequate label on Reviewer
  // is what the selector wrote — its historical necessity is not verifiable
  // because the evaluated pool at approve time was not persisted (fixture gap).
  const quality = fixture.savedApproved.qualityTeam;
  const byRole = Object.fromEntries(quality.map((e) => [e.role, e]));

  assert.equal(
    MAX_ROLES_PER_MODEL,
    2,
    "Astra on Architect+Debugger saturates the per-model family limit exactly"
  );
  assert.equal(byRole.Architect.model.modelId, "gpt-6-astra");
  assert.equal(byRole.Debugger.model.modelId, "gpt-6-astra");
  assert.equal(byRole.Architect.reason, null);
  assert.equal(byRole.Debugger.reason, null);

  assert.equal(MAX_TECHNICAL_ROLES_PER_PROVIDER, 3);
  assert.match(
    byRole.Reviewer.reason,
    /Only adequate option — no real alternative avoids concentration without forcing a repeat/,
    "selector recorded only-adequate-concentration on the 4th Codex technical role"
  );
  assert.match(
    byRole.Explorer.reason,
    /Near-equivalent alternatives/,
    "Explorer diversity stayed inside Codex (terra vs astra family) — not a cross-provider diversify"
  );

  const poolGap = fixture.gaps.find((g) => g.id === "recommendation-pool-at-approve");
  assert.equal(poolGap.status, "missing");
});
