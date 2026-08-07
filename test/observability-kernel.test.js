import test from "node:test";
import assert from "node:assert/strict";
import {
  OBSERVABILITY_PROBE_STATES, assertObservabilityProbeContract,
  registerObservabilityProbe, getObservabilityProbe, listObservabilityProbes,
  resetObservabilityProbesForTests, buildObservabilitySnapshot,
  ensureObservabilityProbesRegistered
} from "../src/global/observability/index.js";

const stub = (id = "gentle", overrides = {}) => ({
  id, declaredEvents: [], declaredActions: [],
  async probe() {
    return {
      id, state: "missing", version: null, contractCompatible: null,
      diagnostics: [], evidence: [], error: null
    };
  },
  ...overrides
});

test("probe contract, registry soft-get, snapshot degrade", async () => {
  assert.deepEqual([...OBSERVABILITY_PROBE_STATES], ["missing", "available", "incompatible", "error"]);
  assert.throws(() => assertObservabilityProbeContract(null), /must be an object/);
  assert.throws(() => assertObservabilityProbeContract({ id: "x" }), /missing probe/);
  assert.throws(
    () => assertObservabilityProbeContract({ id: "x", probe: async () => ({}) }),
    /declaredEvents/
  );

  resetObservabilityProbesForTests();
  assert.equal(getObservabilityProbe("missing"), null);
  registerObservabilityProbe(stub("gentle", { async probe() { throw new Error("boom"); } }));
  registerObservabilityProbe(stub("other", {
    async probe() {
      return {
        id: "other", state: "available", version: "1", contractCompatible: true,
        diagnostics: [], evidence: [], error: null
      };
    }
  }));
  assert.throws(() => registerObservabilityProbe(stub("gentle")), /already registered/);
  const snap = await buildObservabilitySnapshot({});
  assert.equal(snap.probes.find((p) => p.id === "gentle").state, "error");
  assert.equal(snap.probes.find((p) => p.id === "other").state, "available");
  assert.equal(listObservabilityProbes().length, 2);
});

test("ensureObservabilityProbesRegistered installs gentle+graphify+hermes once", () => {
  resetObservabilityProbesForTests();
  ensureObservabilityProbesRegistered();
  ensureObservabilityProbesRegistered();
  assert.equal(getObservabilityProbe("gentle")?.id, "gentle");
  assert.equal(getObservabilityProbe("graphify")?.id, "graphify");
  assert.equal(getObservabilityProbe("hermes")?.id, "hermes");
  assert.equal(listObservabilityProbes().length, 3);
});
