import assert from "node:assert/strict";
import test from "node:test";
import {
  extractJsonPayload,
  loadGentleWorkflow,
  mapSddStatusToWorkflow,
  parseStrictJson,
  runGentleCommand
} from "../src/global/control-plane/gentle-adapters.js";
import { REVIEW_STATUS_ARGS } from "../src/global/control-plane/review-status.js";
import {
  NO_ACTIVE_WORKFLOW,
  WORKFLOW_KIND
} from "../src/global/control-plane/constants.js";

test("extractJsonPayload reads fenced gentle sdd-status JSON", () => {
  const text = `## SDD Status\n\n### JSON\n\`\`\`json\n{"schemaName":"gentle-ai.sdd-status","changeName":null,"next":"sdd-new"}\n\`\`\`\n`;
  assert.deepEqual(extractJsonPayload(text), {
    schemaName: "gentle-ai.sdd-status",
    changeName: null,
    next: "sdd-new"
  });
});

test("mapSddStatusToWorkflow stays none without active change", () => {
  const workflow = mapSddStatusToWorkflow({
    schemaName: "gentle-ai.sdd-status",
    changeName: null,
    next: "sdd-new"
  });
  assert.equal(workflow.kind, WORKFLOW_KIND.NONE);
  assert.equal(workflow.active, false);
  assert.equal(workflow.label, NO_ACTIVE_WORKFLOW);
});

test("mapSddStatusToWorkflow surfaces active SDD phase and next", () => {
  const workflow = mapSddStatusToWorkflow({
    changeName: "control-plane",
    phase: "sdd-spec",
    next: "sdd-design"
  });
  assert.equal(workflow.kind, WORKFLOW_KIND.SDD);
  assert.equal(workflow.active, true);
  assert.equal(workflow.phase, "sdd-spec");
  assert.equal(workflow.nextTransition, "sdd-design");
});

test("mapSddStatusToWorkflow accepts explicit Gentle direct/delegated route only", () => {
  assert.equal(mapSddStatusToWorkflow({ route: "direct" }).kind, WORKFLOW_KIND.DIRECT);
  assert.equal(mapSddStatusToWorkflow({ route: "delegated" }).kind, WORKFLOW_KIND.DELEGATED);
  assert.equal(mapSddStatusToWorkflow({ goal: "x" }).kind, WORKFLOW_KIND.NONE);
});

test("loadGentleWorkflow does not invent review when sdd-status fails", async () => {
  const calls = [];
  const result = await loadGentleWorkflow({
    probe: async () => ({
      state: "available",
      contractCompatible: true,
      diagnostics: [],
      evidence: []
    }),
    runCommand(args) {
      calls.push(args[0]);
      if (args[0] === "sdd-status") {
        return { ok: false, error: "gentle_parse_failed", payload: null };
      }
      return {
        ok: true,
        payload: {
          authoritative: true,
          entries: [{
            status: "recovered",
            state: "approved",
            lineage_id: "rev-1",
            revision: "sha256:abc",
            gate: "pre-commit"
          }]
        }
      };
    }
  });
  assert.deepEqual(calls, ["sdd-status", "review"]);
  assert.equal(result.ok, false);
  assert.equal(result.error, "gentle_parse_failed");
  assert.equal(result.workflow.review, null);
  assert.equal(result.provider, "connected");
});

test("runGentleCommand prefers stdout JSON and rejects nonzero status", () => {
  const ok = runGentleCommand(["sdd-status"], {
    spawn: () => ({
      status: 0,
      stdout: '{"changeName":"x","phase":"sdd-spec"}',
      stderr: "warn: ignore {not json"
    })
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.changeName, "x");

  const bad = runGentleCommand(["sdd-status"], {
    spawn: () => ({
      status: 2,
      stdout: '{"changeName":"x"}',
      stderr: ""
    })
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "gentle_nonzero_status");
});

test("parseStrictJson rejects markdown fences and slices", () => {
  assert.equal(parseStrictJson("```json\n{\"a\":1}\n```"), null);
  assert.equal(parseStrictJson("prefix {\"a\":1}"), null);
  assert.deepEqual(parseStrictJson('{"a":1}'), { a: 1 });
});
