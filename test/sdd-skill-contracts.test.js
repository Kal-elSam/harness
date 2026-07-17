import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import { resolveCanonicalSddSkillDir } from "../src/global/integrations/sdd-destinations.js";
import {
  hashSddSkillFiles, listSddSkillFiles, loadCanonicalSddSkill, readSddSkillFiles
} from "../src/global/integrations/sdd-skill-files.js";
import { verifySddConfigure } from "../src/global/integrations/sdd-verify.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = (n) => mkdtempSync(join(process.cwd(), n));

test("skill hash stable; symlink refused; refs materialize/verify/noop", async () => {
  const { files, skillHash } = await loadCanonicalSddSkill("sdd-init", packageRoot);
  assert.deepEqual(files.map((f) => f.relativePath), ["SKILL.md", "references/contract.md"]);
  assert.equal(hashSddSkillFiles([...files].reverse()), skillHash);

  const hashDir = tmp(".tmp-sdd-hash-");
  try {
    mkdirSync(join(hashDir, "references"), { recursive: true });
    for (const file of files) writeFileSync(join(hashDir, file.relativePath), file.bytes);
    const before = hashSddSkillFiles(await readSddSkillFiles(hashDir));
    writeFileSync(join(hashDir, "references/contract.md"), "mutated\n");
    assert.notEqual(hashSddSkillFiles(await readSddSkillFiles(hashDir)), before);
  } finally { rmSync(hashDir, { recursive: true, force: true }); }

  const symDir = tmp(".tmp-sdd-sym-");
  try {
    writeFileSync(join(symDir, "SKILL.md"), "x\n");
    symlinkSync(join(symDir, "SKILL.md"), join(symDir, "link.md"));
    await assert.rejects(() => listSddSkillFiles(symDir), /Symlink refused/);
  } finally { rmSync(symDir, { recursive: true, force: true }); }

  const homeDir = tmp(".tmp-sdd-contracts-");
  try {
    const first = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-c1"
    });
    assert.equal(first.summary.create, 18);
    const ref = join(homeDir, ".agents/skills/sdd-init/references/contract.md");
    const canonical = join(resolveCanonicalSddSkillDir("sdd-init", packageRoot), "references/contract.md");
    assert.equal(readFileSync(ref, "utf8"), readFileSync(canonical, "utf8"));
    assert.ok(first.receipt.files.every((f) => f.relativePath && f.skillHash));
    const tracked = Object.fromEntries(
      first.receipt.files.filter((e) => e.afterHash).map((e) => [e.destinationPath, e.afterHash])
    );
    assert.equal((await verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, trackedFiles: tracked
    })).summary.configured, 18);
    rmSync(ref);
    assert.equal((await verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, trackedFiles: tracked
    })).summary.missing, 1);
    writeFileSync(ref, readFileSync(canonical));
    const second = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-c2", trackedFiles: tracked
    });
    assert.equal(second.summary.noop, 18);
    assert.equal(second.writes, false);
  } finally { rmSync(homeDir, { recursive: true, force: true }); }
});
