import assert from "node:assert/strict";
import { test } from "node:test";
import { degradeCapabilities } from "../src/global/kernel/context-bundle.js";

test("absent optional integrations disable only their capability", () => {
  const caps = degradeCapabilities({
    engram: false,
    codegraph: false,
    mcp: false,
    gentleAi: false,
    hermes: false
  });
  assert.equal(caps.conversation, true);
  assert.equal(caps.routing, true);
  assert.equal(caps.memory, false);
  assert.equal(caps.graph, false);
  assert.equal(caps.mcp, false);
  assert.equal(caps.methodology, false);
  assert.equal(caps.hermes, false);
  assert.equal(caps.inventsOddSddReview, false);
});

