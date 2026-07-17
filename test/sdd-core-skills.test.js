import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import { resolveCanonicalSddSkillDir } from "../src/global/integrations/sdd-destinations.js";
import {
  hashSddSkillFiles, listSddSkillFiles, loadCanonicalSddSkill, readSddSkillFiles
} from "../src/global/integrations/sdd-skill-files.js";
import { verifySddConfigure } from "../src/global/integrations/sdd-verify.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(packageRoot, "global-template", "components", "sdd-core", "skills");
const EXPECTED_SKILLS = [
  "sdd-init",
  "sdd-explore",
  "sdd-propose",
  "sdd-spec",
  "sdd-design",
  "sdd-tasks",
  "sdd-apply",
  "sdd-verify",
  "sdd-archive"
];
const tmp = (n) => mkdtempSync(join(process.cwd(), n));

test("sdd-core ships exactly nine unique skills with valid frontmatter", async () => {
  assert.equal(new Set(EXPECTED_SKILLS).size, 9);

  for (const skillId of EXPECTED_SKILLS) {
    const content = await readFile(join(skillsRoot, skillId, "SKILL.md"), "utf8");
    const contract = await readFile(join(skillsRoot, skillId, "references/contract.md"), "utf8");

    assert.match(content, /^---\n[\s\S]+?\n---\n/m);
    assert.match(content, new RegExp(`name:\\s*${skillId}`));
    assert.match(content, /description:\s*".+"/);
    assert.match(content, /## Source of truth/);
    assert.match(content, /\[Phase contract\]\(references\/contract\.md\)/);
    assert.match(contract, /Activation:[\s\S]*Hard rules:[\s\S]*Gates:[\s\S]*Steps:[\s\S]*Output:/);
  }
});

test("skill hash length-safe; symlinks refused; refs materialize/noop", async () => {
  const { files, skillHash } = await loadCanonicalSddSkill("sdd-init", packageRoot);
  assert.equal(hashSddSkillFiles([...files].reverse()), skillHash);
  assert.notEqual(
    hashSddSkillFiles([{ relativePath: "a", bytes: Buffer.from("\0b") }]),
    hashSddSkillFiles([{ relativePath: "a\0", bytes: Buffer.from("b") }])
  );
  const h = tmp(".tmp-sdd-hash-");
  try {
    mkdirSync(join(h, "references"), { recursive: true });
    for (const f of files) writeFileSync(join(h, f.relativePath), f.bytes);
    const before = hashSddSkillFiles(await readSddSkillFiles(h));
    writeFileSync(join(h, "references/contract.md"), "mutated\n");
    assert.notEqual(hashSddSkillFiles(await readSddSkillFiles(h)), before);
  } finally { rmSync(h, { recursive: true, force: true }); }
  const s = tmp(".tmp-sdd-sym-");
  try {
    writeFileSync(join(s, "SKILL.md"), "x\n");
    symlinkSync(join(s, "SKILL.md"), join(s, "link.md"));
    await assert.rejects(() => listSddSkillFiles(s), /Symlink refused/);
    const r = tmp(".tmp-sdd-rootlink-");
    try {
      symlinkSync(s, join(r, "skill"));
      await assert.rejects(() => listSddSkillFiles(join(r, "skill")), /Skill root is a symlink/);
    } finally { rmSync(r, { recursive: true, force: true }); }
  } finally { rmSync(s, { recursive: true, force: true }); }
  const home = tmp(".tmp-sdd-contracts-");
  try {
    const first = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir: home, packageRoot, yes: true, receiptId: "sdd-c1"
    });
    assert.equal(first.summary.create, 18);
    const ref = join(home, ".agents/skills/sdd-init/references/contract.md");
    const canon = join(resolveCanonicalSddSkillDir("sdd-init", packageRoot), "references/contract.md");
    assert.equal(readFileSync(ref, "utf8"), readFileSync(canon, "utf8"));
    const tracked = Object.fromEntries(
      first.receipt.files.filter((e) => e.afterHash).map((e) => [e.destinationPath, e.afterHash])
    );
    assert.equal((await verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir: home, packageRoot, trackedFiles: tracked
    })).summary.configured, 18);
    rmSync(ref);
    assert.equal((await verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir: home, packageRoot, trackedFiles: tracked
    })).summary.missing, 1);
    writeFileSync(ref, readFileSync(canon));
    assert.equal((await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir: home, packageRoot, yes: true, receiptId: "sdd-c2", trackedFiles: tracked
    })).summary.noop, 18);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("teaching persona stays optional and explanation-scoped", async () => {
  const content = await readFile(
    join(packageRoot, "global-template", "components", "sdd-core", "personas", "teaching.md"),
    "utf8"
  );

  assert.match(content, /Enabled only with `--persona teaching`/);
  assert.match(content, /Default is `off`/);
  assert.match(content, /Does not affect/);
  assert.match(content, /generated code/);
  assert.match(content, /Never override higher-authority instructions/);
});
