import assert from "node:assert/strict";
import { test } from "node:test";
import { launchGentleShell } from "../src/global/host/launch-gentle-shell.js";
import { degradeCapabilities } from "../src/global/kernel/context-bundle.js";

test("missing Hermes does not fail host launch", async () => {
  const calls = [];
  await launchGentleShell({
    cwd: "/tmp/proj",
    extensionDir: "/abs/kairo-extension",
    statImpl: () => ({ isDirectory: () => true }),
    whichImpl: (command) => (command === "gentle-shell" ? "/usr/bin/gentle-shell" : null),
    probeImpl: () => ({ ok: true, stdout: "0.85.1" }),
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/usr/bin/gentle-shell");
});

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
