import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER,
  PROVIDER_ERROR
} from "../src/global/control-plane/constants.js";
import {
  emptyGentleWorkflow,
  isRecognizedLegacyContract,
  mapGentleProviderState,
  providerError
} from "../src/global/control-plane/provider.js";
import { loadGentleWorkflow } from "../src/global/control-plane/gentle-adapters.js";
import {
  GENTLE_224_BOOTSTRAP,
  argvFromBootstrap
} from "../src/global/control-plane/review-status.js";

test("mapGentleProviderState: missing → unavailable, v2 → connected", () => {
  assert.equal(mapGentleProviderState({ state: "missing" }), PROVIDER.UNAVAILABLE);
  assert.equal(
    mapGentleProviderState({ state: "available", contractCompatible: true }),
    PROVIDER.CONNECTED
  );
});

test("mapGentleProviderState: recognizable v1 → upgrade_required", () => {
  const probe = {
    state: "incompatible",
    contractCompatible: false,
    diagnostics: [
      "schema mismatch: got gentle-ai.review-integration.capabilities/v1",
      "contract mismatch: got gentle-ai.review-integration/v1",
      "protocol.major mismatch: got 1"
    ],
    evidence: [{ kind: "capabilities", schema: "gentle-ai.review-integration.capabilities/v1" }]
  };
  assert.equal(isRecognizedLegacyContract(probe), true);
  assert.equal(mapGentleProviderState(probe), PROVIDER.UPGRADE_REQUIRED);
  assert.equal(providerError(PROVIDER.UPGRADE_REQUIRED), PROVIDER_ERROR.upgrade_required);
});

test("mapGentleProviderState: unknown schema → incompatible fail closed", () => {
  assert.equal(mapGentleProviderState({
    state: "incompatible",
    diagnostics: ["schema mismatch: got gentle-ai.review-integration.capabilities/v9"],
    evidence: [{ schema: "gentle-ai.review-integration.capabilities/v9" }]
  }), PROVIDER.INCOMPATIBLE);
  assert.equal(mapGentleProviderState(null), PROVIDER.INCOMPATIBLE);
  assert.equal(mapGentleProviderState({
    state: "error",
    error: "Failed to parse capabilities JSON.",
    diagnostics: ["Failed to parse capabilities JSON."]
  }), PROVIDER.INCOMPATIBLE);
});

test("mapGentleProviderState: capabilities timeout with binary → unavailable", () => {
  assert.equal(mapGentleProviderState({
    state: "error",
    error: "timeout",
    diagnostics: ["gentle-ai review capabilities timed out"],
    evidence: [{ kind: "binary", path: "/usr/bin/gentle-ai" }]
  }), PROVIDER.UNAVAILABLE);
  assert.equal(
    providerError(PROVIDER.UNAVAILABLE, { state: "error" }),
    "gentle_capabilities_failed"
  );
});

test("loadGentleWorkflow skips workflow fetch unless connected", async () => {
  const calls = [];
  const missing = await loadGentleWorkflow({
    probe: async () => ({ state: "missing", diagnostics: [], evidence: [] }),
    runCommand(args) {
      calls.push(args);
      return { ok: true, payload: { authoritative: true, entries: [] } };
    }
  });
  assert.equal(missing.provider, PROVIDER.UNAVAILABLE);
  assert.equal(missing.ok, false);
  assert.equal(missing.workflow.provider, PROVIDER.UNAVAILABLE);
  assert.equal(missing.workflow.review, null);
  assert.deepEqual(calls, []);

  const upgrade = await loadGentleWorkflow({
    probe: async () => ({
      state: "incompatible",
      diagnostics: ["contract mismatch: got gentle-ai.review-integration/v1"],
      evidence: []
    }),
    runCommand(args) {
      calls.push(args);
      return { ok: true, payload: {} };
    }
  });
  assert.equal(upgrade.provider, PROVIDER.UPGRADE_REQUIRED);
  assert.equal(upgrade.error, "gentle_upgrade_required");
  assert.deepEqual(calls, []);
});

test("loadGentleWorkflow when connected never calls unnegotiated review status", async () => {
  const calls = [];
  const cwd = "/tmp/repo";
  const expected = argvFromBootstrap(GENTLE_224_BOOTSTRAP, {
    repo: cwd,
    binaryPath: "/usr/bin/gentle-ai"
  });
  const result = await loadGentleWorkflow({
    cwd,
    probe: async () => ({
      state: "available", contractCompatible: true, diagnostics: [],
      evidence: [{ kind: "binary", path: "/usr/bin/gentle-ai" }, { kind: "bootstrap", command: GENTLE_224_BOOTSTRAP }]
    }),
    runCommand(args) {
      calls.push(args);
      if (args[0] === "sdd-status") {
        return { ok: true, payload: { schemaName: "gentle-ai.sdd-status", changeName: null } };
      }
      return { ok: true, payload: { authoritative: true, entries: [{ revision: "sha256:abc" }] } };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, PROVIDER.CONNECTED);
  assert.equal(result.workflow.provider, PROVIDER.CONNECTED);
  assert.equal(result.workflow.review, null);
  assert.deepEqual(calls[0], ["sdd-status"]);
  assert.deepEqual(calls[1], expected.argv);
  assert.equal(calls.length, 2);
});

test("emptyGentleWorkflow carries provider and no invented review", () => {
  const workflow = emptyGentleWorkflow({ provider: PROVIDER.INCOMPATIBLE });
  assert.equal(workflow.provider, PROVIDER.INCOMPATIBLE);
  assert.equal(workflow.active, false);
  assert.equal(workflow.review, null);
});
