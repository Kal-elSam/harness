import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_PROTOCOL, SUPPORTED_SCHEMA, SUPPORTED_CONTRACT, SUPPORTED_MANDATORY_FEATURES,
  createGentleProbe, evaluateGentleCapabilities, probeGentle
} from "../src/global/observability/gentle-probe.js";

const TEN = [...SUPPORTED_MANDATORY_FEATURES];
const caps = (o = {}) => ({
  schema: SUPPORTED_SCHEMA,
  contract: SUPPORTED_CONTRACT,
  protocol: { ...SUPPORTED_PROTOCOL },
  package: { name: "gentle-ai", version: "2.2.4" },
  features: {
    mandatory: (o.mandatory ?? TEN).map((n) => (
      typeof n === "object" ? n : { name: n, supported: true, requires: [] }
    )),
    optional: o.optional ?? [{ name: "native_next_transition", supported: true, requires: [] }]
  },
  ...o.payload
});

test("locked support set and capability gates", () => {
  assert.deepEqual(SUPPORTED_PROTOCOL, { major: 2, minor: 0 });
  assert.equal(SUPPORTED_SCHEMA, "gentle-ai.review-integration.capabilities/v2");
  assert.equal(SUPPORTED_CONTRACT, "gentle-ai.review-integration/v2");
  assert.equal(SUPPORTED_MANDATORY_FEATURES.length, 10);
  assert.equal(evaluateGentleCapabilities(caps()).state, "available");
  assert.equal(evaluateGentleCapabilities(caps({
    payload: { protocol: { major: 2, minor: 1 } }
  })).state, "incompatible");
  assert.equal(evaluateGentleCapabilities(caps({
    mandatory: [...TEN, "brand_new_mandatory"]
  })).state, "incompatible");
  assert.equal(evaluateGentleCapabilities(caps({
    mandatory: TEN.map((name) => ({ name, supported: name !== "five_delivery_gates", requires: [] }))
  })).state, "incompatible");
  assert.equal(evaluateGentleCapabilities(caps({
    optional: [{ name: "totally_unknown_optional", supported: true, requires: [] }]
  })).state, "available");
  assert.equal(evaluateGentleCapabilities(caps({
    payload: { schema: "gentle-ai.review-integration.capabilities/v1" }
  })).state, "incompatible");
  assert.equal(evaluateGentleCapabilities(caps({
    payload: { package: { name: "gentle-ai", version: "99.0.0" } }
  })).state, "available");
});

test("probeGentle missing / available / error", async () => {
  assert.equal((await probeGentle({
    whichCommand: () => "",
    probeCommand: () => ({ ok: false, stdout: "", stderr: "", error: null, status: 1 })
  })).state, "missing");

  const available = await probeGentle({
    whichCommand: () => "/usr/bin/gentle-ai",
    probeCommand: (_c, args) => args.includes("capabilities")
      ? { ok: true, status: 0, stdout: JSON.stringify(caps()), stderr: "", error: null }
      : { ok: true, status: 0, stdout: "gentle-ai 2.2.4", stderr: "", error: null }
  });
  assert.equal(available.state, "available");
  assert.equal(available.version, "2.2.4");
  assert.equal(available.contractCompatible, true);

  assert.equal((await probeGentle({
    whichCommand: () => "/usr/bin/gentle-ai",
    probeCommand: () => ({ ok: true, status: 0, stdout: "not-json", stderr: "", error: null })
  })).state, "error");

  const probe = createGentleProbe({ whichCommand: () => "" });
  assert.equal(probe.id, "gentle");
  assert.equal((await probe.probe({})).state, "missing");
});
