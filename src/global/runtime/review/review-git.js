import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
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
import { readReviewRegularFile } from "./review-fs.js";

export { readReviewRegularFile } from "./review-fs.js";

const defaultExecFile = promisify(execFileCb);

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
    files: s.files.map((f) => {
      const entry = {
        path: f.path, sourcePath: f.sourcePath ?? null, status: f.status,
        hash: f.hash, changedLines: f.changedLines
      };
      if (f.mode != null) entry.mode = f.mode;
      return entry;
    }),
    excluded: s.excluded.map((e) => ({ path: e.path, reason: e.reason }))
  };
}

function parseRawDiff(text) {
  return text.split("\n").filter((l) => l.startsWith(":")).map((line) => {
    const [meta, paths] = line.slice(1).split("\t");
    const parts = meta.trim().split(/\s+/);
    const [oldMode, newMode, oldHash, newHash, status] = parts;
    const pathParts = (paths ?? "").split("\t").map(unquotePath);
    if (pathParts.length >= 2) {
      return {
        oldMode, newMode, oldHash, newHash, status,
        sourcePath: pathParts[0], path: pathParts[1]
      };
    }
    return {
      oldMode, newMode, oldHash, newHash, status,
      sourcePath: null, path: pathParts[0]
    };
  });
}

async function blobIsBinary(cwd, blobHash, execFileImpl) {
  if (!blobHash || /^0+$/.test(blobHash)) return false;
  try {
    const { stdout } = await execFileImpl("git", ["cat-file", "-p", blobHash], {
      cwd, encoding: null, maxBuffer: 8 * 1024 * 1024
    });
    return isBinaryContent(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ""));
  } catch {
    return false;
  }
}

/** Bounded Git review snapshot via argv-only git (no shell, no repo writes). */
export async function resolveReviewSnapshot({
  cwd, base = null, commit = null, staged = false, includePrivate = false, privateConfirmed = false,
  execFileImpl = defaultExecFile
} = {}) {
  const mode = resolveReviewScopeMode({ base, commit, staged });
  await assertGitRepo(cwd, execFileImpl);
  const headSha = (await git(cwd, ["rev-parse", "HEAD"], execFileImpl)).trim();
  let rawEntries = [];
  let numstat = new Map();
  let diffBytes = 0;
  let rawIdentity = new Map();

  if (mode === REVIEW_SCOPE_MODES.WORKING_TREE) {
    rawEntries = parsePorcelain(await git(cwd, ["status", "--porcelain=v1", "-uall"], execFileImpl));
    numstat = new Map([
      ...parseNumstat(await git(cwd, ["diff", "--numstat"], execFileImpl)),
      ...parseNumstat(await git(cwd, ["diff", "--cached", "--numstat"], execFileImpl))
    ]);
    diffBytes = Buffer.byteLength(await git(cwd, ["diff"], execFileImpl), "utf8")
      + Buffer.byteLength(await git(cwd, ["diff", "--cached"], execFileImpl), "utf8");
  } else if (mode === REVIEW_SCOPE_MODES.STAGED) {
    rawEntries = parseNameStatus(await git(cwd, ["diff", "--cached", "--name-status"], execFileImpl));
    numstat = parseNumstat(await git(cwd, ["diff", "--cached", "--numstat"], execFileImpl));
    diffBytes = Buffer.byteLength(await git(cwd, ["diff", "--cached"], execFileImpl), "utf8");
    for (const entry of parseRawDiff(await git(cwd, ["diff", "--cached", "--raw"], execFileImpl))) {
      rawIdentity.set(entry.path, entry);
    }
  } else if (mode === REVIEW_SCOPE_MODES.BASE) {
    const range = `${base}...HEAD`;
    await git(cwd, ["rev-parse", "--verify", base], execFileImpl);
    rawEntries = parseNameStatus(await git(cwd, ["diff", "--name-status", range], execFileImpl));
    numstat = parseNumstat(await git(cwd, ["diff", "--numstat", range], execFileImpl));
    diffBytes = Buffer.byteLength(await git(cwd, ["diff", range], execFileImpl), "utf8");
  } else {
    await git(cwd, ["rev-parse", "--verify", `${commit}^{commit}`], execFileImpl);
    rawEntries = parseNameStatus(
      await git(cwd, ["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", commit], execFileImpl)
    );
    numstat = parseNumstat(
      await git(cwd, ["diff-tree", "--no-commit-id", "--numstat", "-r", "--root", commit], execFileImpl)
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
    let modeBits = null;
    let changedLines = numstat.get(path) ?? 0;
    let bytes = 0;
    const deleted = /D/.test(entry.status);

    if (mode === REVIEW_SCOPE_MODES.WORKING_TREE && !deleted) {
      let buffer;
      try { buffer = await readReviewRegularFile(join(cwd, path)); }
      catch (error) {
        if (error?.code === "REVIEW_SYMLINK") { excluded.push({ path, reason: "symlink" }); continue; }
        if (error?.code === "REVIEW_NON_REGULAR" || error?.code === "REVIEW_IDENTITY_CHANGED") {
          excluded.push({ path, reason: "non-regular" }); continue;
        }
        throw error;
      }
      if (isBinaryContent(buffer)) { excluded.push({ path, reason: "binary" }); continue; }
      hash = createHash("sha256").update(buffer).digest("hex");
      bytes = buffer.length;
      if (!numstat.has(path)) changedLines = buffer.toString("utf8").split(/\r?\n/).length;
      if (entry.status === "??") diffBytes += bytes;
    } else if (mode === REVIEW_SCOPE_MODES.STAGED) {
      const identity = rawIdentity.get(path);
      const blobHash = deleted
        ? (identity?.oldHash ?? null)
        : (identity?.newHash ?? null);
      modeBits = deleted ? (identity?.oldMode ?? null) : (identity?.newMode ?? null);
      if (modeBits === "000000") modeBits = identity?.oldMode ?? null;
      if (blobHash && !/^0+$/.test(blobHash) && await blobIsBinary(cwd, blobHash, execFileImpl)) {
        excluded.push({ path, reason: "binary" });
        continue;
      }
      if (blobHash && !/^0+$/.test(blobHash)) hash = blobHash;
      else hash = createHash("sha256").update(`${entry.status}:${path}`).digest("hex");
    } else {
      const blobRef = mode === REVIEW_SCOPE_MODES.COMMIT ? `${commit}:${path}` : `HEAD:${path}`;
      try { hash = (await git(cwd, ["rev-parse", blobRef], execFileImpl)).trim(); }
      catch { hash = createHash("sha256").update(`${entry.status}:${path}`).digest("hex"); }
    }

    const file = {
      path, sourcePath, status: entry.status.trim(), hash, changedLines, bytes
    };
    if (modeBits != null) file.mode = modeBits;
    files.push(file);
  }

  requirePrivateConsent({ includePrivate, privateConfirmed, privatePaths: privateCandidates });
  files.sort((a, b) => a.path.localeCompare(b.path));
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  const changedLines = files.reduce((sum, f) => sum + f.changedLines, 0);
  assertWithinReviewLimits({ fileCount: files.length, changedLines, diffBytes });

  const snapshot = {
    version: mode === REVIEW_SCOPE_MODES.STAGED ? 2 : 1,
    mode, cwd, headSha, base: base ?? null, commit: commit ?? null,
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
    staged: previous.mode === REVIEW_SCOPE_MODES.STAGED,
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

/** Fail-closed staged candidate check against a receipt snapshot. */
export async function verifyStagedReviewReceipt(receipt, {
  cwd = null, includePrivate = false, privateConfirmed = false, execFileImpl = defaultExecFile
} = {}) {
  const snapshot = receipt?.snapshot;
  if (!snapshot || snapshot.mode !== REVIEW_SCOPE_MODES.STAGED) {
    throw new ReviewSnapshotError("Staged verification requires a staged review receipt.", {
      code: REVIEW_SNAPSHOT_ERROR_CODES.INVALID_SCOPE,
      details: { mode: snapshot?.mode ?? null }
    });
  }
  const drift = await detectReviewSnapshotDrift(
    { ...snapshot, cwd: cwd ?? snapshot.cwd },
    { includePrivate, privateConfirmed, execFileImpl }
  );
  return {
    ok: !drift.stale,
    stale: drift.stale,
    previousFingerprint: drift.previousFingerprint,
    nextFingerprint: drift.nextFingerprint,
    headSha: drift.next.headSha
  };
}
