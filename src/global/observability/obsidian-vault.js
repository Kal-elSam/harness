import { existsSync } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { isPathInside } from "../component-paths.js";

/** Obsidian vault subfolder Kairo may read — never the whole vault. */
export const KAIRO_VAULT_SUBDIR = "Kairo";

/** Directory basenames refused anywhere under the Kairo tree. */
export const EXCLUDED_DIR_NAMES = Object.freeze([
  ".obsidian", ".git", ".trash", "attachments", "Attachment", "Assets", "assets"
]);

const SECRET_BASENAME = /(?:^|\.)(env|secret|secrets|credentials|token|tokens|key|keys|pem|p12|pfx)(?:\.|$)/i;
const MARKDOWN_EXT = /\.md$/i;
const MAX_NOTES = 200;
const MAX_WALK_DEPTH = 8;

function envelope(partial = {}) {
  return {
    state: "error",
    vaultPath: null,
    kairoRoot: null,
    notes: [],
    diagnostics: [],
    error: null,
    ...partial
  };
}

/** Absolute vault path only — no home expansion, no relative paths. */
export function normalizeVaultPath(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, reason: "vaultPath required" };
  }
  const trimmed = raw.trim();
  if (!isAbsolute(trimmed)) {
    return { ok: false, reason: "vaultPath must be absolute" };
  }
  const resolved = resolve(trimmed);
  if (resolved.includes("\0")) {
    return { ok: false, reason: "vaultPath invalid" };
  }
  return { ok: true, path: resolved };
}

export function isExcludedDirName(name) {
  return EXCLUDED_DIR_NAMES.includes(String(name ?? ""));
}

export function isSecretBasename(name) {
  return SECRET_BASENAME.test(String(name ?? ""));
}

export function isAllowedKairoNoteName(name) {
  const base = basename(String(name ?? ""));
  if (!MARKDOWN_EXT.test(base)) return false;
  if (isSecretBasename(base)) return false;
  if (base.startsWith(".")) return false;
  return true;
}

/**
 * Candidate must resolve inside kairoRoot (realpath). Symlinks that escape fail.
 * Relative segments with `..` that leave Kairo/ fail before IO when possible.
 */
export async function assertInsideKairoRoot(candidatePath, kairoRoot, {
  lstatFn = lstat,
  realpathFn = realpath,
  existsFn = existsSync
} = {}) {
  const root = resolve(kairoRoot);
  const claimed = resolve(candidatePath);
  if (!isPathInside(root, claimed) && claimed !== root) {
    return { ok: false, reason: "path escapes Kairo/" };
  }
  if (!existsFn(claimed)) {
    return { ok: true, path: claimed, missing: true };
  }
  try {
    const st = await lstatFn(claimed);
    if (st.isSymbolicLink()) {
      const target = await realpathFn(claimed);
      if (!isPathInside(root, target) && target !== root) {
        return { ok: false, reason: "symlink escapes Kairo/" };
      }
      return { ok: true, path: target, symlink: true };
    }
    const real = await realpathFn(claimed);
    if (!isPathInside(root, real) && real !== root) {
      return { ok: false, reason: "realpath escapes Kairo/" };
    }
    return { ok: true, path: real };
  } catch {
    return { ok: false, reason: "path unreadable" };
  }
}

async function refuseVaultSymlink(vaultPath, { lstatFn = lstat } = {}) {
  try {
    if ((await lstatFn(vaultPath)).isSymbolicLink()) {
      return "vault root is a symlink; refusing";
    }
  } catch {
    return "vault unreadable";
  }
  return null;
}

/**
 * Read-only inspect of an Obsidian vault's Kairo/ subtree.
 * Never writes; never reads Engram/Graphify stores; never opens .obsidian.
 */
export async function inspectObsidianVault({
  vaultPath,
  lstatFn = lstat,
  readdirFn = readdir,
  realpathFn = realpath,
  existsFn = existsSync,
  maxNotes = MAX_NOTES
} = {}) {
  const norm = normalizeVaultPath(vaultPath);
  if (!norm.ok) {
    return envelope({ state: "unavailable", error: norm.reason, diagnostics: [norm.reason] });
  }
  const root = norm.path;
  if (!existsFn(root)) {
    return envelope({
      state: "missing", vaultPath: root, error: "vault missing",
      diagnostics: ["vault path does not exist"]
    });
  }
  const vaultSym = await refuseVaultSymlink(root, { lstatFn });
  if (vaultSym) {
    return envelope({
      state: "error", vaultPath: root, error: vaultSym, diagnostics: [vaultSym]
    });
  }

  let vaultReal;
  try { vaultReal = await realpathFn(root); }
  catch {
    return envelope({
      state: "error", vaultPath: root, error: "vault unreadable",
      diagnostics: ["vault realpath failed"]
    });
  }

  const kairoRoot = join(vaultReal, KAIRO_VAULT_SUBDIR);
  if (!existsFn(kairoRoot)) {
    return envelope({
      state: "partial", vaultPath: vaultReal, kairoRoot,
      error: null, diagnostics: ["Kairo/ subdirectory missing"]
    });
  }

  const kairoGate = await assertInsideKairoRoot(kairoRoot, kairoRoot, {
    lstatFn, realpathFn, existsFn
  });
  if (!kairoGate.ok) {
    return envelope({
      state: "error", vaultPath: vaultReal, kairoRoot,
      error: kairoGate.reason, diagnostics: [kairoGate.reason]
    });
  }
  if (kairoGate.symlink) {
    return envelope({
      state: "error", vaultPath: vaultReal, kairoRoot,
      error: "Kairo/ is a symlink; refusing",
      diagnostics: ["Kairo/ is a symlink; refusing"]
    });
  }

  const notes = [];
  const diagnostics = [];
  await walkKairoNotes(kairoGate.path, kairoGate.path, {
    notes, diagnostics, depth: 0, maxNotes,
    lstatFn, readdirFn, realpathFn, existsFn
  });

  return envelope({
    state: "available",
    vaultPath: vaultReal,
    kairoRoot: kairoGate.path,
    notes,
    diagnostics,
    error: null
  });
}

async function walkKairoNotes(dir, kairoRoot, ctx) {
  if (ctx.notes.length >= ctx.maxNotes || ctx.depth > MAX_WALK_DEPTH) return;
  let entries;
  try {
    entries = await ctx.readdirFn(dir, { withFileTypes: true });
  } catch {
    ctx.diagnostics.push("directory unreadable");
    return;
  }

  const ordered = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of ordered) {
    if (ctx.notes.length >= ctx.maxNotes) break;
    const name = entry.name;
    if (name === "." || name === ".." || name.includes("\0")) continue;
    if (isExcludedDirName(name)) continue;

    const full = join(dir, name);
    const gate = await assertInsideKairoRoot(full, kairoRoot, {
      lstatFn: ctx.lstatFn, realpathFn: ctx.realpathFn, existsFn: ctx.existsFn
    });
    if (!gate.ok) {
      ctx.diagnostics.push(`skipped unsafe path (${gate.reason})`);
      continue;
    }
    if (gate.missing) continue;

    let st;
    try { st = await ctx.lstatFn(full); }
    catch {
      ctx.diagnostics.push("entry unreadable");
      continue;
    }

    if (st.isSymbolicLink()) {
      ctx.diagnostics.push("skipped symlink");
      continue;
    }
    if (st.isDirectory()) {
      await walkKairoNotes(gate.path, kairoRoot, { ...ctx, depth: ctx.depth + 1 });
      continue;
    }
    if (!st.isFile()) continue;
    if (!isAllowedKairoNoteName(name)) continue;

    const rel = gate.path.slice(kairoRoot.length).replace(/^[\\/]/, "").split(sep).join("/");
    ctx.notes.push({
      relativePath: rel,
      title: basename(name, ".md")
    });
  }
}

/** Pure helper for callers composing relative note paths under Kairo/. */
export function resolveKairoNotePath(kairoRoot, relativePath) {
  const root = resolve(kairoRoot);
  const parts = String(relativePath ?? "").split(/[/\\]/).filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === ".." || p.includes("\0"))) {
    return { ok: false, reason: "invalid relativePath" };
  }
  if (parts.some((p) => isExcludedDirName(p) || isSecretBasename(p))) {
    return { ok: false, reason: "relativePath excluded" };
  }
  const claimed = resolve(join(root, ...parts));
  if (!isPathInside(root, claimed)) {
    return { ok: false, reason: "path escapes Kairo/" };
  }
  return { ok: true, path: claimed };
}
