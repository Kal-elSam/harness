import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveSddSkillPath, resolveSddSkillRoot } from "../src/global/integrations/sdd-destinations.js";
import {
  assertSafePathChain, deleteRegularFileIfHash, parentRealpath, replaceRegularFile,
  resetOpenNoFollowFlagForTests, setAfterTombRenameForTests, setBeforeFinalGateForTests, snapshotRegularFile
} from "../src/global/integrations/sdd-fs-guard.js";
const tmp = (n) => mkdtempSync(join(process.cwd(), n));
test("CLI-local FS anchor, pre-gate drift, tombstone link", async () => {
  const h = tmp(".tmp-sdd-fs-");
  try {
    mkdirSync(join(h, "agents-real", "skills", "sdd-init"), { recursive: true });
    writeFileSync(join(h, "agents-real", "skills", "sdd-init", "SKILL.md"), "x\n"); symlinkSync(join(h, "agents-real"), join(h, ".agents"));
    assert.match((await assertSafePathChain(resolveSddSkillPath("sdd-init", "codex", h), resolveSddSkillRoot("codex", h), h)).reason, /symlink/i);
    rmSync(join(h, ".agents"), { force: true }); rmSync(join(h, "agents-real"), { recursive: true, force: true });
    const root = resolveSddSkillRoot("codex", h), path = resolveSddSkillPath("sdd-init", "codex", h);
    mkdirSync(dirname(path), { recursive: true });
    const parent = await parentRealpath(path), gate = { managedRoot: root, expectedParentRealpath: parent, trustedAnchor: h };
    await replaceRegularFile(path, Buffer.from("c\n"), { createExclusive: true, ...gate });
    const snap = await snapshotRegularFile(path);
    setBeforeFinalGateForTests(async () => {
      renameSync(join(h, ".agents"), join(h, "agents-real")); symlinkSync(join(h, "agents-real"), join(h, ".agents"));
    });
    await assert.rejects(() => replaceRegularFile(path, Buffer.from("x\n"), {
      expectedIno: snap.ino, expectedHash: snap.hash, ...gate
    }), /symlink|Parent realpath|Managed root/i);
    setBeforeFinalGateForTests(null); rmSync(join(h, ".agents"), { force: true }); renameSync(join(h, "agents-real"), join(h, ".agents"));
    writeFileSync(path, "tomb\n"); const del = await snapshotRegularFile(path);
    setAfterTombRenameForTests(async (p, tomb) => {
      writeFileSync(p, "reappeared\n");
      const alt = `${tomb}.alt`; writeFileSync(alt, "tomb\n"); renameSync(alt, tomb); // new inode, same bytes
    });
    const denied = await deleteRegularFileIfHash(path, del.hash, gate);
    assert.equal(denied.ok, false); assert.equal(readFileSync(path, "utf8"), "reappeared\n");
    assert.equal(readFileSync(denied.tombPath, "utf8"), "tomb\n");
  } finally { resetOpenNoFollowFlagForTests(); rmSync(h, { recursive: true, force: true }); }
});
