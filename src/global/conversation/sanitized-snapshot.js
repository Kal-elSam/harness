// The real defense the Bootstrap Analyst runs against: never the real
// project directory. A read-only sandbox (Codex) or an unrestricted
// permission mode (Claude, today) only ever governs WRITES — neither
// stops the model provider's own backend from receiving the real
// CONTENT of whatever the model reads as part of normal inference.
// "Read-only" is not "secret-safe".
//
// This builds a real temporary copy of the project's real text files,
// with every real matched secret redacted (secret-scanner.js) and every
// path context-compiler.js's own isPrivatePath already excludes from
// context skipped outright — the analyst's `cwd` points at THIS copy,
// so a normal investigation (listing/reading files within its working
// directory, which is how these agents actually explore) never sees an
// unredacted secret.
//
// HONEST LIMIT, verified empirically against the real Codex CLI, not
// assumed: `codex exec --sandbox read-only` does NOT confine file READS
// to cwd — a real test run against a real absolute path outside the
// snapshot successfully read that file's content. This is not a bug in
// Codex; "read-only" there means "no writes", full-disk read access is
// the documented default. So this module is NOT a hard filesystem
// sandbox, and must never be described as one. The real, remaining
// mitigation is that the analyst is never told the real project's
// absolute path (buildAnalystPrompt only ever passes profile.projectName,
// never a path) and .git is always excluded (no remote URL or other path
// hints to reconstruct it from) — so escaping requires the model to
// already know or guess a path it was never given, not merely wanting to.
// A genuine filesystem-level sandbox (OS-level process isolation) would
// be needed to close this completely; that's real, separate, larger
// work, not a redaction-module fix.

import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, dirname } from "node:path";
import { isPrivatePath } from "../intelligence/context-compiler.js";
import { redactSecrets } from "./secret-scanner.js";

// Directories that are never real source the analyst needs to read, and
// are often huge (vendor code, build output, VCS internals) — skipped
// outright rather than wastefully copied and scanned.
const EXCLUDED_DIR_NAMES = new Set([
  ".git", "node_modules", ".next", "dist", "build", ".turbo", ".cache", "coverage",
  ".codegraph", "graphify-out", ".venv", "__pycache__", ".pnpm"
]);

// A conservative allowlist of real source/text extensions — binary files
// (images, fonts, compiled artifacts) are never copied; there's nothing
// for the analyst to usefully read in them, and skipping avoids wasting
// the file/byte budget below on files that can't meaningfully leak text
// secrets anyway (a real secret embedded in a binary is a much rarer,
// separate risk this module doesn't attempt to solve).
const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".yml", ".yaml",
  ".toml", ".env.example", ".txt", ".css", ".scss", ".html", ".py", ".go", ".rs", ".rb",
  ".java", ".kt", ".swift", ".sh", ".graphql", ".sql", ".xml", ".vue", ".svelte"
]);

const DEFAULT_MAX_FILES = 400;
const DEFAULT_MAX_TOTAL_BYTES = 4 * 1024 * 1024; // 4 MiB — a real, bounded budget, not the whole repo
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;

function isTextFile(filePath) {
  for (const ext of TEXT_EXTENSIONS) {
    if (filePath.endsWith(ext)) return true;
  }
  return false;
}

async function walk(root, dir, budget, report, deps) {
  let entries;
  try {
    entries = await deps.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip, never throw and abort the whole snapshot
  }
  for (const entry of entries) {
    if (budget.filesCopied >= budget.maxFiles || budget.totalBytes >= budget.maxTotalBytes) return;
    const absolute = join(dir, entry.name);
    const rel = relative(root, absolute).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      await walk(root, absolute, budget, report, deps);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isPrivatePath(rel)) {
      report.excludedPrivatePaths.push(rel);
      continue;
    }
    if (!isTextFile(entry.name)) continue;
    let stats;
    try {
      stats = await deps.stat(absolute);
    } catch {
      continue;
    }
    if (stats.size > budget.maxFileBytes) {
      report.excludedOversized.push(rel);
      continue;
    }
    let content;
    try {
      content = await deps.readFile(absolute, "utf8");
    } catch {
      continue; // likely binary despite the extension allowlist, or unreadable — skip, never guess
    }
    const { text, redactedCount } = redactSecrets(content);
    const destination = join(budget.snapshotRoot, rel);
    await deps.mkdir(dirname(destination), { recursive: true });
    await deps.writeFile(destination, text, "utf8");
    report.copiedFiles.push(rel);
    budget.filesCopied += 1;
    budget.totalBytes += Buffer.byteLength(text, "utf8");
    report.filesCopied += 1;
    report.secretsRedacted += redactedCount;
    if (redactedCount > 0) report.redactedFiles.push(rel);
  }
}

/**
 * Builds a real, bounded, secret-redacted temporary copy of a project's
 * real text files — the Bootstrap Analyst's `cwd` must point here, never
 * at the real project root. Always call the returned `cleanup()` when
 * done (a `finally` in the caller), even on failure — never leave a
 * sanitized copy lying around.
 * @param {string} projectRoot
 * @param {{maxFiles?: number, maxTotalBytes?: number, maxFileBytes?: number}} [options]
 * @param {object} [deps] - injectable real fs/promises functions, for tests only (defaults to the real ones)
 * @returns {Promise<{snapshotRoot: string, filesCopied: number, secretsRedacted: number, redactedFiles: string[], excludedPrivatePaths: string[], excludedOversized: string[], cleanup: () => Promise<void>}>}
 */
export async function buildSanitizedSnapshot(projectRoot, options = {}, deps = {}) {
  const fsDeps = {
    readdir: deps.readdir ?? readdir, stat: deps.stat ?? stat, readFile: deps.readFile ?? readFile,
    mkdir: deps.mkdir ?? mkdir, writeFile: deps.writeFile ?? writeFile
  };
  const mkdtempImpl = deps.mkdtemp ?? mkdtemp;
  const snapshotRoot = await mkdtempImpl(join(tmpdir(), "kairo-analyst-snapshot-"));
  const budget = {
    snapshotRoot,
    filesCopied: 0, totalBytes: 0,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  };
  const report = { filesCopied: 0, secretsRedacted: 0, redactedFiles: [], copiedFiles: [], excludedPrivatePaths: [], excludedOversized: [] };
  const cleanup = () => rm(snapshotRoot, { recursive: true, force: true }).catch(() => {});
  // walk() itself only swallows per-entry errors (an unreadable dir/file
  // is skipped, never abandons the whole snapshot) — but an unexpected
  // failure (e.g. disk full mid-copy) can still throw. The mkdtemp'd
  // directory must never be left behind just because building it failed
  // partway through.
  try {
    await walk(projectRoot, projectRoot, budget, report, fsDeps);
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { snapshotRoot, ...report, cleanup };
}
