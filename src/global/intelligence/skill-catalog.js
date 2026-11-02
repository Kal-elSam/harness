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

const USER_SKILL_ROOTS = [".claude/skills", ".codex/skills", ".agents/skills"];

/**
 * Every installed SKILL.md a seat specialty may link to: the project skill
 * catalog, the paths the skill registry (`.atl/skill-registry.md`) lists, and
 * the user-level skill roots. Missing roots and unreadable files are skipped.
 * @param {{root: string, homeDir?: string|null, catalog?: Array<{name: string, path: string}>}} args
 * @returns {Promise<Array<{name: string, path: string}>>}
 */
export async function readInstalledSkills({ root, homeDir = null, catalog = null } = {}) {
  const found = new Map();
  const add = (name, path) => { if (name && !found.has(name)) found.set(name, { name, path }); };
  for (const skill of catalog ?? await readSkillCatalog(root)) add(skill.name, skill.path);
  try {
    const registry = await readFile(join(root, ".atl", "skill-registry.md"), "utf8");
    for (const match of registry.matchAll(/([^\s`|()]+\/([\w.-]+)\/SKILL\.md)/g)) {
      const path = match[1].replace(/^~\//, homeDir ? `${homeDir}/` : "~/");
      if (path.startsWith("~") || existsSync(path.startsWith("/") ? path : join(root, path))) add(match[2], path);
    }
  } catch { /* No registry file. */ }
  if (homeDir) {
    for (const userRoot of USER_SKILL_ROOTS) {
      let entries = [];
      try { entries = await readdir(join(homeDir, userRoot), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const path = join(homeDir, userRoot, entry.name, "SKILL.md");
        if (entry.isDirectory() && existsSync(path)) add(entry.name, path);
      }
    }
  }
  return [...found.values()];
}

/**
 * Links a seat specialty to an installed skill: exact name first, then a skill
 * whose name contains the specialty as a whole word. Null when none exists.
 * @param {string} specialty
 * @param {Array<{name: string, path: string}>} skills
 */
export function resolveSkillForSpecialty(specialty, skills) {
  const wanted = String(specialty ?? "").toLowerCase();
  if (!wanted) return null;
  const words = skill => skill.name.toLowerCase().split(/[^a-z0-9]+/);
  const hit = skills.find(skill => skill.name.toLowerCase() === wanted)
    ?? skills.find(skill => words(skill).includes(wanted));
  return hit ? { name: hit.name, path: hit.path } : null;
}
