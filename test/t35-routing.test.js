import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectRoute } from "../src/global/team/project-router.js";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const model = (adapterId, modelId, extra = {}) => ({
  candidateKey: `${adapterId}::${modelId}`, adapterId, modelId, displayName: modelId, accessMode: "automatic", utility: 1, ...extra
});
const haiku = model("claude", "haiku");
const mimo = model("opencode-go", "mimo-v2.6-pro");
const strategy = { status: "active", profileFingerprint: "fp", projectTeam: [{ role: "Builder", model: haiku, assignmentSource: "recommended", fallback: null }] };
const eligibility = { claude: { ok: true }, "opencode-go": { ok: true } };

test("T35: the router does not pick an unverified unknown-capacity provider to fill its deficit", () => {
  const route = resolveProjectRoute({
    role: "Builder", strategy, eligibility, now: NOW, pool: [haiku, mimo],
    ledger: [{ adapterId: "claude", modelId: "haiku", status: "completed", at: NOW - 1000 }],
    providerCapacity: { claude: { quotaRemainingPercent: 60 } }
  });
  assert.equal(route.provider, "claude");
  assert.equal(route.model.modelId, "haiku");
});
