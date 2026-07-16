import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(packageRoot, "global-template", "components", "sdd-core", "skills");
const EXPECTED_SKILLS = [
  "sdd-init",
  "sdd-explore",
  "sdd-propose",
  "sdd-spec",
  "sdd-design"
];

test("sdd-core canonical phase skills ship valid frontmatter", async () => {
  for (const skillId of EXPECTED_SKILLS) {
    const content = await readFile(join(skillsRoot, skillId, "SKILL.md"), "utf8");

    assert.match(content, /^---\n[\s\S]+?\n---\n/m);
    assert.match(content, new RegExp(`name:\\s*${skillId}`));
    assert.match(content, /description:\s*".+"/);
    assert.match(content, /## Source of truth/);
  }
});
