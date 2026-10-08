/**
 * Selection evidence: the team selector's evaluated candidates and per-role
 * causes must survive into the persisted project strategy.
 * Real data: test/fixtures/team-selection-repro-dfd018.json (preserved
 * catalogs/AA excerpt). Inline model lists below are SYNTHETIC (labelled).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  scoreAvailableModels, annotateWithRegistryEvidence, buildAiTeam, buildEfficientTeam
} from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { ingestArtificialAnalysisEvidence } from "../src/global/intelligence/model-capability-registry-sources.js";
import { ingestOfficialSnapshotEvidence } from "../src/global/intelligence/official-benchmark-snapshots.js";
import { buildCompleteCandidateCatalog, buildScoredCandidatePools } from "../src/global/intelligence/model-candidate-catalog.js";
import { buildProviderCapacity } from "../src/global/intelligence/subscription-pressure-source.js";
import { buildProjectStrategy } from "../src/global/conversation/project-strategy.js";
import { readProjectStrategy, writeProjectStrategy } from "../src/global/conversation/project-strategy-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "team-selection-repro-dfd018.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const BLOCK_CAUSES = [null, "model_cap", "provider_cap", "reviewer_independence"];

function dfdWalk() {
  const providerCatalogs = [
    { adapterId: "codex", models: fixture.catalogs.codex.models },
    { adapterId: "claude", models: fixture.catalogs.claude.models },
    { adapterId: "opencode-go", models: fixture.catalogs["opencode-go"].models }
  ];
  const aa = fixture.aa.models;
  const modelEntitlement = { claude: Object.fromEntries(Object.entries(fixture.claudeEntitlement).map(([id, e]) => [id, { status: e.status, reason: e.reason }])) };
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aa, { modelEntitlement });
  const registry = createCapabilityRegistry();
  ingestOfficialSnapshotEvidence(registry);
  ingestArtificialAnalysisEvidence(registry, providerCatalogs, aa);
  const scoredAll = annotateWithRegistryEvidence(scoreAvailableModels(providerCatalogs, aa), registry);
  const { recommendationPool } = buildScoredCandidatePools(scoredAll, catalog);
  const providerCapacity = buildProviderCapacity(fixture.providerCapacityDerived.remainingPercentByAdapter);
  const roleCapabilities = Object.fromEntries(fixture.project.roleRequirements.map((r) => [r.role, { required: r.capabilities, optional: [] }]));
  const strategy = buildProjectStrategy(
    { fingerprint: fixture.project.profileFingerprint, roleRequirements: fixture.project.roleRequirements },
    { scoredAll: recommendationPool, eligibility: fixture.eligibility, registry, providerCapacity },
    { choice: "quality", model: fixture.savedApproved.bootstrapAnalyst, selectionSource: "automatic", recommendationTags: ["quality"] }
  );
  return { recommendationPool, registry, providerCapacity, roleCapabilities, strategy };
}

test("buildAiTeam / buildEfficientTeam entries carry selection with reasonKind, poolSize and evaluated rows (dfd018 fixture)", () => {
  const { recommendationPool, registry, providerCapacity, roleCapabilities } = dfdWalk();
  for (const team of [
    buildAiTeam(recommendationPool, fixture.eligibility, registry, roleCapabilities),
    buildEfficientTeam(recommendationPool, fixture.eligibility, registry, { providerCapacity, roleCapabilities })
  ]) {
    for (const entry of team) {
      const sel = entry.selection;
      assert.ok(sel, `${entry.role} has selection`);
      assert.ok("reasonKind" in sel && "poolSize" in sel);
      assert.ok(Array.isArray(sel.evaluated) && sel.evaluated.length > 0);
      for (const row of sel.evaluated) {
        assert.deepEqual(Object.keys(row).sort(), ["adapterId", "blockedBy", "candidateKey", "gapValue", "inBand", "modelId"]);
        assert.ok(BLOCK_CAUSES.includes(row.blockedBy), `cause ${row.blockedBy}`);
        assert.equal(typeof row.inBand, "boolean");
      }
      assert.ok(
        sel.evaluated.some((row) => row.adapterId === entry.primary.adapterId && row.modelId === entry.primary.modelId),
        `${entry.role}: chosen primary is among evaluated`
      );
      assert.deepEqual(JSON.parse(JSON.stringify(sel)), sel, "JSON-serializable, no Maps/model objects");
    }
  }
});

test("dfd018 QUALITY Architect: Claude chosen by diversity; the blocked Codex candidates carry their real causes", () => {
  const { strategy } = dfdWalk();
  const architect = strategy.qualityTeam.find((row) => row.role === "Architect");
  assert.equal(architect.model.modelId, "claude-opus-5");
  assert.equal(architect.selection.reasonKind, "diversity");
  const cause = (modelId) => architect.selection.evaluated.find((row) => row.modelId === modelId);
  assert.equal(cause("gpt-6-astra").blockedBy, "model_cap");
  assert.equal(cause("gpt-5.6-sol").blockedBy, "provider_cap");
  assert.equal(cause("claude-opus-5").blockedBy, null);
  assert.equal(cause("claude-opus-5").inBand, true);
  assert.equal(cause("claude-sonnet-5").inBand, false);
});

test("dfd018 EFFICIENT Architect: ranked list is evaluated and Claude Opus is blocked by model_cap before assignment", () => {
  const { strategy } = dfdWalk();
  const architect = strategy.efficientTeam.find((row) => row.role === "Architect");
  const opus = architect.selection.evaluated.find((row) => row.modelId === "claude-opus-5");
  assert.equal(opus.blockedBy, "model_cap");
  assert.equal(architect.selection.evaluated.length >= 5, true);
});

test("buildProjectStrategy persists selection on qualityTeam/efficientTeam rows and strategy-level providerCapacity", () => {
  const { strategy, providerCapacity } = dfdWalk();
  assert.deepEqual(strategy.providerCapacity, providerCapacity);
  for (const team of [strategy.qualityTeam, strategy.efficientTeam]) {
    assert.ok(team.length > 0);
    for (const row of team) {
      assert.ok(row.selection && Array.isArray(row.selection.evaluated), `${row.role} persisted selection`);
    }
  }
  const claudeSeen = strategy.qualityTeam.some((row) => row.selection.evaluated.some((c) => c.adapterId === "claude"));
  assert.ok(claudeSeen, "Claude candidates and their causes are visible in the saved strategy");
  const reviewer = strategy.qualityTeam.find((row) => row.role === "Reviewer");
  if (reviewer) assert.ok(reviewer.selection.evaluated.length > 1);
});

test("a persisted strategy round-trips selection; an old file without selection still reads", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "kairo-project-"));
  const { strategy } = dfdWalk();
  await writeProjectStrategy(homeDir, projectRoot, strategy);
  const read = await readProjectStrategy(homeDir, projectRoot);
  assert.deepEqual(read.qualityTeam.map((r) => r.selection), strategy.qualityTeam.map((r) => r.selection));
  assert.deepEqual(read.providerCapacity, strategy.providerCapacity);

  const oldRoot = await mkdtemp(join(tmpdir(), "kairo-project-"));
  const dir = join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(oldRoot));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "project-strategy.json"), JSON.stringify({
    schema: "kairo.project-strategy/v1", status: "suggested", profileFingerprint: "old",
    qualityTeam: [{ role: "Architect", model: { adapterId: "codex", modelId: "x" }, reason: null }], efficientTeam: []
  }));
  const old = await readProjectStrategy(homeDir, oldRoot);
  assert.equal(old.profileFingerprint, "old");
  assert.equal(old.qualityTeam[0].selection, undefined);
});
