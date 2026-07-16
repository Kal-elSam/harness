import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENT_HEALTH,
  buildComponentHealthEntries,
  doctorAffectedByComponentHealth,
  summarizeComponentHealth
} from "../src/global/component-health.js";
import { runComponentEcosystemChecks } from "../src/global/component-ecosystem-checks.js";
import { resolveTargetComponents } from "../src/global/component-registry.js";

test("summarizeComponentHealth maps check statuses to public health", () => {
  assert.equal(summarizeComponentHealth([]), COMPONENT_HEALTH.HEALTHY);
  assert.equal(summarizeComponentHealth([{ status: "ok" }]), COMPONENT_HEALTH.HEALTHY);
  assert.equal(summarizeComponentHealth([{ status: "warning" }]), COMPONENT_HEALTH.DEGRADED);
  assert.equal(summarizeComponentHealth([{ status: "stale" }]), COMPONENT_HEALTH.DRIFTED);
  assert.equal(summarizeComponentHealth([{ status: "missing" }]), COMPONENT_HEALTH.MISSING);
  assert.equal(
    summarizeComponentHealth([{ status: "warning" }, { status: "stale" }]),
    COMPONENT_HEALTH.DRIFTED
  );
});

test("engram integration warnings degrade component health without doctor failure signal", async () => {
  const checks = await runComponentEcosystemChecks({
    installedComponents: resolveTargetComponents({ components: ["engram-memory"] })
  });
  const [entry] = buildComponentHealthEntries(
    [{ id: "engram-memory", version: "1.0.0", source: "bundled" }],
    checks
  );

  assert.equal(entry.status, COMPONENT_HEALTH.DEGRADED);
  assert.equal(doctorAffectedByComponentHealth(entry.status), false);
  assert.equal(
    JSON.parse(JSON.stringify(entry)).status,
    "degraded"
  );
});
