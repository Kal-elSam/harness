import assert from "node:assert/strict";
import test from "node:test";
import {
  extractJsonPayload,
  loadGentleWorkflow,
  parseStrictJson,
  runGentleCommand
} from "../src/global/control-plane/gentle-adapters.js";
import { GENTLE_224_BOOTSTRAP } from "../src/global/control-plane/review-status.js";

test("extractJsonPayload still parses raw JSON", () => {
  assert.deepEqual(extractJsonPayload('{"schemaName":"gentle-ai.sdd-status"}'), {
    schemaName: "gentle-ai.sdd-status"
  });
});

test("loadGentleWorkflow does not invent review when sdd-status fails", async () => {
  const calls = [];
  const result = await loadGentleWorkflow({
    probe: async () => ({
      state: "available",
      contractCompatible: true,
      diagnostics: [],
      evidence: [{ kind: "binary", path: "/usr/bin/gentle-ai" }, { kind: "bootstrap", command: GENTLE_224_BOOTSTRAP }]
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
  const ok = runGentleCommand(["sdd-status", "--json"], {
    command: "/usr/bin/gentle-ai",
    spawn: (_cmd, _args, opts) => {
      assert.equal(opts.shell, false);
      return {
        status: 0,
        stdout: '{"changeName":"x","phase":"sdd-spec"}',
        stderr: "warn: ignore {not json"
      };
    }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.changeName, "x");

  const bad = runGentleCommand(["sdd-status", "--json"], {
    command: "/usr/bin/gentle-ai",
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
