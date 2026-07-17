import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listSddSkillFiles } from "../src/global/integrations/sdd-skill-files.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(packageRoot, "global-template", "components", "sdd-core", "skills");
const EXPECTED_SKILLS = [
  "sdd-init", "sdd-explore", "sdd-propose", "sdd-spec", "sdd-design",
  "sdd-tasks", "sdd-apply", "sdd-verify", "sdd-archive"
];

test("sdd-core ships exactly nine unique skills with valid frontmatter", async () => {
  assert.equal(new Set(EXPECTED_SKILLS).size, 9);

  for (const skillId of EXPECTED_SKILLS) {
    const skillDir = join(skillsRoot, skillId);
    const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
    const files = await listSddSkillFiles(skillDir);

    assert.match(content, /^---\n[\s\S]+?\n---\n/m);
    assert.match(content, new RegExp(`name:\\s*${skillId}`));
    assert.match(content, /description:\s*".+"/);
    assert.match(content, /## Source of truth/);
    assert.match(content, /\[Phase contract\]\(references\/contract\.md\)/);
    assert.ok(files.some((f) => f.relativePath === "references/contract.md"));
  }
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
