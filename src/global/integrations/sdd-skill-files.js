import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isPathInside } from "../component-paths.js";
import { resolveCanonicalSddSkillDir } from "./sdd-destinations.js";

export function normalizeSkillRelativePath(relativePath) {
  return String(relativePath ?? "").split(sep).join("/");
}

export function compareSkillPaths(left, right) {
  const a = normalizeSkillRelativePath(left);
  const b = normalizeSkillRelativePath(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertSafeRelative(root, absolutePath) {
  const rel = normalizeSkillRelativePath(relative(root, absolutePath));
  if (!rel || rel.startsWith("../") || rel.split("/").includes("..")) {
    throw new Error(`Skill path escapes skill root: ${rel || "."}`);
  }
  if (!isPathInside(root, absolutePath) && resolve(absolutePath) !== root) {
    throw new Error(`Skill path escapes skill root: ${rel}`);
  }
  return rel;
}

export async function listSddSkillFiles(skillDir) {
  const root = resolve(skillDir);
  const files = [];
  await walk(root, root, files);
  files.sort((a, b) => compareSkillPaths(a.relativePath, b.relativePath));
  return files;
}

async function walk(root, dir, files) {
  for (const name of (await readdir(dir)).sort()) {
    const absolutePath = join(dir, name);
    const relativePath = assertSafeRelative(root, absolutePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) throw new Error(`Symlink refused in skill: ${relativePath}`);
    if (stats.isDirectory()) { await walk(root, absolutePath, files); continue; }
    if (!stats.isFile()) throw new Error(`Non-regular file refused in skill: ${relativePath}`);
    files.push({ relativePath, absolutePath });
  }
}

export async function readSddSkillFiles(skillDir) {
  return Promise.all((await listSddSkillFiles(skillDir)).map(async (entry) => ({
    ...entry, bytes: await readFile(entry.absolutePath)
  })));
}

export function hashSddSkillFiles(files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => compareSkillPaths(a.relativePath, b.relativePath))) {
    hash.update(normalizeSkillRelativePath(file.relativePath));
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function loadCanonicalSddSkill(skillId, packageRoot) {
  const files = await readSddSkillFiles(resolveCanonicalSddSkillDir(skillId, packageRoot));
  return { files, skillHash: hashSddSkillFiles(files) };
}
