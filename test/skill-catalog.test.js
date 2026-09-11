import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFrontmatter, readSkillCatalog } from "../src/global/intelligence/skill-catalog.js";

async function writeSkill(root, dirRel, name, frontmatter) {
  const dir = join(root, dirRel, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), frontmatter, "utf8");
}

test("parseSkillFrontmatter reads the vercel-labs/skills format (name + description)", () => {
  const text = "---\nname: go-testing\ndescription: Apply focused Go testing patterns.\nmetadata:\n  internal: true\n---\n\n# Go Testing\nBody text here.";
  const fields = parseSkillFrontmatter(text);
  assert.equal(fields.name, "go-testing");
  assert.equal(fields.description, "Apply focused Go testing patterns.");
});

test("parseSkillFrontmatter returns null when there is no frontmatter block", () => {
  assert.equal(parseSkillFrontmatter("# Just a heading, no frontmatter"), null);
  assert.equal(parseSkillFrontmatter(""), null);
});

test("readSkillCatalog reads real name/description across all standard skill roots, skipping entries without both", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-skill-catalog-"));
  await writeSkill(root, "docs/skills", "go-testing", "---\nname: go-testing\ndescription: Apply focused Go testing patterns.\n---\nBody");
  await writeSkill(root, ".claude/skills", "branch-pr", "---\nname: branch-pr\ndescription: Create Gentle AI pull requests with issue-first checks.\n---\nBody");
  await writeSkill(root, ".claude/skills", "no-description", "---\nname: broken\n---\nBody");
  await mkdir(join(root, "docs/skills", "not-a-skill-just-a-file"), { recursive: true }); // dir with no SKILL.md

  const catalog = await readSkillCatalog(root);
  assert.equal(catalog.length, 2);
  const names = catalog.map((s) => s.name).sort();
  assert.deepEqual(names, ["branch-pr", "go-testing"]);
  const goTesting = catalog.find((s) => s.name === "go-testing");
  assert.equal(goTesting.description, "Apply focused Go testing patterns.");
  assert.equal(goTesting.path, "docs/skills/go-testing/SKILL.md");
});

test("readSkillCatalog returns an empty list when no skill directories exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-skill-catalog-empty-"));
  assert.deepEqual(await readSkillCatalog(root), []);
});
