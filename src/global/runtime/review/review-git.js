import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  REVIEW_SCOPE_MODES,
  REVIEW_SNAPSHOT_ERROR_CODES,
  ReviewSnapshotError,
  assertReviewPathSafe,
  assertWithinReviewLimits,
  canonicalFingerprint,
  isBinaryContent,
  isReviewPrivatePath,
  requirePrivateConsent,
  resolveReviewScopeMode
} from "./review-types.js";

const defaultExecFile = promisify(execFileCb);

/** lstat + open(O_NOFOLLOW); never follows symlinks or non-regular leaves. */
export async function readReviewRegularFile(absPath) {
  let st;
  try { st = await lstat(absPath); }
  catch (error) {
    error.code = error.code ?? "ENOENT";
    throw error;
  }
  if (st.isSymbolicLink()) {
    const error = new Error(`Refusing symlink "${absPath}".`);
    error.code = "REVIEW_SYMLINK";
    throw error;
  }
  if (!st.isFile()) {
    const error = new Error(`Refusing non-regular file "${absPath}".`);
    error.code = "REVIEW_NON_REGULAR";
    throw error;
  }
  let handle;
  try {
    handle = await open(absPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ELOOP" || error?.code === "EMLINK") {
      const wrapped = new Error(`Refusing symlink "${absPath}".`);
      wrapped.code = "REVIEW_SYMLINK";
      throw wrapped;
    }
    throw error;
  }
  try { return await handle.readFile(); }
  finally { await handle.close(); }
}

async function git(cwd, args, execFileImpl) {
  try {
    const { stdout } = await execFileImpl("git", args, {
      cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024
    });
    return stdout ?? "";
  } catch (error) {
    throw new ReviewSnapshotError(String(error?.stderr ?? error?.message ?? error).trim() || "git failed", { code: REVIEW_SNAPSHOT_ERROR_CODES.INVALID_REF, details: { args, status: error?.code ?? null } });
  }
}

async function assertGitRepo(cwd, execFileImpl) {
  try {
    if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"], execFileImpl)).trim() !== "true") {
      throw new Error("not git");
    }
  } catch (error) {
    if (error instanceof ReviewSnapshotError && error.code === REVIEW_SNAPSHOT_ERROR_CODES.INVALID_REF) {
      throw new ReviewSnapshotError("Not a git repository.", {
        code: REVIEW_SNAPSHOT_ERROR_CODES.NOT_A_GIT_REPO
      });
    }
    throw error;
  }
}

function unquotePath(path) {
  if (path.startsWith("\"") && path.endsWith("\"")) {
    try { return JSON.parse(path); } catch { return path.slice(1, -1); }
  }
  return path;
}

function parseNumstat(text) {
  const byPath = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [addedRaw, deletedRaw, pathRaw] = line.split("\t");
    if (!pathRaw) continue;
    const path = pathRaw.includes(" => ") ? pathRaw.split(" => ").at(-1) : pathRaw;
    const n = (addedRaw === "-" ? 0 : Number(addedRaw)) + (deletedRaw === "-" ? 0 : Number(deletedRaw));
    byPath.set(path, (byPath.get(path) ?? 0) + n);
  }
  return byPath;
}

function parsePorcelain(text) {
  return text.split("\n").filter(Boolean).map((line) => {
    const status = line.slice(0, 2);
    const rest = line.slice(3);
    if (rest.includes(" -> ")) {
      const [from, to] = rest.split(" -> ");
      return { status, sourcePath: unquotePath(from), path: unquotePath(to) };
    }
    return { status, sourcePath: null, path: unquotePath(rest) };
  });
}

function parseNameStatus(text) {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const parts = line.split("\t");
    if (parts.length >= 3) {
      return { status: parts[0], sourcePath: unquotePath(parts[1]), path: unquotePath(parts[2]) };
    }
    return { status: parts[0], sourcePath: null, path: unquotePath(parts[1]) };
  });
}

function fingerprintPayload(s) {
  return {
    mode: s.mode, headSha: s.headSha, base: s.base ?? null, commit: s.commit ?? null,
    files: s.files.map((f) => ({
      path: f.path, sourcePath: f.sourcePath ?? null, status: f.status, hash: f.hash, changedLines: f.changedLines
    })),
    excluded: s.excluded.map((e) => ({ path: e.path, reason: e.reason }))
  };
}

/** Bounded Git review snapshot via argv-only git (no shell, no repo writes). */
export async function resolveReviewSnapshot({
  cwd, base = null, commit = null, includePrivate = false, privateConfirmed = false,
  execFileImpl = defaultExecFile
} = {}) {
  const mode = resolveReviewScopeMode({ base, commit });
  await assertGitRepo(cwd, execFileImpl);
  const headSha = (await git(cwd, ["rev-parse", "HEAD"], execFileImpl)).trim();
  let rawEntries = [];
  let numstat = new Map();
  let diffBytes = 0;

  if (mode === REVIEW_SCOPE_MODES.WORKING_TREE) {
    rawEntries = parsePorcelain(await git(cwd, ["status", "--porcelain=v1", "-uall"], execFileImpl));
    numstat = new Map([
      ...parseNumstat(await git(cwd, ["diff", "--numstat"], execFileImpl)),
      ...parseNumstat(await git(cwd, ["diff", "--cached", "--numstat"], execFileImpl))
    ]);
    diffBytes = Buffer.byteLength(await git(cwd, ["diff"], execFileImpl), "utf8")
      + Buffer.byteLength(await git(cwd, ["diff", "--cached"], execFileImpl), "utf8");
  } else if (mode === REVIEW_SCOPE_MODES.BASE) {
    const range = `${base}...HEAD`;
    await git(cwd, ["rev-parse", "--verify", base], execFileImpl);
    rawEntries = parseNameStatus(await git(cwd, ["diff", "--name-status", range], execFileImpl));
    numstat = parseNumstat(await git(cwd, ["diff", "--numstat", range], execFileImpl));
    diffBytes = Buffer.byteLength(await git(cwd, ["diff", range], execFileImpl), "utf8");
  } else {
    await git(cwd, ["rev-parse", "--verify", `${commit}^{commit}`], execFileImpl);
    rawEntries = parseNameStatus(
      await git(cwd, ["diff-tree", "--no-commit-id", "--name-status", "-r", commit], execFileImpl)
    );
    numstat = parseNumstat(
      await git(cwd, ["diff-tree", "--no-commit-id", "--numstat", "-r", commit], execFileImpl)
    );
    diffBytes = Buffer.byteLength(await git(cwd, ["show", "--format=", "--patch", commit], execFileImpl), "utf8");
  }

  const excluded = [];
  const privateCandidates = [];
  const files = [];

  for (const entry of rawEntries) {
    const path = assertReviewPathSafe(entry.path);
    const sourcePath = entry.sourcePath != null ? assertReviewPathSafe(entry.sourcePath) : null;
    const privateEnds = [path, sourcePath].filter(Boolean).filter((p) => isReviewPrivatePath(p));
    if (privateEnds.length > 0) {
      if (includePrivate) privateCandidates.push(...privateEnds);
      else { excluded.push({ path, reason: "private" }); continue; }
    }

    let hash;
    let changedLines = numstat.get(path) ?? 0;
    let bytes = 0;
    const deleted = /D/.test(entry.status);

    if (mode === REVIEW_SCOPE_MODES.WORKING_TREE && !deleted) {
      let buffer;
      try { buffer = await readReviewRegularFile(join(cwd, path)); }
      catch (error) {
        if (error?.code === "REVIEW_SYMLINK") { excluded.push({ path, reason: "symlink" }); continue; }
        if (error?.code === "REVIEW_NON_REGULAR") { excluded.push({ path, reason: "non-regular" }); continue; }
        throw error;
      }
      if (isBinaryContent(buffer)) { excluded.push({ path, reason: "binary" }); continue; }
      hash = createHash("sha256").update(buffer).digest("hex");
      bytes = buffer.length;
      if (!numstat.has(path)) changedLines = buffer.toString("utf8").split(/\r?\n/).length;
      if (entry.status === "??") diffBytes += bytes;
    } else {
      try { hash = (await git(cwd, ["rev-parse", `HEAD:${path}`], execFileImpl)).trim(); }
      catch { hash = createHash("sha256").update(`${entry.status}:${path}`).digest("hex"); }
    }

    files.push({
      path, sourcePath, status: entry.status.trim(), hash, changedLines, bytes
    });
  }

  requirePrivateConsent({ includePrivate, privateConfirmed, privatePaths: privateCandidates });
  files.sort((a, b) => a.path.localeCompare(b.path));
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  const changedLines = files.reduce((sum, f) => sum + f.changedLines, 0);
  assertWithinReviewLimits({ fileCount: files.length, changedLines, diffBytes });

  const snapshot = {
    version: 1, mode, cwd, headSha, base: base ?? null, commit: commit ?? null,
    files, excluded, totals: { fileCount: files.length, changedLines, diffBytes }, fingerprint: null
  };
  snapshot.fingerprint = canonicalFingerprint(fingerprintPayload(snapshot));
  return snapshot;
}

export function fingerprintReviewSnapshot(snapshot) {
  return canonicalFingerprint(fingerprintPayload(snapshot));
}

export async function detectReviewSnapshotDrift(previous, options = {}) {
  const next = await resolveReviewSnapshot({
    cwd: previous.cwd, base: previous.base, commit: previous.commit,
    includePrivate: options.includePrivate ?? false,
    privateConfirmed: options.privateConfirmed ?? false,
    execFileImpl: options.execFileImpl
  });
  return {
    stale: next.fingerprint !== previous.fingerprint,
    previousFingerprint: previous.fingerprint,
    nextFingerprint: next.fingerprint,
    next
  };
}
