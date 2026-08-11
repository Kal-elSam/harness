import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_ACCESS,
  detectAgentMcpRegistration,
  mapCompanionToConnections,
  resolveMcpConfigPath
} from "../src/global/connections.js";
import { actionsForConnection } from "../src/global/connection-actions.js";
import {
  buildMcpInstallPlan,
  runMcpInstall
} from "../src/global/mcp-install.js";

test("mapCompanionToConnections builds five chip fields from companion + agent", () => {
  const chips = mapCompanionToConnections({
    ok: true,
    signals: {
      gentle: { state: "available" },
      hermes: { activity: { state: "missing" } },
      graphify: { state: "available", graphStatus: "stale" }
    },
    engram: { status: "configured" }
  }, {
    connected: false,
    state: "not_connected",
    detail: "not registered"
  });

  assert.equal(chips.length, 5);
  assert.equal(chips[0].id, "gentle");
  assert.equal(chips[0].state, "available");
  assert.equal(chips[0].access, CONNECTION_ACCESS.gentle);
  assert.equal(chips[0].optional, true);
  assert.ok(Array.isArray(chips[0].actions));
  assert.equal(chips[1].id, "hermes");
  assert.equal(chips[1].state, "missing");
  assert.ok(chips[1].actions.some((a) => a.kind === "guide"));
  assert.equal(chips[2].id, "engram");
  assert.equal(chips[2].state, "configured");
  assert.equal(chips[3].id, "graphify");
  assert.equal(chips[3].state, "stale");
  assert.ok(chips[3].actions.some((a) => a.command === "graphify update ."));
  assert.match(chips[3].detail, /stale/i);
  assert.equal(chips[4].id, "agent");
  assert.equal(chips[4].state, "not_connected");
  assert.ok(chips[4].actions.some((a) => a.id === "connect-agent"));
});

test("engram unconfigured offers configure dry-run action", () => {
  const { actions, optional } = actionsForConnection({
    id: "engram",
    state: "unconfigured",
    detail: "needs configure"
  });
  assert.equal(optional, true);
  assert.ok(actions.some((a) => a.id === "configure-engram" && /engram-memory/.test(a.command)));
});

test("hermes unavailable offers Start Hermes gateway", () => {
  const { actions, optional } = actionsForConnection({
    id: "hermes",
    state: "unavailable",
    detail: "API down"
  });
  assert.equal(optional, true);
  assert.ok(actions.some((a) => a.id === "start-hermes" && a.command === "hermes gateway run"));
});

test("detectAgentMcpRegistration reads mcpServers.kairo", async () => {
  const path = resolveMcpConfigPath("cursor", { homeDir: "/tmp/fake-home" });
  assert.match(path, /\.cursor\/mcp\.json$/);

  const missing = await detectAgentMcpRegistration({
    homeDir: "/tmp/fake-home",
    readFileFn: async () => {
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    }
  });
  assert.equal(missing.connected, false);
  assert.equal(missing.state, "not_connected");

  const connected = await detectAgentMcpRegistration({
    homeDir: "/tmp/fake-home",
    readFileFn: async () => JSON.stringify({
      mcpServers: { kairo: { command: "kairo", args: ["mcp"] }, engram: {} }
    })
  });
  assert.equal(connected.connected, true);
  assert.equal(connected.state, "connected");
});

test("mcp install plans without --yes and applies with backup", async () => {
  const writes = [];
  const copies = [];
  const ruleCalls = [];
  const homeDir = "/tmp/kairo-mcp-home";

  const planOnly = await runMcpInstall({
    homeDir,
    yes: false,
    json: true,
    readFileFn: async () => {
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    },
    writeAtomicJsonFn: async () => {
      throw new Error("should not write");
    },
    ensureRule: async (opts) => {
      ruleCalls.push(opts);
      return {
        path: `${homeDir}/.cursor/rules/kairo-work-snapshot.mdc`,
        wouldWrite: true,
        wrote: false,
        backupPath: null
      };
    }
  });
  assert.equal(planOnly.applied, false);
  assert.equal(planOnly.plan.entry.command, "kairo");
  assert.equal(planOnly.plan.ruleWouldWrite, true);
  assert.match(planOnly.plan.rulePath, /kairo-work-snapshot\.mdc$/);
  assert.equal(ruleCalls[0].apply, false);

  const existing = { mcpServers: { engram: { command: "engram" } } };
  const applied = await runMcpInstall({
    homeDir,
    yes: true,
    json: true,
    now: () => 42,
    readFileFn: async () => JSON.stringify(existing),
    mkdirFn: async () => {},
    copyFileFn: async (from, to) => { copies.push({ from, to }); },
    writeAtomicJsonFn: async (path, value) => { writes.push({ path, value }); },
    ensureRule: async (opts) => {
      ruleCalls.push(opts);
      return {
        path: `${homeDir}/.cursor/rules/kairo-work-snapshot.mdc`,
        wouldWrite: true,
        wrote: opts.apply === true,
        backupPath: null
      };
    }
  });
  assert.equal(applied.applied, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value.mcpServers.engram.command, "engram");
  assert.deepEqual(writes[0].value.mcpServers.kairo, { command: "kairo", args: ["mcp"] });
  assert.equal(copies.length, 1);
  assert.match(copies[0].to, /\.kairo-backup\.42$/);
  assert.equal(applied.ruleWrote, true);
  assert.ok(ruleCalls.some((c) => c.apply === true));

  const planned = buildMcpInstallPlan({
    homeDir,
    existing: { mcpServers: { kairo: { command: "kairo", args: ["mcp"] } } },
    alreadyConnected: true
  });
  assert.equal(planned.wouldWrite, false);
  assert.match(planned.rulePath, /kairo-work-snapshot\.mdc$/);
});
