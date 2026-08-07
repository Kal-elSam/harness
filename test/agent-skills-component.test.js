import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_SKILLS_IDS,
  buildAgentSkillsManagedSection
} from "../src/global/components/agent-skills.js";
import { resolveComponent } from "../src/global/component-registry.js";
import { readComponentCatalogDocument } from "../src/global/load-component-catalog.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentSkillsRoot = join(packageRoot, "global-template/components/agent-skills");

test("catalog lists agent-skills as optional complementary component", () => {
  const catalog = readComponentCatalogDocument();
  const entry = catalog.components.find((component) => component.id === "agent-skills");

  assert.ok(entry);
  assert.equal(entry.defaultEnabled, false);
  assert.deepEqual(entry.capabilities, ["skills.complementary"]);
  assert.ok(entry.assetFiles.includes("LICENSE"));
  assert.ok(entry.assetFiles.includes("PROVENANCE.md"));
  assert.deepEqual(
    entry.assetFiles.filter((asset) => asset.startsWith("skills/")).map((asset) => asset.split("/")[1]).sort(),
    [...AGENT_SKILLS_IDS].sort()
  );
});

test("agent-skills builder states Gentle AI methodological authority", () => {
  const component = resolveComponent("agent-skills");
  const section = component.buildManagedSection(
    { componentsDir: "/home/user/.harness/components" },
    { id: "cursor", assets: { configFile: ".cursor/AGENTS.md" } }
  );

  assert.match(section, /### Agent Skills \(complementary\)/);
  assert.match(section, /Gentle AI remains the methodological authority/);
  assert.match(section, /PROVENANCE\.md/);
  assert.equal(buildAgentSkillsManagedSection.length, 3);
});

test("only the five adopted complementary skills are vendored", () => {
  const skillDirs = readdirSync(join(agentSkillsRoot, "skills")).sort();
  assert.deepEqual(skillDirs, [...AGENT_SKILLS_IDS].sort());

  for (const skillId of AGENT_SKILLS_IDS) {
    assert.ok(readFileSync(join(agentSkillsRoot, "skills", skillId, "SKILL.md"), "utf8").length > 0);
  }

  const provenance = readFileSync(join(agentSkillsRoot, "PROVENANCE.md"), "utf8");
  assert.match(provenance, /https:\/\/github\.com\/addyosmani\/agent-skills/);
  assert.match(provenance, /d2478bf0c73a6357df39a3ed6aff16acaa218843/);
  assert.match(readFileSync(join(agentSkillsRoot, "LICENSE"), "utf8"), /MIT License/);

  const forbidden = [
    "spec-driven-development",
    "test-driven-development",
    "code-review-and-quality",
    "git-workflow-and-versioning"
  ];
  for (const name of forbidden) {
    assert.equal(skillDirs.includes(name), false, `must not vendor ${name}`);
  }
});
