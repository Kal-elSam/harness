import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, bestEvidence } from "../src/global/intelligence/model-capability-registry.js";
import { OFFICIAL_BENCHMARK_SNAPSHOTS, ingestOfficialSnapshotEvidence, validateSnapshotIntegrity } from "../src/global/intelligence/official-benchmark-snapshots.js";

function baseSnapshot(overrides = {}) {
  return {
    source: "openai-official", url: "https://openai.com/index/gpt-6-astra/", published: "2026-09-03",
    benchmark: "terminal-bench", benchmarkVersion: "4.0", caveat: "max effort",
    scores: [{ adapterId: "codex", modelId: "gpt-6-astra", value: 57.9 }],
    ...overrides
  };
}

test("ingestOfficialSnapshotEvidence registers real cross-vendor evidence for Codex, giving it coverage Hugging Face never provides", () => {
  const registry = createCapabilityRegistry();
  ingestOfficialSnapshotEvidence(registry);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  const entries = registry.getEvidence(id, "terminal-bench");
  assert.ok(entries.length >= 1);
  assert.equal(entries[0].value, 57.9);
  assert.equal(entries[0].source, "openai-official");
});

test("every entry is marked unverified — manufacturer-reported is never treated as independent, regardless of which vendor published it", () => {
  const registry = createCapabilityRegistry();
  ingestOfficialSnapshotEvidence(registry);
  for (const identity of registry.listIdentities()) {
    for (const entry of registry.getEvidence(identity.id)) {
      assert.equal(entry.verified, false, `${identity.id} / ${entry.metric} from ${entry.source} must be verified:false`);
    }
  }
});

test("the vendor's own methodology caveat is preserved on every entry, never dropped", () => {
  const registry = createCapabilityRegistry();
  ingestOfficialSnapshotEvidence(registry);
  const id = registry.registerIdentity("claude", "claude-fable-5-1");
  const entry = registry.getEvidence(id, "terminal-bench-science")[0];
  assert.match(entry.modelConfig, /safeguards/i);
});

test("the same real benchmark reported by two different vendors is kept as two separate evidence entries, never merged or averaged", () => {
  const registry = createCapabilityRegistry();
  ingestOfficialSnapshotEvidence(registry);
  // gpt-5.6-sol's terminal-bench score is reported both on OpenAI's own
  // page and, separately, on Anthropic's competitor-comparison page.
  const id = registry.registerIdentity("codex", "gpt-5.6-sol");
  const entries = registry.getEvidence(id, "terminal-bench");
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.source).sort(), ["anthropic-official", "openai-official"]);
});

test("OFFICIAL_BENCHMARK_SNAPSHOTS never contains a score for a model Kairo doesn't recognize by real adapterId/modelId pairs", () => {
  const validAdapters = new Set(["codex", "claude", "opencode-go", "cursor"]);
  for (const snapshot of OFFICIAL_BENCHMARK_SNAPSHOTS) {
    for (const score of snapshot.scores) {
      assert.ok(validAdapters.has(score.adapterId), `unexpected adapterId "${score.adapterId}"`);
      assert.ok(typeof score.modelId === "string" && score.modelId.length > 0);
    }
  }
});

test("validateSnapshotIntegrity accepts the real, shipped snapshot data", () => {
  assert.doesNotThrow(() => validateSnapshotIntegrity(OFFICIAL_BENCHMARK_SNAPSHOTS));
});

test("validateSnapshotIntegrity rejects a snapshot missing the vendor's own methodology caveat", () => {
  assert.throws(() => validateSnapshotIntegrity([baseSnapshot({ caveat: undefined })]), /caveat/);
});

test("validateSnapshotIntegrity rejects a non-https or missing source url", () => {
  assert.throws(() => validateSnapshotIntegrity([baseSnapshot({ url: "openai.com/index/gpt-6-astra" })]), /https/);
});

test("validateSnapshotIntegrity rejects a malformed published date", () => {
  assert.throws(() => validateSnapshotIntegrity([baseSnapshot({ published: "Sept 2026" })]), /ISO date/);
});

test("validateSnapshotIntegrity rejects a score missing adapterId or modelId", () => {
  assert.throws(() => validateSnapshotIntegrity([baseSnapshot({ scores: [{ adapterId: "codex", value: 50 }] })]), /adapterId and modelId/);
});

test("validateSnapshotIntegrity rejects an exact duplicate row (same vendor, benchmark, model reported twice)", () => {
  const score = { adapterId: "codex", modelId: "gpt-6-astra", value: 57.9 };
  assert.throws(() => validateSnapshotIntegrity([baseSnapshot({ scores: [score, { ...score }] })]), /duplicate row/);
});

test("bestEvidence can still surface a manufacturer snapshot when nothing else covers that benchmark", () => {
  const registry = createCapabilityRegistry();
  ingestOfficialSnapshotEvidence(registry);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  const best = bestEvidence(registry, id, "gpqa-diamond");
  assert.equal(best.value, 96.0);
  assert.equal(best.source, "openai-official");
});
