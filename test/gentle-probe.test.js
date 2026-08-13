import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_PROTOCOL, SUPPORTED_PROTOCOL_MINORS, SUPPORTED_SCHEMA, SUPPORTED_SCHEMA_V21,
  SUPPORTED_CAPABILITY_SCHEMAS, SUPPORTED_CONTRACT, SUPPORTED_MANDATORY_FEATURES,
  ADDITIVE_MINOR_POLICY, createGentleProbe, evaluateGentleCapabilities, probeGentle
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
  assert.deepEqual(SUPPORTED_PROTOCOL_MINORS, [0, 1]);
  assert.deepEqual(SUPPORTED_CAPABILITY_SCHEMAS, [SUPPORTED_SCHEMA, SUPPORTED_SCHEMA_V21]);
  assert.equal(SUPPORTED_CONTRACT, "gentle-ai.review-integration/v2");
  assert.equal(ADDITIVE_MINOR_POLICY, "optional-fields-only");
  assert.equal(SUPPORTED_MANDATORY_FEATURES.length, 10);
  assert.equal(evaluateGentleCapabilities(caps()).state, "available");
  assert.equal(evaluateGentleCapabilities(caps({
    payload: { protocol: { major: 2, minor: 1 } }
  })).state, "available");
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
  assert.equal(evaluateGentleCapabilities(caps({
    payload: { schema: SUPPORTED_SCHEMA_V21, protocol: { major: 2, minor: 1 } }
  })).state, "available");
  assert.equal(evaluateGentleCapabilities(caps({
    payload: { schema: "gentle-ai.review-integration.capabilities/v2.2" }
  })).state, "incompatible");
  assert.equal(evaluateGentleCapabilities(caps({
    payload: { protocol: { major: 2, minor: 2 } }
  })).state, "incompatible");
  assert.equal(evaluateGentleCapabilities(caps({
    payload: { compatibility: { additive_minor_policy: "rewrite-fields" } }
  })).state, "incompatible");
});

test("Gentle 2.2.4 v2.0 and 2.3.0 v2.1 preserve announced bootstrap", () => {
  const v20 = evaluateGentleCapabilities(caps({
    payload: {
      package: { name: "gentle-ai", version: "2.2.4" },
      protocol: { major: 2, minor: 0 },
      bootstrap: {
        command: "gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --next-transition",
        required_feature: "native_next_transition"
      }
    }
  }));
  assert.equal(v20.state, "available");
  assert.equal(
    v20.evidence.find((row) => row.kind === "bootstrap")?.command.includes("--agent"),
    false
  );

  const v21 = evaluateGentleCapabilities(caps({
    payload: {
      schema: SUPPORTED_SCHEMA_V21,
      package: { name: "gentle-ai", version: "2.3.0" },
      protocol: { major: 2, minor: 1 },
      bootstrap: {
        command: "gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition",
        required_feature: "native_next_transition"
      }
    }
  }));
  assert.equal(v21.state, "available");
  assert.match(v21.evidence.find((row) => row.kind === "bootstrap").command, /--agent claude-code/);
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
  assert.equal(available.evidence.find((e) => e.kind === "binary").path, "/usr/bin/gentle-ai");

  assert.equal((await probeGentle({
    whichCommand: () => "/usr/bin/gentle-ai",
    probeCommand: () => ({ ok: true, status: 0, stdout: "not-json", stderr: "", error: null })
  })).state, "error");

  // Valid capabilities JSON must not override a failed / timed-out capability probe.
  const failedExit = await probeGentle({
    whichCommand: () => "/usr/bin/gentle-ai",
    probeCommand: (_c, args) => args.includes("capabilities")
      ? {
        ok: false, status: 1, timedOut: false, stdout: JSON.stringify(caps()),
        stderr: "boom", error: null
      }
      : { ok: true, status: 0, stdout: "gentle-ai 2.2.4", stderr: "", error: null, timedOut: false }
  });
  assert.equal(failedExit.state, "error");
  assert.match(String(failedExit.error), /exit 1/);

  const timedOut = await probeGentle({
    whichCommand: () => "/usr/bin/gentle-ai",
    probeCommand: (_c, args) => args.includes("capabilities")
      ? {
        ok: false, status: null, timedOut: true, stdout: JSON.stringify(caps()),
        stderr: "", error: "ETIMEDOUT"
      }
      : { ok: true, status: 0, stdout: "gentle-ai 2.2.4", stderr: "", error: null, timedOut: false }
  });
  assert.equal(timedOut.state, "error");
  assert.match(String(timedOut.diagnostics.join(" ")), /timed out/);

  const probe = createGentleProbe({ whichCommand: () => "" });
  assert.equal(probe.id, "gentle");
  assert.equal((await probe.probe({})).state, "missing");
});
