import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Reads the real project-local skill catalog (SKILL.md name + description
// per skill) from the same directories context-compiler.js already scans
// for skill *names* — this reads their real descriptions too, so the
// execution router can match a task against what a skill actually claims
// to do instead of guessing from bare folder names.
const SKILL_ROOTS = ["docs/skills", ".cursor/skills", ".codex/skills", ".claude/skills"];

/**
 * Minimal frontmatter parser for SKILL.md's `---\nkey: value\n---` header —
 * no YAML dependency, since skill frontmatter is flat key/value pairs (per
 * the vercel-labs/skills format: required `name` and `description`).
 * @param {string} text
 */
export function parseSkillFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? "");
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const fieldMatch = /^([\w.-]+):\s*(.*)$/.exec(line.trim());
    if (!fieldMatch) continue;
    fields[fieldMatch[1]] = fieldMatch[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

/**
 * Reads every SKILL.md under this project's standard skill directories and
 * returns their real `name`/`description`. Skills without both fields are
 * skipped rather than guessed at.
 * @param {string} root - project root
 * @returns {Promise<Array<{name: string, description: string, path: string}>>}
 */
export async function readSkillCatalog(root) {
  const skills = [];
  const seenNames = new Set();
  for (const skillRoot of SKILL_ROOTS) {
    const dir = join(root, skillRoot);
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;
      let raw;
      try {
        raw = await readFile(skillMdPath, "utf8");
      } catch {
        continue;
      }
      const frontmatter = parseSkillFrontmatter(raw);
      const name = frontmatter?.name ?? entry.name;
      if (!frontmatter?.description || seenNames.has(name)) continue;
      seenNames.add(name);
      skills.push({ name, description: frontmatter.description, path: join(skillRoot, entry.name, "SKILL.md") });
    }
  }
  return skills;
}
