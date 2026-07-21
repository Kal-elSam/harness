import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  ENGRAM_INTEGRATION_STATUS,
  engramSetupSlugForAgent,
  inspectEngramAgentConfig
} from "../src/global/integrations/engram-evidence.js";
import { planEngramConfigure } from "../src/global/integrations/engram-plan.js";
import {
  captureEngramObservedFiles,
  diffEngramObservedFiles,
  hashFileContents,
  saveEngramReceipt
} from "../src/global/integrations/engram-receipts.js";
import { rollbackEngramReceipt } from "../src/global/integrations/engram-rollback.js";

test("pi Engram slug, evidence, conflicts, and restart_required plan", () => {
  assert.equal(engramSetupSlugForAgent("pi"), "pi");

  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-pi-engram-"));
  try {
    const agentDir = join(homeDir, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });

    assert.equal(inspectEngramAgentConfig("pi", { homeDir }).status, ENGRAM_INTEGRATION_STATUS.UNCONFIGURED);

    writeFileSync(join(agentDir, "settings.json"), "{not-json", "utf8");
    assert.equal(inspectEngramAgentConfig("pi", { homeDir }).status, ENGRAM_INTEGRATION_STATUS.CONFLICT);

    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:other"] }), "utf8");
    writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { engram: { command: "engram" } } }), "utf8");
    assert.equal(inspectEngramAgentConfig("pi", { homeDir }).status, ENGRAM_INTEGRATION_STATUS.UNCONFIGURED);

    writeFileSync(join(agentDir, "mcp.json"), "[]", "utf8");
    assert.equal(inspectEngramAgentConfig("pi", { homeDir }).status, ENGRAM_INTEGRATION_STATUS.CONFLICT);

    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ packages: ["npm:gentle-engram@0.1.8", "npm:pi-mcp-adapter"] }),
      "utf8"
    );
    writeFileSync(
      join(agentDir, "mcp.json"),
      JSON.stringify({ mcpServers: { engram: { command: "engram", args: ["mcp"] } } }),
      "utf8"
    );
    const configured = inspectEngramAgentConfig("pi", { homeDir });
    assert.equal(configured.status, ENGRAM_INTEGRATION_STATUS.CONFIGURED);
    assert.equal(configured.evidence.filter((item) => item.present).length, 2);

    const plan = planEngramConfigure({
      requestedAgentIds: ["pi"],
      inspect: () => ({
        provider: "engram",
        status: ENGRAM_INTEGRATION_STATUS.UNCONFIGURED,
        binary: {
          path: "/opt/engram",
          version: "1.19.0",
          status: ENGRAM_INTEGRATION_STATUS.AVAILABLE,
          supported: true,
          guidance: null
        },
        agents: [{ id: "pi", slug: "pi", status: ENGRAM_INTEGRATION_STATUS.UNCONFIGURED, evidence: [] }],
        doctorInvoked: false
      })
    });
    assert.deepEqual(plan.actions[0].command, ["/opt/engram", "setup", "pi"]);
    assert.equal(plan.nextStatusIfApplied, ENGRAM_INTEGRATION_STATUS.RESTART_REQUIRED);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("pi Engram rollback restores hashed files and leaves provider packages as residue", async () => {
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-pi-engram-rb-"));
  try {
    const agentDir = join(homeDir, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    const settingsPath = join(agentDir, "settings.json");
    const mcpPath = join(agentDir, "mcp.json");
    writeFileSync(settingsPath, JSON.stringify({ packages: [] }), "utf8");
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }), "utf8");

    const before = await captureEngramObservedFiles(["pi"], { homeDir });
    assert.equal(before.every((entry) => entry.ownership === "kairo"), true);

    writeFileSync(
      settingsPath,
      JSON.stringify({ packages: ["npm:gentle-engram", "npm:pi-mcp-adapter"] }),
      "utf8"
    );
    writeFileSync(
      mcpPath,
      JSON.stringify({ mcpServers: { engram: { command: "engram" } } }),
      "utf8"
    );
    const packageResiduePath = join(agentDir, "packages", "gentle-engram", "package.json");
    mkdirSync(dirnameSafe(packageResiduePath), { recursive: true });
    writeFileSync(packageResiduePath, JSON.stringify({ name: "gentle-engram" }), "utf8");

    const after = await captureEngramObservedFiles(["pi"], { homeDir });
    const changes = [
      ...diffEngramObservedFiles(before, after),
      {
        path: packageResiduePath,
        agentId: "pi",
        kind: "plugin",
        ownership: "provider",
        change: "created",
        beforeHash: null,
        afterHash: hashFileContents(JSON.stringify({ name: "gentle-engram" }))
      }
    ];

    const backupDir = join(homeDir, ".harness", "integrations", "engram", "backups", "engram-pi");
    mkdirSync(backupDir, { recursive: true });
    const settingsBackup = join(backupDir, "settings");
    const mcpBackup = join(backupDir, "mcp");
    writeFileSync(settingsBackup, JSON.stringify({ packages: [] }), "utf8");
    writeFileSync(mcpBackup, JSON.stringify({ mcpServers: {} }), "utf8");

    for (const change of changes) {
      if (change.path === settingsPath) change.afterHash = hashFileContents(JSON.stringify({ packages: ["npm:gentle-engram", "npm:pi-mcp-adapter"] }));
      if (change.path === mcpPath) {
        change.afterHash = hashFileContents(JSON.stringify({ mcpServers: { engram: { command: "engram" } } }));
      }
    }

    await saveEngramReceipt({
      id: "engram-pi",
      touchedMemoryDb: false,
      changes,
      backups: [
        { path: settingsPath, backupPath: settingsBackup, beforeHash: hashFileContents(JSON.stringify({ packages: [] })) },
        { path: mcpPath, backupPath: mcpBackup, beforeHash: hashFileContents(JSON.stringify({ mcpServers: {} })) }
      ]
    }, { homeDir });

    const rolled = await rollbackEngramReceipt({
      receiptId: "engram-pi",
      homeDir,
      dryRun: true,
      yes: true,
      interactive: false
    });
    assert.ok(rolled.actions.some((action) => action.action === "restore"));
    assert.ok(rolled.actions.some((action) => action.action === "residue"));
    assert.equal(rolled.touchedMemoryDb, false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

function dirnameSafe(path) {
  return path.slice(0, path.lastIndexOf("/"));
}
