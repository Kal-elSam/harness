import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashBuffer } from "../src/hash.js";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import { resolveCanonicalSddSkillPath, resolveSddSkillPath } from "../src/global/integrations/sdd-destinations.js";
import { loadSddReceipt, saveSddReceipt } from "../src/global/integrations/sdd-receipts.js";
import { rollbackSddReceipt } from "../src/global/integrations/sdd-rollback.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = (name) => mkdtempSync(join(process.cwd(), name));

test("rollback blocks manipulated destinationPath without mutating files", async () => {
  const homeDir = home(".tmp-sdd-rb-hard-");
  try {
    await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-hard-1"
    });
    const receipt = await loadSddReceipt("sdd-hard-1", { homeDir });
    const target = resolveSddSkillPath("sdd-init", "codex", homeDir);
    const outside = join(homeDir, "escape.txt");
    writeFileSync(outside, "secret\n");
    receipt.files = receipt.files.map((file) =>
      file.destinationPath === target ? { ...file, destinationPath: outside } : file
    );
    await saveSddReceipt(receipt, { homeDir });

    const blocked = await rollbackSddReceipt({
      receiptId: "sdd-hard-1", homeDir, yes: true, interactive: false
    });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.ok, false);
    assert.equal(readFileSync(outside, "utf8"), "secret\n");
    assert.equal(
      readFileSync(target, "utf8"),
      readFileSync(resolveCanonicalSddSkillPath("sdd-init", packageRoot), "utf8")
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("rollback blocks tampered backup and refuses symlink destinations", async () => {
  const homeDir = home(".tmp-sdd-rb-sym-");
  try {
    const first = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-sym-1"
    });
    const skillPath = resolveSddSkillPath("sdd-tasks", "codex", homeDir);
    const tracked = Object.fromEntries(
      first.receipt.files.filter((e) => e.afterHash).map((e) => [e.destinationPath, e.afterHash])
    );
    writeFileSync(skillPath, "# stale managed\n");
    const updated = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-sym-2",
      trackedFiles: { ...tracked, [skillPath]: hashBuffer(Buffer.from("# stale managed\n")) }
    });
    assert.ok(updated.receipt.backups.some((e) => e.path === skillPath));

    const receipt = await loadSddReceipt("sdd-sym-2", { homeDir });
    const backup = receipt.backups.find((e) => e.path === skillPath);
    writeFileSync(backup.backupPath, "tampered backup\n");
    const badBackup = await rollbackSddReceipt({
      receiptId: "sdd-sym-2", homeDir, yes: true, interactive: false
    });
    assert.equal(badBackup.blocked, true);
    assert.ok(badBackup.actions.some((a) => /Backup hash/.test(a.reason ?? "")));

    writeFileSync(backup.backupPath, "# stale managed\n");
    writeFileSync(skillPath, readFileSync(resolveCanonicalSddSkillPath("sdd-tasks", packageRoot)));
    rmSync(skillPath, { force: true });
    const decoy = join(homeDir, "decoy.txt");
    writeFileSync(decoy, readFileSync(resolveCanonicalSddSkillPath("sdd-tasks", packageRoot)));
    symlinkSync(decoy, skillPath);

    const sym = await rollbackSddReceipt({
      receiptId: "sdd-sym-2", homeDir, yes: true, interactive: false
    });
    assert.equal(sym.ok, false);
    assert.ok(sym.actions.some((a) => /symlink/i.test(a.reason ?? "")));
    assert.equal(
      readFileSync(decoy, "utf8"),
      readFileSync(resolveCanonicalSddSkillPath("sdd-tasks", packageRoot), "utf8")
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("rollback blocks backup paths that escape the receipt backup directory", async () => {
  const homeDir = home(".tmp-sdd-rb-esc-");
  try {
    const first = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-esc-1"
    });
    const skillPath = resolveSddSkillPath("sdd-archive", "codex", homeDir);
    const tracked = Object.fromEntries(
      first.receipt.files.filter((e) => e.afterHash).map((e) => [e.destinationPath, e.afterHash])
    );
    writeFileSync(skillPath, "old\n");
    await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-esc-2",
      trackedFiles: { ...tracked, [skillPath]: hashBuffer(Buffer.from("old\n")) }
    });

    const receipt = await loadSddReceipt("sdd-esc-2", { homeDir });
    const escapeBackup = join(homeDir, "evil-backup");
    writeFileSync(escapeBackup, "old\n");
    receipt.backups = receipt.backups.map((e) =>
      e.path === skillPath ? { ...e, backupPath: escapeBackup } : e
    );
    await saveSddReceipt(receipt, { homeDir });
    writeFileSync(skillPath, readFileSync(resolveCanonicalSddSkillPath("sdd-archive", packageRoot)));

    const blocked = await rollbackSddReceipt({
      receiptId: "sdd-esc-2", homeDir, yes: true, interactive: false
    });
    assert.equal(blocked.blocked, true);
    assert.ok(blocked.actions.some((a) => /escapes|does not match/i.test(a.reason ?? "")));
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
