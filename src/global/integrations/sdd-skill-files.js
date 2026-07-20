import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isPathInside } from "../component-paths.js";
import { resolveCanonicalSddSkillDir } from "./sdd-destinations.js";
export function normalizeSkillRelativePath(p) {
  return String(p ?? "").split(sep).join("/");
}
export function compareSkillPaths(left, right) {
  const a = normalizeSkillRelativePath(left), b = normalizeSkillRelativePath(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
function assertSafeRelative(root, absolutePath) {
  const rel = normalizeSkillRelativePath(relative(root, absolutePath));
  if (!rel || rel.startsWith("../") || rel.split("/").includes("..")
    || (!isPathInside(root, absolutePath) && resolve(absolutePath) !== root)) {
    throw new Error(`Skill path escapes skill root: ${rel || "."}`);
  }
  return rel;
}
function u32be(n) {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(n >>> 0);
  return buf;
}
export async function listSddSkillFiles(skillDir) {
  const root = resolve(skillDir), rootStats = await lstat(root);
  if (rootStats.isSymbolicLink()) throw new Error("Skill root is a symlink; refusing.");
  if (!rootStats.isDirectory()) throw new Error("Skill root is not a directory; refusing.");
  const files = [];
  await walk(root, root, files);
  return files.sort((a, b) => compareSkillPaths(a.relativePath, b.relativePath));
}
async function walk(root, dir, files) {
  for (const name of (await readdir(dir)).sort()) {
    const absolutePath = join(dir, name), relativePath = assertSafeRelative(root, absolutePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) throw new Error(`Symlink refused in skill: ${relativePath}`);
    if (stats.isDirectory()) { await walk(root, absolutePath, files); continue; }
    if (!stats.isFile()) throw new Error(`Non-regular file refused in skill: ${relativePath}`);
    files.push({ relativePath, absolutePath });
  }
}
export async function readSddSkillFiles(skillDir) {
  return Promise.all((await listSddSkillFiles(skillDir)).map(async (e) => (
    { ...e, bytes: await readFile(e.absolutePath) }
  )));
}
export function hashSddSkillFiles(files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => compareSkillPaths(a.relativePath, b.relativePath))) {
    const path = Buffer.from(normalizeSkillRelativePath(file.relativePath), "utf8");
    hash.update(u32be(path.length)).update(path);
    hash.update(u32be(file.bytes.length)).update(file.bytes);
  }
  return hash.digest("hex");
}
export async function loadCanonicalSddSkill(skillId, packageRoot) {
  const files = await readSddSkillFiles(resolveCanonicalSddSkillDir(skillId, packageRoot));
  return { files, skillHash: hashSddSkillFiles(files) };
}
