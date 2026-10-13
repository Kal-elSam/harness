import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultResolveKairoPiCliPath, openPiRpcBridge, KAIRO_WORKSPACE_SNAPSHOT_SCHEMA } from "../src/global/host/pi-rpc-bridge.js";
import { degradeCapabilities } from "../src/global/kernel/context-bundle.js";
import { buildKairoPiFixture } from "./helpers/kairo-pi-fixture.js";

test("missing Hermes does not fail RPC host opening", async () => {
  const fixture = await buildKairoPiFixture();
  const originalFlags = [process.env.KAIRO_PI_EMPTY_SESSIONS, process.env.PI_SKIP_VERSION_CHECK];
  const calls = [];
  const bridge = await openPiRpcBridge({
    cwd: "/abs/project", env: { HARNESS_HOME: "/abs/home", PATH: "" },
    loadSnapshot: async () => ({ schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA, project: { label: "demo" }, agents: [] }),
    resolveCliPath: () => defaultResolveKairoPiCliPath(fixture.resolveEntryImpl),
    execPath: "/fake/node/bin/node",
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      throw new Error("stubbed engine unavailable");
    }
  });
  assert.equal(bridge.hostOpen, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/fake/node/bin/node");
  assert.equal(calls[0].args[0], fixture.cliPath);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.KAIRO_PI_EMPTY_SESSIONS, "1");
  assert.equal(calls[0].options.env.PI_SKIP_VERSION_CHECK, "1");
  assert.deepEqual([process.env.KAIRO_PI_EMPTY_SESSIONS, process.env.PI_SKIP_VERSION_CHECK], originalFlags);
  assert.equal(calls[0].options.env.PI_CODING_AGENT_DIR, "/abs/home/.harness/pi-agent");
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

test("RPC spawn defaults to process.execPath without consulting PATH", async () => {
  let command;
  const bridge = await openPiRpcBridge({
    cwd: "/abs/project", env: { HARNESS_HOME: "/abs/home", PATH: "" },
    loadSnapshot: async () => ({ schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA, project: { label: "demo" }, agents: [] }),
    resolveCliPath: () => "/abs/cli.js",
    spawnImpl: (value) => { command = value; throw new Error("stubbed engine unavailable"); }
  });
  assert.equal(command, process.execPath);
  assert.equal(bridge.hostOpen, true);
});
