import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashBuffer } from "../src/hash.js";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import { classifySddVerifyHealth, SDD_HEALTH } from "../src/global/integrations/sdd-evidence.js";
import { resolveCanonicalSddSkillPath, resolveSddSkillPath } from "../src/global/integrations/sdd-destinations.js";
import { rollbackSddReceipt } from "../src/global/integrations/sdd-rollback.js";
import { syncSddConfigure, verifySddConfigure } from "../src/global/integrations/sdd-verify.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = (name) => mkdtempSync(join(process.cwd(), name));

test("verify separates missing, configured, canonical drift, and disk conflict", async () => {
  assert.equal(classifySddVerifyHealth({ exists: false, canonicalHash: "a" }).status, SDD_HEALTH.MISSING);
  assert.equal(classifySddVerifyHealth({
    exists: true, canonicalHash: "a", diskHash: "a", trackedHash: "a"
  }).status, SDD_HEALTH.CONFIGURED);
  assert.deepEqual(classifySddVerifyHealth({
    exists: true, canonicalHash: "b", diskHash: "a", trackedHash: "a"
  }), { status: SDD_HEALTH.DRIFTED, drift: "canonical", reason: "Managed bytes drifted from canonical." });
  assert.deepEqual(classifySddVerifyHealth({
    exists: true, canonicalHash: "a", diskHash: "x", trackedHash: "a"
  }), { status: SDD_HEALTH.CONFLICT, drift: "disk", reason: "Disk drifted from tracked hash." });
  assert.equal(classifySddVerifyHealth({
    exists: true, canonicalHash: "a", diskHash: "a", trackedHash: null
  }).status, SDD_HEALTH.CONFLICT);

  const homeDir = home(".tmp-sdd-verify-");
  try {
    const applied = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-verify-base"
    });
    const tracked = Object.fromEntries(
      applied.receipt.files.filter((e) => e.afterHash).map((e) => [e.destinationPath, e.afterHash])
    );
    const ok = await verifySddConfigure({ requestedAgentIds: ["codex"], homeDir, packageRoot, trackedFiles: tracked });
    assert.equal(ok.status, SDD_HEALTH.CONFIGURED);
    assert.equal(ok.summary.configured, 18);

    const path = resolveSddSkillPath("sdd-init", "codex", homeDir);
    writeFileSync(path, "# stale managed\n");
    const driftedTracked = { ...tracked, [path]: hashBuffer(Buffer.from("# stale managed\n")) };
    const drifted = await verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, trackedFiles: driftedTracked
    });
    assert.equal(drifted.status, SDD_HEALTH.DRIFTED);
    assert.ok(drifted.findings.some((e) => e.drift === "canonical"));

    writeFileSync(path, "user edited\n");
    const conflicted = await verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, trackedFiles: driftedTracked
    });
    assert.equal(conflicted.status, SDD_HEALTH.CONFLICT);
    assert.ok(conflicted.findings.some((e) => e.drift === "disk"));
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("sync blocks on conflicts; rollback deletes creates and restores updates only when afterHash matches", async () => {
  const homeDir = home(".tmp-sdd-rollback-");
  try {
    const skillPath = resolveSddSkillPath("sdd-tasks", "codex", homeDir);
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, "user owned\n");
    const blocked = await syncSddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-sync-block"
    });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.synced, false);
    assert.equal(readFileSync(skillPath, "utf8"), "user owned\n");
    rmSync(skillPath, { force: true });

    const first = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-rb-1"
    });
    const tracked = Object.fromEntries(
      first.receipt.files.filter((e) => e.afterHash).map((e) => [e.destinationPath, e.afterHash])
    );
    writeFileSync(skillPath, "# stale managed\n");
    const updated = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-rb-2",
      trackedFiles: { ...tracked, [skillPath]: hashBuffer(Buffer.from("# stale managed\n")) }
    });
    assert.ok((updated.receipt.backups ?? []).some((e) => e.path === skillPath));

    const dry = await rollbackSddReceipt({
      receiptId: "sdd-rb-2", homeDir, dryRun: true, yes: true, interactive: false
    });
    assert.ok(dry.actions.some((a) => a.action === "restore"));

    writeFileSync(skillPath, "edited after apply\n");
    const guarded = await rollbackSddReceipt({
      receiptId: "sdd-rb-2", homeDir, dryRun: false, yes: true, interactive: false
    });
    assert.ok(guarded.actions.some((a) => a.action === "skip" && /changed after apply/.test(a.reason)));
    assert.equal(readFileSync(skillPath, "utf8"), "edited after apply\n");

    writeFileSync(skillPath, readFileSync(resolveCanonicalSddSkillPath("sdd-tasks", packageRoot)));
    const restored = await rollbackSddReceipt({
      receiptId: "sdd-rb-2", homeDir, dryRun: false, yes: true, interactive: false
    });
    assert.ok(restored.actions.some((a) => a.action === "restore" && a.ok));
    assert.equal(readFileSync(skillPath, "utf8"), "# stale managed\n");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
