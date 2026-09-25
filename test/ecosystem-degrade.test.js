import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchGentleShell } from "../src/global/host/launch-gentle-shell.js";
import { degradeCapabilities } from "../src/global/kernel/context-bundle.js";
import { buildKairoPiFixture } from "./helpers/kairo-pi-fixture.js";

test("missing Hermes does not fail host launch", async () => {
  const fixture = await buildKairoPiFixture();
  const cwd = await mkdtemp(join(tmpdir(), "kairo-ecosystem-degrade-"));
  const calls = [];
  await launchGentleShell({
    cwd,
    extensionDir: "/abs/kairo-extension",
    env: { HARNESS_HOME: "/tmp/kairo-ecosystem-test" },
    statImpl: () => ({ isDirectory: () => true }),
    nodeVersion: "22.19.0",
    execPath: "/fake/node/bin/node",
    resolveEntryImpl: fixture.resolveEntryImpl,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/fake/node/bin/node");
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
