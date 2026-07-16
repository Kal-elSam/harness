import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATION_PROVIDER_IDS,
  assertProviderContract,
  normalizeIntegrationMetadata
} from "../src/global/integrations/provider-contract.js";
import {
  registerIntegrationProvider,
  getIntegrationProvider,
  requireIntegrationProvider,
  listIntegrationProviders,
  resolveComponentIntegrationProvider,
  resetIntegrationProvidersForTests
} from "../src/global/integrations/provider-registry.js";
import { createEngramProvider } from "../src/global/integrations/engram-provider.js";
import { ensureIntegrationProvidersRegistered } from "../src/global/integrations/index.js";
import { normalizeManifestEntry } from "../src/global/component-manifest.js";
import { loadComponentCatalog } from "../src/global/load-component-catalog.js";
import { describeComponentCatalog } from "../src/global/component-registry.js";

const base = (o = {}) => ({
  id: "team-rules",
  label: "Team Rules",
  version: "0.1.0",
  assetFiles: ["README.md"],
  ...o
});

function stubProvider(id = "engram") {
  return {
    id,
    async inspect() {},
    async plan() {},
    async apply() {},
    async verify() {},
    async rollback() {}
  };
}

test("normalizes integration.provider and rejects executable fields", () => {
  assert.deepEqual(
    normalizeIntegrationMetadata({ provider: "engram" }, { componentId: "engram-memory" }),
    { provider: "engram" }
  );
  assert.equal(normalizeIntegrationMetadata(undefined, { componentId: "x" }), null);

  assert.throws(
    () => normalizeIntegrationMetadata({ provider: "unknown" }, { componentId: "x" }),
    /integration\.provider/
  );
  assert.throws(
    () => normalizeIntegrationMetadata({ provider: "engram", commands: ["setup"] }, {
      componentId: "x",
      source: "workspace"
    }),
    /cannot declare executable/
  );
  assert.throws(
    () => normalizeIntegrationMetadata({ provider: "engram", setupCommand: "engram" }, {
      componentId: "x",
      source: "bundled"
    }),
    /cannot declare executable/
  );
  assert.throws(
    () => normalizeIntegrationMetadata({ provider: "engram", extra: true }, { componentId: "x" }),
    /unsupported field/
  );

  const entry = normalizeManifestEntry(base({
    integration: { provider: "engram" }
  }), { source: "workspace" });
  assert.deepEqual(entry.integration, { provider: "engram" });
});

test("provider registry validates contract and resolves component providers", async () => {
  resetIntegrationProvidersForTests();
  assert.deepEqual(INTEGRATION_PROVIDER_IDS, ["engram", "sdd-core"]);
  assert.throws(() => assertProviderContract({ id: "engram" }), /missing inspect/);

  const registered = registerIntegrationProvider(stubProvider());
  assert.equal(registered.id, "engram");
  assert.equal(getIntegrationProvider("engram"), registered);
  assert.equal(requireIntegrationProvider("engram").id, "engram");
  assert.equal(listIntegrationProviders().length, 1);
  assert.throws(() => registerIntegrationProvider(stubProvider()), /already registered/);
  assert.throws(() => requireIntegrationProvider("missing"), /Unknown integration provider/);

  assert.equal(
    resolveComponentIntegrationProvider({ integration: { provider: "engram" } }).id,
    "engram"
  );
  assert.equal(resolveComponentIntegrationProvider({}), null);

  resetIntegrationProvidersForTests();
  ensureIntegrationProvidersRegistered();
  const engram = getIntegrationProvider("engram");
  assert.equal(engram.id, "engram");
  assert.equal(createEngramProvider().id, "engram");
  const inspection = await engram.inspect({
    whichCommand: () => null,
    agentIds: []
  });
  assert.equal(inspection.provider, "engram");
  assert.equal(inspection.doctorInvoked, false);
  const verified = await engram.verify({
    whichCommand: () => null,
    agentIds: []
  });
  assert.equal(verified.provider, "engram");
  const dry = await engram.plan({
    requestedAgentIds: ["codex"],
    inspect: () => ({
      provider: "engram",
      status: "missing",
      binary: { path: null, version: null, status: "missing", supported: false, guidance: "missing" },
      agents: [],
      doctorInvoked: false
    })
  });
  assert.equal(dry.executes, false);
});

test("bundled engram-memory declares integration.provider engram", () => {
  const engram = loadComponentCatalog().find((component) => component.id === "engram-memory");
  assert.deepEqual(engram.integration, { provider: "engram" });
  const publicEntry = describeComponentCatalog().find((entry) => entry.id === "engram-memory");
  assert.deepEqual(publicEntry.integration, { provider: "engram" });
});

test("bundled sdd-core declares integration.provider sdd-core", () => {
  const sdd = loadComponentCatalog().find((component) => component.id === "sdd-core");
  assert.deepEqual(sdd.integration, { provider: "sdd-core" });
});
