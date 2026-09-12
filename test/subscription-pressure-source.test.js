import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, bestEvidence } from "../src/global/intelligence/model-capability-registry.js";
import { ingestQuotaPressureEvidence } from "../src/global/intelligence/subscription-pressure-source.js";

test("ingestQuotaPressureEvidence attaches the real remaining-percent to every model under that adapter's catalog", () => {
  const registry = createCapabilityRegistry();
  const catalogsByAdapter = { claude: [{ id: "claude-fable-5-1" }, { id: "claude-opus-5" }] };
  ingestQuotaPressureEvidence(registry, catalogsByAdapter, { claude: 42 });
  const fableId = registry.registerIdentity("claude", "claude-fable-5-1");
  const opusId = registry.registerIdentity("claude", "claude-opus-5");
  assert.equal(bestEvidence(registry, fableId, "kairo.quotaRemainingPercent").value, 42);
  assert.equal(bestEvidence(registry, opusId, "kairo.quotaRemainingPercent").value, 42);
});

test("ingestQuotaPressureEvidence marks quota evidence verified — it's Kairo's own real usage probe, not a third-party report", () => {
  const registry = createCapabilityRegistry();
  ingestQuotaPressureEvidence(registry, { codex: [{ id: "gpt-6-astra" }] }, { codex: 80 });
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(bestEvidence(registry, id, "kairo.quotaRemainingPercent").verified, true);
  assert.equal(bestEvidence(registry, id, "kairo.quotaRemainingPercent").source, "kairo-telemetry");
});

test("an adapter with no real remaining-percent is skipped entirely — never fabricate quota headroom", () => {
  const registry = createCapabilityRegistry();
  ingestQuotaPressureEvidence(registry, { claude: [{ id: "claude-fable-5-1" }] }, { claude: null });
  assert.equal(registry.listIdentities().length, 0);
});

test("an adapter with no catalog entries registers no identities, even with a real remaining-percent", () => {
  const registry = createCapabilityRegistry();
  ingestQuotaPressureEvidence(registry, {}, { claude: 50 });
  assert.equal(registry.listIdentities().length, 0);
});

test("accepts plain string catalog entries, not just objects", () => {
  const registry = createCapabilityRegistry();
  ingestQuotaPressureEvidence(registry, { codex: ["gpt-6-astra"] }, { codex: 15 });
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(bestEvidence(registry, id, "kairo.quotaRemainingPercent").value, 15);
});
