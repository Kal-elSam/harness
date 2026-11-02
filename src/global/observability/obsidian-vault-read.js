import { constants } from "node:fs";
import { open, opendir, realpath, stat } from "node:fs/promises";
import { basename, join, relative, isAbsolute, win32 } from "node:path";
import { hashBuffer } from "../../hash.js";
import { readObsidianConfig } from "../obsidian-command.js";
import { resolveHomeDir } from "../paths.js";
import { loadObsidianVaultStatus } from "./obsidian-status.js";
import { normalizeVaultPath, isExcludedDirName, isSecretBasename } from "./obsidian-vault.js";
import { parseKnowledgeFrontmatter } from "./obsidian-knowledge-views.js";

export const VAULT_READ_LIMITS = Object.freeze({
  fileBytes: 256 * 1024, contentBytes: 16 * 1024, walked: 1000,
  results: 50, depth: 16, snippet: 240, query: 1000
});
const excluded = name => isExcludedDirName(name)
  || [".obsidian", ".kairo-backups", ".trash"].includes(name.toLowerCase());
const secret = name => isSecretBasename(name)
  || /secret|token|credential|^id_(rsa|dsa|ecdsa|ed25519)(\.|$)|\.(pem|key|p12|pfx)(\.|$)/i.test(name);
const inside = (root, candidate) => {
  const rel = relative(root, candidate);
  return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
};
const allowed = path => path.split(/[\\/]/).every(part => !excluded(part) && !secret(part) && !part.startsWith("."))
  && /\.md$/i.test(path);
const failure = code => ({ state: "error", code });

async function vaultRoot(homeDir) {
  const config = await readObsidianConfig(homeDir);
  if (!config.vaultPath) return { state: (await loadObsidianVaultStatus()).state, code: "not_configured" };
  const normalized = normalizeVaultPath(config.vaultPath);
  if (!normalized.ok) return failure("invalid_vault");
  try {
    const root = await realpath(normalized.path);
    return (await stat(root)).isDirectory() ? { root } : failure("invalid_vault");
  } catch { return failure("vault_unavailable"); }
}

function validatePath(path) {
  if (typeof path !== "string" || !path || path.length > 4096 || path.includes("\0") || isAbsolute(path)
    || win32.isAbsolute(path) || path.includes("\\") || path.split("/").some(p => p === ".." || p === "." || !p)) return "invalid_path";
  return allowed(path) ? null : "forbidden_path";
}

/** Resolve both lexical and canonical paths before touching a note. Never follow an escaping link. */
async function readNote(root, path) {
  const invalid = validatePath(path);
  if (invalid) return failure(invalid);
  let handle;
  try {
    const real = await realpath(join(root, path));
    if (!inside(root, real) || !allowed(relative(root, real))) return failure("forbidden_path");
    handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    // Revalidate after opening, including inode identity, to reject path replacement races.
    const current = await realpath(join(root, path));
    if (current !== real || !inside(root, current) || !allowed(relative(root, current))) return failure("forbidden_path");
    const named = await stat(current);
    if (before.dev !== named.dev || before.ino !== named.ino || !before.isFile()) return failure("forbidden_path");
    if (before.size > VAULT_READ_LIMITS.fileBytes) return failure("file_too_large");
    const buffer = Buffer.alloc(VAULT_READ_LIMITS.fileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > VAULT_READ_LIMITS.fileBytes) return failure("file_too_large");
    return { buffer: buffer.subarray(0, length) };
  } catch { return failure("note_unavailable"); }
  finally { await handle?.close(); }
}

/** Hash covers full accepted bytes, even when returned UTF-8 content is truncated. */
export async function readObsidianVaultNote({ homeDir = resolveHomeDir(), path } = {}) {
  const vault = await vaultRoot(homeDir);
  if (!vault.root) return vault;
  const note = await readNote(vault.root, path);
  if (!note.buffer) return note;
  let content = note.buffer.subarray(0, VAULT_READ_LIMITS.contentBytes).toString("utf8");
  while (Buffer.byteLength(content) > VAULT_READ_LIMITS.contentBytes) content = content.slice(0, -1);
  return { state: "available", code: "ok", path, content,
    sha256: hashBuffer(note.buffer), truncated: note.buffer.length > VAULT_READ_LIMITS.contentBytes };
}

/** Bounded depth-first walk. Directory streams avoid unbounded readdir allocations. */
export async function searchObsidianVault({ homeDir = resolveHomeDir(), query, project, kind, limit = 20 } = {}) {
  const vault = await vaultRoot(homeDir);
  if (!vault.root) return vault;
  if (typeof query !== "string" || !query.trim() || query.length > VAULT_READ_LIMITS.query
    || (project !== undefined && (typeof project !== "string" || project.length > 256))
    || (kind !== undefined && (typeof kind !== "string" || kind.length > 256))) return failure("invalid_query");
  const max = Number.isFinite(limit) ? Math.max(1, Math.min(VAULT_READ_LIMITS.results, Math.floor(limit))) : 20;
  const results = [];
  let walked = 0;
  let truncated = false;
  const needle = query.toLowerCase();
  async function walk(dir, depth) {
    if (depth > VAULT_READ_LIMITS.depth) { truncated = true; return; }
    let stream;
    try {
      const real = await realpath(dir);
      if (real !== vault.root && (!inside(vault.root, real) || relative(vault.root, real).split(/[\\/]/).some(p => excluded(p) || secret(p) || p.startsWith(".")))) return;
      stream = await opendir(real);
      for await (const entry of stream) {
        if (walked >= VAULT_READ_LIMITS.walked || results.length >= max) { truncated = true; break; }
        walked++;
        if (excluded(entry.name) || secret(entry.name) || entry.name.startsWith(".")) continue;
        const path = join(dir, entry.name);
        // Directory symlinks are not traversed, preventing aliases, cycles and duplicate walks.
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (/\.md$/i.test(entry.name) && (entry.isFile() || entry.isSymbolicLink())) {
          const rel = relative(vault.root, path).split("\\").join("/");
          const note = await readNote(vault.root, rel);
          if (!note.buffer) continue;
          const text = note.buffer.toString("utf8");
          const { fields, body } = parseKnowledgeFrontmatter(text);
          if (project !== undefined && fields.project !== project) continue;
          if (kind !== undefined && (fields.kairo_kind ?? fields.kind) !== kind) continue;
          const title = (fields.title || body.match(/^#\s+(.+)$/m)?.[1] || basename(rel, ".md")).slice(0, 240);
          if (!`${rel}\n${title}\n${text}`.toLowerCase().includes(needle)) continue;
          const hit = body.toLowerCase().indexOf(needle);
          const snippet = body.slice(Math.max(0, hit - 60), Math.max(0, hit - 60) + VAULT_READ_LIMITS.snippet).replace(/\s+/g, " ").trim();
          // Bound metadata as well as snippets: frontmatter can occupy the entire file.
          const frontmatter = Object.fromEntries(Object.entries(fields).slice(0, 32).map(([k, v]) => [k.slice(0, 128), v.slice(0, 512)]));
          results.push({ path: rel, title, frontmatter, snippet, sha256: hashBuffer(note.buffer) });
        }
      }
    } catch { truncated = true; }
  }
  await walk(vault.root, 0);
  return { state: "available", code: "ok", results, walked, truncated };
}
