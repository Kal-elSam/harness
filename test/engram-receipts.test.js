import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  captureEngramObservedFiles,
  diffEngramObservedFiles,
  hashFileContents,
  saveEngramReceipt,
  loadEngramReceipt
} from "../src/global/integrations/engram-receipts.js";
import { rollbackEngramReceipt } from "../src/global/integrations/engram-rollback.js";

test("receipts hash observed files and rollback refuses edited artifacts", async () => {
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-engram-receipts-"));
  try {
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    const configPath = join(homeDir, ".codex", "config.toml");
    writeFileSync(configPath, "before\n");
    const before = await captureEngramObservedFiles(["codex"], { homeDir });
    assert.equal(before.find((e) => e.path === configPath).present, true);

    writeFileSync(configPath, "after\n");
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    const createdPath = join(homeDir, ".codex", "engram-instructions.md");
    writeFileSync(createdPath, "protocol\n");
    const pluginPath = join(homeDir, ".config", "opencode", "plugins", "engram.ts");
    mkdirSync(join(homeDir, ".config", "opencode", "plugins"), { recursive: true });
    writeFileSync(pluginPath, "export {}\n");

    const after = await captureEngramObservedFiles(["codex", "opencode"], { homeDir });
    const changes = diffEngramObservedFiles(before, after);
    assert.ok(changes.some((c) => c.path === configPath && c.change === "modified"));
    assert.ok(changes.some((c) => c.path === createdPath && c.change === "created"));
    assert.ok(changes.some((c) => c.path === pluginPath && c.ownership === "provider"));

    const backupDir = join(homeDir, ".harness", "integrations", "engram", "backups", "engram-test");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, "config");
    writeFileSync(backupPath, "before\n");

    const receipt = {
      id: "engram-test",
      touchedMemoryDb: false,
      changes,
      backups: [{ path: configPath, backupPath, beforeHash: hashFileContents("before\n") }]
    };
    // Fix afterHash on modified/created to current
    for (const change of receipt.changes) {
      if (change.path === configPath) change.afterHash = hashFileContents("after\n");
      if (change.path === createdPath) change.afterHash = hashFileContents("protocol\n");
      if (change.path === pluginPath) change.afterHash = hashFileContents("export {}\n");
    }
    await saveEngramReceipt(receipt, { homeDir });
    assert.equal((await loadEngramReceipt("engram-test", { homeDir })).id, "engram-test");

    const dry = await rollbackEngramReceipt({
      receiptId: "engram-test", homeDir, dryRun: true, yes: true, interactive: false
    });
    assert.equal(dry.touchedMemoryDb, false);
    assert.ok(dry.actions.some((a) => a.action === "restore"));
    assert.ok(dry.actions.some((a) => a.action === "delete"));
    assert.ok(dry.actions.some((a) => a.action === "residue"));

    writeFileSync(configPath, "edited-after-setup\n");
    writeFileSync(createdPath, "edited-protocol\n");
    const guarded = await rollbackEngramReceipt({
      receiptId: "engram-test", homeDir, dryRun: false, yes: true, interactive: false
    });
    assert.ok(guarded.actions.some((a) => a.action === "skip" && /changed after setup/.test(a.reason)));
    assert.ok(guarded.actions.some((a) => a.action === "skip" && /edited after setup/.test(a.reason)));
    assert.equal(readFileSync(configPath, "utf8"), "edited-after-setup\n");
    assert.equal(readFileSync(createdPath, "utf8"), "edited-protocol\n");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
