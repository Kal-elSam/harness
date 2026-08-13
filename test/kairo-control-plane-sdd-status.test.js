import assert from "node:assert/strict";
import test from "node:test";
import { WORKFLOW_KIND } from "../src/global/control-plane/constants.js";
import { emptyGentleWorkflow } from "../src/global/control-plane/provider.js";
import {
  SDD_STATUS_ARGS,
  applySddProjection,
  mapOfficialSddStatus
} from "../src/global/control-plane/sdd-status.js";
import { loadGentleWorkflow } from "../src/global/control-plane/gentle-adapters.js";
import { GENTLE_224_BOOTSTRAP } from "../src/global/control-plane/review-status.js";

test("mapOfficialSddStatus copies changeName and nextRecommended only", () => {
  const mapped = mapOfficialSddStatus({
    schemaName: "gentle-ai.sdd-status",
    changeName: "control-plane",
    nextRecommended: "sdd-spec",
    phase: "invented",
    route: "direct",
    next: "sdd-design"
  });
  assert.equal(mapped.ok, true);
  assert.deepEqual(mapped.projection, {
    schemaName: "gentle-ai.sdd-status",
    changeName: "control-plane",
    nextRecommended: "sdd-spec"
  });
});

test("mapOfficialSddStatus fails closed on unknown schema and inferred route", () => {
  assert.equal(mapOfficialSddStatus({ route: "direct" }).ok, false);
  assert.equal(mapOfficialSddStatus({ schemaName: "other.sdd", changeName: "x" }).ok, false);
  assert.equal(mapOfficialSddStatus(null).ok, false);
});

test("applySddProjection never sets phase or nextTransition", () => {
  const workflow = emptyGentleWorkflow({ provider: "connected" });
  applySddProjection(workflow, {
    schemaName: "gentle-ai.sdd-status",
    changeName: "cp",
    nextRecommended: "sdd-spec"
  });
  assert.equal(workflow.kind, WORKFLOW_KIND.SDD);
  assert.equal(workflow.phase, null);
  assert.equal(workflow.nextTransition, null);
  assert.equal(workflow.sdd.nextRecommended, "sdd-spec");
});

test("loadGentleWorkflow uses sdd-status --json and keeps review when schema is unknown", async () => {
  const calls = [];
  const result = await loadGentleWorkflow({
    probe: async () => ({
      state: "available",
      contractCompatible: true,
      diagnostics: [],
      evidence: [{ kind: "binary", path: "/usr/bin/gentle-ai" }, { kind: "bootstrap", command: GENTLE_224_BOOTSTRAP }]
    }),
    runCommand(args) {
      calls.push(args);
      if (args[0] === "sdd-status") {
        return { ok: true, payload: { schemaName: "unknown", changeName: "x", route: "direct" } };
      }
      return {
        ok: true,
        payload: {
          schema: "gentle-ai.review-integration.status/v3",
          contract: "gentle-ai.review-integration/v2",
          next_transition: { kind: "collect", reason_code: "wait" }
        }
      };
    }
  });
  assert.deepEqual(calls[0], [...SDD_STATUS_ARGS]);
  assert.equal(result.ok, true);
  assert.equal(result.workflow.kind, WORKFLOW_KIND.REVIEW);
  assert.equal(result.workflow.sdd, null);
  assert.deepEqual(result.workflow.nextTransition, { kind: "collect", reason_code: "wait" });
});
