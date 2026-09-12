import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, bestEvidence } from "../src/global/intelligence/model-capability-registry.js";
import { ingestArtificialAnalysisEvidence } from "../src/global/intelligence/model-capability-registry-sources.js";

const AA_MODELS = [
  { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 52.8, codingIndex: 76.9, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 67.4 },
  { slug: "claude-fable-5-1", name: "Claude Fable 5.1", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 67.1 }
];

test("ingestArtificialAnalysisEvidence registers only real, matched models — never an unmatched catalog entry", () => {
  const registry = createCapabilityRegistry();
  ingestArtificialAnalysisEvidence(registry, [
    { adapterId: "codex", models: [{ id: "gpt-6-astra", displayName: "GPT-6 Astra" }, { id: "totally-unreleased-model" }] }
  ], AA_MODELS, { fetchedAt: "2026-09-12" });
  const identities = registry.listIdentities();
  assert.equal(identities.length, 1);
  assert.equal(identities[0].modelId, "gpt-6-astra");
});

test("ingestArtificialAnalysisEvidence records one evidence entry per real, non-null metric, never a fabricated value for a missing one", () => {
  const registry = createCapabilityRegistry();
  const aa = [{ slug: "partial-model", name: "Partial", intelligenceIndex: 40, codingIndex: null, mathIndex: null, priceInputPerMTok: 2, outputTokensPerSecond: null }];
  ingestArtificialAnalysisEvidence(registry, [{ adapterId: "codex", models: [{ id: "partial-model" }] }], aa, { fetchedAt: "2026-09-12" });
  const id = registry.registerIdentity("codex", "partial-model");
  const metrics = registry.getEvidence(id).map((e) => e.metric).sort();
  assert.deepEqual(metrics, ["intelligenceIndex", "priceInputPerMTok"]);
});

test("ingestArtificialAnalysisEvidence handles Cursor's plain-string catalog shape too", () => {
  const registry = createCapabilityRegistry();
  ingestArtificialAnalysisEvidence(registry, [{ adapterId: "cursor", models: ["gpt-6-astra"] }], AA_MODELS, { fetchedAt: "2026-09-12" });
  const identity = registry.listIdentities().find((i) => i.adapterId === "cursor");
  assert.equal(identity.modelId, "gpt-6-astra");
});

test("ingestArtificialAnalysisEvidence marks every entry unverified — AA's free tier never independently verifies a result", () => {
  const registry = createCapabilityRegistry();
  ingestArtificialAnalysisEvidence(registry, [{ adapterId: "codex", models: [{ id: "gpt-6-astra" }] }], AA_MODELS, { fetchedAt: "2026-09-12" });
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  for (const entry of registry.getEvidence(id)) assert.equal(entry.verified, false);
});

test("a later, independently-verified source can be layered on top without disturbing AA's own evidence", () => {
  const registry = createCapabilityRegistry();
  ingestArtificialAnalysisEvidence(registry, [{ adapterId: "codex", models: [{ id: "gpt-6-astra" }] }], AA_MODELS, { fetchedAt: "2026-09-12" });
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  registry.addEvidence(id, { metric: "codingIndex", value: 75.0, source: "huggingface-leaderboard", date: "2026-09-12", verified: true });
  assert.equal(registry.getEvidence(id, "codingIndex").length, 2);
  assert.equal(bestEvidence(registry, id, "codingIndex").source, "huggingface-leaderboard");
});
