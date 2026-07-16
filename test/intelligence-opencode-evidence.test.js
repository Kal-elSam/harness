import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTITLEMENT_STATES,
  BILLING_MODELS,
  parseAuthListProviders,
  hasAuthProvider,
  classifyModelsProbeStatus,
  buildDirectEvidenceBase,
  collectOpencodeCliEvidence
} from "../src/global/intelligence/backends/opencode-evidence.js";

test("parseAuthListProviders extracts Go/Zen without reading auth.json", () => {
  const providers = parseAuthListProviders(`
┌  Credentials ~/.local/share/opencode/auth.json
●  OpenCode Zen api
●  OpenCode Go api
●  Anthropic api
└  3 credentials
`);
  assert.ok(providers.includes("OpenCode Zen"));
  assert.ok(providers.includes("OpenCode Go"));
  assert.ok(providers.includes("Anthropic"));
});

test("hasAuthProvider matches Go and Zen labels", () => {
  assert.equal(hasAuthProvider(["OpenCode Go", "Anthropic"], "go"), true);
  assert.equal(hasAuthProvider(["OpenCode Zen"], "go"), false);
  assert.equal(hasAuthProvider(["OpenCode Zen"], "zen"), true);
});

test("classifyModelsProbeStatus maps HTTP to entitlement states", () => {
  assert.equal(classifyModelsProbeStatus(429), ENTITLEMENT_STATES.LIMIT_REACHED);
  assert.equal(classifyModelsProbeStatus(401), ENTITLEMENT_STATES.UNKNOWN);
  assert.equal(classifyModelsProbeStatus(403), ENTITLEMENT_STATES.UNKNOWN);
  assert.equal(classifyModelsProbeStatus(200), ENTITLEMENT_STATES.UNVERIFIED);
  assert.equal(classifyModelsProbeStatus(500), ENTITLEMENT_STATES.UNKNOWN);
});

test("buildDirectEvidenceBase separates configured from authenticated", () => {
  const configuredOnly = buildDirectEvidenceBase({
    product: "go",
    hasApiKey: false,
    cliEvidence: {
      cliInstalled: true,
      authListOk: true,
      authProviders: ["OpenCode Go"]
    },
    modelsOk: false
  });
  assert.equal(configuredOnly.configured, true);
  assert.equal(configuredOnly.authenticated, false);
  assert.equal(configuredOnly.entitlement, ENTITLEMENT_STATES.UNVERIFIED);
  assert.equal(configuredOnly.billingModel, BILLING_MODELS.GO_PLAN);

  const authenticated = buildDirectEvidenceBase({
    product: "zen",
    hasApiKey: true,
    cliEvidence: null,
    modelsHttpStatus: 200,
    modelsOk: true
  });
  assert.equal(authenticated.configured, true);
  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.entitlement, ENTITLEMENT_STATES.UNVERIFIED);
  assert.equal(authenticated.billingModel, BILLING_MODELS.ZEN_CREDITS);
});

test("buildDirectEvidenceBase marks 429 as limit_reached", () => {
  const limited = buildDirectEvidenceBase({
    product: "go",
    hasApiKey: true,
    modelsHttpStatus: 429,
    modelsOk: false
  });
  assert.equal(limited.entitlement, ENTITLEMENT_STATES.LIMIT_REACHED);
  assert.equal(limited.authenticated, false);
});

test("collectOpencodeCliEvidence never invents providers without CLI", () => {
  const missing = collectOpencodeCliEvidence({
    whichImpl: () => false
  });
  assert.equal(missing.cliInstalled, false);
  assert.deepEqual(missing.authProviders, []);

  const listed = collectOpencodeCliEvidence({
    whichImpl: () => true,
    probeImpl: () => ({
      ok: true,
      stdout: "●  OpenCode Go api\n●  OpenCode Zen api\n",
      stderr: "",
      error: null
    })
  });
  assert.equal(listed.cliInstalled, true);
  assert.equal(listed.authListOk, true);
  assert.ok(listed.authProviders.includes("OpenCode Go"));
  assert.ok(listed.authProviders.includes("OpenCode Zen"));
});

test("failed auth list with partial stdout stays negative evidence", () => {
  const failed = collectOpencodeCliEvidence({
    whichImpl: () => true,
    probeImpl: () => ({
      ok: false,
      stdout: "●  OpenCode Go api\n●  Anthropic api\n",
      stderr: "error: auth list failed\n●  OpenCode Zen api\n",
      error: "exit 1"
    })
  });
  assert.equal(failed.cliInstalled, true);
  assert.equal(failed.authListOk, false);
  assert.deepEqual(failed.authProviders, []);
  assert.match(String(failed.error), /exit 1|auth list failed/i);
});
